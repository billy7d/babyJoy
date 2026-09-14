import { hasProductTypeSchema, revalidateComboProducts } from "./combos";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function error(code: string, message: string, status: number, details?: unknown) {
  return json({ success: false, error: { code, message, details } }, status);
}

async function hasTable(env: Env, tableName: string) {
  try {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
      .bind(tableName)
      .first<{ name: string }>();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

async function hasColumn(env: Env, tableName: string, columnName: string) {
  try {
    const row = await env.DB.prepare(
      `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
    )
      .bind(tableName, columnName)
      .first<{ name: string }>();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

type ProductDeleteRow = {
  id: string;
  name: string;
  slug: string;
  productType: string;
  status: string;
};

type VariantDeleteRow = {
  id: string;
  name: string;
  sku: string | null;
};

type AffectedCartRow = {
  id: string;
  publicCode: string;
  checkoutState: string | null;
};

type DeleteImpact = {
  product: ProductDeleteRow;
  variants: VariantDeleteRow[];
  counts: {
    variants: number;
    productImages: number;
    variantImages: number;
    descriptionAssets: number;
    categories: number;
    tags: number;
    comboMemberships: number;
    activeCarts: number;
    historicalCartLines: number;
    promotionRelationships: number;
    promotionGiftReferences: number;
  };
  affectedCombos: Array<{ id: string; name: string }>;
  activeCarts: AffectedCartRow[];
  r2Keys: string[];
};

async function readProduct(id: string, env: Env) {
  const hasType = await hasProductTypeSchema(env);
  return env.DB.prepare(
    `SELECT id, name, slug,
       ${hasType ? "COALESCE(product_type, 'STANDARD')" : "'STANDARD'"} AS productType,
       status
     FROM products WHERE id = ?`,
  )
    .bind(id)
    .first<ProductDeleteRow>();
}

async function loadPromotionRelationships(productId: string, env: Env) {
  if (!(await hasTable(env, "promotions"))) return [] as Array<{ id: string; name: string; configJson: string }>;
  const rows = await env.DB.prepare(
    "SELECT id, name, config_json AS configJson FROM promotions WHERE config_json LIKE ?",
  )
    .bind(`%${productId}%`)
    .all<{ id: string; name: string; configJson: string }>();
  return rows.results;
}

async function loadR2Keys(productId: string, variantIds: string[], env: Env) {
  const keys: string[] = [];
  if (await hasTable(env, "product_images")) {
    const rows = await env.DB.prepare(
      "SELECT r2_key AS r2Key FROM product_images WHERE product_id = ?",
    )
      .bind(productId)
      .all<{ r2Key: string }>();
    keys.push(...rows.results.map((row) => row.r2Key));
  }
  if (variantIds.length && (await hasTable(env, "product_variant_images"))) {
    const rows = await env.DB.prepare(
      `SELECT r2_key AS r2Key FROM product_variant_images
       WHERE variant_id IN (${variantIds.map(() => "?").join(",")})`,
    )
      .bind(...variantIds)
      .all<{ r2Key: string }>();
    keys.push(...rows.results.map((row) => row.r2Key));
  }
  if (await hasTable(env, "product_description_assets")) {
    const rows = await env.DB.prepare(
      "SELECT r2_key AS r2Key FROM product_description_assets WHERE product_id = ?",
    )
      .bind(productId)
      .all<{ r2Key: string }>();
    keys.push(...rows.results.map((row) => row.r2Key));
  }
  return [...new Set(keys.filter(Boolean))];
}

async function getDeleteImpact(id: string, env: Env): Promise<DeleteImpact | null> {
  const product = await readProduct(id, env);
  if (!product) return null;
  const variants = await env.DB.prepare(
    "SELECT id, name, sku FROM product_variants WHERE product_id = ? ORDER BY sort_order, id",
  )
    .bind(id)
    .all<VariantDeleteRow>();
  const variantIds = variants.results.map((variant) => variant.id);
  const placeholders = variantIds.map(() => "?").join(",");
  const variantPredicate = variantIds.length
    ? ` OR ci.variant_id IN (${placeholders})`
    : "";
  const comboVariantPredicate = variantIds.length
    ? ` OR ccc.variant_id IN (${placeholders})`
    : "";
  const hasComboHistory = await hasTable(env, "cart_request_combo_components");
  const comboHistoryJoin = hasComboHistory
    ? " LEFT JOIN cart_request_combo_components ccc ON ccc.cart_request_item_id = ci.id"
    : "";
  const hasPromotionGiftHistory = await hasTable(env, "cart_request_promotion_gifts");
  const promotionGiftJoin = hasPromotionGiftHistory
    ? " LEFT JOIN cart_request_promotion_gifts pg ON pg.cart_request_id = cr.id"
    : "";
  const hasCheckoutState = await hasColumn(env, "cart_requests", "checkout_state");
  const checkoutStateSelect = hasCheckoutState
    ? "cr.checkout_state AS checkoutState"
    : "NULL AS checkoutState";
  const comboHistoryPredicate = hasComboHistory
    ? ` OR ccc.product_id = ?${comboVariantPredicate}`
    : "";
  const promotionGiftPredicate = hasPromotionGiftHistory
    ? ` OR pg.product_id = ?${variantIds.length ? ` OR pg.variant_id IN (${placeholders})` : ""}`
    : "";
  const variantValues = [
    id,
    ...variantIds,
    ...(hasComboHistory ? [id, ...variantIds] : []),
    ...(hasPromotionGiftHistory ? [id, ...variantIds] : []),
  ];
  const promotionGiftCountPromise = hasPromotionGiftHistory
    ? env.DB.prepare(
        `SELECT COUNT(*) AS count FROM cart_request_promotion_gifts
         WHERE product_id = ?${variantIds.length ? ` OR variant_id IN (${placeholders})` : ""}`,
      )
        .bind(id, ...variantIds)
        .first<{ count: number }>()
    : Promise.resolve({ count: 0 });
  const [categoryCount, tagCount, imageCount, variantImageCount, descriptionCount, cartRows, comboRows, promotions, r2Keys, promotionGiftCount] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM product_categories WHERE product_id = ?").bind(id).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM product_tags WHERE product_id = ?").bind(id).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM product_images WHERE product_id = ?").bind(id).first<{ count: number }>(),
    variantIds.length && (await hasTable(env, "product_variant_images"))
      ? env.DB.prepare(`SELECT COUNT(*) AS count FROM product_variant_images WHERE variant_id IN (${placeholders})`).bind(...variantIds).first<{ count: number }>()
      : Promise.resolve({ count: 0 }),
    (await hasTable(env, "product_description_assets"))
      ? env.DB.prepare("SELECT COUNT(*) AS count FROM product_description_assets WHERE product_id = ?").bind(id).first<{ count: number }>()
      : Promise.resolve({ count: 0 }),
    env.DB.prepare(
      `SELECT DISTINCT cr.id, cr.public_code AS publicCode, ${checkoutStateSelect}
       FROM cart_requests cr LEFT JOIN cart_request_items ci ON ci.cart_request_id = cr.id${comboHistoryJoin}${promotionGiftJoin}
       WHERE (ci.product_id = ?${variantPredicate}${comboHistoryPredicate}${promotionGiftPredicate})`,
    )
      .bind(...variantValues)
      .all<AffectedCartRow>(),
    (await hasTable(env, "combo_group_items")) && variantIds.length
      ? env.DB.prepare(
          `SELECT DISTINCT p.id, p.name
           FROM combo_group_items cgi
           JOIN combo_groups cg ON cg.id = cgi.group_id
           JOIN products p ON p.id = cg.combo_product_id
           WHERE cgi.variant_id IN (${placeholders}) AND p.id != ?
           ORDER BY p.name, p.id`,
        )
          .bind(...variantIds, id)
          .all<{ id: string; name: string }>()
      : Promise.resolve({ results: [] as Array<{ id: string; name: string }> }),
    loadPromotionRelationships(id, env),
    loadR2Keys(id, variantIds, env),
    promotionGiftCountPromise,
  ]);
  const activeCarts = cartRows.results.filter((row) =>
    row.checkoutState === "READY_TO_SEND" || row.checkoutState === "WAITING_SELLER_CONFIRM",
  );
  const historicalCount = Math.max(0, cartRows.results.length - activeCarts.length);
  let comboMemberships = 0;
  if (variantIds.length && (await hasTable(env, "combo_group_items"))) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM combo_group_items WHERE variant_id IN (${placeholders})`,
    )
      .bind(...variantIds)
      .first<{ count: number }>();
    comboMemberships = Number(row?.count ?? 0);
  }
  return {
    product,
    variants: variants.results,
    counts: {
      variants: variants.results.length,
      productImages: Number(imageCount?.count ?? 0),
      variantImages: Number(variantImageCount?.count ?? 0),
      descriptionAssets: Number(descriptionCount?.count ?? 0),
      categories: Number(categoryCount?.count ?? 0),
      tags: Number(tagCount?.count ?? 0),
      comboMemberships,
      activeCarts: activeCarts.length,
      historicalCartLines: historicalCount,
      promotionRelationships: promotions.length,
      promotionGiftReferences: Number(promotionGiftCount?.count ?? 0),
    },
    affectedCombos: comboRows.results,
    activeCarts,
    r2Keys,
  };
}

export async function getProductDeletePreflight(id: string, env: Env) {
  const impact = await getDeleteImpact(id, env);
  if (!impact) return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  return json({
    success: true,
    data: {
      product: impact.product,
      counts: impact.counts,
      variants: impact.variants,
      affectedCombos: impact.affectedCombos,
      activeCarts: impact.activeCarts,
      r2KeyCount: impact.r2Keys.length,
    },
  });
}

function sanitizePromotionConfig(configJson: string, productId: string) {
  try {
    const parsed = JSON.parse(configJson) as unknown;
    let changed = false;
    const visit = (value: unknown, key = ""): unknown => {
      if (Array.isArray(value)) {
        const filtered = value.filter((item) => {
          const keep = !(key.toLowerCase().includes("product") && item === productId);
          if (!keep) changed = true;
          return keep;
        });
        return filtered.map((item) => visit(item, key));
      }
      if (!value || typeof value !== "object") {
        if (key.toLowerCase().includes("product") && value === productId) {
          changed = true;
          return null;
        }
        return value;
      }
      const next: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        if (childKey.toLowerCase().includes("productid") && childValue === productId) {
          changed = true;
          next[childKey] = null;
        } else next[childKey] = visit(childValue, childKey);
      }
      return next;
    };
    const sanitized = visit(parsed);
    return changed ? JSON.stringify(sanitized) : null;
  } catch {
    return null;
  }
}

type StorageCleanupResult = {
  deleted: string[];
  pending: string[];
};

async function cleanupStorageKeys(
  keys: string[],
  env: Env,
): Promise<StorageCleanupResult> {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (
    !uniqueKeys.length ||
    !env.PRODUCT_IMAGES ||
    typeof env.PRODUCT_IMAGES.delete !== "function"
  )
    return { deleted: [], pending: uniqueKeys };
  try {
    const placeholders = uniqueKeys.map(() => "?").join(",");
    const mediaTables = [
      "product_images",
      "product_variant_images",
      "product_description_assets",
    ];
    const availableMediaTables: string[] = [];
    for (const tableName of mediaTables)
      if (await hasTable(env, tableName)) availableMediaTables.push(tableName);
    if (!availableMediaTables.length)
      return { deleted: [], pending: uniqueKeys };
    const references = await env.DB.prepare(
      `SELECT r2_key AS r2Key FROM (
         ${availableMediaTables.map((tableName) => `SELECT r2_key FROM ${tableName}`).join(" UNION ALL ")}
       ) WHERE r2_key IN (${placeholders})`,
    )
      .bind(...uniqueKeys)
      .all<{ r2Key: string }>();
    const referenced = new Set(references.results.map((row) => row.r2Key));
    const removable = uniqueKeys.filter((key) => !referenced.has(key));
    for (let offset = 0; offset < removable.length; offset += 1000)
      await env.PRODUCT_IMAGES.delete(removable.slice(offset, offset + 1000));
    return {
      deleted: removable,
      pending: uniqueKeys.filter((key) => referenced.has(key)),
    };
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "product_r2_cleanup_failed",
        keyCount: uniqueKeys.length,
        errorType: caught instanceof Error ? caught.name : "UNKNOWN",
      }),
    );
    return { deleted: [], pending: uniqueKeys };
  }
}

