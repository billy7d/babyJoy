/** Kiểm tra migration variant media theo kiểu expand-only để code mới vẫn chạy khi rollout chưa áp dụng DB. */
export async function hasVariantMediaSchema(env: Env) {
  try {
    const [table, column] = await Promise.all([
      env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'product_variant_images'",
      ).first<{ name: string }>(),
      env.DB.prepare(
        "SELECT name FROM pragma_table_info('product_variants') WHERE name = 'package_size'",
      ).first<{ name: string }>(),
    ]);
    return Boolean(table?.name && column?.name);
  } catch {
    return false;
  }
}
