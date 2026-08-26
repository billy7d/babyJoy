import {
  MAX_IMAGE_BYTES,
  createImmutableImageKey,
  getPublicImageUrl,
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
        object.size > MAX_IMAGE_BYTES ||
        !isAllowedImageType(object.httpMetadata?.contentType ?? ""),
    )
  )
    throw new Error("INVALID_IMAGE_REFERENCE");
}

export async function uploadImmutableProductImage(
  request: Request,
  bucket: R2Bucket,
  options: { now?: Date; createUuid?: () => string } = {},
): Promise<{ key: string; url: string }> {
  const contentType =
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ??
    "";
  if (!isAllowedImageType(contentType))
    throw new ImageUploadError("UNSUPPORTED_TYPE");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_IMAGE_BYTES) throw new ImageUploadError("TOO_LARGE");
  if (!request.body) throw new ImageUploadError("EMPTY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new ImageUploadError("TOO_LARGE");
    }
    chunks.push(value);
  }
  if (!byteLength) throw new ImageUploadError("EMPTY");
  // Chỉ cấp phát bộ đệm sau khi stream đã được giới hạn ở 5 MB.
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });

  const now = options.now ?? new Date();
  const createUuid = options.createUuid ?? (() => crypto.randomUUID());
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const key = createImmutableImageKey(
      contentType as AllowedImageType,
      now,
      createUuid(),
    );
    const uploaded = await bucket.put(key, bytes.buffer, {
      onlyIf: new Headers({ "if-none-match": "*" }),
      storageClass: "Standard",
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    if (uploaded) return { key, url: getPublicImageUrl(key) };
  }
  throw new ImageUploadError("KEY_COLLISION");
}
