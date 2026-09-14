import {
  evaluatePromotions,
  parseStoredPromotion,
  promotionConfigProvidesFreeShipping,
  promotionTypes,
  validatePromotionConfig,
  type AppliedPromotion,
  type PromotionCartLine,
  type PromotionCatalogProduct,
  type PromotionDefinition,
  type PromotionEvaluationResult,
  type PromotionGiftItem,
  type PromotionProgress,
  type PromotionTargetNames,
} from "../shared/promotions";
import {
  comboLineId,
  validateComboConfig,
  validateComboSelection,
  type ComboSelection,
} from "../shared/combos";
import type { PricedItem } from "./services";
import { getPublicImageUrl } from "../shared/images";
import { hasInventorySchema, hasVariantRetirementSchema } from "./inventory";
import { hasVariantMediaSchema } from "./variant-media";
import { getComboConfig, hasComboSchema } from "./combos";

export type StandardPromotionCartRequestItem = {
  lineType?: "STANDARD";
  variantId: string;
  quantity: number;
  displayedPrice?: number;
};

export type ComboPromotionCartRequestItem = {
  lineType: "COMBO";
  comboProductId: string;
  comboVersion: number;
  selection: ComboSelection;
  quantity: number;
  displayedPrice?: number;
};

export type PromotionCartRequestItem =
  | StandardPromotionCartRequestItem
  | ComboPromotionCartRequestItem;

export type AuthoritativePricedItem = PricedItem & {
  originalLineTotalVnd: number;
  discountAmountVnd: number;
  categoryIds: string[];
  trackInventory?: boolean;
  stockOnHand?: number;
  reservedQuantity?: number;
  availableQuantity?: number;
  inventoryAvailability?: "AVAILABLE" | "OUT_OF_STOCK";
  lineType?: "STANDARD" | "COMBO";
  comboProductId?: string;
  comboVersion?: number;
  comboSelection?: ComboSelection;
  comboComponents?: ComboComponentSnapshot[];
};

export type PromotionSnapshot = {
  promotionId: string | null;
  promotionName: string;
  promotionType: string;
  discountAmountVnd: number;
  freeShipping: boolean;
  configSnapshot?: string;
};

export type PromotionGiftSnapshot = PromotionGiftItem & {
  imageUrl: string;
};

export type PromotionHistory = {
  discountAmountVnd: number;
  finalTotalVnd: number;
  freeShipping: boolean;
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
  inventoryItems: Array<{ variantId: string; quantity: number; trackInventory?: boolean }>;
  promotionSchema: boolean;
};

