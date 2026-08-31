import {
  evaluatePromotions,
  parseStoredPromotion,
  type AppliedPromotion,
  type PromotionCartLine,
  type PromotionCatalogProduct,
  type PromotionDefinition,
  type PromotionEvaluationResult,
  type PromotionGiftItem,
  type PromotionProgress,
} from "../shared/promotions";
import type { PricedItem } from "./services";
import { getPublicImageUrl } from "../shared/images";
import { hasInventorySchema } from "./inventory";

export type PromotionCartRequestItem = {
  variantId: string;
  quantity: number;
  displayedPrice?: number;
};

export type AuthoritativePricedItem = PricedItem & {
  originalLineTotalVnd: number;
  discountAmountVnd: number;
  categoryIds: string[];
  trackInventory?: boolean;
  stockOnHand?: number;
  reservedQuantity?: number;
  availableQuantity?: number;
  inventoryAvailability?: "AVAILABLE" | "OUT_OF_STOCK";
};

export type PromotionSnapshot = {
  promotionId: string | null;
  promotionName: string;
  promotionType: string;
  discountAmountVnd: number;
  configSnapshot?: string;
};

export type PromotionGiftSnapshot = PromotionGiftItem & {
  imageUrl: string;
};

export type PromotionHistory = {
  discountAmountVnd: number;
  finalTotalVnd: number;
  promotions: PromotionSnapshot[];
  gifts: PromotionGiftSnapshot[];
};

export type AuthoritativeCartEvaluation = {
  lines: PromotionCartLine[];
  pricedItems: AuthoritativePricedItem[];
  promotions: PromotionDefinition[];
  evaluation: PromotionEvaluationResult;
  unavailable: string[];
  changed: Array<{
    variantId: string;
    displayedPrice: number;
    currentPrice: number;
  }>;
  insufficientStock: string[];
  promotionSchema: boolean;
};

export class PromotionCartError extends Error {
  constructor(
    readonly code: "VARIANT_NOT_FOUND" | "VARIANT_UNAVAILABLE",
    message: string,
    readonly status: 404 | 409,
    readonly variantIds: string[] = [],
  ) {
    super(message);
  }
}

