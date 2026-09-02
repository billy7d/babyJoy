import {
  MAX_IMAGE_LONG_EDGE,
  MAX_SOURCE_IMAGE_BYTES,
  MAX_STORED_IMAGE_BYTES,
  TARGET_IMAGE_BYTES,
  isAllowedImageType,
  type AllowedImageType,
} from "../../shared/images";

export const FAST_PATH_MAX_IMAGE_BYTES = 600 * 1024;
export const IMAGE_COMPRESSION_QUALITIES = [0.82, 0.78, 0.74, 0.7] as const;
export const IMAGE_RESIZE_EDGES = [MAX_IMAGE_LONG_EDGE, 1400, 1200] as const;

// Giới hạn pixel cho nhánh fallback không hỗ trợ decode-resize, tránh giải mã ảnh bất thường.
export const MAX_IMAGE_DECODE_PIXELS = 64_000_000;

export type OptimizedProductImage = {
  blob: Blob;
  mimeType: AllowedImageType;
  originalBytes: number;
  optimizedBytes: number;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
};

export type ImageDimensions = {
  width: number;
  height: number;
};

export type ImageCompressionStep = {
  maxLongEdge: number;
  quality: (typeof IMAGE_COMPRESSION_QUALITIES)[number];
};

export type ImageOptimizationErrorCode =
  | "UNSUPPORTED_TYPE"
  | "SOURCE_TOO_LARGE"
  | "EMPTY"
  | "INVALID_IMAGE"
  | "TOO_LARGE"
  | "UNSUPPORTED_BROWSER";

const IMAGE_OPTIMIZATION_MESSAGES: Record<
  ImageOptimizationErrorCode,
  string
> = {
  UNSUPPORTED_TYPE: "Chỉ hỗ trợ ảnh JPEG, PNG và WebP.",
  SOURCE_TOO_LARGE: "Ảnh vượt quá giới hạn 30 MB. Vui lòng chọn ảnh khác.",
  EMPTY: "Tệp ảnh đang trống.",
  INVALID_IMAGE: "Không thể đọc ảnh. Vui lòng chọn tệp ảnh khác.",
  TOO_LARGE: "Ảnh sau tối ưu vẫn vượt quá giới hạn lưu trữ 1.5 MB.",
  UNSUPPORTED_BROWSER: "Trình duyệt hiện tại không thể tối ưu ảnh.",
};

export class ImageOptimizationError extends Error {
  constructor(public readonly code: ImageOptimizationErrorCode) {
    super(IMAGE_OPTIMIZATION_MESSAGES[code]);
  }
}

export function calculateResizedDimensions(
  width: number,
  height: number,
  maxLongEdge = MAX_IMAGE_LONG_EDGE,
): ImageDimensions {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(maxLongEdge) ||
    maxLongEdge <= 0
  )
    throw new ImageOptimizationError("INVALID_IMAGE");

  const scale = Math.min(1, maxLongEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function buildImageCompressionPlan(): ImageCompressionStep[] {
  return IMAGE_RESIZE_EDGES.flatMap((maxLongEdge) =>
    IMAGE_COMPRESSION_QUALITIES.map((quality) => ({ maxLongEdge, quality })),
  );
}

function getSourceMimeType(file: Pick<Blob, "type">): AllowedImageType | null {
  const mimeType = file.type.split(";")[0].trim().toLowerCase();
  return isAllowedImageType(mimeType) ? mimeType : null;
}

function assertValidSource(
  file: Pick<Blob, "size" | "type">,
  mimeType: AllowedImageType | null,
): asserts mimeType is AllowedImageType {
  if (!mimeType) throw new ImageOptimizationError("UNSUPPORTED_TYPE");
  if (file.size <= 0) throw new ImageOptimizationError("EMPTY");
  if (file.size > MAX_SOURCE_IMAGE_BYTES)
    throw new ImageOptimizationError("SOURCE_TOO_LARGE");
}

export function validateProductImageSource(
  file: Pick<Blob, "size" | "type">,
): AllowedImageType {
  const mimeType = getSourceMimeType(file);
  assertValidSource(file, mimeType);
  return mimeType;
}

function loadImageElement(file: Blob): Promise<HTMLImageElement> {
  if (
    typeof globalThis.Image === "undefined" ||
    typeof globalThis.URL?.createObjectURL !== "function"
  )
    return Promise.reject(new ImageOptimizationError("UNSUPPORTED_BROWSER"));

  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const releaseObjectUrl = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
      releaseObjectUrl();
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new ImageOptimizationError("INVALID_IMAGE"));
        return;
      }
      resolve(image);
    };
    image.onerror = () => {
      releaseObjectUrl();
      reject(new ImageOptimizationError("INVALID_IMAGE"));
    };
    image.decoding = "async";
    image.src = objectUrl;
  });
}

export async function readImageDimensions(file: Blob): Promise<ImageDimensions> {
  const image = await loadImageElement(file);
  return { width: image.naturalWidth, height: image.naturalHeight };
}

type CanvasSurface = OffscreenCanvas | HTMLCanvasElement;
type DecodedImage = ImageBitmap | HTMLImageElement;