export class PromotionCartError extends Error {
  constructor(
    readonly code: "VARIANT_NOT_FOUND" | "VARIANT_UNAVAILABLE" | "COMBO_NOT_FOUND" | "COMBO_INVALID",
    message: string,
    readonly status: 404 | 409 | 422,
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
  variantArchivedAt: string | null;
  imageKey: string | null;
  trackInventory: number;
  stockOnHand: number;
  reservedQuantity: number;
};

type CategoryRow = { productId: string; categoryId: string };
type NamedRow = { id: string; name: string };

type ComboProductRow = {
  id: string;
  name: string;
  status: string;
  productType: string;
  basePriceVnd: number | null;
  imageKey: string | null;
};

type ComboComponentRow = {
  id: string;
  productId: string;
  productName: string;
  productStatus: string;
  variantName: string;
  sku: string | null;
  availability: string;
  trackInventory: number;
  stockOnHand: number;
  reservedQuantity: number;
  imageKey: string | null;
};

export type ComboComponentSnapshot = {
  groupId: string;
  groupNameSnapshot: string;
  groupItemId: string;
  variantId: string;
  productId: string | null;
  productNameSnapshot: string;
  variantNameSnapshot: string;
  skuSnapshot: string | null;
  imageKeySnapshot: string | null;
  quantity: number;
  priceAdjustmentVnd: number;
};

type CanonicalLineResult = {
  lines: PromotionCartLine[];
  unavailable: string[];
  changed: AuthoritativeCartEvaluation["changed"];
  insufficientStock: string[];
  inventoryItems: Array<{ variantId: string; quantity: number; trackInventory?: boolean }>;
};

function isMissingPromotionSchema(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table: promotions|no such column: promotion_discount_vnd/i.test(message);
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
  items: StandardPromotionCartRequestItem[],
  env: Env,
) {
  if (!items.length)
    return {
      lines: [] as PromotionCartLine[],
      unavailable: [] as string[],
      changed: [] as AuthoritativeCartEvaluation["changed"],
      insufficientStock: [] as string[],
      inventoryItems: [] as CanonicalLineResult["inventoryItems"],
    };
  const placeholders = items.map(() => "?").join(",");
  const [inventorySchema, variantRetirementSchema, variantMediaSchema] = await Promise.all([
    hasInventorySchema(env),
    hasVariantRetirementSchema(env),
    hasVariantMediaSchema(env),
  ]);
  const variantArchivedAtSelect = variantRetirementSchema
    ? "v.archived_at AS variantArchivedAt"
    : "NULL AS variantArchivedAt";
  const inventorySelect = inventorySchema
    ? "v.track_inventory AS trackInventory, v.stock_on_hand AS stockOnHand, v.reserved_quantity AS reservedQuantity"
    : "0 AS trackInventory, 0 AS stockOnHand, 0 AS reservedQuantity";
  const imageKeySelect = variantMediaSchema
    ? `COALESCE(
        (SELECT r2_key FROM product_variant_images
         WHERE variant_id = v.id ORDER BY is_primary DESC, sort_order, created_at, id LIMIT 1),
        (SELECT r2_key FROM product_images
         WHERE product_id = p.id ORDER BY sort_order, created_at, id LIMIT 1)
      )`
    : `(SELECT r2_key FROM product_images
        WHERE product_id = p.id ORDER BY sort_order, created_at, id LIMIT 1)`;
  const variantNameSelect = variantMediaSchema
    ? "CASE WHEN TRIM(v.package_size) = '' THEN v.name ELSE v.name || ' · ' || v.package_size END"
    : "v.name";
  const rows = await env.DB.prepare(
    `SELECT v.id AS variantId, ${variantNameSelect} AS variantName, v.sku,
      v.price_vnd AS priceVnd, v.availability, p.id AS productId,
      p.name AS productName, p.status AS productStatus,
      ${variantArchivedAtSelect},
      ${inventorySelect},
      ${imageKeySelect} AS imageKey
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
      row.variantArchivedAt ||
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
  return {
    lines,
    unavailable,
    changed,
    insufficientStock,
    inventoryItems: lines
      .filter((line) => line.trackInventory)
      .map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        trackInventory: line.trackInventory,
      })),
  } satisfies CanonicalLineResult;
}

/** Nạp Combo từ DB, xác thực version/rule rồi tách component để giữ tồn kho theo Variant thật. */
async function loadCanonicalComboLines(
  items: ComboPromotionCartRequestItem[],
  env: Env,
): Promise<CanonicalLineResult> {
  if (!items.length)
    return {
      lines: [],
      unavailable: [],
      changed: [],
      insufficientStock: [],
      inventoryItems: [],
    };
  if (!(await hasComboSchema(env)))
    throw new PromotionCartError(
      "COMBO_NOT_FOUND",
      "Cấu hình Combo chưa sẵn sàng trên cơ sở dữ liệu.",
      404,
      [...new Set(items.map((item) => item.comboProductId))],
    );

  const productIds = [...new Set(items.map((item) => item.comboProductId))];
  const productRows = await env.DB.prepare(
    `SELECT p.id, p.name, p.status,
       COALESCE(p.product_type, 'STANDARD') AS productType,
       p.base_price_vnd AS basePriceVnd,
       (SELECT r2_key FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.sort_order, pi.created_at, pi.id LIMIT 1) AS imageKey
     FROM products p WHERE p.id IN (${productIds.map(() => "?").join(",")})`,
  )
    .bind(...productIds)
    .all<ComboProductRow>();
  const products = new Map(productRows.results.map((row) => [row.id, row]));
  const configs = new Map<string, Awaited<ReturnType<typeof getComboConfig>>>();
  await Promise.all(
    productIds.map(async (productId) => {
      configs.set(productId, await getComboConfig(productId, env));
    }),
  );

  const prepared = items.map((item) => {
    const config = configs.get(item.comboProductId);
    if (!config)
      throw new PromotionCartError(
        "COMBO_NOT_FOUND",
        "Combo không còn tồn tại hoặc chưa được cấu hình.",
        404,
        [item.comboProductId],
      );
    const configValidation = validateComboConfig(config);
    const normalizedSelection: ComboSelection = {
      ...item.selection,
      configVersion: config.configVersion,
    };
    const selectionValidation = validateComboSelection(config, item.selection);
    if (
      !configValidation.ok ||
      item.comboVersion !== config.configVersion ||
      item.selection.configVersion !== config.configVersion ||
      !selectionValidation.ok
    ) {
      throw new PromotionCartError(
        "COMBO_INVALID",
        [
          ...configValidation.errors,
          ...(item.comboVersion !== config.configVersion ||
          item.selection.configVersion !== config.configVersion
            ? ["Combo này vừa được cập nhật. Vui lòng kiểm tra lại lựa chọn."]
            : []),
          ...selectionValidation.errors,
        ].join(" "),
        409,
        [item.comboProductId],
      );
    }
    return {
      item,
      config,
      selection: normalizedSelection,
      validation: selectionValidation,
      lineId: comboLineId(item.comboProductId, normalizedSelection),
    };
  });
  const componentIds = [
    ...new Set(
      prepared.flatMap((entry) => entry.validation.components.map((component) => component.variantId)),
    ),
  ];
  const inventorySchema = await hasInventorySchema(env);
  const componentRows = componentIds.length
    ? await env.DB.prepare(
        `SELECT v.id, v.product_id AS productId, p.name AS productName,
           p.status AS productStatus, v.name AS variantName, v.sku,
           v.availability,
           ${inventorySchema
             ? "v.track_inventory AS trackInventory, v.stock_on_hand AS stockOnHand, v.reserved_quantity AS reservedQuantity"
             : "0 AS trackInventory, 0 AS stockOnHand, 0 AS reservedQuantity"},
           (SELECT r2_key FROM product_images pi
            WHERE pi.product_id = v.product_id
            ORDER BY pi.sort_order, pi.created_at, pi.id LIMIT 1) AS imageKey
         FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id IN (${componentIds.map(() => "?").join(",")})`,
      )
        .bind(...componentIds)
        .all<ComboComponentRow>()
    : { results: [] as ComboComponentRow[] };
  const components = new Map(componentRows.results.map((row) => [row.id, row]));
  const categoryRows = await env.DB.prepare(
    `SELECT pc.product_id AS productId, pc.category_id AS categoryId
     FROM product_categories pc JOIN categories c ON c.id = pc.category_id
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
  const inventoryItems: CanonicalLineResult["inventoryItems"] = [];
  const lines = prepared.map((entry) => {
    const product = products.get(entry.item.comboProductId);
    if (!product || product.productType !== "COMBO")
      throw new PromotionCartError(
        "COMBO_NOT_FOUND",
        "Combo không còn tồn tại hoặc chưa được cấu hình.",
        404,
        [entry.item.comboProductId],
      );
    const priceVnd = Math.max(
      0,
      Number(product?.basePriceVnd ?? 0) + entry.validation.priceAdjustment,
    );
    const lineQuantity = entry.item.quantity;
    let lineUnavailable = !product || product.status !== "AVAILABLE";
    entry.validation.components.forEach((component) => {
      const row = components.get(component.variantId);
      const requestedQuantity = component.quantity * lineQuantity;
      if (
        !row ||
        row.productStatus !== "AVAILABLE" ||
        row.availability !== "AVAILABLE"
      ) {
        lineUnavailable = true;
        return;
      }
      const availableQuantity = Math.max(
        0,
        Number(row.stockOnHand ?? 0) - Number(row.reservedQuantity ?? 0),
      );
      if (row.trackInventory && availableQuantity < requestedQuantity)
        insufficientStock.push(row.id);
      if (row.trackInventory)
        inventoryItems.push({
          variantId: row.id,
          quantity: requestedQuantity,
          trackInventory: true,
        });
    });
    if (lineUnavailable) unavailable.push(entry.lineId);
    if (
      entry.item.displayedPrice !== undefined &&
      entry.item.displayedPrice !== priceVnd
    )
      changed.push({
        variantId: entry.lineId,
        displayedPrice: entry.item.displayedPrice,
        currentPrice: priceVnd,
      });
    const comboComponents = entry.validation.components.map((component) => {
      const group = entry.config.groups.find((candidate) => candidate.id === component.groupId);
      const groupItem = group?.items.find((candidate) => candidate.id === component.groupItemId);
      const row = components.get(component.variantId);
      return {
        groupId: component.groupId,
        groupNameSnapshot: group?.name ?? "Group",
        groupItemId: component.groupItemId,
        variantId: component.variantId,
        productId: row?.productId ?? groupItem?.productId ?? null,
        productNameSnapshot: row?.productName ?? groupItem?.productName ?? "Sản phẩm",
        variantNameSnapshot: row?.variantName ?? groupItem?.variantName ?? "Variant",
        skuSnapshot: row?.sku ?? groupItem?.sku ?? null,
        imageKeySnapshot: row?.imageKey ?? groupItem?.imageKey ?? null,
        quantity: component.quantity * lineQuantity,
        priceAdjustmentVnd: component.priceAdjustment * component.quantity * lineQuantity,
      } satisfies ComboComponentSnapshot;
    });
    return {
      productId: entry.item.comboProductId,
      variantId: entry.lineId,
      productName: product?.name ?? "Combo",
      variantName: "Combo",
      sku: null,
      imageKey: product?.imageKey ?? null,
      priceVnd,
      quantity: lineQuantity,
      categoryIds: categoryMap.get(entry.item.comboProductId) ?? [],
      lineType: "COMBO" as const,
      comboProductId: entry.item.comboProductId,
      comboVersion: entry.config.configVersion,
      comboSelection: entry.selection,
      comboComponents,
      ...(inventorySchema
        ? { trackInventory: false, inventoryAvailability: "AVAILABLE" as const }
        : {}),
    } satisfies PromotionCartLine;
  });
  return {
    lines,
    unavailable: [...new Set(unavailable)],
    changed,
    insufficientStock: [...new Set(insufficientStock)],
    inventoryItems,
  } satisfies CanonicalLineResult;
}

function promotionGiftProductIds(promotions: PromotionDefinition[]) {
  const ids = new Set<string>();
  promotions.forEach((promotion) => {
    if (promotion.config.type === "ORDER_GIFT") ids.add(promotion.config.giftProductId);
    if (promotion.config.type === "BUY_X_GET_Y") ids.add(promotion.config.rewardProductId);
  });
  return [...ids];
}

async function loadPromotionTargetNames(
  promotions: PromotionDefinition[],
  env: Env,
): Promise<PromotionTargetNames> {
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  promotions.forEach((promotion) => {
    const config = promotion.config;
    if (config.type === "BUY_X_GET_Y") productIds.add(config.triggerProductId);
    if (config.type === "PRODUCT_DISCOUNT")
      config.productIds.forEach((productId) => productIds.add(productId));
    if (config.type === "CATEGORY_DISCOUNT")
      config.categoryIds.forEach((categoryId) => categoryIds.add(categoryId));
    if (config.type === "QUANTITY_DISCOUNT") {
      if (config.scope === "SELECTED_PRODUCTS")
        config.productIds?.forEach((productId) => productIds.add(productId));
      if (config.scope === "SELECTED_CATEGORIES")
        config.categoryIds?.forEach((categoryId) => categoryIds.add(categoryId));
    }
    if (config.type === "COMBO_DISCOUNT")
      config.items.forEach((item) => productIds.add(item.productId));
  });
  const emptyProducts = { results: [] as NamedRow[] };
  const emptyCategories = { results: [] as NamedRow[] };
  const [productRows, categoryRows] = await Promise.all([
    productIds.size
      ? env.DB.prepare(
          `SELECT id, name FROM products WHERE id IN (${[...productIds].map(() => "?").join(",")})`,
        )
          .bind(...productIds)
          .all<NamedRow>()
      : Promise.resolve(emptyProducts),
    categoryIds.size
      ? env.DB.prepare(
          `SELECT id, name FROM categories WHERE id IN (${[...categoryIds].map(() => "?").join(",")})`,
        )
          .bind(...categoryIds)
          .all<NamedRow>()
      : Promise.resolve(emptyCategories),
  ]);
  return {
    products: Object.fromEntries(
      productRows.results.map((row) => [row.id, row.name]),
    ),
    categories: Object.fromEntries(
      categoryRows.results.map((row) => [row.id, row.name]),
    ),
  };
}

async function loadGiftCatalog(
  promotions: PromotionDefinition[],
  env: Env,
) {
  const productIds = promotionGiftProductIds(promotions);
  if (!productIds.length) return [] as PromotionCatalogProduct[];
  const [inventorySchema, variantRetirementSchema, variantMediaSchema] =
    await Promise.all([
      hasInventorySchema(env),
      hasVariantRetirementSchema(env),
      hasVariantMediaSchema(env),
    ]);
  const variantArchivedAtSelect = variantRetirementSchema
    ? "v.archived_at AS variantArchivedAt"
    : "NULL AS variantArchivedAt";
  const imageKeySelect = variantMediaSchema
    ? `COALESCE(
        (SELECT r2_key FROM product_variant_images
         WHERE variant_id = v.id ORDER BY is_primary DESC, sort_order, created_at, id LIMIT 1),
        (SELECT r2_key FROM product_images
         WHERE product_id = p.id ORDER BY sort_order, created_at, id LIMIT 1)
      )`
    : `(SELECT r2_key FROM product_images
        WHERE product_id = p.id ORDER BY sort_order, created_at, id LIMIT 1)`;
  const variantNameSelect = variantMediaSchema
    ? "CASE WHEN TRIM(v.package_size) = '' THEN v.name ELSE v.name || ' · ' || v.package_size END"
    : "v.name";
  const rows = await env.DB.prepare(
    `SELECT p.id AS productId, p.name AS productName, p.status AS productStatus,
      v.id AS variantId, ${variantNameSelect} AS variantName, v.sku,
      v.price_vnd AS priceVnd, v.availability,
      ${variantArchivedAtSelect},
      ${inventorySchema
        ? "v.track_inventory AS trackInventory, v.stock_on_hand AS stockOnHand, v.reserved_quantity AS reservedQuantity"
        : "0 AS trackInventory, 0 AS stockOnHand, 0 AS reservedQuantity"},
      ${imageKeySelect} AS imageKey,
      v.sort_order AS sortOrder
     FROM products p
     LEFT JOIN product_variants v ON v.product_id = p.id
     WHERE p.id IN (${productIds.map(() => "?").join(",")})
     ORDER BY p.id,
       CASE WHEN p.status = 'AVAILABLE' AND v.availability = 'AVAILABLE' THEN 0 ELSE 1 END,
       v.sort_order, v.created_at, v.id`,
  )
    .bind(...productIds)
    .all<PromotionCatalogProduct & {
      sortOrder: number | null;
      variantArchivedAt: string | null;
    }>();
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
      !row.variantArchivedAt &&
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
  const standardItems = items.filter(
    (item): item is StandardPromotionCartRequestItem => item.lineType !== "COMBO",
  );
  const comboItems = items.filter(
    (item): item is ComboPromotionCartRequestItem => item.lineType === "COMBO",
  );
  const [standardCanonical, comboCanonical] = await Promise.all([
    loadCanonicalLines(standardItems, env),
    loadCanonicalComboLines(comboItems, env),
  ]);
  const canonical: CanonicalLineResult = {
    lines: [...standardCanonical.lines, ...comboCanonical.lines],
    unavailable: [...standardCanonical.unavailable, ...comboCanonical.unavailable],
    changed: [...standardCanonical.changed, ...comboCanonical.changed],
    insufficientStock: [
      ...new Set([
        ...standardCanonical.insufficientStock,
        ...comboCanonical.insufficientStock,
      ]),
    ],
    inventoryItems: [...standardCanonical.inventoryItems, ...comboCanonical.inventoryItems],
  };
  const inventoryByVariant = new Map<string, { variantId: string; quantity: number; trackInventory?: boolean }>();
  canonical.inventoryItems.forEach((item) => {
    const current = inventoryByVariant.get(item.variantId);
    if (current) current.quantity += item.quantity;
    else inventoryByVariant.set(item.variantId, { ...item });
  });
  const componentStock = new Map<string, number>();
  if (inventoryByVariant.size) {
    const inventoryRows = await env.DB.prepare(
      `SELECT id, stock_on_hand AS stockOnHand, reserved_quantity AS reservedQuantity
       FROM product_variants WHERE id IN (${[...inventoryByVariant.keys()].map(() => "?").join(",")})`,
    )
      .bind(...inventoryByVariant.keys())
      .all<{ id: string; stockOnHand: number; reservedQuantity: number }>();
    inventoryRows.results.forEach((row) =>
      componentStock.set(
        row.id,
        Math.max(0, Number(row.stockOnHand ?? 0) - Number(row.reservedQuantity ?? 0)),
      ),
    );
    inventoryByVariant.forEach((item, variantId) => {
      if ((componentStock.get(variantId) ?? 0) < item.quantity)
        canonical.insufficientStock.push(variantId);
    });
    canonical.insufficientStock = [...new Set(canonical.insufficientStock)];
  }
  const promotions = await loadActivePromotions(env, now);
  // Tải song song catalog quà và tên target để không nhận dữ liệu hiển thị từ client.
  const [catalog, targetNames] = await Promise.all([
    loadGiftCatalog(promotions, env),
    loadPromotionTargetNames(promotions, env),
  ]);
  const evaluation = evaluatePromotions({
    cart: canonical.lines,
    promotions,
    catalog,
    targetNames,
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
    lineType: item.lineType,
    comboProductId: item.comboProductId,
    comboVersion: item.comboVersion,
    comboSelection: item.comboSelection,
    comboComponents: item.comboComponents,
  }));
  return {
    lines: canonical.lines,
    pricedItems,
    promotions,
    evaluation,
    unavailable: canonical.unavailable,
    changed: canonical.changed,
    insufficientStock: canonical.insufficientStock,
    inventoryItems: [...inventoryByVariant.values()],
    promotionSchema: schema,
  };
}

/** Tạo snapshot Cart line và component trong cùng batch với CartRequest. */
export function buildCartRequestItemStatements(
  prepare: (sql: string) => D1PreparedStatement,
  cartRequestId: string,
  createdAt: string,
  items: AuthoritativePricedItem[],
  comboSchema: boolean,
) {
  const statements: D1PreparedStatement[] = [];
  items.forEach((item) => {
    const itemId = crypto.randomUUID();
    if (comboSchema) {
      statements.push(
        prepare(
          `INSERT INTO cart_request_items (
            id, cart_request_id, product_id, variant_id, product_name_snapshot,
            variant_name_snapshot, sku_snapshot, image_key_snapshot, unit_price_vnd,
            quantity, line_total_vnd, line_type, combo_product_id, combo_version,
            combo_selection_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          itemId,
          cartRequestId,
          item.productId,
          item.lineType === "COMBO" ? null : item.variantId,
          item.productName,
          item.variantName,
          item.sku,
          item.imageKey,
          item.priceVnd,
          item.quantity,
          item.lineTotalVnd,
          item.lineType ?? "STANDARD",
          item.lineType === "COMBO" ? item.comboProductId : null,
          item.lineType === "COMBO" ? item.comboVersion : null,
          item.lineType === "COMBO" && item.comboSelection
            ? JSON.stringify(item.comboSelection)
            : null,
          createdAt,
        ),
      );
      item.comboComponents?.forEach((component) => {
        statements.push(
          prepare(
            `INSERT INTO cart_request_combo_components (
              id, cart_request_item_id, combo_product_id, combo_version,
              group_id, group_name_snapshot, group_item_id, variant_id, product_id,
              product_name_snapshot, variant_name_snapshot, sku_snapshot,
              image_key_snapshot, quantity, price_adjustment_vnd, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            itemId,
            item.comboProductId ?? item.productId,
            item.comboVersion ?? 1,
            component.groupId,
            component.groupNameSnapshot,
            component.groupItemId,
            component.variantId,
            component.productId,
            component.productNameSnapshot,
            component.variantNameSnapshot,
            component.skuSnapshot,
            component.imageKeySnapshot,
            component.quantity,
            component.priceAdjustmentVnd,
            createdAt,
          ),
        );
      });
      return;
    }
    statements.push(
      prepare(
        `INSERT INTO cart_request_items (
          id, cart_request_id, product_id, variant_id, product_name_snapshot,
          variant_name_snapshot, sku_snapshot, image_key_snapshot, unit_price_vnd,
          quantity, line_total_vnd, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        itemId,
        cartRequestId,
        item.productId,
        item.variantId,
        item.productName,
        item.variantName,
        item.sku,
        item.imageKey,
        item.priceVnd,
        item.quantity,
        item.lineTotalVnd,
        createdAt,
      ),
    );
  });
  return statements;
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

type StoredPromotionSnapshot = Omit<PromotionSnapshot, "freeShipping">;

function snapshotProvidesFreeShipping(
  promotion: StoredPromotionSnapshot,
  subtotalVnd: number,
) {
  if (
    !promotion.configSnapshot ||
    !promotionTypes.includes(promotion.promotionType as (typeof promotionTypes)[number])
  )
    return false;
  try {
    const config = validatePromotionConfig(
      promotion.promotionType as (typeof promotionTypes)[number],
      JSON.parse(promotion.configSnapshot),
    );
    return promotionConfigProvidesFreeShipping(config, subtotalVnd);
  } catch {
    return false;
  }
}

export async function loadPromotionHistory(
  cartRequestId: string,
  env: Env,
): Promise<PromotionHistory> {
  const fallback: PromotionHistory = {
    discountAmountVnd: 0,
    finalTotalVnd: 0,
    freeShipping: false,
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
        .all<StoredPromotionSnapshot>(),
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
    const snapshotPromotions = promotions.results.map((promotion) => ({
      ...promotion,
      freeShipping: snapshotProvidesFreeShipping(promotion, request?.subtotalVnd ?? 0),
    }));
    return {
      discountAmountVnd: request?.discountAmountVnd ?? 0,
      finalTotalVnd: request?.finalTotalVnd ?? request?.subtotalVnd ?? 0,
      freeShipping: snapshotPromotions.some((promotion) => promotion.freeShipping),
      promotions: snapshotPromotions,
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
): Array<Pick<AppliedPromotion, "promotionId" | "promotionName" | "type" | "discountAmountVnd" | "freeShipping">> {
  return applied.map(({ promotionId, promotionName, type, discountAmountVnd, freeShipping }) => ({
    promotionId,
    promotionName,
    type,
    discountAmountVnd,
    freeShipping,
  }));
}

export function progressSummary(
  progress: PromotionProgress[],
): PromotionProgress[] {
  return progress;
}
