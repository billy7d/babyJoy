import { MAX_STORED_IMAGE_BYTES } from "../../shared/images";
import {
  ImageOptimizationError,
  optimizeProductImage,
  validateProductImageSource,
  type OptimizedProductImage,
} from "./image-optimizer";

export type ProductImageUploadPhase = "optimizing" | "uploading";

export type ProductImageUploadProgress = (
  phase: ProductImageUploadPhase,
  optimized?: OptimizedProductImage,
) => void;

export type OptimizeAndUploadProductImageOptions = {
  endpoint: string;
  headers?: HeadersInit;
  onPhase?: ProductImageUploadProgress;
};

export function formatProductImageBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function validateProductImageFiles(
  files: readonly Pick<Blob, "size" | "type">[],
): void {
  for (const file of files) validateProductImageSource(file);
}

export async function processProductImageFilesSequentially<T>(
  files: readonly File[],
  processFile: (file: File, index: number, total: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];
  for (const [index, file] of files.entries()) {
    // Nhường một nhịp cho trình duyệt giữa các ảnh để giao diện vẫn phản hồi.
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    results.push(await processFile(file, index, files.length));
  }
  return results;
}

export async function optimizeAndUploadProductImage(
  file: File,
  options: OptimizeAndUploadProductImageOptions,
): Promise<{ response: Response; optimized: OptimizedProductImage }> {
  options.onPhase?.("optimizing");
  const optimized = await optimizeProductImage(file);
  if (optimized.optimizedBytes > MAX_STORED_IMAGE_BYTES)
    throw new ImageOptimizationError("TOO_LARGE");

  options.onPhase?.("uploading", optimized);
  const headers = new Headers(options.headers);
  headers.set("content-type", optimized.mimeType);
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers,
    body: optimized.blob,
  });
  return { response, optimized };
}
