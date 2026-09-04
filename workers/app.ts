import { createRequestHandler } from "react-router";
import {
  mapCartItemSnapshot,
  type CartItemSnapshotRow,
} from "./services";
import {
  authorizeAdminRequest,
  type AdminAuthorization,
} from "./access";
import {
  ImageUploadError,
  normalizeProductImages,
  uploadImmutableProductImage,
  validateAssociatedImages,
} from "./image-service";
import {
  cleanupOrphanedProductDescriptionAssets,
  hasProductDescriptionSchema,
  imageUploadErrorStatus,
  listProductDescriptionAssets,
  mapProductDescriptionAssets,
  prepareProductDescriptionAssetPersistence,
  uploadProductDescriptionAsset,
  validateProductDescriptionAssets,
  ProductDescriptionAssetError,
  type ProductDescriptionAssetRow,
} from "./product-description-assets";
import {
  getProductImageUrl,
  getProductImageUrlStrategy,
  getPublicImageUrl,
  MAX_STORED_IMAGE_BYTES,
  type ProductImageUrlStrategy,
} from "../shared/images";
import {
  findProductConflict,
  productConflictError,
} from "./product-conflicts";
import {
  getMessengerStatus,
  handleMessengerWebhook,
  retryMessengerDelivery,
  startMessengerCheckout,
} from "./messenger";
import {
  checkoutConfigResponse,
  activateCartShare,
  getAdminSellerSettings,
  getPublicCartShare,
  prepareCartShare,
  saveAdminSellerSettings,
} from "./cart-share";
import {
  cancelInventoryOrder,
  confirmInventoryOrder,
  cleanupExpiredReservations,
  getAdminCheckoutSettings,
  hasInventorySchema,
  hasVariantRetirementSchema,
  listActiveReservations,
  listPromotionReservations,
  mapInventoryError,
  saveAdminCheckoutSettings,
} from "./inventory";
import {
  getAdminCronHealthData,
  runInventoryCleanupCron,
} from "./scheduled-inventory-cleanup";
import {
  evaluateAuthoritativeCart,
  PromotionCartError,
} from "./promotions";
import {
  deleteAdminPromotion,
  duplicateAdminPromotion,
  getAdminPromotion,
  listAdminPromotions,
  listPromotionOptions,
  saveAdminPromotion,
  updateAdminPromotionStatus,
} from "./promotion-admin";
import {
  addAdminAnalyticsExemption,
  authorizeStorefrontSession,
  createAccessLink,
  deleteAccessLink,
  getStorefrontSettings,
  handleAccessRequest,
  isAccessEndpointPath,
  isAdminHtmlPath,
  isStorefrontAccessGateEnabled,
  isStorefrontProtectedApiPath,
  isStorefrontProtectedHtmlPath,
  listAccessLinks,
  resetAccessLinkSessions,
  revokeAccessLink,
  rotateAccessLink,
  saveStorefrontSettings,
  storefrontAccessRequiredRedirect,
  storefrontGateMisconfiguredResponse,
  storefrontSessionRequiredResponse,
  testAccessLink,
  updateAccessLink,
  redactPathForLog,
} from "./storefront-access";
import {
  buildPaginationMeta,
  normalizeLimit,
  normalizePage,
} from "../shared/pagination";
import {
  buildCartRequestListQuery,
  parseCartRequestListParams,
} from "./cart-requests";
import {
  extractProductDescriptionText,
  getProductDescriptionImageNodes,
  normalizeProductDescriptionDocument,
  parseProductDescriptionContent,
  type ProductDescriptionDocument,
  type ProductDescriptionValidationIssue,
} from "../shared/product-description";
import {
  getAdminContentPage,
  listAdminContentPages,
  getPublicContentPage,
  saveAdminContentPage,
} from "./content-pages";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);
const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function cloneResponseWithHeaders(response: Response, headers: Headers) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function privateNoStoreResponse(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  return cloneResponseWithHeaders(response, headers);
}

function error(
  code: string,
  message: string,
  status: number,
  details?: unknown,
) {
  return json({ success: false, error: { code, message, details } }, status);
}

async function readBoundedJson(request: Request, maxBytes = 64 * 1024) {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > maxBytes
    )
      throw new Error("PAYLOAD_TOO_LARGE");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(text) as unknown;
}

async function evaluateCart(request: Request, env: Env) {
  let value: unknown;
  try {
    value = await readBoundedJson(request);
  } catch {
    return error("VALIDATION_ERROR", "Thông tin giỏ hàng chưa hợp lệ.", 422);
  }
  if (!value || typeof value !== "object")
    return error("VALIDATION_ERROR", "Thông tin giỏ hàng chưa hợp lệ.", 422);
  const rawItems = (value as { items?: unknown }).items;
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 50)
    return error("VALIDATION_ERROR", "Thông tin giỏ hàng chưa hợp lệ.", 422);
  const seen = new Set<string>();
  const items = [] as Array<{ variantId: string; quantity: number }>;
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object")
      return error("VALIDATION_ERROR", "Thông tin giỏ hàng chưa hợp lệ.", 422);
    const row = rawItem as Record<string, unknown>;
    const variantId = typeof row.variantId === "string" ? row.variantId.trim() : "";
    const quantity = Number(row.quantity);
    if (
      !variantId ||
      seen.has(variantId) ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 99
    )
      return error("VALIDATION_ERROR", "Thông tin giỏ hàng chưa hợp lệ.", 422);
    seen.add(variantId);
    items.push({ variantId, quantity });
  }
  try {
    // Dọn lazy để tồn kho khả dụng không bị khóa bởi reservation đã quá hạn khi cron trễ.
    await cleanupExpiredReservations(env);
    const result = await evaluateAuthoritativeCart(items, env);
    if (result.unavailable.length)
      return error(
        "VARIANT_UNAVAILABLE",
        "Một số sản phẩm hiện không còn sẵn sàng.",
        409,
        { variantIds: result.unavailable },
      );
    if (result.insufficientStock.length)
      return error(
        "INSUFFICIENT_STOCK",
        "Một số sản phẩm không đủ tồn kho khả dụng.",
        409,
        { variantIds: result.insufficientStock },
      );
    return json({
      success: true,
      subtotalVnd: result.evaluation.subtotalVnd,
      discountTotalVnd: result.evaluation.discountTotalVnd,
      finalTotalVnd: result.evaluation.finalTotalVnd,
      totalQuantity: result.evaluation.totalQuantity,
      items: result.evaluation.items.map(({ categoryIds: _categoryIds, ...item }) => item),
      gifts: result.evaluation.gifts,
      appliedPromotions: result.evaluation.appliedPromotions.map(
        ({ giftItems: _giftItems, ...promotion }) => promotion,
      ),
      progress: result.evaluation.progress,
    });
  } catch (caught) {
    if (caught instanceof PromotionCartError)
      return error(caught.code, caught.message, caught.status, {
        variantIds: caught.variantIds,
      });
    throw caught;
  }
}

async function listCategories(env: Env, includeInactive = false) {
  const result = await env.DB.prepare(
    `SELECT c.id, c.parent_id AS parentId, c.name, c.slug, c.description,
      c.image_key AS imageKey, c.sort_order AS sortOrder, c.is_active AS isActive,
      (SELECT COUNT(*) FROM product_categories pc WHERE pc.category_id = c.id) AS productCount
     FROM categories c ${includeInactive ? "" : "WHERE c.is_active = 1"}
     ORDER BY c.sort_order, c.name`,
  ).all();
  return json({ data: result.results });
}

async function listBrands(env: Env, includeInactive = false) {
  const result = await env.DB.prepare(
    `SELECT id, name, slug, sort_order AS sortOrder, is_active AS isActive
     FROM brands ${includeInactive ? "" : "WHERE is_active = 1"}
     ORDER BY sort_order, name`,
  ).all();
  return json({ data: result.results });
}

async function listTags(env: Env) {
  const result = await env.DB.prepare(
    `SELECT id, name, slug, group_type AS groupType, sort_order AS sortOrder,
      is_active AS isActive
     FROM tags
     WHERE is_active = 1
     ORDER BY sort_order, name`,
  ).all();
  return json({ data: result.results });
}

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  brandId: string | null;
  brandSlug: string | null;
  minAgeMonths: number | null;
  isBestSeller: number;
  bestSellerRank: number | null;
  archivedAt: string | null;
  shortDescription: string;
  description: string;
  descriptionContent?: string | null;
  status: string;
  featured: number;
  sortOrder: number;
  categorySlug: string | null;
};
type ProductVariantRow = {
  productId: string;
  id: string;
  name: string;
  sku: string | null;
  priceVnd: number;
  compareAtPriceVnd: number | null;
  availability: string;
  sortOrder: number;
  trackInventory?: number;
  stockOnHand?: number;
  reservedQuantity?: number;
};
type ProductImageRow = {
  productId: string;
  id: string;
  r2Key: string;
  altText: string;
  sortOrder: number;
};
type ProductTagRow = { productId: string; name: string; slug: string };
type ProductCategoryRow = { productId: string; id: string; slug: string; name: string };

async function hydrateProducts(
  rows: ProductRow[],
  env: Env,
  imageUrlStrategy: ProductImageUrlStrategy,
  includeDescription = false,
) {
  if (!rows.length) return [];
  const placeholders = rows.map(() => "?").join(",");
  const ids = rows.map((row) => row.id);
  const [inventorySchema, variantRetirementSchema] = await Promise.all([
    hasInventorySchema(env),
    hasVariantRetirementSchema(env),
  ]);
  const descriptionSchema =
    includeDescription && (await hasProductDescriptionSchema(env));
  const inventorySelect = inventorySchema
    ? ", track_inventory AS trackInventory, stock_on_hand AS stockOnHand, reserved_quantity AS reservedQuantity"
    : ", 0 AS trackInventory, 0 AS stockOnHand, 0 AS reservedQuantity";
  const activeVariantWhere = variantRetirementSchema
    ? " AND archived_at IS NULL"
    : "";
  const [variants, images, tags, categories] = await Promise.all([
    env.DB.prepare(
      `SELECT product_id AS productId, id, name, sku, price_vnd AS priceVnd, compare_at_price_vnd AS compareAtPriceVnd, availability, sort_order AS sortOrder${inventorySelect} FROM product_variants WHERE product_id IN (${placeholders})${activeVariantWhere} ORDER BY sort_order, created_at`,
    )
      .bind(...ids)
      .all<ProductVariantRow>(),
    env.DB.prepare(
      `SELECT product_id AS productId, id, r2_key AS r2Key, alt_text AS altText, sort_order AS sortOrder FROM product_images WHERE product_id IN (${placeholders}) ORDER BY sort_order, created_at`,
    )
      .bind(...ids)
      .all<ProductImageRow>(),
    env.DB.prepare(
      `SELECT pt.product_id AS productId, t.name, t.slug FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.product_id IN (${placeholders}) AND t.is_active = 1 ORDER BY t.sort_order, t.name`,
    )
      .bind(...ids)
      .all<ProductTagRow>(),
    env.DB.prepare(
      `SELECT pc.product_id AS productId, c.id, c.slug, c.name
       FROM product_categories pc JOIN categories c ON c.id = pc.category_id
       WHERE pc.product_id IN (${placeholders}) AND c.is_active = 1
       ORDER BY c.sort_order, c.name`,
    )
      .bind(...ids)
      .all<ProductCategoryRow>(),
  ]);
  const descriptionAssetRows = descriptionSchema
    ? await listProductDescriptionAssets(env, ids, imageUrlStrategy)
    : [];
  const descriptionAssetsByProduct = new Map<string, ProductDescriptionAssetRow[]>();
  descriptionAssetRows.forEach((asset) => {
    if (!asset.productId) return;
    const current = descriptionAssetsByProduct.get(asset.productId) ?? [];
    current.push(asset);
    descriptionAssetsByProduct.set(asset.productId, current);
  });
  return rows.map((product) => ({
    ...product,
    variants: variants.results
      .filter((variant) => variant.productId === product.id)
      .map(({ productId: _productId, ...variant }) => ({
        ...variant,
        trackInventory: Boolean(variant.trackInventory),
        availableQuantity: Math.max(
          0,
          Number(variant.stockOnHand ?? 0) - Number(variant.reservedQuantity ?? 0),
        ),
        inventoryAvailability:
          Number(variant.stockOnHand ?? 0) - Number(variant.reservedQuantity ?? 0) > 0
            ? "AVAILABLE"
            : "OUT_OF_STOCK",
      })),
    images: images.results
      .filter((image) => image.productId === product.id)
      .map(({ productId: _productId, ...image }) => ({
        ...image,
        url: getProductImageUrl(image.r2Key, imageUrlStrategy),
      })),
    tagNames: tags.results
      .filter((tag) => tag.productId === product.id)
      .map((tag) => tag.name),
    tagSlugs: tags.results
      .filter((tag) => tag.productId === product.id)
      .map((tag) => tag.slug),
    categories: categories.results
      .filter((category) => category.productId === product.id)
      .map(({ productId: _productId, ...category }) => category),
    categoryIds: categories.results
      .filter((category) => category.productId === product.id)
      .map((category) => category.id),
    categorySlugs: categories.results
      .filter((category) => category.productId === product.id)
      .map((category) => category.slug),
    ...(includeDescription
      ? (() => {
          const assets = descriptionAssetsByProduct.get(product.id) ?? [];
          const content = parseProductDescriptionContent(
            product.descriptionContent,
            { assetIds: new Set(assets.map((asset) => asset.id)) },
          );
          if (product.descriptionContent && !content)
            console.error(
              JSON.stringify({
                message: "invalid product description content",
                productId: product.id,
              }),
            );
          return {
            descriptionContent: content,
            descriptionAssets: mapProductDescriptionAssets(
              assets,
              imageUrlStrategy,
            ),
          };
        })()
      : {}),
  }));
}