function createCanvas(width: number, height: number): CanvasSurface {
  if (typeof globalThis.OffscreenCanvas !== "undefined")
    return new OffscreenCanvas(width, height);
  if (typeof globalThis.document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new ImageOptimizationError("UNSUPPORTED_BROWSER");
}

function drawImageToCanvas(
  canvas: CanvasSurface,
  image: DecodedImage,
  width: number,
  height: number,
) {
  const context = canvas.getContext("2d");
  if (
    !context ||
    !("drawImage" in context) ||
    !("clearRect" in context) ||
    !("imageSmoothingEnabled" in context) ||
    !("imageSmoothingQuality" in context)
  )
    throw new ImageOptimizationError("UNSUPPORTED_BROWSER");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
}

async function decodeResizedImage(
  file: Blob,
  dimensions: ImageDimensions,
): Promise<DecodedImage> {
  if (typeof globalThis.createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, {
        resizeWidth: dimensions.width,
        resizeHeight: dimensions.height,
        resizeQuality: "high",
        imageOrientation: "from-image",
      });
    } catch {
      // Một số trình duyệt có createImageBitmap nhưng chưa hỗ trợ đủ tùy chọn resize.
    }
  }

  const image = await loadImageElement(file);
  return image;
}

function closeDecodedImage(image: DecodedImage) {
  if ("close" in image) image.close();
}

async function canvasToBlob(
  canvas: CanvasSurface,
  mimeType: AllowedImageType,
  quality: number,
): Promise<Blob | null> {
  if ("convertToBlob" in canvas)
    return canvas.convertToBlob({ type: mimeType, quality });
  return new Promise((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });
}

async function tryEncodeCanvas(
  canvas: CanvasSurface,
  mimeType: AllowedImageType,
  quality: number,
): Promise<Blob | null> {
  try {
    const blob = await canvasToBlob(canvas, mimeType, quality);
    if (!blob?.size) return null;
    if (blob.type && blob.type.toLowerCase() !== mimeType) return null;
    return blob;
  } catch {
    return null;
  }
}

function fallbackMimeType(sourceMimeType: AllowedImageType): AllowedImageType {
  return sourceMimeType === "image/jpeg" ? "image/jpeg" : "image/png";
}

async function encodeOptimizedImage(
  canvas: CanvasSurface,
  sourceMimeType: AllowedImageType,
  quality: number,
): Promise<{ blob: Blob; mimeType: AllowedImageType }> {
  const webp = await tryEncodeCanvas(canvas, "image/webp", quality);
  if (webp) return { blob: webp, mimeType: "image/webp" };

  const fallbackType = fallbackMimeType(sourceMimeType);
  const fallback = await tryEncodeCanvas(canvas, fallbackType, quality);
  if (fallback) return { blob: fallback, mimeType: fallbackType };
  throw new ImageOptimizationError("UNSUPPORTED_BROWSER");
}

export async function optimizeProductImage(
  file: File,
): Promise<OptimizedProductImage> {
  const mimeType = validateProductImageSource(file);
  const originalDimensions = await readImageDimensions(file);
  const originalPixels = originalDimensions.width * originalDimensions.height;

  // Guard này chỉ chặn ảnh có kích thước bất thường; ảnh camera 8K thông dụng vẫn được nhận.
  if (originalPixels > MAX_IMAGE_DECODE_PIXELS)
    throw new ImageOptimizationError("INVALID_IMAGE");

  if (
    file.size <= FAST_PATH_MAX_IMAGE_BYTES &&
    Math.max(originalDimensions.width, originalDimensions.height) <=
      MAX_IMAGE_LONG_EDGE
  )
    return {
      blob: file,
      mimeType,
      originalBytes: file.size,
      optimizedBytes: file.size,
      originalWidth: originalDimensions.width,
      originalHeight: originalDimensions.height,
      width: originalDimensions.width,
      height: originalDimensions.height,
    };

  let lastWithinHardLimit:
    | { blob: Blob; mimeType: AllowedImageType; width: number; height: number }
    | undefined;

  for (const maxLongEdge of IMAGE_RESIZE_EDGES) {
    const dimensions = calculateResizedDimensions(
      originalDimensions.width,
      originalDimensions.height,
      maxLongEdge,
    );
    const image = await decodeResizedImage(file, dimensions);
    const canvas = createCanvas(dimensions.width, dimensions.height);
    try {
      drawImageToCanvas(canvas, image, dimensions.width, dimensions.height);
      for (const quality of IMAGE_COMPRESSION_QUALITIES) {
        const encoded = await encodeOptimizedImage(canvas, mimeType, quality);
        const result = {
          ...encoded,
          width: dimensions.width,
          height: dimensions.height,
        };
        if (encoded.blob.size <= TARGET_IMAGE_BYTES)
          return {
            ...result,
            originalBytes: file.size,
            optimizedBytes: encoded.blob.size,
            originalWidth: originalDimensions.width,
            originalHeight: originalDimensions.height,
          };
        if (encoded.blob.size <= MAX_STORED_IMAGE_BYTES)
          lastWithinHardLimit = result;
      }
    } finally {
      closeDecodedImage(image);
    }

    if (lastWithinHardLimit)
      return {
        ...lastWithinHardLimit,
        originalBytes: file.size,
        optimizedBytes: lastWithinHardLimit.blob.size,
        originalWidth: originalDimensions.width,
        originalHeight: originalDimensions.height,
      };
  }

  throw new ImageOptimizationError("TOO_LARGE");
}