type PromotionRow = {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  priority: number;
  stackable: number;
  startsAt: string | null;
  endsAt: string | null;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  usageCountTotal: number;
  configJson: string;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CanonicalVariantRow = {
  variantId: string;
  variantName: string;
  sku: string | null;
  priceVnd: number;
  availability: string;
  productId: string;
  productName: string;
  productStatus: string;
  archivedAt: string | null;
  imageKey: string | null;
  trackInventory: number;
  stockOnHand: number;
  reservedQuantity: number;
};

type CategoryRow = { productId: string; categoryId: string };

function isMissingPromotionSchema(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table: promotions|no such column: promotion_discount_vnd/i.test(message);
}

async function hasProductArchiveColumn(env: Env) {
  try {
    const row = await env.DB.prepare(
      "SELECT 1 AS present FROM pragma_table_info('products') WHERE name = 'archived_at' LIMIT 1",
    ).first<{ present: number }>();
    return Boolean(row?.present);
  } catch {
    return false;
  }
}

export async function hasPromotionSchema(env: Env) {
  try {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'promotions'",
    ).first<{ name: string }>();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function mapPromotionRow(row: PromotionRow) {
  return parseStoredPromotion(row);
}

export async function loadActivePromotions(
  env: Env,
  now: Date | string = new Date(),
) {
  if (!(await hasPromotionSchema(env))) return [];
  const timestamp = typeof now === "string" ? Date.parse(now) : now.getTime();
  if (!Number.isFinite(timestamp)) return [];
  const isoNow = new Date(timestamp).toISOString();
  let rows: { results: PromotionRow[] };
  try {
    rows = await env.DB.prepare(
      `SELECT id, name, description, type, status, priority, stackable,
        starts_at AS startsAt, ends_at AS endsAt,
        usage_limit_total AS usageLimitTotal,
        usage_limit_per_customer AS usageLimitPerCustomer,
        usage_count_total AS usageCountTotal, config_json AS configJson,
        archived_at AS archivedAt, deleted_at AS deletedAt,
        created_at AS createdAt, updated_at AS updatedAt
       FROM promotions
       WHERE status = 'ACTIVE'
         AND archived_at IS NULL
         AND deleted_at IS NULL
         AND (starts_at IS NULL OR starts_at <= ?)
         AND (ends_at IS NULL OR ? < ends_at)
         AND (usage_limit_total IS NULL OR usage_count_total < usage_limit_total)
       ORDER BY priority DESC, created_at, id`,
    )
      .bind(isoNow, isoNow)
      .all<PromotionRow>();
  } catch (caught) {
    if (isMissingPromotionSchema(caught)) return [];
    throw caught;
  }
  const valid: PromotionDefinition[] = [];
  rows.results.forEach((row) => {
    const promotion = mapPromotionRow(row);
    if (promotion) valid.push(promotion);
    else
      console.warn(
        JSON.stringify({
          event: "promotion_invalid_config_skipped",
          promotionId: row.id,
        }),
      );
  });
  return valid;
}

async function loadCanonicalLines(
  items: PromotionCartRequestItem[],
  env: Env,
) {
  if (!items.length)
    return {
      lines: [] as PromotionCartLine[],
      unavailable: [] as string[],
      changed: [] as AuthoritativeCartEvaluation["changed"],
      insufficientStock: [] as string[],
    };
  const placeholders = items.map(() => "?").join(",");
  const inventorySchema = await hasInventorySchema(env);
  const archivedAtSelect = (await hasProductArchiveColumn(env))
    ? "p.archived_at AS archivedAt"
    : "NULL AS archivedAt";
  const inventorySelect = inventorySchema
    ? "v.track_inventory AS trackInventory, v.stock_on_hand AS stockOnHand, v.reserved_quantity AS reservedQuantity"
    : "0 AS trackInventory, 0 AS stockOnHand, 0 AS reservedQuantity";
  const rows = await env.DB.prepare(
    `SELECT v.id AS variantId, v.name AS variantName, v.sku,
      v.price_vnd AS priceVnd, v.availability, p.id AS productId,
      p.name AS productName, p.status AS productStatus, ${archivedAtSelect},
      ${inventorySelect},
      (SELECT r2_key FROM product_images
       WHERE product_id = p.id ORDER BY sort_order, created_at, id LIMIT 1) AS imageKey
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.id IN (${placeholders})`,
  )
    .bind(...items.map((item) => item.variantId))
    .all<CanonicalVariantRow>();
  const byId = new Map(rows.results.map((row) => [row.variantId, row]));
  const missing = items
    .map((item) => item.variantId)
    .filter((variantId) => !byId.has(variantId));
  if (missing.length)
    throw new PromotionCartError(
      "VARIANT_NOT_FOUND",
      "Một phân loại sản phẩm không còn tồn tại.",
      404,
      missing,
    );
  const productIds = [...new Set(rows.results.map((row) => row.productId))];
  const categoryRows = await env.DB.prepare(
    `SELECT pc.product_id AS productId, pc.category_id AS categoryId
     FROM product_categories pc
     JOIN categories c ON c.id = pc.category_id
     WHERE c.is_active = 1 AND pc.product_id IN (${productIds.map(() => "?").join(",")})
     ORDER BY pc.product_id, pc.category_id`,
  )
    .bind(...productIds)
    .all<CategoryRow>();
  const categoryMap = new Map<string, string[]>();
  categoryRows.results.forEach((row) => {
    const current = categoryMap.get(row.productId) ?? [];
    current.push(row.categoryId);
    categoryMap.set(row.productId, current);
  });
  const unavailable: string[] = [];
  const changed: AuthoritativeCartEvaluation["changed"] = [];
  const insufficientStock: string[] = [];
  const lines = items.map((item) => {
    const row = byId.get(item.variantId)!;
    if (
      row.productStatus !== "AVAILABLE" ||
      row.archivedAt ||
      row.availability !== "AVAILABLE"
    )
      unavailable.push(item.variantId);
    const availableQuantity = Math.max(
      0,
      Number(row.stockOnHand ?? 0) - Number(row.reservedQuantity ?? 0),
    );
    if (row.trackInventory && availableQuantity < item.quantity)
      insufficientStock.push(item.variantId);
    if (item.displayedPrice !== undefined && item.displayedPrice !== row.priceVnd)
      changed.push({
        variantId: item.variantId,
        displayedPrice: item.displayedPrice,
        currentPrice: row.priceVnd,
      });
    return {
      productId: row.productId,
      variantId: row.variantId,
      productName: row.productName,
      variantName: row.variantName,
      sku: row.sku,
      imageKey: row.imageKey,
      priceVnd: row.priceVnd,
      quantity: item.quantity,
      categoryIds: categoryMap.get(row.productId) ?? [],
      ...(inventorySchema
        ? {
            trackInventory: Boolean(row.trackInventory),
            stockOnHand: row.stockOnHand,
            reservedQuantity: row.reservedQuantity,
            availableQuantity,
            inventoryAvailability:
              availableQuantity > 0 ? ("AVAILABLE" as const) : ("OUT_OF_STOCK" as const),
          }
        : {}),
    } satisfies PromotionCartLine;
  });
  return { lines, unavailable, changed, insufficientStock };
}

function promotionGiftProductIds(promotions: PromotionDefinition[]) {
  const ids = new Set<string>();
  promotions.forEach((promotion) => {
    if (promotion.config.type === "ORDER_GIFT") ids.add(promotion.config.giftProductId);
    if (promotion.config.type === "BUY_X_GET_Y") ids.add(promotion.config.rewardProductId);
  });
  return [...ids];
}

async function loadGiftCatalog(
  promotions: PromotionDefinition[],
  env: Env,
) {
  const productIds = promotionGiftProductIds(promotions);
  if (!productIds.length) return [] as PromotionCatalogProduct[];
  const archivedAtSelect = (await hasProductArchiveColumn(env))
    ? "p.archived_at AS archivedAt"
    : "NULL AS archivedAt";
  const inventorySchema = await hasInventorySchema(env);
  const rows = await env.DB.prepare(
    `SELECT p.id AS productId, p.name AS productName, p.status AS productStatus,
      ${archivedAtSelect},
      v.id AS variantId, v.name AS variantName, v.sku,
      v.price_vnd AS priceVnd, v.availability,
      ${inventorySchema
        ? "v.track_inventory AS trackInventory, v.stock_on_hand AS stockOnHand, v.reserved_quantity AS reservedQuantity"
        : "0 AS trackInventory, 0 AS stockOnHand, 0 AS reservedQuantity"},
      (SELECT r2_key FROM product_images
       WHERE product_id = p.id ORDER BY sort_order, created_at, id LIMIT 1) AS imageKey,
      v.sort_order AS sortOrder
     FROM products p
     LEFT JOIN product_variants v ON v.product_id = p.id
     WHERE p.id IN (${productIds.map(() => "?").join(",")})
     ORDER BY p.id,
       CASE WHEN p.status = 'AVAILABLE' AND v.availability = 'AVAILABLE' THEN 0 ELSE 1 END,
       v.sort_order, v.created_at, v.id`,
  )
    .bind(...productIds)
    .all<PromotionCatalogProduct & { sortOrder: number | null; archivedAt: string | null }>();
  const selected = new Map<string, PromotionCatalogProduct>();
  rows.results.forEach((row) => {
    const availableQuantity = Math.max(
      0,
      Number(row.stockOnHand ?? 0) - Number(row.reservedQuantity ?? 0),
    );
    if (
      !selected.has(row.productId) &&
      row.variantId &&
      row.productStatus === "AVAILABLE" &&
      !row.archivedAt &&
      row.availability === "AVAILABLE" &&
      (!row.trackInventory || availableQuantity > 0)
    )
      selected.set(row.productId, {
        productId: row.productId,
        productName: row.productName,
        variantId: row.variantId,
        variantName: row.variantName,
        sku: row.sku,
        imageKey: row.imageKey,
        priceVnd: row.priceVnd ?? 0,
        availability: row.availability ?? "HIDDEN",
        productStatus: row.productStatus,
        ...(row.trackInventory
          ? {
              trackInventory: true,
              stockOnHand: row.stockOnHand,
              reservedQuantity: row.reservedQuantity,
              availableQuantity,
              inventoryAvailability:
                availableQuantity > 0 ? ("AVAILABLE" as const) : ("OUT_OF_STOCK" as const),
            }
          : {}),
      });
  });
  return [...selected.values()];
}

export async function evaluateAuthoritativeCart(
  items: PromotionCartRequestItem[],
  env: Env,
  now: Date | string = new Date(),
): Promise<AuthoritativeCartEvaluation> {
  const schema = await hasPromotionSchema(env);
  const canonical = await loadCanonicalLines(items, env);
  const promotions = await loadActivePromotions(env, now);
  const catalog = await loadGiftCatalog(promotions, env);
  const evaluation = evaluatePromotions({
    cart: canonical.lines,
    promotions,
    catalog,
    now,
  });
  const pricedItems = evaluation.items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId,
    productName: item.productName,
    variantName: item.variantName,
    sku: item.sku,
    imageKey: item.imageKey,
    priceVnd: item.priceVnd,
    quantity: item.quantity,
    lineTotalVnd: item.lineTotalVnd,
    originalLineTotalVnd: item.originalLineTotalVnd,
    discountAmountVnd: item.discountAmountVnd,
    categoryIds: item.categoryIds,
    trackInventory: item.trackInventory,
    stockOnHand: item.stockOnHand,
    reservedQuantity: item.reservedQuantity,
    availableQuantity: item.availableQuantity,
    inventoryAvailability: item.inventoryAvailability,
  }));
  return {
    lines: canonical.lines,
    pricedItems,
    promotions,
    evaluation,
    unavailable: canonical.unavailable,
    changed: canonical.changed,
    insufficientStock: canonical.insufficientStock,
    promotionSchema: schema,
  };
}