type ProductListStatus = "ALL" | "AVAILABLE" | "OUT_OF_STOCK" | "HIDDEN";
type ProductListSort =
  | "default"
  | "newest"
  | "price_asc"
  | "price_desc"
  | "best_seller";

type ProductListQuery = {
  whereSql: string;
  values: Array<string | number>;
  orderSql: string;
};

function csvQueryValue(value: string | null) {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function parseBooleanQuery(value: string | null) {
  return value === "1" || value === "true";
}

function parseProductSort(value: string | null): ProductListSort {
  if (
    value === "newest" ||
    value === "price_asc" ||
    value === "price_desc" ||
    value === "best_seller"
  )
    return value;
  return "default";
}

function parseAdminStatus(value: string | null): ProductListStatus {
  if (
    value === "AVAILABLE" ||
    value === "OUT_OF_STOCK" ||
    value === "HIDDEN"
  )
    return value;
  return "ALL";
}

function buildProductListQuery({
  q,
  categories,
  brands,
  age,
  bestSeller,
  tag,
  available,
  sort,
  includeHidden,
  status,
  inventorySchema,
  variantRetirementSchema,
}: {
  q: string;
  categories: string[];
  brands: string[];
  age: number | null;
  bestSeller: boolean;
  tag: string;
  available: boolean;
  sort: ProductListSort;
  includeHidden: boolean;
  status: ProductListStatus;
  inventorySchema: boolean;
  variantRetirementSchema: boolean;
}): ProductListQuery {
  const activeVariantPredicate = (alias: string) =>
    variantRetirementSchema ? ` AND ${alias}.archived_at IS NULL` : "";
  const where = includeHidden
    ? ["1 = 1"]
    : [
        "p.status != 'HIDDEN'",
        "p.archived_at IS NULL",
        `EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.availability != 'HIDDEN'${activeVariantPredicate("pv")})`,
      ];
  const values: Array<string | number> = [];
  if (includeHidden && status !== "ALL") {
    where.push("p.status = ?");
    values.push(status);
  }
  if (q) {
    where.push(
      `(p.name LIKE ? OR COALESCE(b.name, p.brand, '') LIKE ? OR EXISTS (SELECT 1 FROM product_variants sv WHERE sv.product_id = p.id AND sv.sku LIKE ?${activeVariantPredicate("sv")}))`,
    );
    values.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (categories.length) {
    const categoryPlaceholders = categories.map(() => "?").join(",");
    where.push(
      `EXISTS (SELECT 1 FROM product_categories spc JOIN categories sc ON sc.id = spc.category_id WHERE spc.product_id = p.id AND sc.is_active = 1 AND sc.slug IN (${categoryPlaceholders}))`,
    );
    values.push(...categories);
  }
  if (brands.length) {
    const brandPlaceholders = brands.map(() => "?").join(",");
    where.push(`b.slug IN (${brandPlaceholders})`);
    values.push(...brands);
  }
  if (age !== null) {
    where.push("p.min_age_months <= ?");
    values.push(age);
  }
  if (bestSeller) where.push("p.is_best_seller = 1");
  if (tag) {
    where.push(
      "EXISTS (SELECT 1 FROM product_tags spt JOIN tags st ON st.id = spt.tag_id WHERE spt.product_id = p.id AND st.is_active = 1 AND st.slug = ?)",
    );
    values.push(tag);
  }
  if (available)
    where.push(
      inventorySchema
        ? `EXISTS (SELECT 1 FROM product_variants av WHERE av.product_id = p.id AND av.availability = 'AVAILABLE' AND (av.track_inventory = 0 OR av.stock_on_hand > av.reserved_quantity)${activeVariantPredicate("av")})`
        : `EXISTS (SELECT 1 FROM product_variants av WHERE av.product_id = p.id AND av.availability = 'AVAILABLE'${activeVariantPredicate("av")})`,
    );

  const price =
    `COALESCE((SELECT MIN(sv.price_vnd) FROM product_variants sv WHERE sv.product_id = p.id AND sv.availability != 'HIDDEN'${activeVariantPredicate("sv")}), 0)`;
  const orderSql =
    sort === "price_asc"
      ? `${price} ASC, p.sort_order ASC, p.name ASC, p.id ASC`
      : sort === "price_desc"
        ? `${price} DESC, p.sort_order ASC, p.name ASC, p.id ASC`
        : sort === "newest"
          ? "p.created_at DESC, p.id DESC"
          : sort === "best_seller" || bestSeller
            ? "p.is_best_seller DESC, COALESCE(p.best_seller_rank, 2147483647) ASC, p.sort_order ASC, p.name ASC, p.id ASC"
            : "p.sort_order ASC, p.name ASC, p.id ASC";
  return { whereSql: where.join(" AND "), values, orderSql };
}

async function listProducts(request: Request, env: Env, includeHidden = false) {
  // Dọn lazy để catalog không giữ trạng thái tồn kho đã quá hạn khi cron trễ.
  await cleanupExpiredReservations(env);
  const [inventorySchema, variantRetirementSchema] = await Promise.all([
    hasInventorySchema(env),
    hasVariantRetirementSchema(env),
  ]);
  const imageUrlStrategy = getProductImageUrlStrategy(env.ENVIRONMENT);
  const url = new URL(request.url);
  const ageValue = url.searchParams.get("age");
  let age: number | null = null;
  if (ageValue !== null) {
    const parsedAge = Number(ageValue);
    if (!Number.isSafeInteger(parsedAge) || parsedAge < 0 || parsedAge > 240)
      return error("VALIDATION_ERROR", "Độ tuổi lọc không hợp lệ.", 422);
    age = parsedAge;
  }
  const requestedPage = normalizePage(url.searchParams.get("page"));
  const limit = normalizeLimit(url.searchParams.get("limit"));
  const query = buildProductListQuery({
    q: (url.searchParams.get("q") ?? "").trim(),
    categories: csvQueryValue(url.searchParams.get("category")),
    brands: csvQueryValue(url.searchParams.get("brand")),
    age,
    bestSeller: parseBooleanQuery(url.searchParams.get("bestSeller")),
    tag: (url.searchParams.get("tag") ?? "").trim(),
    available: parseBooleanQuery(url.searchParams.get("available")),
    sort: parseProductSort(url.searchParams.get("sort")),
    includeHidden,
    status: parseAdminStatus(url.searchParams.get("status")),
    inventorySchema,
    variantRetirementSchema,
  });
  const count = await env.DB.prepare(
    `SELECT COUNT(DISTINCT p.id) AS totalItems
     FROM products p LEFT JOIN brands b ON b.id = p.brand_id
     WHERE ${query.whereSql}`,
  )
    .bind(...query.values)
    .first<{ totalItems: number }>();
  const pagination = buildPaginationMeta({
    totalItems: Number(count?.totalItems ?? 0),
    requestedPage,
    limit,
  });
  const result = await env.DB.prepare(
    `SELECT p.id, p.name, p.slug, COALESCE(b.name, p.brand) AS brand,
      p.brand_id AS brandId, b.slug AS brandSlug, p.min_age_months AS minAgeMonths,
      p.is_best_seller AS isBestSeller, p.best_seller_rank AS bestSellerRank,
      p.archived_at AS archivedAt, p.short_description AS shortDescription,
      p.description, p.status, p.featured, p.sort_order AS sortOrder,
      (SELECT c.slug FROM product_categories pc JOIN categories c ON c.id = pc.category_id
        WHERE pc.product_id = p.id AND c.is_active = 1 ORDER BY c.sort_order, c.id LIMIT 1) AS categorySlug
    FROM products p LEFT JOIN brands b ON b.id = p.brand_id
    WHERE ${query.whereSql} ORDER BY ${query.orderSql} LIMIT ? OFFSET ?`,
  )
    .bind(
      ...query.values,
      pagination.limit,
      (pagination.page - 1) * pagination.limit,
    )
    .all<ProductRow>();
  const products = await hydrateProducts(result.results, env, imageUrlStrategy);
  if (!includeHidden)
    products.forEach((product) => {
      product.variants = product.variants.filter(
        (variant) => variant.availability !== "HIDDEN",
      );
    });
  return json({ data: products, pagination });
}

async function getProduct(
  slug: string,
  env: Env,
  imageUrlStrategy: ProductImageUrlStrategy,
) {
  await cleanupExpiredReservations(env);
  const descriptionSchema = await hasProductDescriptionSchema(env);
  const product = await env.DB.prepare(
    `SELECT p.id, p.name, p.slug, COALESCE(b.name, p.brand) AS brand,
      p.brand_id AS brandId, b.slug AS brandSlug, p.min_age_months AS minAgeMonths,
      p.is_best_seller AS isBestSeller, p.best_seller_rank AS bestSellerRank,
      p.archived_at AS archivedAt, p.short_description AS shortDescription,
      p.description, ${descriptionSchema ? "p.description_content" : "NULL"} AS descriptionContent,
      p.status, p.featured, p.sort_order AS sortOrder,
      (SELECT c.slug FROM product_categories pc JOIN categories c ON c.id = pc.category_id
        WHERE pc.product_id = p.id AND c.is_active = 1 ORDER BY c.sort_order LIMIT 1) AS categorySlug
     FROM products p LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.slug = ? AND p.status != 'HIDDEN' AND p.archived_at IS NULL`,
  )
    .bind(slug)
    .first<ProductRow>();
  if (!product)
    return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  const [hydrated] = await hydrateProducts(
    [product],
    env,
    imageUrlStrategy,
    true,
  );
  hydrated.variants = hydrated.variants.filter(
    (variant) => variant.availability !== "HIDDEN",
  );
  return json({ data: hydrated });
}

async function hasDatabaseTable(env: Env, tableName: string) {
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

async function getAdminRequests(request: Request, env: Env) {
  await cleanupExpiredReservations(env);
  const params = parseCartRequestListParams(new URL(request.url).searchParams);
  if (params.invalid.length)
    return error(
      "VALIDATION_ERROR",
      "Bộ lọc giỏ hàng không hợp lệ.",
      422,
      { fields: params.invalid },
    );

  const inventorySchema = await hasInventorySchema(env);
  const messengerSessionSchema = await hasDatabaseTable(
    env,
    "messenger_checkout_sessions",
  );
  const query = buildCartRequestListQuery(params, {
    inventorySchema,
    messengerSessionSchema,
  });
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS totalItems
     FROM cart_requests cr ${query.whereSql}`,
  )
    .bind(...query.values)
    .first<{ totalItems: number }>();
  const pagination = buildPaginationMeta({
    totalItems: Number(count?.totalItems ?? 0),
    requestedPage: params.page,
    limit: params.limit,
  });
  const inventorySelect = inventorySchema
    ? ", cr.checkout_state AS checkoutState, cr.reservation_started_at AS reservationStartedAt, cr.reservation_expires_at AS reservationExpiresAt, cr.reservation_duration_minutes AS reservationDurationMinutes"
    : ", 'LEGACY' AS checkoutState, NULL AS reservationStartedAt, NULL AS reservationExpiresAt, NULL AS reservationDurationMinutes";
  const sessionSelect = messengerSessionSchema
    ? "(SELECT status FROM messenger_checkout_sessions WHERE cart_request_id = cr.id ORDER BY created_at DESC LIMIT 1)"
    : "NULL";
  const result = await env.DB.prepare(
    `SELECT cr.id, cr.public_code AS publicCode, cr.customer_name AS customerName,
      cr.customer_phone AS customerPhone, cr.item_line_count AS itemLineCount,
      cr.total_quantity AS totalQuantity, cr.subtotal_vnd AS subtotalVnd, cr.status,
      cr.telegram_status AS telegramStatus, cr.contact_channel AS contactChannel,
      cr.messenger_delivery_status AS messengerDeliveryStatus,
      ${sessionSelect} AS messengerSessionStatus,
      cr.created_at AS createdAt${inventorySelect}
     FROM cart_requests cr ${query.whereSql}
     ORDER BY ${query.orderSql} LIMIT ? OFFSET ?`,
  )
    .bind(
      ...query.values,
      pagination.limit,
      (pagination.page - 1) * pagination.limit,
    )
    .all<Record<string, unknown>>();
  return json({ data: result.results, pagination });
}

async function getAdminRequest(id: string, env: Env) {
  await cleanupExpiredReservations(env);
  const inventorySchema = await hasInventorySchema(env);
  const cartRequest = await env.DB.prepare(
    `SELECT id, public_code AS publicCode, customer_name AS customerName,
      customer_phone AS customerPhone, customer_contact AS customerContact,
      customer_note AS customerNote, item_line_count AS itemLineCount,
      total_quantity AS totalQuantity, subtotal_vnd AS subtotalVnd, status,
      telegram_status AS telegramStatus, telegram_last_error AS telegramLastError,
      contact_channel AS contactChannel,
      messenger_delivery_status AS messengerDeliveryStatus,
      messenger_confirmed_at AS messengerConfirmedAt,
      messenger_sent_at AS messengerSentAt,
      messenger_attempt_count AS messengerAttemptCount,
      messenger_last_error_code AS messengerLastErrorCode,
      messenger_last_error AS messengerLastError,
      messenger_last_user_interaction_at AS messengerLastUserInteractionAt,
      CASE WHEN messenger_psid IS NULL THEN 0 ELSE 1 END AS messengerLinked,
      (SELECT status FROM messenger_checkout_sessions WHERE cart_request_id = cart_requests.id ORDER BY created_at DESC LIMIT 1) AS messengerSessionStatus,
      (SELECT expires_at FROM messenger_checkout_sessions WHERE cart_request_id = cart_requests.id ORDER BY created_at DESC LIMIT 1) AS messengerExpiresAt,
      created_at AS createdAt, updated_at AS updatedAt${inventorySchema
        ? ", checkout_state AS checkoutState, reservation_started_at AS reservationStartedAt, reservation_expires_at AS reservationExpiresAt, reservation_duration_minutes AS reservationDurationMinutes, seller_confirmed_at AS sellerConfirmedAt"
        : ", 'LEGACY' AS checkoutState, NULL AS reservationStartedAt, NULL AS reservationExpiresAt, NULL AS reservationDurationMinutes, NULL AS sellerConfirmedAt"}
     FROM cart_requests WHERE id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!cartRequest)
    return error("PRODUCT_NOT_FOUND", "Không tìm thấy giỏ hàng.", 404);
  const items = await env.DB.prepare(
    "SELECT id, product_id AS productId, variant_id AS variantId, product_name_snapshot AS productName, variant_name_snapshot AS variantName, sku_snapshot AS sku, image_key_snapshot AS imageKey, unit_price_vnd AS priceVnd, quantity, line_total_vnd AS lineTotalVnd, created_at AS createdAt FROM cart_request_items WHERE cart_request_id = ? ORDER BY created_at",
  )
    .bind(id)
    .all<CartItemSnapshotRow>();
  const [reservations, promotionReservations] = await Promise.all([
    listActiveReservations(id, env),
    listPromotionReservations(id, env),
  ]);
  return json({
    data: {
      ...cartRequest,
      serverNow: new Date().toISOString(),
      reservations,
      promotionReservations,
      items: items.results.map(mapCartItemSnapshot),
    },
  });
}

async function updateRequestStatus(request: Request, id: string, env: Env) {
  const body = (await readBoundedJson(request)) as { status?: string };
  const allowed = [
    "SUBMITTED",
    "CONTACTED",
    "CONFIRMED",
    "COMPLETED",
    "CANCELLED",
  ];
  if (!body.status || !allowed.includes(body.status))
    return error("VALIDATION_ERROR", "Trạng thái không hợp lệ.", 422);
  if (await hasInventorySchema(env)) {
    const checkout = await env.DB.prepare(
      "SELECT checkout_state AS checkoutState FROM cart_requests WHERE id = ?",
    )
      .bind(id)
      .first<{ checkoutState: string }>();
    if (!checkout) return error("ORDER_NOT_FOUND", "Không tìm thấy giỏ hàng.", 404);
    if (checkout.checkoutState !== "LEGACY")
      return error(
        "INVALID_ORDER_TRANSITION",
        "Đơn hàng reservation phải dùng thao tác xác nhận hoặc giải phóng riêng.",
        409,
      );
  }
  await env.DB.prepare(
    "UPDATE cart_requests SET status = ?, updated_at = ? WHERE id = ?",
  )
    .bind(body.status, new Date().toISOString(), id)
    .run();
  return json({ success: true, status: body.status });
}

async function uploadImage(request: Request, env: Env) {
  try {
    const result = await uploadImmutableProductImage(
      request,
      env.PRODUCT_IMAGES,
    );
    // API là nơi duy nhất quyết định URL để local dùng /media và production dùng custom domain.
    return json(
      {
        success: true,
        ...result,
        url: getProductImageUrl(
          result.key,
          getProductImageUrlStrategy(env.ENVIRONMENT),
        ),
      },
      201,
    );
  } catch (caught) {
    if (caught instanceof ImageUploadError) {
      const status =
        caught.code === "UNSUPPORTED_TYPE"
          ? 415
          : caught.code === "TOO_LARGE"
            ? 413
            : caught.code === "KEY_COLLISION"
              ? 409
              : 422;
      const message =
        caught.code === "UNSUPPORTED_TYPE"
          ? "Định dạng ảnh không được hỗ trợ."
          : caught.code === "TOO_LARGE"
            ? `Ảnh tối ưu vượt quá ${MAX_STORED_IMAGE_BYTES / (1024 * 1024)} MB.`
            : caught.code === "KEY_COLLISION"
              ? "Không thể tạo khóa ảnh duy nhất."
              : "Tệp ảnh đang trống.";
      return error(caught.code, message, status);
    }
    throw caught;
  }
}

async function uploadDescriptionImage(request: Request, env: Env) {
  if (!(await hasProductDescriptionSchema(env)))
    return error(
      "DESCRIPTION_SCHEMA_UNAVAILABLE",
      "Mô tả rich chưa sẵn sàng trên cơ sở dữ liệu.",
      409,
    );
  const productId = request.headers.get("x-product-id")?.trim() || null;
  const contentPageSlug =
    request.headers.get("x-content-page-slug")?.trim() || null;
  const uploadSessionId =
    request.headers.get("x-upload-session-id")?.trim() ?? "";
  try {
    const result = await uploadProductDescriptionAsset(
      request,
      env,
      productId,
      uploadSessionId,
      getProductImageUrlStrategy(env.ENVIRONMENT),
      contentPageSlug,
    );
    return json({ success: true, ...result }, 201);
  } catch (caught) {
    if (
      caught instanceof ImageUploadError ||
      caught instanceof ProductDescriptionAssetError
    ) {
      const status = imageUploadErrorStatus(caught);
      const message =
        caught instanceof ImageUploadError && caught.code === "UNSUPPORTED_TYPE"
          ? "Định dạng ảnh không được hỗ trợ."
          : caught instanceof ImageUploadError && caught.code === "TOO_LARGE"
            ? `Ảnh tối ưu vượt quá ${MAX_STORED_IMAGE_BYTES / (1024 * 1024)} MB.`
            : caught instanceof ProductDescriptionAssetError &&
                caught.code === "PRODUCT_NOT_FOUND"
              ? "Không tìm thấy sản phẩm."
              : caught instanceof ProductDescriptionAssetError &&
                  caught.code === "CONTENT_PAGE_NOT_FOUND"
                ? "Không tìm thấy trang nội dung."
                : caught instanceof ProductDescriptionAssetError &&
                  caught.code === "ASSET_OWNERSHIP"
                ? "Asset ảnh mô tả không thuộc sản phẩm này."
                : "Thông tin ảnh mô tả chưa hợp lệ.";
      return error(caught.code, message, status);
    }
    throw caught;
  }
}

type AdminProductInput = {
  name?: string;
  slug?: string;
  brand?: string;
  brandId?: string | null;
  minAgeMonths?: number | null;
  isBestSeller?: boolean;
  bestSellerRank?: number | null;
  shortDescription?: string;
  description?: string;
  descriptionContent?: unknown;
  descriptionUploadSessionId?: string;
  status?: string;
  featured?: boolean;
  sortOrder?: number;
  categoryId?: string;
  categoryIds?: string[];
  tagIds?: string[];
  images?: Array<{
    id?: string;
    r2Key?: string;
    altText?: string;
    sortOrder?: number;
  }>;
  variants?: Array<{
    id?: string;
    clientId?: string;
    name?: string;
    sku?: string;
    priceVnd?: number | string;
    compareAtPriceVnd?: number | string | null;
    availability?: string;
    sortOrder?: number;
    trackInventory?: boolean;
    stockOnHand?: number | string;
  }>;
  deletedVariantIds?: string[];
};

type VariantValidationIssue = {
  code: string;
  field?: "name" | "sku" | "priceVnd" | "availability" | "trackInventory" | "stockOnHand";
  variantId?: string | null;
  clientId?: string | null;
  message: string;
};

class AdminProductValidationError extends Error {
  constructor(
    readonly issue: VariantValidationIssue,
    readonly status = 422,
  ) {
    super(issue.message);
  }
}

class AdminProductDescriptionValidationError extends Error {
  constructor(readonly issues: ProductDescriptionValidationIssue[]) {
    super("INVALID_PRODUCT_DESCRIPTION");
  }
}

function normalizeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function validateAdminProduct(input: unknown) {
  const invalid = (message = "Thông tin sản phẩm chưa hợp lệ."): never => {
    throw new AdminProductValidationError({ code: "VALIDATION_ERROR", message });
  };
  if (!input || typeof input !== "object") invalid();
  const body = input as AdminProductInput;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slugInput = typeof body.slug === "string" ? body.slug.trim() : "";
  const slug = normalizeSlug(slugInput || name);
  const statuses = ["AVAILABLE", "OUT_OF_STOCK", "HIDDEN"];
  if (
    !name ||
    name.length > 180 ||
    !slug ||
    !statuses.includes(body.status ?? "AVAILABLE") ||
    !Array.isArray(body.variants)
  )
    invalid();
  const rawVariants = body.variants!;
  const variants = rawVariants.map((variant, index) => {
    if (!variant || typeof variant !== "object") invalid();
    const variantName = typeof variant.name === "string" ? variant.name.trim() : "";
    const sku = typeof variant.sku === "string" ? variant.sku.trim() : "";
    const rawPrice = variant.priceVnd;
    const priceVnd =
      typeof rawPrice !== "number" && typeof rawPrice !== "string"
        ? Number.NaN
        : typeof rawPrice === "string" && !rawPrice.trim()
          ? Number.NaN
          : Number(rawPrice);
    const rawAvailability = variant.availability;
    const availability =
      rawAvailability === undefined
        ? "AVAILABLE"
        : typeof rawAvailability === "string"
          ? rawAvailability
          : "__INVALID__";
    const variantId = typeof variant.id === "string" ? variant.id.trim() : "";
    const clientId =
      typeof variant.clientId === "string" ? variant.clientId.trim() : "";
    const trackInventory =
      variant.trackInventory === undefined
        ? undefined
        : typeof variant.trackInventory === "boolean"
          ? variant.trackInventory
          : null;
    const rawStockOnHand = variant.stockOnHand;
    const stockOnHand =
      rawStockOnHand === undefined
        ? undefined
        : typeof rawStockOnHand === "number" || typeof rawStockOnHand === "string"
          ? Number(rawStockOnHand)
          : Number.NaN;
    const issue = (code: string, field: VariantValidationIssue["field"], message: string) => {
      throw new AdminProductValidationError({
        code,
        field,
        variantId: variantId || null,
        clientId: clientId || null,
        message,
      });
    };
    if (variant.id !== undefined && (!variantId || typeof variant.id !== "string"))
      throw new AdminProductValidationError({
        code: "VARIANT_OWNERSHIP",
        variantId: variantId || null,
        clientId: clientId || null,
        message: "ID phân loại không hợp lệ.",
      });
    if (!variantName || variantName.length > 180)
      issue("INVALID_VARIANT_NAME", "name", "Tên phân loại là bắt buộc.");
    if (!sku || sku.length > 120)
      issue("INVALID_SKU", "sku", "Mã SKU là bắt buộc.");
    if (!Number.isSafeInteger(priceVnd) || priceVnd <= 0)
      issue("INVALID_PRICE", "priceVnd", "Giá bán phải là số nguyên lớn hơn 0.");
    if (!statuses.includes(availability))
      issue("INVALID_AVAILABILITY", "availability", "Tình trạng phân loại không hợp lệ.");
    if (trackInventory === null)
      issue("INVALID_INVENTORY", "trackInventory", "Theo dõi tồn kho phải là bật hoặc tắt.");
    if (
      stockOnHand !== undefined &&
      (!Number.isSafeInteger(stockOnHand) || stockOnHand < 0)
    )
      issue("INVALID_STOCK", "stockOnHand", "Tồn kho thực tế phải là số nguyên không âm.");
    const rawCompareAtPrice = variant.compareAtPriceVnd;
    const compareAtPriceVnd =
      rawCompareAtPrice === null || rawCompareAtPrice === undefined
        ? null
        : typeof rawCompareAtPrice !== "number" &&
            typeof rawCompareAtPrice !== "string"
          ? Number.NaN
          : Number(rawCompareAtPrice);
    if (
      compareAtPriceVnd !== null &&
      (!Number.isSafeInteger(compareAtPriceVnd) || compareAtPriceVnd < 0)
    )
      issue("INVALID_PRICE", "priceVnd", "Giá so sánh không hợp lệ.");
    return {
      ...variant,
      id: variantId || undefined,
      clientId: clientId || undefined,
      name: variantName,
      sku,
      priceVnd,
      compareAtPriceVnd,
      availability,
      trackInventory: trackInventory === null ? undefined : trackInventory,
      stockOnHand,
      sortOrder: Number.isFinite(variant.sortOrder)
        ? Number(variant.sortOrder)
        : index,
    };
  });
  const skuOwners = new Map<string, (typeof variants)[number]>();
  variants.forEach((variant) => {
    const previous = skuOwners.get(variant.sku);
    if (previous) {
      throw new AdminProductValidationError({
        code: "DUPLICATE_SKU",
        field: "sku",
        variantId: variant.id ?? null,
        clientId: variant.clientId ?? null,
        message: "Mã SKU bị trùng trong danh sách phân loại.",
      });
    }
    skuOwners.set(variant.sku, variant);
  });
  const rawDeletedVariantIds = body.deletedVariantIds;
  const deletedVariantIds = Array.isArray(rawDeletedVariantIds)
    ? rawDeletedVariantIds.map((value) =>
        typeof value === "string" ? value.trim() : "",
      )
    : [];
  if (
    (rawDeletedVariantIds !== undefined &&
      !Array.isArray(rawDeletedVariantIds)) ||
    deletedVariantIds.some((value) => !value) ||
    new Set(deletedVariantIds).size !== deletedVariantIds.length
  )
    invalid("Danh sách phân loại cần xóa không hợp lệ.");
  const variantIds = variants.map((variant) => variant.id).filter(Boolean) as string[];
  if (new Set(variantIds).size !== variantIds.length)
    invalid("Mỗi phân loại chỉ được xuất hiện một lần.");
  const categoryIds =
    body.categoryIds ?? (body.categoryId ? [body.categoryId] : undefined);
  if (
    categoryIds !== undefined &&
    (!Array.isArray(categoryIds) ||
      categoryIds.some((value) => typeof value !== "string" || !value.trim()) ||
      new Set(categoryIds).size !== categoryIds.length)
  )
    invalid("Danh sách nhóm sản phẩm không hợp lệ.");
  const brandId = body.brandId?.trim() || null;
  const minAgeMonths =
    body.minAgeMonths === null || body.minAgeMonths === undefined
      ? null
      : Number(body.minAgeMonths);
  const isBestSeller = body.isBestSeller === true;
  const bestSellerRank =
    body.bestSellerRank === null || body.bestSellerRank === undefined
      ? null
      : Number(body.bestSellerRank);
  if (
    (minAgeMonths !== null &&
      (!Number.isSafeInteger(minAgeMonths) || minAgeMonths < 0 || minAgeMonths > 240)) ||
    (isBestSeller &&
      (bestSellerRank === null ||
        !Number.isSafeInteger(bestSellerRank) ||
        bestSellerRank < 1)) ||
    (!isBestSeller && bestSellerRank !== null)
  )
    invalid("Thông tin tuổi hoặc Best seller không hợp lệ.");
  if (
    body.tagIds !== undefined &&
    (!Array.isArray(body.tagIds) ||
      body.tagIds.some((value) => typeof value !== "string" || !value.trim()))
  )
    invalid("Danh sách tag không hợp lệ.");
  const images =
    body.images === undefined ? undefined : normalizeProductImages(body.images);
  const hasDescriptionContent = Object.prototype.hasOwnProperty.call(
    body,
    "descriptionContent",
  );
  let descriptionContent: ProductDescriptionDocument | null | undefined;
  if (hasDescriptionContent) {
    if (body.descriptionContent === null) {
      descriptionContent = null;
    } else {
      const normalized = normalizeProductDescriptionDocument(
        body.descriptionContent,
      );
      if (!normalized.ok)
        throw new AdminProductDescriptionValidationError(normalized.issues);
      descriptionContent = normalized.document;
    }
  }
  const descriptionUploadSessionId =
    body.descriptionUploadSessionId === undefined
      ? undefined
      : typeof body.descriptionUploadSessionId === "string"
        ? body.descriptionUploadSessionId.trim()
        : "";
  if (
    body.descriptionUploadSessionId !== undefined &&
    !descriptionUploadSessionId
  )
    throw new AdminProductDescriptionValidationError([
      {
        path: "$.descriptionUploadSessionId",
        code: "INVALID_UPLOAD_SESSION",
        message: "Phiên tải ảnh mô tả không hợp lệ.",
      },
    ]);
  return {
    ...body,
    name,
    slug,
    status: body.status ?? "AVAILABLE",
    featured: body.featured ? 1 : 0,
    sortOrder: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0,
    variants,
    deletedVariantIds,
    brandId,
    minAgeMonths,
    isBestSeller: isBestSeller ? 1 : 0,
    bestSellerRank,
    categoryIds,
    tagIds: body.tagIds,
    images,
    descriptionContent,
    descriptionUploadSessionId,
  };
}

async function readAdminProductData(
  id: string,
  env: Env,
  imageUrlStrategy: ProductImageUrlStrategy,
) {
  await cleanupExpiredReservations(env);
  const descriptionSchema = await hasProductDescriptionSchema(env);
  const product = await env.DB.prepare(
    `SELECT p.id, p.name, p.slug, COALESCE(b.name, p.brand) AS brand,
      p.brand_id AS brandId, b.slug AS brandSlug, p.min_age_months AS minAgeMonths,
      p.is_best_seller AS isBestSeller, p.best_seller_rank AS bestSellerRank,
      p.archived_at AS archivedAt, p.short_description AS shortDescription,
      p.description, ${descriptionSchema ? "p.description_content" : "NULL"} AS descriptionContent,
      p.status, p.featured, p.sort_order AS sortOrder
     FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!product) return null;
  const [inventorySchema, variantRetirementSchema] = await Promise.all([
    hasInventorySchema(env),
    hasVariantRetirementSchema(env),
  ]);
  const activeVariantWhere = variantRetirementSchema
    ? " AND archived_at IS NULL"
    : "";
  const variants = await env.DB.prepare(
    `SELECT id, name, sku, price_vnd AS priceVnd, compare_at_price_vnd AS compareAtPriceVnd, availability, sort_order AS sortOrder${inventorySchema
      ? ", track_inventory AS trackInventory, stock_on_hand AS stockOnHand, reserved_quantity AS reservedQuantity"
      : ", 0 AS trackInventory, 0 AS stockOnHand, 0 AS reservedQuantity"}
     FROM product_variants WHERE product_id = ?${activeVariantWhere} ORDER BY sort_order, created_at, id`,
  )
    .bind(id)
    .all();
  const categories = await env.DB.prepare(
    "SELECT category_id AS id FROM product_categories WHERE product_id = ?",
  )
    .bind(id)
    .all();
  const tags = await env.DB.prepare(
    "SELECT tag_id AS id FROM product_tags WHERE product_id = ?",
  )
    .bind(id)
    .all();
  const images = await env.DB.prepare(
    "SELECT id, r2_key AS r2Key, alt_text AS altText, sort_order AS sortOrder FROM product_images WHERE product_id = ? ORDER BY sort_order, created_at",
  )
    .bind(id)
    .all<Omit<ProductImageRow, "productId">>();
  const descriptionAssetRows = descriptionSchema
    ? await listProductDescriptionAssets(env, [id], imageUrlStrategy)
    : [];
  const descriptionContent = parseProductDescriptionContent(
    product.descriptionContent,
    { assetIds: new Set(descriptionAssetRows.map((asset) => asset.id)) },
  );
  if (product.descriptionContent && !descriptionContent)
    console.error(
      JSON.stringify({
        message: "invalid admin product description content",
        productId: id,
      }),
    );
  return {
    ...product,
    descriptionContent,
    descriptionAssets: mapProductDescriptionAssets(
      descriptionAssetRows,
      imageUrlStrategy,
    ),
    variants: variants.results.map((variant) => ({
      ...variant,
      trackInventory: Boolean(variant.trackInventory),
      availableQuantity: Math.max(
        0,
        Number(variant.stockOnHand ?? 0) - Number(variant.reservedQuantity ?? 0),
      ),
    })),
    categoryIds: categories.results.map((item) => item.id),
    tagIds: tags.results.map((item) => item.id),
    images: images.results.map((image) => ({
      ...image,
      url: getProductImageUrl(image.r2Key, imageUrlStrategy),
    })),
  };
}

async function getAdminProduct(
  id: string,
  env: Env,
  imageUrlStrategy: ProductImageUrlStrategy,
) {
  const product = await readAdminProductData(id, env, imageUrlStrategy);
  if (!product)
    return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  return json({ data: product });
}

async function saveAdminProduct(
  request: Request,
  env: Env,
  id?: string,
) {
  let body: ReturnType<typeof validateAdminProduct>;
  try {
    body = validateAdminProduct(await readBoundedJson(request, 512 * 1024));
  } catch (caught) {
    if (caught instanceof Error && caught.message === "PAYLOAD_TOO_LARGE")
      return error(
        "PAYLOAD_TOO_LARGE",
        "Dữ liệu sản phẩm vượt giới hạn cho phép.",
        413,
      );
    if (caught instanceof AdminProductDescriptionValidationError)
      return error(
        "INVALID_PRODUCT_DESCRIPTION",
        "Nội dung mô tả sản phẩm chưa hợp lệ.",
        422,
        caught.issues,
      );
    if (caught instanceof AdminProductValidationError)
      return error(
        caught.issue.code,
        caught.issue.message,
        caught.status,
        caught.issue,
      );
    return error("VALIDATION_ERROR", "Thông tin sản phẩm chưa hợp lệ.", 422);
  }
  const productId = id ?? crypto.randomUUID();
  const existingProduct = id
    ? await env.DB.prepare("SELECT id FROM products WHERE id = ?")
        .bind(id)
        .first<{ id: string }>()
    : null;
  if (id && !existingProduct)
    return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);

  const descriptionContentProvided = body.descriptionContent !== undefined;
  const descriptionSchema = descriptionContentProvided
    ? await hasProductDescriptionSchema(env)
    : false;
  if (descriptionContentProvided && !descriptionSchema)
    return error(
      "DESCRIPTION_SCHEMA_UNAVAILABLE",
      "Mô tả rich chưa sẵn sàng trên cơ sở dữ liệu.",
      409,
    );
  let descriptionAssetRows: ProductDescriptionAssetRow[] = [];
  if (descriptionContentProvided && body.descriptionContent) {
    try {
      const validation = await validateProductDescriptionAssets(
        env,
        body.descriptionContent,
        productId,
        body.descriptionUploadSessionId ?? null,
      );
      descriptionAssetRows = validation.rows;
      if (
        !id &&
        getProductDescriptionImageNodes(body.descriptionContent).length > 0 &&
        !body.descriptionUploadSessionId
      )
        return error(
          "INVALID_PRODUCT_DESCRIPTION",
          "Ảnh mô tả của sản phẩm mới cần có phiên tải ảnh hợp lệ.",
          422,
        );
    } catch (caught) {
      if (caught instanceof ProductDescriptionAssetError) {
        const status =
          caught.code === "DESCRIPTION_SCHEMA_UNAVAILABLE" ? 409 : 422;
        return error(
          "INVALID_PRODUCT_DESCRIPTION",
          "Một ảnh trong mô tả không hợp lệ hoặc không thuộc sản phẩm này.",
          status,
        );
      }
      throw caught;
    }
  }

  const [inventorySchema, variantRetirementSchema] = await Promise.all([
    hasInventorySchema(env),
    hasVariantRetirementSchema(env),
  ]);

  // Đọc toàn bộ ID trước transaction để phân biệt rõ update, insert và delete.
  const existingVariants = id
    ? await env.DB.prepare(
        `SELECT id${inventorySchema
          ? ", track_inventory AS trackInventory, stock_on_hand AS stockOnHand, reserved_quantity AS reservedQuantity"
          : ", 0 AS trackInventory, 0 AS stockOnHand, 0 AS reservedQuantity"}${variantRetirementSchema
          ? ", archived_at AS archivedAt"
          : ", NULL AS archivedAt"}
         FROM product_variants WHERE product_id = ?`,
      )
        .bind(productId)
        .all<{
          id: string;
          trackInventory: number;
          stockOnHand: number;
          reservedQuantity: number;
          archivedAt: string | null;
        }>()
    : {
        results: [] as Array<{
          id: string;
          trackInventory: number;
          stockOnHand: number;
          reservedQuantity: number;
          archivedAt: string | null;
        }>,
      };
  const existingVariantIds = new Set(
    existingVariants.results.map((variant) => variant.id),
  );
  const deletedVariantIds = new Set(body.deletedVariantIds);
  const historicalVariantIds = new Set<string>();
  if (variantRetirementSchema && id && deletedVariantIds.size) {
    const placeholders = [...deletedVariantIds].map(() => "?").join(",");
    const historical = await env.DB.prepare(
      `SELECT DISTINCT variant_id AS variantId
       FROM (
         SELECT variant_id FROM inventory_movements
         UNION ALL
         SELECT variant_id FROM inventory_reservations
         UNION ALL
         SELECT variant_id FROM cart_request_items
         UNION ALL
         SELECT variant_id FROM cart_request_promotion_gifts
       ) AS history
       WHERE variant_id IN (${placeholders})`,
    )
      .bind(...deletedVariantIds)
      .all<{ variantId: string }>();
    historical.results.forEach((row) => historicalVariantIds.add(row.variantId));
  }
  const activeExistingVariantIds = new Set(
    existingVariants.results
      .filter((variant) => !variant.archivedAt)
      .map((variant) => variant.id),
  );
  if (!id && deletedVariantIds.size)
    return error(
      "VARIANT_OWNERSHIP",
      "Không thể xóa phân loại khi tạo sản phẩm mới.",
      422,
      { code: "VARIANT_OWNERSHIP", field: "deletedVariantIds" },
    );
  for (const variant of body.variants) {
    if (variant.id && !existingVariantIds.has(variant.id))
      return error(
        "VARIANT_OWNERSHIP",
        "Phân loại không thuộc sản phẩm này.",
        422,
        {
          code: "VARIANT_OWNERSHIP",
          field: "variantId",
          variantId: variant.id,
          clientId: variant.clientId ?? null,
          message: "Phân loại không thuộc sản phẩm này.",
        },
      );
    const current = variant.id
      ? existingVariants.results.find((item) => item.id === variant.id)
      : undefined;
    if (current?.archivedAt)
      return error(
        "VARIANT_OWNERSHIP",
        "Phân loại đã được lưu trữ và không còn chỉnh sửa được.",
        422,
        {
          code: "VARIANT_OWNERSHIP",
          field: "variantId",
          variantId: variant.id,
          clientId: variant.clientId ?? null,
          message: "Phân loại đã được lưu trữ và không còn chỉnh sửa được.",
        },
      );
    if (variant.id && deletedVariantIds.has(variant.id))
      return error(
        "VALIDATION_ERROR",
        "Không thể vừa cập nhật vừa xóa cùng một phân loại.",
        422,
        {
          code: "VALIDATION_ERROR",
          field: "variantId",
          variantId: variant.id,
          clientId: variant.clientId ?? null,
          message: "Không thể vừa cập nhật vừa xóa cùng một phân loại.",
        },
      );
  }
  for (const variantId of deletedVariantIds) {
    if (!existingVariantIds.has(variantId))
      return error(
        "VARIANT_OWNERSHIP",
        "Phân loại không thuộc sản phẩm này.",
        422,
        {
          code: "VARIANT_OWNERSHIP",
          field: "deletedVariantIds",
          variantId,
          clientId: null,
          message: "Phân loại không thuộc sản phẩm này.",
        },
      );
  }
  if (inventorySchema && id) {
    const guardedIds = body.variants
      .filter((variant) => variant.id && variant.trackInventory === false)
      .map((variant) => variant.id as string)
      .concat([...deletedVariantIds]);
    if (guardedIds.length) {
      const placeholders = guardedIds.map(() => "?").join(",");
      const active = await env.DB.prepare(
        `SELECT DISTINCT variant_id AS variantId
         FROM inventory_reservations
         WHERE status = 'ACTIVE' AND variant_id IN (${placeholders})`,
      )
        .bind(...guardedIds)
        .all<{ variantId: string }>();
      if (active.results.length)
        return error(
          "INVENTORY_CONFLICT",
          "Không thể tắt theo dõi hoặc xóa phân loại đang được giữ hàng.",
          409,
          { variantIds: active.results.map((row) => row.variantId) },
        );
    }
  }
  const newVariantCount = body.variants.filter((variant) => !variant.id).length;
  const deletedActiveVariantCount = [...deletedVariantIds].filter((variantId) =>
    activeExistingVariantIds.has(variantId),
  ).length;
  const finalVariantCount =
    activeExistingVariantIds.size - deletedActiveVariantCount + newVariantCount;
  if (finalVariantCount < 1)
    return error(
      "AT_LEAST_ONE_VARIANT",
      "Sản phẩm cần có ít nhất một phân loại.",
      422,
      {
        code: "AT_LEAST_ONE_VARIANT",
        field: "variants",
        message: "Sản phẩm cần có ít nhất một phân loại.",
      },
    );

  if (body.categoryIds !== undefined) {
    const existing = id
      ? await env.DB.prepare(
          "SELECT category_id AS id FROM product_categories WHERE product_id = ?",
        )
          .bind(productId)
          .all<{ id: string }>()
      : { results: [] as Array<{ id: string }> };
    const existingIds = new Set(existing.results.map((item) => item.id));
    if (body.categoryIds.length) {
      const placeholders = body.categoryIds.map(() => "?").join(",");
      const rows = await env.DB.prepare(
        `SELECT id, is_active AS isActive FROM categories WHERE id IN (${placeholders})`,
      )
        .bind(...body.categoryIds)
        .all<{ id: string; isActive: number }>();
      if (
        rows.results.length !== body.categoryIds.length ||
        rows.results.some((item) => !item.isActive && !existingIds.has(item.id))
      )
        return error(
          "INVALID_CATEGORY",
          "Nhóm sản phẩm không tồn tại hoặc đang bị ẩn.",
          422,
        );
    }
  }
  if (body.brandId) {
    const brand = await env.DB.prepare(
      "SELECT id, is_active AS isActive FROM brands WHERE id = ?",
    )
      .bind(body.brandId)
      .first<{ id: string; isActive: number }>();
    const currentBrand = id
      ? await env.DB.prepare("SELECT brand_id AS brandId FROM products WHERE id = ?")
          .bind(productId)
          .first<{ brandId: string | null }>()
      : null;
    if (!brand || (!brand.isActive && currentBrand?.brandId !== brand.id))
      return error("INVALID_BRAND", "Hãng không tồn tại hoặc đang bị ẩn.", 422);
  }
  const findConflict = () =>
    findProductConflict(env.DB, {
      productId,
      slug: body.slug,
      skus: body.variants
        .map((variant) => variant.sku ?? "")
        .filter(Boolean),
    });
  const existingConflict = await findConflict();
  if (existingConflict) {
    const conflict = productConflictError(existingConflict);
    return error(conflict.code, conflict.message, 409, conflict.details);
  }
  const skuValues = [...new Set(body.variants.map((variant) => variant.sku))];
  if (skuValues.length) {
    const placeholders = skuValues.map(() => "?").join(",");
    const skuRows = await env.DB.prepare(
      `SELECT id, product_id AS productId, sku FROM product_variants WHERE sku IN (${placeholders})`,
    )
      .bind(...skuValues)
      .all<{ id: string; productId: string; sku: string }>();
    for (const row of skuRows.results) {
      if (deletedVariantIds.has(row.id) && !historicalVariantIds.has(row.id))
        continue;
      const incoming = body.variants.find((variant) => variant.sku === row.sku);
      const isSameVariant =
        incoming?.id === row.id && row.productId === productId;
      if (isSameVariant) continue;
      return error(
        "DUPLICATE_SKU",
        `SKU "${row.sku}" đã được sử dụng.`,
        409,
        {
          code: "DUPLICATE_SKU",
          field: "sku",
          variantId: incoming?.id ?? null,
          clientId: incoming?.clientId ?? null,
          ownerId: row.productId,
          message: `SKU "${row.sku}" đã được sử dụng.`,
        },
      );
    }
  }
  if (body.images) {
    try {
      await validateAssociatedImages(body.images, env.PRODUCT_IMAGES);
    } catch {
      return error(
        "INVALID_IMAGE_REFERENCE",
        "Một ảnh không tồn tại trong R2 hoặc metadata không hợp lệ.",
        422,
      );
    }
  }
  if (inventorySchema) {
    for (const variant of body.variants) {
      if (!variant.id) continue;
      const current = existingVariants.results.find((item) => item.id === variant.id);
      if (!current) continue;
      const stockOnHand = variant.stockOnHand ?? current.stockOnHand;
      if (stockOnHand < current.reservedQuantity)
        return error(
          "INVENTORY_CONFLICT",
          "Tồn kho thực tế không được thấp hơn số lượng đang giữ.",
          409,
          { variantId: variant.id },
        );
    }
  }
  const now = new Date().toISOString();
  const legacyDescription = body.descriptionContent
    ? extractProductDescriptionText(body.descriptionContent)
    : body.description ?? "";
  const richDescriptionJson = body.descriptionContent
    ? JSON.stringify(body.descriptionContent)
    : null;
  const productStatement = id
    ? env.DB.prepare(
        descriptionContentProvided && descriptionSchema
          ? "UPDATE products SET name = ?, slug = ?, brand = CASE WHEN ? IS NULL THEN brand ELSE NULL END, brand_id = ?, min_age_months = ?, is_best_seller = ?, best_seller_rank = ?, short_description = ?, description = ?, description_content = ?, status = ?, archived_at = CASE WHEN ? != 'HIDDEN' THEN NULL ELSE archived_at END, featured = ?, sort_order = ?, updated_at = ? WHERE id = ?"
          : "UPDATE products SET name = ?, slug = ?, brand = CASE WHEN ? IS NULL THEN brand ELSE NULL END, brand_id = ?, min_age_months = ?, is_best_seller = ?, best_seller_rank = ?, short_description = ?, description = ?, status = ?, archived_at = CASE WHEN ? != 'HIDDEN' THEN NULL ELSE archived_at END, featured = ?, sort_order = ?, updated_at = ? WHERE id = ?",
      ).bind(
        ...(descriptionContentProvided && descriptionSchema
          ? [
              body.name,
              body.slug,
              body.brandId,
              body.brandId,
              body.minAgeMonths,
              body.isBestSeller,
              body.bestSellerRank,
              body.shortDescription ?? "",
              legacyDescription,
              richDescriptionJson,
              body.status,
              body.status,
              body.featured,
              body.sortOrder,
              now,
              productId,
            ]
          : [
              body.name,
              body.slug,
              body.brandId,
              body.brandId,
              body.minAgeMonths,
              body.isBestSeller,
              body.bestSellerRank,
              body.shortDescription ?? "",
              legacyDescription,
              body.status,
              body.status,
              body.featured,
              body.sortOrder,
              now,
              productId,
            ]),
      )
    : env.DB.prepare(
        descriptionContentProvided && descriptionSchema
          ? "INSERT INTO products (id, name, slug, brand_id, min_age_months, is_best_seller, best_seller_rank, short_description, description, description_content, status, featured, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          : "INSERT INTO products (id, name, slug, brand_id, min_age_months, is_best_seller, best_seller_rank, short_description, description, status, featured, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        ...(descriptionContentProvided && descriptionSchema
          ? [
              productId,
              body.name,
              body.slug,
              body.brandId,
              body.minAgeMonths,
              body.isBestSeller,
              body.bestSellerRank,
              body.shortDescription ?? "",
              legacyDescription,
              richDescriptionJson,
              body.status,
              body.featured,
              body.sortOrder,
              now,
              now,
            ]
          : [
              productId,
              body.name,
              body.slug,
              body.brandId,
              body.minAgeMonths,
              body.isBestSeller,
              body.bestSellerRank,
              body.shortDescription ?? "",
              legacyDescription,
              body.status,
              body.featured,
              body.sortOrder,
              now,
              now,
            ]),
      );
  const descriptionPersistence = descriptionContentProvided
    ? await prepareProductDescriptionAssetPersistence(
        env,
        productId,
        body.descriptionContent ?? null,
        descriptionAssetRows,
        now,
      )
    : { statements: [] as D1PreparedStatement[], removed: [] as ProductDescriptionAssetRow[] };
  const statements = [productStatement, ...descriptionPersistence.statements];
  if (body.categoryIds !== undefined) {
    statements.push(
      env.DB.prepare(
        "DELETE FROM product_categories WHERE product_id = ?",
      ).bind(productId),
    );
    [...new Set(body.categoryIds)].forEach((categoryId) =>
      statements.push(
        env.DB.prepare(
          "INSERT INTO product_categories (product_id, category_id, created_at) VALUES (?, ?, ?)",
        ).bind(productId, categoryId, now),
      ),
    );
  }
  if (body.tagIds !== undefined) {
    statements.push(
      env.DB.prepare("DELETE FROM product_tags WHERE product_id = ?").bind(
        productId,
      ),
    );
    [...new Set(body.tagIds)].forEach((tagId) =>
      statements.push(
        env.DB.prepare(
          "INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)",
        ).bind(productId, tagId),
      ),
    );
  }
  // Chỉ xóa cứng variant chưa từng được tham chiếu; lịch sử phải giữ FK hợp lệ.
  [...deletedVariantIds].forEach((variantId) => {
    if (historicalVariantIds.has(variantId))
      statements.push(
        env.DB.prepare(
          "UPDATE product_variants SET availability = 'HIDDEN', archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ? AND product_id = ?",
        ).bind(now, now, variantId, productId),
      );
    else
      statements.push(
        env.DB.prepare(
          "DELETE FROM product_variants WHERE id = ? AND product_id = ?",
        ).bind(variantId, productId),
      );
  });
  body.variants.forEach((variant) => {
    if (variant.id) {
      const current = existingVariants.results.find((item) => item.id === variant.id);
      const trackInventory =
        variant.trackInventory ?? Boolean(current?.trackInventory);
      const stockOnHand = variant.stockOnHand ?? current?.stockOnHand ?? 0;
      if (
        inventorySchema &&
        current &&
        stockOnHand !== current.stockOnHand
      )
        statements.push(
          env.DB.prepare(
            `INSERT INTO inventory_movements (
              id, variant_id, movement_type, quantity_delta,
              stock_before, stock_after, note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            variant.id,
            stockOnHand > current.stockOnHand ? "RESTOCK" : "MANUAL_ADJUSTMENT",
            stockOnHand - current.stockOnHand,
            current.stockOnHand,
            stockOnHand,
            "Điều chỉnh tồn kho từ Admin.",
            now,
          ),
        );
      statements.push(
        env.DB.prepare(
          inventorySchema
            ? "UPDATE product_variants SET name = ?, sku = ?, price_vnd = ?, compare_at_price_vnd = ?, availability = ?, track_inventory = ?, stock_on_hand = ?, sort_order = ?, updated_at = ? WHERE id = ? AND product_id = ?"
            : "UPDATE product_variants SET name = ?, sku = ?, price_vnd = ?, compare_at_price_vnd = ?, availability = ?, sort_order = ?, updated_at = ? WHERE id = ? AND product_id = ?",
        ).bind(
          ...(inventorySchema
            ? [
                variant.name,
                variant.sku,
                variant.priceVnd,
                variant.compareAtPriceVnd ?? null,
                variant.availability,
                trackInventory ? 1 : 0,
                stockOnHand,
                variant.sortOrder,
                now,
                variant.id,
                productId,
              ]
            : [
                variant.name,
                variant.sku,
                variant.priceVnd,
                variant.compareAtPriceVnd ?? null,
                variant.availability,
                variant.sortOrder,
                now,
                variant.id,
                productId,
              ]),
        ),
      );
    } else {
      const variantId = crypto.randomUUID();
      const trackInventory = variant.trackInventory ?? true;
      const stockOnHand = variant.stockOnHand ?? 0;
      statements.push(
        env.DB.prepare(
          inventorySchema
            ? "INSERT INTO product_variants (id, product_id, name, sku, price_vnd, compare_at_price_vnd, availability, track_inventory, stock_on_hand, reserved_quantity, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)"
            : "INSERT INTO product_variants (id, product_id, name, sku, price_vnd, compare_at_price_vnd, availability, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          ...(inventorySchema
            ? [
                variantId,
                productId,
                variant.name,
                variant.sku,
                variant.priceVnd,
                variant.compareAtPriceVnd ?? null,
                variant.availability,
                trackInventory ? 1 : 0,
                stockOnHand,
                variant.sortOrder,
                now,
                now,
              ]
            : [
                variantId,
                productId,
                variant.name,
                variant.sku,
                variant.priceVnd,
                variant.compareAtPriceVnd ?? null,
                variant.availability,
                variant.sortOrder,
                now,
                now,
              ]),
        ),
      );
      if (inventorySchema)
        statements.push(
          env.DB.prepare(
            `INSERT INTO inventory_movements (
              id, variant_id, movement_type, quantity_delta,
              stock_before, stock_after, note, created_at
            ) VALUES (?, ?, 'INITIAL_STOCK', ?, 0, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            variantId,
            stockOnHand,
            stockOnHand,
            "Tồn kho ban đầu từ Admin.",
            now,
          ),
        );
    }
  });
  if (body.images !== undefined) {
    const existingImages = id
      ? await env.DB.prepare(
          "SELECT id, r2_key AS r2Key, created_at AS createdAt FROM product_images WHERE product_id = ?",
        )
          .bind(productId)
          .all<{ id: string; r2Key: string; createdAt: string }>()
      : {
          results: [] as Array<{
            id: string;
            r2Key: string;
            createdAt: string;
          }>,
        };
    const existingByKey = new Map(
      existingImages.results.map((image) => [image.r2Key, image]),
    );
    statements.push(
      env.DB.prepare("DELETE FROM product_images WHERE product_id = ?").bind(
        productId,
      ),
    );
    body.images.forEach((image) => {
      const existing = existingByKey.get(image.r2Key);
      statements.push(
        env.DB.prepare(
          "INSERT INTO product_images (id, product_id, r2_key, alt_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(
          existing?.id ?? crypto.randomUUID(),
          productId,
          image.r2Key,
          image.altText,
          image.sortOrder,
          existing?.createdAt ?? now,
        ),
      );
    });
  }
  try {
    await env.DB.batch(statements);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const inventoryFailure = mapInventoryError(caught);
    if (inventoryFailure) return inventoryFailure;
    if (message.includes("UNIQUE")) {
      const conflict = await findConflict();
      if (conflict) {
        const response = productConflictError(conflict);
        return error(response.code, response.message, 409, response.details);
      }
    }
    return error(
      "VALIDATION_ERROR",
      "Chưa thể lưu sản phẩm.",
      409,
    );
  }
  const persistedProduct = await readAdminProductData(
    productId,
    env,
    getProductImageUrlStrategy(env.ENVIRONMENT),
  );
  return json(
    {
      success: true,
      id: productId,
      slug: body.slug,
      product: persistedProduct,
    },
    id ? 200 : 201,
  );
}

async function duplicateAdminProduct(id: string, env: Env) {
  const source = await env.DB.prepare("SELECT * FROM products WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!source)
    return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  const [inventorySchema, variantRetirementSchema] = await Promise.all([
    hasInventorySchema(env),
    hasVariantRetirementSchema(env),
  ]);
  const variants = await env.DB.prepare(
    `SELECT * FROM product_variants WHERE product_id = ?${variantRetirementSchema
      ? " AND archived_at IS NULL"
      : ""} ORDER BY sort_order`,
  )
    .bind(id)
    .all<Record<string, unknown>>();
  const newId = crypto.randomUUID();
  const suffix = crypto.randomUUID().slice(0, 6);
  const now = new Date().toISOString();
  const descriptionSchema = await hasProductDescriptionSchema(env);
  const statements = [
    env.DB.prepare(
      descriptionSchema
        ? "INSERT INTO products (id, name, slug, brand, short_description, description, description_content, status, featured, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 'HIDDEN', 0, ?, ?, ?)"
        : "INSERT INTO products (id, name, slug, brand, short_description, description, status, featured, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'HIDDEN', 0, ?, ?, ?)",
    ).bind(
      newId,
      `${source.name} (Bản sao)`,
      `${source.slug}-copy-${suffix}`,
      source.brand,
      source.short_description,
      source.description,
      source.sort_order,
      now,
      now,
    ),
  ];
  variants.results.forEach((variant) =>
    (() => {
      const variantId = crypto.randomUUID();
      statements.push(
        env.DB.prepare(
          inventorySchema
            ? "INSERT INTO product_variants (id, product_id, name, sku, price_vnd, compare_at_price_vnd, availability, track_inventory, stock_on_hand, reserved_quantity, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'HIDDEN', ?, ?, 0, ?, ?, ?)"
            : "INSERT INTO product_variants (id, product_id, name, sku, price_vnd, compare_at_price_vnd, availability, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'HIDDEN', ?, ?, ?)",
        ).bind(
          ...(inventorySchema
            ? [
                variantId,
                newId,
                variant.name,
                variant.sku ? `${variant.sku}-COPY-${suffix}` : null,
                variant.price_vnd,
                variant.compare_at_price_vnd,
                variant.track_inventory ?? 1,
                variant.stock_on_hand ?? 0,
                variant.sort_order,
                now,
                now,
              ]
            : [
                variantId,
                newId,
                variant.name,
                variant.sku ? `${variant.sku}-COPY-${suffix}` : null,
                variant.price_vnd,
                variant.compare_at_price_vnd,
                variant.sort_order,
                now,
                now,
              ]),
        ),
      );
      if (inventorySchema)
        statements.push(
          env.DB.prepare(
            `INSERT INTO inventory_movements (
              id, variant_id, movement_type, quantity_delta,
              stock_before, stock_after, note, created_at
            ) VALUES (?, ?, 'INITIAL_STOCK', ?, 0, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            variantId,
            variant.stock_on_hand ?? 0,
            variant.stock_on_hand ?? 0,
            "Tồn kho ban đầu của sản phẩm sao chép.",
            now,
          ),
        );
    })(),
  );
  await env.DB.batch(statements);
  return json({ success: true, id: newId }, 201);
}

