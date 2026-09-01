import type { Product } from "./catalog";

// Chỉ cộng tồn kho vật lý của các variant đang bật theo dõi; null nghĩa là không theo dõi.
export function getAdminProductStockOnHand(product: Product): number | null {
  const trackedVariants = product.variants.filter(
    (variant) => variant.trackInventory === true,
  );

  if (!trackedVariants.length) return null;

  return trackedVariants.reduce((total, variant) => {
    const stockOnHand = Number(variant.stockOnHand ?? 0);
    return total + (Number.isFinite(stockOnHand) ? Math.max(0, stockOnHand) : 0);
  }, 0);
}