export type PromotionPersistenceStatements = {
  usage: D1PreparedStatement[];
  snapshots: D1PreparedStatement[];
  gifts: D1PreparedStatement[];
  redemptions: D1PreparedStatement[];
};

export function buildPromotionPersistenceStatements(
  prepare: (sql: string) => D1PreparedStatement,
  cartRequestId: string,
  createdAt: string,
  result: AuthoritativeCartEvaluation,
  options: { consumeUsage?: boolean } = {},
): PromotionPersistenceStatements {
  const empty: PromotionPersistenceStatements = {
    usage: [],
    snapshots: [],
    gifts: [],
    redemptions: [],
  };
  if (!result.promotionSchema) return empty;
  const byId = new Map(result.promotions.map((promotion) => [promotion.id, promotion]));
  result.evaluation.appliedPromotions.forEach((applied) => {
    const definition = byId.get(applied.promotionId);
    if (!definition) return;
    if (options.consumeUsage !== false)
      empty.usage.push(
        prepare(
          `UPDATE promotions
           SET usage_count_total = usage_count_total + 1, updated_at = ?
           WHERE id = ?`,
        ).bind(createdAt, definition.id),
      );
    empty.snapshots.push(
      prepare(
        `INSERT INTO cart_request_promotions (
          id, cart_request_id, promotion_id, promotion_name_snapshot,
          promotion_type_snapshot, discount_amount_vnd, config_snapshot, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        cartRequestId,
        definition.id,
        definition.name,
        definition.type,
        applied.discountAmountVnd,
        JSON.stringify(definition.config),
        createdAt,
      ),
    );
    applied.giftItems.forEach((gift) => {
      empty.gifts.push(
        prepare(
          `INSERT INTO cart_request_promotion_gifts (
            id, cart_request_id, promotion_id, product_id, variant_id,
            product_name_snapshot, variant_name_snapshot, sku_snapshot,
            image_key_snapshot, unit_price_vnd, quantity, line_total_vnd, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`,
        ).bind(
          crypto.randomUUID(),
          cartRequestId,
          definition.id,
          gift.productId,
          gift.variantId,
          gift.productName,
          gift.variantName,
          gift.sku,
          gift.imageKey,
          gift.quantity,
          createdAt,
        ),
      );
    });
    if (options.consumeUsage !== false) empty.redemptions.push(
      prepare(
        `INSERT INTO promotion_redemptions (
          id, promotion_id, cart_request_id, customer_key, created_at
        ) VALUES (?, ?, ?, NULL, ?)`,
      ).bind(crypto.randomUUID(), definition.id, cartRequestId, createdAt),
    );
  });
  return empty;
}

export async function loadPromotionHistory(
  cartRequestId: string,
  env: Env,
): Promise<PromotionHistory> {
  const fallback: PromotionHistory = {
    discountAmountVnd: 0,
    finalTotalVnd: 0,
    promotions: [],
    gifts: [],
  };
  if (!(await hasPromotionSchema(env))) return fallback;
  try {
    const [request, promotions, gifts] = await Promise.all([
      env.DB.prepare(
        "SELECT subtotal_vnd AS subtotalVnd, promotion_discount_vnd AS discountAmountVnd, final_total_vnd AS finalTotalVnd FROM cart_requests WHERE id = ?",
      )
        .bind(cartRequestId)
        .first<{ subtotalVnd: number; discountAmountVnd: number; finalTotalVnd: number }>(),
      env.DB.prepare(
        `SELECT promotion_id AS promotionId,
          promotion_name_snapshot AS promotionName,
          promotion_type_snapshot AS promotionType,
          discount_amount_vnd AS discountAmountVnd,
          config_snapshot AS configSnapshot
         FROM cart_request_promotions
         WHERE cart_request_id = ? ORDER BY created_at, id`,
      )
        .bind(cartRequestId)
        .all<PromotionSnapshot>(),
      env.DB.prepare(
        `SELECT promotion_id AS promotionId, product_id AS productId,
          variant_id AS variantId, product_name_snapshot AS productName,
          variant_name_snapshot AS variantName, sku_snapshot AS sku,
          image_key_snapshot AS imageKey, unit_price_vnd AS unitPriceVnd,
          quantity, line_total_vnd AS lineTotalVnd
         FROM cart_request_promotion_gifts
         WHERE cart_request_id = ? ORDER BY created_at, id`,
      )
        .bind(cartRequestId)
        .all<Omit<PromotionGiftItem, "isPromotionGift">>(),
    ]);
    return {
      discountAmountVnd: request?.discountAmountVnd ?? 0,
      finalTotalVnd: request?.finalTotalVnd ?? request?.subtotalVnd ?? 0,
      promotions: promotions.results,
      gifts: gifts.results.map((gift) => ({
        ...gift,
        unitPriceVnd: 0,
        lineTotalVnd: 0,
        isPromotionGift: true,
        imageUrl: getPublicImageUrl(gift.imageKey),
      })),
    };
  } catch (caught) {
    if (isMissingPromotionSchema(caught)) return fallback;
    throw caught;
  }
}

export function appliedPromotionSummary(
  applied: AppliedPromotion[],
): Array<Pick<AppliedPromotion, "promotionId" | "promotionName" | "type" | "discountAmountVnd">> {
  return applied.map(({ promotionId, promotionName, type, discountAmountVnd }) => ({
    promotionId,
    promotionName,
    type,
    discountAmountVnd,
  }));
}

export function progressSummary(
  progress: PromotionProgress[],
): PromotionProgress[] {
  return progress;
}