async function archiveAdminProduct(id: string, env: Env) {
  const exists = await env.DB.prepare("SELECT id FROM products WHERE id = ?")
    .bind(id)
    .first();
  if (!exists)
    return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE products SET status = 'HIDDEN', archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ?",
    ).bind(now, now, id),
    env.DB.prepare(
      "UPDATE product_variants SET availability = 'HIDDEN', updated_at = ? WHERE product_id = ?",
    ).bind(now, id),
  ]);
  return json({ success: true, id, archivedAt: now });
}

async function getAdminCategory(id: string, env: Env) {
  const category = await env.DB.prepare(
    `SELECT c.id, c.name, c.slug, c.description, c.image_key AS imageKey,
      c.sort_order AS sortOrder, c.is_active AS isActive,
      (SELECT COUNT(*) FROM product_categories pc WHERE pc.category_id = c.id) AS productCount
     FROM categories c WHERE c.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!category)
    return error("CATEGORY_NOT_FOUND", "Không tìm thấy nhóm sản phẩm.", 404);
  return json({ data: category });
}

async function listAdminCategoryProducts(
  request: Request,
  id: string,
  env: Env,
) {
  const category = await env.DB.prepare(
    "SELECT id, is_active AS isActive FROM categories WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; isActive: number }>();
  if (!category)
    return error("CATEGORY_NOT_FOUND", "Không tìm thấy nhóm sản phẩm.", 404);
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const result = await env.DB.prepare(
    `SELECT p.id, p.name, p.slug, p.status,
      CASE WHEN pc.product_id IS NULL THEN 0 ELSE 1 END AS selected
     FROM products p LEFT JOIN product_categories pc
       ON pc.product_id = p.id AND pc.category_id = ?
     WHERE (? = '' OR p.name LIKE ? OR p.slug LIKE ?)
     ORDER BY selected DESC, p.sort_order, p.name LIMIT 200`,
  )
    .bind(id, q, `%${q}%`, `%${q}%`)
    .all();
  return json({ data: result.results });
}

async function replaceAdminCategoryProducts(
  request: Request,
  id: string,
  env: Env,
) {
  const body = (await readBoundedJson(request)) as { productIds?: unknown };
  if (
    !Array.isArray(body.productIds) ||
    body.productIds.some((value) => typeof value !== "string" || !value.trim()) ||
    new Set(body.productIds).size !== body.productIds.length
  )
    return error("VALIDATION_ERROR", "Danh sách sản phẩm không hợp lệ.", 422);
  const category = await env.DB.prepare(
    "SELECT id, is_active AS isActive FROM categories WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; isActive: number }>();
  if (!category)
    return error("CATEGORY_NOT_FOUND", "Không tìm thấy nhóm sản phẩm.", 404);
  if (!category.isActive) {
    const existing = await env.DB.prepare(
      "SELECT product_id AS id FROM product_categories WHERE category_id = ?",
    )
      .bind(id)
      .all<{ id: string }>();
    const existingIds = new Set(existing.results.map((item) => item.id));
    if (body.productIds.some((productId) => !existingIds.has(productId)))
      return error(
        "CATEGORY_INACTIVE",
        "Không thể gán sản phẩm mới vào nhóm đang ẩn.",
        422,
      );
  }
  if (body.productIds.length) {
    const placeholders = body.productIds.map(() => "?").join(",");
    const products = await env.DB.prepare(
      `SELECT id FROM products WHERE id IN (${placeholders})`,
    )
      .bind(...body.productIds)
      .all<{ id: string }>();
    if (products.results.length !== body.productIds.length)
      return error("INVALID_PRODUCT", "Có sản phẩm không tồn tại.", 422);
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM product_categories WHERE category_id = ?").bind(id),
    ...body.productIds.map((productId) =>
      env.DB.prepare(
        "INSERT INTO product_categories (product_id, category_id, created_at) VALUES (?, ?, ?)",
      ).bind(productId, id, now),
    ),
  ]);
  return json({ success: true, productCount: body.productIds.length });
}

async function removeAdminCategoryProduct(
  categoryId: string,
  productId: string,
  env: Env,
) {
  const result = await env.DB.prepare(
    "DELETE FROM product_categories WHERE category_id = ? AND product_id = ?",
  )
    .bind(categoryId, productId)
    .run();
  if (!result.meta.changes)
    return error("RELATION_NOT_FOUND", "Sản phẩm không thuộc nhóm này.", 404);
  return json({ success: true });
}

async function deactivateAdminCategory(id: string, env: Env) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE categories SET is_active = 0, updated_at = ? WHERE id = ?",
  )
    .bind(now, id)
    .run();
  if (!result.meta.changes)
    return error("CATEGORY_NOT_FOUND", "Không tìm thấy nhóm sản phẩm.", 404);
  return json({ success: true, id, deactivated: true });
}

type TaxonomyKind = "categories" | "tags";

async function deleteTaxonomy(id: string, env: Env, kind: TaxonomyKind) {
  if (kind === "categories") {
    const category = await env.DB.prepare("SELECT id FROM categories WHERE id = ?")
      .bind(id)
      .first<{ id: string }>();
    if (!category)
      return error("CATEGORY_NOT_FOUND", "Không tìm thấy nhóm sản phẩm.", 404);

    const child = await env.DB.prepare(
      "SELECT id FROM categories WHERE parent_id = ? LIMIT 1",
    )
      .bind(id)
      .first<{ id: string }>();
    if (child)
      return error(
        "CATEGORY_HAS_CHILDREN",
        "Không thể xóa danh mục đang có danh mục con. Hãy chuyển hoặc xóa danh mục con trước.",
        409,
        { childId: child.id },
      );

    // FK product_categories chỉ cascade các dòng quan hệ, không cascade sang products.
    const result = await env.DB.prepare(
      "DELETE FROM categories WHERE id = ? AND NOT EXISTS (SELECT 1 FROM categories WHERE parent_id = ?)",
    )
      .bind(id, id)
      .run();
    if (!result.meta.changes) {
      const concurrentChild = await env.DB.prepare(
        "SELECT id FROM categories WHERE parent_id = ? LIMIT 1",
      )
        .bind(id)
        .first<{ id: string }>();
      if (concurrentChild)
        return error(
          "CATEGORY_HAS_CHILDREN",
          "Không thể xóa danh mục đang có danh mục con. Hãy chuyển hoặc xóa danh mục con trước.",
          409,
          { childId: concurrentChild.id },
        );
      return error("CATEGORY_NOT_FOUND", "Không tìm thấy nhóm sản phẩm.", 404);
    }
    return json({ success: true, id, deleted: true });
  }

  const result = await env.DB.prepare("DELETE FROM tags WHERE id = ?")
    .bind(id)
    .run();
  if (!result.meta.changes)
    return error("TAG_NOT_FOUND", "Không tìm thấy tag.", 404);

  // FK product_tags dọn association trong cùng thao tác và giữ nguyên product.
  return json({ success: true, id, deleted: true });
}

async function saveTaxonomy(
  request: Request,
  env: Env,
  kind: "categories" | "tags",
  id?: string,
) {
  const body = (await readBoundedJson(request)) as {
    name?: string;
    slug?: string;
    description?: string;
    imageKey?: string | null;
    groupType?: string;
    sortOrder?: number;
    isActive?: boolean;
  };
  const name = body.name?.trim() ?? "";
  const slug = normalizeSlug(body.slug?.trim() || name);
  if (!name || !slug)
    return error("VALIDATION_ERROR", "Tên và slug không hợp lệ.", 422);
  const rowId = id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  if (kind === "categories") {
    const statement = env.DB.prepare(
      id
        ? "UPDATE categories SET name = ?, slug = ?, description = ?, image_key = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?"
        : "INSERT INTO categories (id, name, slug, description, image_key, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
        ...(id
          ? [
              name,
              slug,
              body.description ?? "",
              body.imageKey?.trim() || null,
              body.sortOrder ?? 0,
              body.isActive === false ? 0 : 1,
              now,
              rowId,
            ]
          : [
              rowId,
              name,
              slug,
              body.description ?? "",
              body.imageKey?.trim() || null,
              body.sortOrder ?? 0,
              body.isActive === false ? 0 : 1,
              now,
              now,
            ]),
      );
    try {
      const result = await statement.run();
      if (id && !result.meta.changes)
        return error("CATEGORY_NOT_FOUND", "Không tìm thấy nhóm sản phẩm.", 404);
    } catch (caught) {
      if (caught instanceof Error && caught.message.includes("UNIQUE"))
        return error("SLUG_CONFLICT", `Slug "${slug}" đã tồn tại.`, 409);
      throw caught;
    }
  } else {
    await env.DB.prepare(
      id
        ? "UPDATE tags SET name = ?, slug = ?, group_type = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?"
        : "INSERT INTO tags (id, name, slug, group_type, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        ...(id
          ? [
              name,
              slug,
              body.groupType ?? null,
              body.sortOrder ?? 0,
              body.isActive === false ? 0 : 1,
              now,
              rowId,
            ]
          : [
              rowId,
              name,
              slug,
              body.groupType ?? null,
              body.sortOrder ?? 0,
              body.isActive === false ? 0 : 1,
              now,
              now,
            ]),
      )
      .run();
  }
  return json({ success: true, id: rowId }, id ? 200 : 201);
}

async function deleteImage(id: string, env: Env) {
  const image = await env.DB.prepare(
    "SELECT r2_key AS r2Key FROM product_images WHERE id = ?",
  )
    .bind(id)
    .first<{ r2Key: string }>();
  if (!image) return error("PRODUCT_NOT_FOUND", "Không tìm thấy ảnh.", 404);
  // Chỉ xóa liên kết khỏi sản phẩm; object R2 lịch sử được giữ bất biến.
  await env.DB.prepare("DELETE FROM product_images WHERE id = ?")
    .bind(id)
    .run();
  return json({ success: true });
}

function adminAuthorizationError(authorization: AdminAuthorization) {
  if (!authorization.authorized && authorization.reason === "MISSING_CONFIG")
    return error(
      "ACCESS_NOT_CONFIGURED",
      "Cloudflare Access chưa được cấu hình cho production.",
      503,
    );
  return error(
    "UNAUTHORIZED",
    "Cloudflare Access JWT không hợp lệ hoặc còn thiếu.",
    401,
  );
}

async function handleApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  preauthorizedAdmin?: AdminAuthorization,
) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/storefront/session") {
    const authorization = await authorizeStorefrontSession(request, env);
    if (!authorization.valid) {
      if (authorization.reason === "MISSING_SECRET")
        return storefrontGateMisconfiguredResponse();
      return storefrontSessionRequiredResponse();
    }
    return json({
      authenticated: isStorefrontAccessGateEnabled(env),
      gateEnabled: isStorefrontAccessGateEnabled(env),
    });
  }
  if (request.method === "GET" && path === "/api/categories")
    return listCategories(env);
  if (request.method === "GET" && path === "/api/tags")
    return listTags(env);
  if (request.method === "GET" && path === "/api/brands")
    return listBrands(env);
  if (
    request.method === "GET" &&
    (path === "/api/products" || path === "/api/search")
  )
    return listProducts(request, env);
  if (request.method === "GET" && path.startsWith("/api/products/"))
    return getProduct(
      decodeURIComponent(path.slice(14)),
      env,
      getProductImageUrlStrategy(env.ENVIRONMENT),
    );
  if (request.method === "GET" && path === "/api/checkout-config")
    return checkoutConfigResponse(env);
  const publicContentPageMatch = path.match(/^\/api\/content-pages\/([^/]+)$/);
  if (request.method === "GET" && publicContentPageMatch)
    return getPublicContentPage(
      decodeURIComponent(publicContentPageMatch[1]),
      env,
    );
  if (request.method === "POST" && path === "/api/cart/evaluate")
    return evaluateCart(request, env);
  if (request.method === "POST" && path === "/api/cart/share/prepare")
    return prepareCartShare(request, env);
  if (request.method === "POST" && path === "/api/cart/share/activate")
    return activateCartShare(request, env);
  const publicShareMatch = path.match(/^\/api\/cart\/share\/([^/]+)$/);
  if (request.method === "GET" && publicShareMatch)
    return getPublicCartShare(decodeURIComponent(publicShareMatch[1]), env);
  if (request.method === "POST" && path === "/api/cart/messenger/start")
    return startMessengerCheckout(request, env);
  const messengerStatusMatch = path.match(
    /^\/api\/cart\/messenger\/status\/([^/]+)$/,
  );
  if (request.method === "GET" && messengerStatusMatch)
    return getMessengerStatus(
      request,
      decodeURIComponent(messengerStatusMatch[1]),
      env,
    );
  if (path === "/api/meta/messenger/webhook")
    return handleMessengerWebhook(request, env, ctx);
  let verifiedAdminEmail: string | undefined;
  if (path.startsWith("/api/admin/")) {
    const authorization =
      preauthorizedAdmin ?? (await authorizeAdminRequest(request, env));
    if (!authorization.authorized) {
      return adminAuthorizationError(authorization);
    }
    verifiedAdminEmail =
      typeof authorization.payload?.email === "string"
        ? authorization.payload.email
        : undefined;
  }
  if (request.method === "GET" && path === "/api/admin/content-pages")
    return listAdminContentPages(env);
  const adminContentPageMatch = path.match(
    /^\/api\/admin\/content-pages\/([^/]+)$/,
  );
  if (request.method === "GET" && adminContentPageMatch)
    return getAdminContentPage(
      decodeURIComponent(adminContentPageMatch[1]),
      env,
    );
  if (request.method === "PUT" && adminContentPageMatch)
    return saveAdminContentPage(
      request,
      decodeURIComponent(adminContentPageMatch[1]),
      env,
    );
  if (request.method === "GET" && path === "/api/admin/access-links")
    return listAccessLinks(request, env);
  if (request.method === "POST" && path === "/api/admin/access-links")
    return createAccessLink(request, env, verifiedAdminEmail);
  const accessLinkMatch = path.match(/^\/api\/admin\/access-links\/([^/]+)$/);
  const accessLinkActionMatch = path.match(
    /^\/api\/admin\/access-links\/([^/]+)\/(reset-sessions|rotate|revoke|test)$/,
  );
  if (request.method === "PUT" && accessLinkMatch)
    return updateAccessLink(
      request,
      env,
      decodeURIComponent(accessLinkMatch[1]),
      verifiedAdminEmail,
    );
  if (request.method === "DELETE" && accessLinkMatch)
    return deleteAccessLink(
      request,
      env,
      decodeURIComponent(accessLinkMatch[1]),
      verifiedAdminEmail,
    );
  if (request.method === "POST" && accessLinkActionMatch) {
    const accessLinkId = decodeURIComponent(accessLinkActionMatch[1]);
    const action = accessLinkActionMatch[2];
    if (action === "reset-sessions")
      return resetAccessLinkSessions(
        request,
        env,
        accessLinkId,
        verifiedAdminEmail,
      );
    if (action === "rotate")
      return rotateAccessLink(request, env, accessLinkId, verifiedAdminEmail);
    if (action === "revoke")
      return revokeAccessLink(request, env, accessLinkId, verifiedAdminEmail);
    return testAccessLink(request, env, accessLinkId);
  }
  if (request.method === "GET" && path === "/api/admin/settings")
    return getStorefrontSettings(env);
  if (request.method === "PUT" && path === "/api/admin/settings")
    return saveStorefrontSettings(request, env);
  if (request.method === "GET" && path === "/api/admin/settings/storefront")
    return getStorefrontSettings(env);
  if (request.method === "PUT" && path === "/api/admin/settings/storefront")
    return saveStorefrontSettings(request, env);
  if (request.method === "GET" && path === "/api/admin/settings/checkout")
    return getAdminCheckoutSettings(env);
  if (request.method === "PUT" && path === "/api/admin/settings/checkout")
    return saveAdminCheckoutSettings(request, env);
  if (request.method === "GET" && path === "/api/admin/cron-health")
    return json({ data: await getAdminCronHealthData(env) });
  if (request.method === "GET" && path === "/api/admin/promotions")
    return listAdminPromotions(request, env);
  if (request.method === "GET" && path === "/api/admin/promotions/options")
    return listPromotionOptions(request, env);
  const promotionMatch = path.match(/^\/api\/admin\/promotions\/([^/]+)$/);
  const promotionDuplicateMatch = path.match(
    /^\/api\/admin\/promotions\/([^/]+)\/duplicate$/,
  );
  const promotionStatusMatch = path.match(
    /^\/api\/admin\/promotions\/([^/]+)\/status$/,
  );
  if (request.method === "POST" && path === "/api/admin/promotions")
    return saveAdminPromotion(request, env);
  if (request.method === "GET" && promotionMatch)
    return getAdminPromotion(decodeURIComponent(promotionMatch[1]), env);
  if (request.method === "PUT" && promotionMatch)
    return saveAdminPromotion(request, env, decodeURIComponent(promotionMatch[1]));
  if (request.method === "DELETE" && promotionMatch)
    return deleteAdminPromotion(decodeURIComponent(promotionMatch[1]), env);
  if (request.method === "POST" && promotionDuplicateMatch)
    return duplicateAdminPromotion(
      decodeURIComponent(promotionDuplicateMatch[1]),
      env,
    );
  if (request.method === "PATCH" && promotionStatusMatch)
    return updateAdminPromotionStatus(
      request,
      decodeURIComponent(promotionStatusMatch[1]),
      env,
    );
  if (request.method === "GET" && path === "/api/admin/products")
    return listProducts(request, env, true);
  const productMatch = path.match(/^\/api\/admin\/products\/([^/]+)$/);
  const duplicateMatch = path.match(
    /^\/api\/admin\/products\/([^/]+)\/duplicate$/,
  );
  if (request.method === "POST" && path === "/api/admin/products")
    return saveAdminProduct(request, env);
  if (request.method === "GET" && productMatch)
    return getAdminProduct(
      productMatch[1],
      env,
      getProductImageUrlStrategy(env.ENVIRONMENT),
    );
  if (request.method === "PUT" && productMatch)
    return saveAdminProduct(request, env, productMatch[1]);
  if (request.method === "DELETE" && productMatch)
    return archiveAdminProduct(productMatch[1], env);
  if (request.method === "POST" && duplicateMatch)
    return duplicateAdminProduct(duplicateMatch[1], env);
  if (request.method === "GET" && path === "/api/admin/categories")
    return listCategories(env, true);
  if (request.method === "GET" && path === "/api/admin/brands")
    return listBrands(env, true);
  if (request.method === "GET" && path === "/api/admin/tags") {
    const result = await env.DB.prepare(
      "SELECT id, name, slug, group_type AS groupType, sort_order AS sortOrder, is_active AS isActive FROM tags ORDER BY sort_order, name",
    ).all();
    return json({ data: result.results });
  }
  const categoryMatch = path.match(/^\/api\/admin\/categories\/([^/]+)$/);
  const categoryProductsMatch = path.match(
    /^\/api\/admin\/categories\/([^/]+)\/products$/,
  );
  const categoryProductMatch = path.match(
    /^\/api\/admin\/categories\/([^/]+)\/products\/([^/]+)$/,
  );
  const tagMatch = path.match(/^\/api\/admin\/tags\/([^/]+)$/);
  const permanentTaxonomyMatch = path.match(
    /^\/api\/admin\/(categories|tags)\/([^/]+)\/permanent$/,
  );
  if (request.method === "POST" && path === "/api/admin/categories")
    return saveTaxonomy(request, env, "categories");
  if (request.method === "GET" && categoryProductsMatch)
    return listAdminCategoryProducts(request, categoryProductsMatch[1], env);
  if (request.method === "PUT" && categoryProductsMatch)
    return replaceAdminCategoryProducts(request, categoryProductsMatch[1], env);
  if (request.method === "DELETE" && categoryProductMatch)
    return removeAdminCategoryProduct(
      categoryProductMatch[1],
      categoryProductMatch[2],
      env,
    );
  if (request.method === "DELETE" && permanentTaxonomyMatch)
    return deleteTaxonomy(
      permanentTaxonomyMatch[2],
      env,
      permanentTaxonomyMatch[1] === "categories" ? "categories" : "tags",
    );
  if (request.method === "GET" && categoryMatch)
    return getAdminCategory(categoryMatch[1], env);
  if (request.method === "PUT" && categoryMatch)
    return saveTaxonomy(request, env, "categories", categoryMatch[1]);
  if (request.method === "DELETE" && categoryMatch)
    return deactivateAdminCategory(categoryMatch[1], env);
  if (request.method === "POST" && path === "/api/admin/tags")
    return saveTaxonomy(request, env, "tags");
  if (request.method === "PUT" && tagMatch)
    return saveTaxonomy(request, env, "tags", tagMatch[1]);
  if (request.method === "GET" && path === "/api/admin/cart-requests")
    return getAdminRequests(request, env);
  if (request.method === "GET" && path === "/api/admin/settings/seller")
    return getAdminSellerSettings(env);
  if (request.method === "PUT" && path === "/api/admin/settings/seller")
    return saveAdminSellerSettings(request, env);
  const requestMatch = path.match(/^\/api\/admin\/cart-requests\/([^/]+)$/);
  if (request.method === "GET" && requestMatch)
    return getAdminRequest(requestMatch[1], env);
  const statusMatch = path.match(
    /^\/api\/admin\/cart-requests\/([^/]+)\/status$/,
  );
  if (request.method === "PATCH" && statusMatch)
    return updateRequestStatus(request, statusMatch[1], env);
  const confirmRequestMatch = path.match(
    /^\/api\/admin\/cart-requests\/([^/]+)\/confirm$/,
  );
  if (request.method === "POST" && confirmRequestMatch)
    return confirmInventoryOrder(decodeURIComponent(confirmRequestMatch[1]), env);
  const cancelRequestMatch = path.match(
    /^\/api\/admin\/cart-requests\/([^/]+)\/cancel$/,
  );
  if (request.method === "POST" && cancelRequestMatch)
    return cancelInventoryOrder(decodeURIComponent(cancelRequestMatch[1]), env);
  const retryMessengerMatch = path.match(
    /^\/api\/admin\/cart-requests\/([^/]+)\/retry-messenger$/,
  );
  if (request.method === "POST" && retryMessengerMatch)
    return retryMessengerDelivery(retryMessengerMatch[1], env);
  if (request.method === "POST" && path === "/api/admin/images")
    return uploadImage(request, env);
  if (
    request.method === "POST" &&
    path === "/api/admin/product-description-assets"
  )
    return uploadDescriptionImage(request, env);
  const imageMatch = path.match(/^\/api\/admin\/images\/([^/]+)$/);
  if (request.method === "DELETE" && imageMatch)
    return deleteImage(imageMatch[1], env);
  return error("PRODUCT_NOT_FOUND", "Không tìm thấy API.", 404);
}

async function handleMedia(path: string, env: Env) {
  const object = await env.PRODUCT_IMAGES.get(
    decodeURIComponent(path.slice(7)),
  );
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("deprecation", "true");
  headers.set(
    "link",
    `<${getPublicImageUrl(decodeURIComponent(path.slice(7)))}>; rel="alternate"`,
  );
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (isAccessEndpointPath(url.pathname))
        return await handleAccessRequest(request, env);
      if (url.pathname.startsWith("/api/")) {
        let adminAuthorization: AdminAuthorization | undefined;
        if (url.pathname.startsWith("/api/admin/")) {
          adminAuthorization = await authorizeAdminRequest(request, env);
          if (!adminAuthorization.authorized)
            return adminAuthorizationError(adminAuthorization);
        }
        if (isStorefrontProtectedApiPath(url.pathname) &&
            isStorefrontAccessGateEnabled(env)) {
          if (!env.STOREFRONT_ACCESS_SECRET?.trim())
            return storefrontGateMisconfiguredResponse();
          const authorization = await authorizeStorefrontSession(request, env);
          if (!authorization.valid) {
            if (authorization.reason === "MISSING_SECRET")
              return storefrontGateMisconfiguredResponse();
            return storefrontSessionRequiredResponse();
          }
        }
        const response = await handleApi(
          request,
          env,
          ctx,
          adminAuthorization,
        );
        return adminAuthorization?.authorized
          ? await addAdminAnalyticsExemption(response, request, env)
          : response;
      }
      if (url.pathname.startsWith("/media/"))
        return await handleMedia(url.pathname, env);
      const protectedHtml =
        isStorefrontProtectedHtmlPath(url.pathname) &&
        isStorefrontAccessGateEnabled(env);
      if (protectedHtml) {
        if (!env.STOREFRONT_ACCESS_SECRET?.trim())
          return storefrontGateMisconfiguredResponse();
        const authorization = await authorizeStorefrontSession(request, env);
        if (!authorization.valid) {
          if (authorization.reason === "MISSING_SECRET")
            return storefrontGateMisconfiguredResponse();
          return storefrontAccessRequiredRedirect(request, true);
        }
      }
      const response = await requestHandler(request);
      if (/^\/c\/[^/]+$/.test(url.pathname)) {
        const headers = new Headers(response.headers);
        headers.set("x-robots-tag", "noindex, nofollow, noarchive");
        headers.set("referrer-policy", "no-referrer");
        headers.set("cache-control", "private, no-store");
        return cloneResponseWithHeaders(response, headers);
      }
      if (isAdminHtmlPath(url.pathname) || protectedHtml)
        return privateNoStoreResponse(response);
      return response;
    } catch (caught) {
      console.error(
        JSON.stringify({
          message: "unexpected route error",
          path: redactPathForLog(url.pathname),
          errorType: caught instanceof Error ? caught.name : "UNKNOWN",
        }),
      );
      if (url.pathname.startsWith("/api/"))
        return error(
          "SUBMISSION_FAILED",
          "Đã có lỗi máy chủ. Vui lòng thử lại.",
          500,
        );
      return new Response("Đã có lỗi xảy ra.", { status: 500 });
    }
  },
  async scheduled(controller, env) {
    await runInventoryCleanupCron(env, new Date(controller.scheduledTime));
    try {
      await cleanupOrphanedProductDescriptionAssets(
        env,
        new Date(controller.scheduledTime),
      );
    } catch (caught) {
      console.error(
        JSON.stringify({
          message: "product description asset cleanup failed",
          errorType: caught instanceof Error ? caught.name : "UNKNOWN",
        }),
      );
    }
  },
} satisfies ExportedHandler<Env>;
