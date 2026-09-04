export const CONTENT_PAGE_DEFINITIONS = [
  { slug: "shipping-policy", label: "Chính sách vận chuyển" },
  { slug: "buying-guide", label: "Hướng dẫn mua hàng" },
  { slug: "returns-refunds", label: "Đổi trả & Hoàn tiền" },
] as const;

export type ContentPageSlug = (typeof CONTENT_PAGE_DEFINITIONS)[number]["slug"];

export const CONTENT_PAGE_SLUGS = CONTENT_PAGE_DEFINITIONS.map(
  (page) => page.slug,
) as ContentPageSlug[];

export function isContentPageSlug(value: unknown): value is ContentPageSlug {
  return (
    typeof value === "string" &&
    CONTENT_PAGE_SLUGS.includes(value as ContentPageSlug)
  );
}

export function contentPageLabel(slug: ContentPageSlug) {
  return CONTENT_PAGE_DEFINITIONS.find((page) => page.slug === slug)?.label ?? slug;
}
