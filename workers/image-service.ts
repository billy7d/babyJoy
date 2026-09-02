import {
  MAX_STORED_IMAGE_BYTES,
  createImmutableImageKey,
  isAllowedImageType,
  isImmutableProductImageKey,
  type AllowedImageType,
} from "../shared/images";

export type ProductImageInput = {
  id?: string;
  r2Key?: string;
  altText?: string;
  sortOrder?: number;
};
export type NormalizedProductImage = {
  id?: string;
  r2Key: string;
  altText: string;
  sortOrder: number;
};

function toByteChunk(
  value: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  return value.buffer instanceof ArrayBuffer
    ? (value as Uint8Array<ArrayBuffer>)
    : new Uint8Array(value);
}

type FixedLengthStreamLike = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};
type FixedLengthStreamConstructor = new (
  length: number,
) => FixedLengthStreamLike;

function getFixedLengthStreamConstructor():
  | FixedLengthStreamConstructor
  | undefined {
  return (
    globalThis as typeof globalThis & {
      FixedLengthStream?: FixedLengthStreamConstructor;
    }
  ).FixedLengthStream;
}

export class ImageUploadError extends Error {
  constructor(
    public readonly code:
      "UNSUPPORTED_TYPE" | "TOO_LARGE" | "EMPTY" | "KEY_COLLISION",
  ) {
    super(code);
  }
}

export function normalizeProductImages(
  value: unknown,
): NormalizedProductImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20)
    throw new Error("VALIDATION_ERROR");
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error("VALIDATION_ERROR");
    const row = item as ProductImageInput;
    const r2Key = row.r2Key?.trim() ?? "";
    const altText = row.altText?.trim() ?? "";
    if (
      !isImmutableProductImageKey(r2Key) ||
      altText.length > 250 ||
      seen.has(r2Key)
    )
      throw new Error("VALIDATION_ERROR");
    seen.add(r2Key);
    return {
      id: row.id?.trim() || undefined,
      r2Key,
      altText,
      sortOrder: index,
    };
  });
}

export async function validateAssociatedImages(
  images: NormalizedProductImage[],
  bucket: R2Bucket,
): Promise<void> {
  const objects = await Promise.all(
    images.map((image) => bucket.head(image.r2Key)),
  );
  if (
    objects.some(
      (object) =>
        !object ||
        object.size > MAX_STORED_IMAGE_BYTES ||
        !isAllowedImageType(object.httpMetadata?.contentType ?? ""),
    )
  )
    throw new Error("INVALID_IMAGE_REFERENCE");
}

export async function uploadImmutableProductImage(
  request: Request,
  bucket: R2Bucket,
  options: { now?: Date; createUuid?: () => string } = {},
): Promise<{ key: string }> {
  const contentType =
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ??
    "";
  if (!isAllowedImageType(contentType))
    throw new ImageUploadError("UNSUPPORTED_TYPE");
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > MAX_STORED_IMAGE_BYTES
    )
      throw new ImageUploadError("TOO_LARGE");
  }
  if (!request.body) throw new ImageUploadError("EMPTY");

  const reader = request.body.getReader();
  let firstChunk: Uint8Array<ArrayBuffer> | undefined;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      reader.releaseLock();
      throw new ImageUploadError("EMPTY");
    }
    if (value?.byteLength) {
      firstChunk = toByteChunk(value);
      break;
    }
  }
  if (!firstChunk) {
    reader.releaseLock();
    throw new ImageUploadError("EMPTY");
  }
  if (firstChunk.byteLength > MAX_STORED_IMAGE_BYTES) {
    try {
      await reader.cancel();
    } catch {
      // Hủy reader là best effort; giới hạn vẫn được trả về cho client.
    } finally {
      reader.releaseLock();
    }
    throw new ImageUploadError("TOO_LARGE");
  }

  const initialChunk = firstChunk;
  const byteCounter = { value: initialChunk.byteLength };
  let firstChunkPending = true;
  const boundedStream = new ReadableStream<Uint8Array>({
    type: "bytes",
    async pull(controller) {
      if (firstChunkPending) {
        firstChunkPending = false;
        controller.enqueue(initialChunk);
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          reader.releaseLock();
          controller.close();
          return;
        }
        const chunk = toByteChunk(value);
        const nextLength = byteCounter.value + chunk.byteLength;
        if (nextLength > MAX_STORED_IMAGE_BYTES) {
          try {
            await reader.cancel();
          } catch {
            // Việc hủy reader chỉ là best effort khi client đã ngắt kết nối.
          }
          reader.releaseLock();
          controller.error(new ImageUploadError("TOO_LARGE"));
          return;
        }
        byteCounter.value = nextLength;
        controller.enqueue(chunk);
      } catch (caught) {
        try {
          reader.releaseLock();
        } catch {
          // Reader có thể đã tự giải phóng sau lỗi stream.
        }
        controller.error(caught);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch {
        // R2 có thể đã hủy reader trước khi callback này chạy.
      }
    },
  });

  const now = options.now ?? new Date();
  const createUuid = options.createUuid ?? (() => crypto.randomUUID());
  const key = createImmutableImageKey(
    contentType as AllowedImageType,
    now,
    createUuid(),
  );
  const putOptions = {
    onlyIf: new Headers({ "if-none-match": "*" }),
    storageClass: "Standard",
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  } satisfies R2PutOptions;

  let uploadValue: ReadableStream<Uint8Array> | Blob = boundedStream;
  let streamPump: Promise<void> | undefined;
  const FixedLengthStream = getFixedLengthStreamConstructor();
  if (FixedLengthStream && contentLengthHeader !== null) {
    // R2 cần biết trước độ dài stream; FixedLengthStream vẫn truyền dữ liệu theo luồng.
    const fixedLength = new FixedLengthStream(Number(contentLengthHeader));
    uploadValue = fixedLength.readable;
    streamPump = boundedStream.pipeTo(fixedLength.writable).catch((caught) => {
      if (caught instanceof ImageUploadError) throw caught;
      throw new ImageUploadError("TOO_LARGE");
    });
  } else if (FixedLengthStream && contentLengthHeader === null) {
    // Khi client không gửi Content-Length, chỉ giữ tối đa 1.5 MiB để tạo body có độ dài xác định cho R2.
    uploadValue = await new Response(boundedStream).blob();
  }

  let uploaded: R2Object | null;
  if (streamPump) {
    try {
      uploaded = await bucket.put(key, uploadValue, putOptions);
      await streamPump;
    } catch (caught) {
      await streamPump.catch(() => undefined);
      throw caught;
    }
  } else {
    uploaded = await bucket.put(key, uploadValue, putOptions);
  }
  // Tầng lưu trữ chỉ trả về khóa; API sẽ dựng URL theo môi trường của request.
  if (uploaded) return { key };
  throw new ImageUploadError("KEY_COLLISION");
}
