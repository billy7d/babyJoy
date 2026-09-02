export const PUBLIC_IMAGE_BASE_URL = "https://images.metraphuong.com";
export const PRODUCT_IMAGE_PLACEHOLDER = "/images/logo.png";
export const MAX_SOURCE_IMAGE_BYTES = 30 * 1024 * 1024;
export const TARGET_IMAGE_BYTES = 900 * 1024;
export const MAX_STORED_IMAGE_BYTES = Math.floor(1.5 * 1024 * 1024);
export const MAX_IMAGE_LONG_EDGE = 1600;
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export function normalizeR2Key(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (
    !key ||
    key.startsWith("/") ||
    key.endsWith("/") ||
    key.includes("\\") ||
    key.includes("?") ||
    key.includes("#")
  )
    return null;
  const segments = key.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[\u0000-\u001f\u007f]/.test(segment),
    )
  )
    return null;
  return segments.join("/");
}

export function getPublicImageUrl(r2Key: unknown): string {
  const key = normalizeR2Key(r2Key);
  if (!key) return PRODUCT_IMAGE_PLACEHOLDER;
  const encodedPath = key.split("/").map(encodeURIComponent).join("/");
  return `${PUBLIC_IMAGE_BASE_URL}/${encodedPath}`;
}

export function isAllowedImageType(value: string): value is AllowedImageType {
  return ALLOWED_IMAGE_TYPES.includes(value as AllowedImageType);
}

export function imageExtension(
  contentType: AllowedImageType,
): "jpg" | "png" | "webp" {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

export function createImmutableImageKey(
  contentType: AllowedImageType,
  now = new Date(),
  uuid: string = crypto.randomUUID(),
): string {
  return `products/${now.toISOString().slice(0, 10)}/${uuid}.${imageExtension(contentType)}`;
}

export function isImmutableProductImageKey(value: unknown): value is string {
  const key = normalizeR2Key(value);
  return Boolean(
    key &&
    /^products\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(
      key,
    ),
  );
}