async function settleStorageCleanupQueue(
  result: StorageCleanupResult,
  env: Env,
) {
  if (!(await hasTable(env, "product_storage_cleanup"))) return;
  const statements: D1PreparedStatement[] = [];
  const now = new Date().toISOString();
  if (result.deleted.length) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM product_storage_cleanup
         WHERE r2_key IN (${result.deleted.map(() => "?").join(",")})`,
      ).bind(...result.deleted),
    );
  }
  if (result.pending.length) {
    statements.push(
      env.DB.prepare(
        `UPDATE product_storage_cleanup
         SET attempt_count = attempt_count + 1,
             last_error = ?, updated_at = ?
         WHERE r2_key IN (${result.pending.map(() => "?").join(",")})`,
      ).bind(
        "R2 object còn được tham chiếu hoặc cleanup chưa thành công; sẽ thử lại.",
        now,
        ...result.pending,
      ),
    );
  }
  if (statements.length) await env.DB.batch(statements);
}

export async function processProductStorageCleanup(env: Env) {
  if (!(await hasTable(env, "product_storage_cleanup"))) return;
  const rows = await env.DB.prepare(
    `SELECT r2_key AS r2Key
     FROM product_storage_cleanup
     ORDER BY updated_at, id
     LIMIT 500`,
  ).all<{ r2Key: string }>();
  if (!rows.results.length) return;
  const keys = rows.results.map((row) => row.r2Key);
  const result = await cleanupStorageKeys(keys, env);
  await settleStorageCleanupQueue(result, env);
}

export async function hardDeleteProduct(
  id: string,
  env: Env,
  ctx: ExecutionContext,
  confirmed: boolean,
) {
  if (!confirmed)
    return error(
      "DELETE_CONFIRMATION_REQUIRED",
      "Hãy xác nhận XÓA để xóa vĩnh viễn sản phẩm.",
      422,
    );
  const impact = await getDeleteImpact(id, env);
  if (!impact) return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  const variantIds = impact.variants.map((variant) => variant.id);
  const placeholders = variantIds.map(() => "?").join(",");
  const affectedComboIds = impact.affectedCombos.map((combo) => combo.id);
  const activeCartIds = impact.activeCarts.map((cart) => cart.id);
  const statements: D1PreparedStatement[] = [];
  const now = new Date().toISOString();
  const hasInventory = await hasTable(env, "inventory_reservations");
  const hasCombo = await hasTable(env, "combo_group_items");
  const hasComboHistory = await hasTable(env, "cart_request_combo_components");
  const hasPromotionGiftHistory = await hasTable(env, "cart_request_promotion_gifts");
  const hasPromotions = await hasTable(env, "promotions");
  const hasStorageCleanup = await hasTable(env, "product_storage_cleanup");
  if (hasInventory && activeCartIds.length) {
    const activePlaceholders = activeCartIds.map(() => "?").join(",");
    statements.push(
      env.DB.prepare(
        `UPDATE inventory_reservations
         SET status = 'RELEASED', released_at = ?, release_reason = 'PRODUCT_DELETED'
         WHERE cart_request_id IN (${activePlaceholders}) AND status = 'ACTIVE'`,
      ).bind(now, ...activeCartIds),
    );
  }
  if (hasInventory && variantIds.length) {
    statements.push(
      env.DB.prepare(
        `UPDATE inventory_reservations
         SET status = 'RELEASED', released_at = ?, release_reason = 'PRODUCT_DELETED'
         WHERE variant_id IN (${placeholders}) AND status = 'ACTIVE'`,
      ).bind(now, ...variantIds),
    );
  }
  if (activeCartIds.length) {
    const activePlaceholders = activeCartIds.map(() => "?").join(",");
    const activeComboLinePredicate = hasComboHistory
      ? ` OR id IN (
           SELECT cart_request_item_id FROM cart_request_combo_components
           WHERE product_id = ?${variantIds.length ? ` OR variant_id IN (${placeholders})` : ""}
         )`
      : "";
    statements.push(
      env.DB.prepare(
        `DELETE FROM cart_request_items
         WHERE cart_request_id IN (${activePlaceholders})
           AND (product_id = ?${variantIds.length ? ` OR variant_id IN (${placeholders})` : ""}${activeComboLinePredicate})`,
      ).bind(
        ...activeCartIds,
        id,
        ...variantIds,
        ...(hasComboHistory ? [id, ...variantIds] : []),
      ),
      env.DB.prepare(
        `UPDATE cart_requests SET checkout_state = 'CANCELLED', status = 'CANCELLED',
           updated_at = ? WHERE id IN (${activePlaceholders})`,
      ).bind(now, ...activeCartIds),
    );
    if (await hasTable(env, "promotion_reservations"))
      statements.push(
        env.DB.prepare(
          `UPDATE promotion_reservations
           SET status = 'RELEASED', released_at = ?, release_reason = 'PRODUCT_DELETED'
           WHERE cart_request_id IN (${activePlaceholders}) AND status = 'ACTIVE'`,
        ).bind(now, ...activeCartIds),
      );
  }
  if (variantIds.length) {
    statements.push(
      env.DB.prepare(
        `UPDATE cart_request_items SET product_id = NULL, variant_id = NULL
         WHERE product_id = ? OR variant_id IN (${placeholders})`,
      ).bind(id, ...variantIds),
    );
  } else {
    statements.push(
      env.DB.prepare("UPDATE cart_request_items SET product_id = NULL, variant_id = NULL WHERE product_id = ?").bind(id),
    );
  }
  if (hasComboHistory)
    statements.push(
      env.DB.prepare(
        `UPDATE cart_request_combo_components SET product_id = NULL, variant_id = NULL
         WHERE product_id = ?${variantIds.length ? ` OR variant_id IN (${placeholders})` : ""}`,
      ).bind(id, ...variantIds),
    );
  if (hasPromotionGiftHistory)
    statements.push(
      env.DB.prepare(
        `UPDATE cart_request_promotion_gifts SET product_id = NULL, variant_id = NULL
         WHERE product_id = ?${variantIds.length ? ` OR variant_id IN (${placeholders})` : ""}`,
      ).bind(id, ...variantIds),
    );
  if (hasCombo && variantIds.length)
    statements.push(
      env.DB.prepare(`DELETE FROM combo_group_items WHERE variant_id IN (${placeholders})`).bind(...variantIds),
    );
  if (hasPromotions) {
    for (const promotion of await loadPromotionRelationships(id, env)) {
      const configJson = sanitizePromotionConfig(promotion.configJson, id);
      if (configJson)
        statements.push(
          env.DB.prepare(
            "UPDATE promotions SET config_json = ?, status = CASE WHEN status = 'ACTIVE' THEN 'INACTIVE' ELSE status END, updated_at = ? WHERE id = ?",
          ).bind(configJson, now, promotion.id),
        );
      }
  }
  if (hasStorageCleanup && impact.r2Keys.length) {
    for (let offset = 0; offset < impact.r2Keys.length; offset += 100) {
      const chunk = impact.r2Keys.slice(offset, offset + 100);
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO product_storage_cleanup
             (id, r2_key, created_at, updated_at)
           VALUES ${chunk.map(() => "(?, ?, ?, ?)").join(", ")}`,
        ).bind(
          ...chunk.flatMap((r2Key) => [crypto.randomUUID(), r2Key, now, now]),
        ),
      );
    }
  }
  statements.push(env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id));
  try {
    await env.DB.batch(statements);
  } catch (caught) {
    console.error(JSON.stringify({ event: "product_hard_delete_failed", productId: id, errorType: caught instanceof Error ? caught.name : "UNKNOWN" }));
    return error("PRODUCT_DELETE_FAILED", "Chưa thể xóa vĩnh viễn sản phẩm; dữ liệu chưa bị thay đổi.", 409);
  }
  const cleanup = async () => {
    const result = await cleanupStorageKeys(impact.r2Keys, env);
    await settleStorageCleanupQueue(result, env);
  };
  if (typeof ctx.waitUntil === "function") ctx.waitUntil(cleanup());
  else await cleanup();
  const revalidated = impact.product.productType === "STANDARD"
    ? await revalidateComboProducts(affectedComboIds, env)
    : [];
  return json({
    success: true,
    id,
    deleted: true,
    productType: impact.product.productType,
    affectedCombos: revalidated,
    historicalCartLinesDetached: impact.counts.historicalCartLines,
    activeCartsCancelled: activeCartIds.length,
    r2CleanupScheduled: impact.r2Keys.length > 0,
  });
}
