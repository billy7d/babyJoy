export type ProductConflict = {
  field: "slug" | "sku";
  value: string;
  ownerId: string;
};

type ConflictDatabase = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
    };
  };
};

export async function findProductConflict(
  db: ConflictDatabase,
  input: { productId: string; slug: string; skus: string[] },
): Promise<ProductConflict | null> {
  const slugOwner = await db
    .prepare("SELECT id FROM products WHERE slug = ? AND id != ? LIMIT 1")
    .bind(input.slug, input.productId)
    .first<{ id: string }>();
  if (slugOwner)
    return { field: "slug", value: input.slug, ownerId: slugOwner.id };

  const skus = [...new Set(input.skus.map((sku) => sku.trim()).filter(Boolean))];
  if (!skus.length) return null;
  // Placeholder chỉ được dựng từ số lượng SKU; mọi giá trị vẫn truyền qua bind.
  const placeholders = skus.map(() => "?").join(", ");
  const skuOwner = await db
    .prepare(
      `SELECT product_id AS productId, sku FROM product_variants WHERE sku IN (${placeholders}) AND product_id != ? LIMIT 1`,
    )
    .bind(...skus, input.productId)
    .first<{ productId: string; sku: string }>();
  return skuOwner
    ? { field: "sku", value: skuOwner.sku, ownerId: skuOwner.productId }
    : null;
}

export function productConflictError(conflict: ProductConflict) {
  if (conflict.field === "slug") {
    return {
      code: "SLUG_CONFLICT",
      message: `Slug "${conflict.value}" đã tồn tại.`,
      details: conflict,
    };
  }
  return {
    code: "SKU_CONFLICT",
    message: `SKU "${conflict.value}" đã được sử dụng.`,
    details: conflict,
  };
}
