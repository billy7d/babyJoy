import { createRequestHandler } from "react-router";
import {
  mapCartItemSnapshot,
  type CartItemSnapshotRow,
} from "./services";
import { authorizeAdminRequest } from "./access";
import {
  ImageUploadError,
  normalizeProductImages,
  uploadImmutableProductImage,
  validateAssociatedImages,
} from "./image-service";
import { getPublicImageUrl } from "../shared/images";
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
  getAdminSellerSettings,
  getPublicCartShare,
  prepareCartShare,
  saveAdminSellerSettings,
} from "./cart-share";

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

function error(
  code: string,
  message: string,
  status: number,
  details?: unknown,
) {
  return json({ success: false, error: { code, message, details } }, status);
}

async function readBoundedJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (text.length > 64 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(text) as unknown;
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
};
type ProductImageRow = {
  productId: string;
  id: string;
  r2Key: string;
  altText: string;
  sortOrder: number;
};
type ProductTagRow = { productId: string; name: string };
type ProductCategoryRow = { productId: string; id: string; slug: string; name: string };

async function hydrateProducts(rows: ProductRow[], env: Env) {
  if (!rows.length) return [];
  const placeholders = rows.map(() => "?").join(",");
  const ids = rows.map((row) => row.id);
  const [variants, images, tags, categories] = await Promise.all([
    env.DB.prepare(
      `SELECT product_id AS productId, id, name, sku, price_vnd AS priceVnd, compare_at_price_vnd AS compareAtPriceVnd, availability, sort_order AS sortOrder FROM product_variants WHERE product_id IN (${placeholders}) ORDER BY sort_order, created_at`,
    )
      .bind(...ids)
      .all<ProductVariantRow>(),
    env.DB.prepare(
      `SELECT product_id AS productId, id, r2_key AS r2Key, alt_text AS altText, sort_order AS sortOrder FROM product_images WHERE product_id IN (${placeholders}) ORDER BY sort_order, created_at`,
    )
      .bind(...ids)
      .all<ProductImageRow>(),
    env.DB.prepare(
      `SELECT pt.product_id AS productId, t.name FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.product_id IN (${placeholders}) AND t.is_active = 1 ORDER BY t.sort_order, t.name`,
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
  return rows.map((product) => ({
    ...product,
    variants: variants.results
      .filter((variant) => variant.productId === product.id)
      .map(({ productId: _productId, ...variant }) => variant),
    images: images.results
      .filter((image) => image.productId === product.id)
      .map(({ productId: _productId, ...image }) => ({
        ...image,
        url: getPublicImageUrl(image.r2Key),
      })),
    tagNames: tags.results
      .filter((tag) => tag.productId === product.id)
      .map((tag) => tag.name),
    categories: categories.results
      .filter((category) => category.productId === product.id)
      .map(({ productId: _productId, ...category }) => category),
    categoryIds: categories.results
      .filter((category) => category.productId === product.id)
      .map((category) => category.id),
    categorySlugs: categories.results
      .filter((category) => category.productId === product.id)
      .map((category) => category.slug),
  }));
}

async function listProducts(request: Request, env: Env, includeHidden = false) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const categories = (url.searchParams.get("category") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const brands = (url.searchParams.get("brand") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const ageValue = url.searchParams.get("age");
  const age = ageValue === null ? null : Number.parseInt(ageValue, 10);
  const bestSellerValue = url.searchParams.get("bestSeller");
  const bestSeller = bestSellerValue === "1" || bestSellerValue === "true";
  const sort = url.searchParams.get("sort") ?? "default";
  const page = Math.max(
    1,
    Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  );
  const limit = Math.min(
    24,
    Math.max(
      1,
      Number.parseInt(url.searchParams.get("limit") ?? "24", 10) || 24,
    ),
  );
  const where = includeHidden
    ? ["1 = 1"]
    : [
        "p.status != 'HIDDEN'",
        "p.archived_at IS NULL",
        "EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.availability != 'HIDDEN')",
      ];
  const values: Array<string | number> = [];
  if (q) {
    where.push(
      "(p.name LIKE ? OR COALESCE(b.name, p.brand, '') LIKE ? OR EXISTS (SELECT 1 FROM product_variants sv WHERE sv.product_id = p.id AND sv.sku LIKE ?))",
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
  if (ageValue !== null) {
    if (!Number.isSafeInteger(age) || Number(age) < 0 || Number(age) > 240)
      return error("VALIDATION_ERROR", "Độ tuổi lọc không hợp lệ.", 422);
    where.push("p.min_age_months <= ?");
    values.push(Number(age));
  }
  if (bestSeller) where.push("p.is_best_seller = 1");
  const price =
    "COALESCE((SELECT MIN(sv.price_vnd) FROM product_variants sv WHERE sv.product_id = p.id AND sv.availability != 'HIDDEN'), 0)";
  const order =
    sort === "price_asc"
      ? `${price} ASC`
      : sort === "price_desc"
        ? `${price} DESC`
      : sort === "newest"
          ? "p.created_at DESC"
          : sort === "best_seller" || bestSeller
            ? "p.is_best_seller DESC, p.best_seller_rank ASC, p.sort_order, p.name"
          : "p.sort_order, p.name";
  values.push(limit, (page - 1) * limit);
  const sql = `SELECT p.id, p.name, p.slug, COALESCE(b.name, p.brand) AS brand,
    p.brand_id AS brandId, b.slug AS brandSlug, p.min_age_months AS minAgeMonths,
    p.is_best_seller AS isBestSeller, p.best_seller_rank AS bestSellerRank,
    p.archived_at AS archivedAt, p.short_description AS shortDescription,
    p.description, p.status, p.featured, p.sort_order AS sortOrder,
    (SELECT c.slug FROM product_categories pc JOIN categories c ON c.id = pc.category_id
      WHERE pc.product_id = p.id AND c.is_active = 1 ORDER BY c.sort_order LIMIT 1) AS categorySlug
    FROM products p LEFT JOIN brands b ON b.id = p.brand_id
    WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`;
  const result = await env.DB.prepare(sql)
    .bind(...values)
    .all<ProductRow>();
  const products = await hydrateProducts(result.results, env);
  if (!includeHidden)
    products.forEach((product) => {
      product.variants = product.variants.filter(
        (variant) => variant.availability !== "HIDDEN",
      );
    });
  return json({
    data: products,
    pagination: { page, limit },
  });
}

async function getProduct(slug: string, env: Env) {
  const product = await env.DB.prepare(
    `SELECT p.id, p.name, p.slug, COALESCE(b.name, p.brand) AS brand,
      p.brand_id AS brandId, b.slug AS brandSlug, p.min_age_months AS minAgeMonths,
      p.is_best_seller AS isBestSeller, p.best_seller_rank AS bestSellerRank,
      p.archived_at AS archivedAt, p.short_description AS shortDescription,
      p.description, p.status, p.featured, p.sort_order AS sortOrder,
      (SELECT c.slug FROM product_categories pc JOIN categories c ON c.id = pc.category_id
        WHERE pc.product_id = p.id AND c.is_active = 1 ORDER BY c.sort_order LIMIT 1) AS categorySlug
     FROM products p LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.slug = ? AND p.status != 'HIDDEN' AND p.archived_at IS NULL`,
  )
    .bind(slug)
    .first<ProductRow>();
  if (!product)
    return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  const [hydrated] = await hydrateProducts([product], env);
  hydrated.variants = hydrated.variants.filter(
    (variant) => variant.availability !== "HIDDEN",
  );
  return json({ data: hydrated });
}

async function getAdminRequests(request: Request, env: Env) {
  const scope = new URL(request.url).searchParams.get("scope") ?? "queue";
  const where =
    scope === "messenger"
      ? "WHERE contact_channel = 'MESSENGER'"
      : scope === "share"
        ? "WHERE contact_channel = 'SHARE'"
      : scope === "all"
        ? ""
        : "WHERE contact_channel IN ('LEGACY', 'SHARE') OR messenger_delivery_status = 'SENT'";
  const result = await env.DB.prepare(
    `SELECT id, public_code AS publicCode, customer_name AS customerName,
      customer_phone AS customerPhone, item_line_count AS itemLineCount,
      total_quantity AS totalQuantity, subtotal_vnd AS subtotalVnd, status,
      telegram_status AS telegramStatus, contact_channel AS contactChannel,
      messenger_delivery_status AS messengerDeliveryStatus,
      (SELECT status FROM messenger_checkout_sessions WHERE cart_request_id = cart_requests.id ORDER BY created_at DESC LIMIT 1) AS messengerSessionStatus,
      created_at AS createdAt
     FROM cart_requests ${where}
     ORDER BY CASE WHEN contact_channel = 'MESSENGER' AND messenger_delivery_status != 'SENT' THEN 1 ELSE 0 END,
       created_at DESC LIMIT 100`,
  ).all();
  return json({ data: result.results });
}

async function getAdminRequest(id: string, env: Env) {
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
      created_at AS createdAt, updated_at AS updatedAt
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
  return json({
    data: { ...cartRequest, items: items.results.map(mapCartItemSnapshot) },
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
    return json({ success: true, ...result }, 201);
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
            ? "Ảnh vượt quá 5MB."
            : caught.code === "KEY_COLLISION"
              ? "Không thể tạo khóa ảnh duy nhất."
              : "Tệp ảnh đang trống.";
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
    name?: string;
    sku?: string;
    priceVnd?: number;
    compareAtPriceVnd?: number | null;
    availability?: string;
    sortOrder?: number;
  }>;
};

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
  if (!input || typeof input !== "object") throw new Error("VALIDATION_ERROR");
  const body = input as AdminProductInput;
  const name = body.name?.trim() ?? "";
  const slug = normalizeSlug(body.slug?.trim() || name);
  const statuses = ["AVAILABLE", "OUT_OF_STOCK", "HIDDEN"];
  if (
    !name ||
    name.length > 180 ||
    !slug ||
    !statuses.includes(body.status ?? "AVAILABLE") ||
    !Array.isArray(body.variants) ||
    !body.variants.length
  )
    throw new Error("VALIDATION_ERROR");
  const variants = body.variants.map((variant, index) => {
    const variantName = variant.name?.trim() ?? "";
    const priceVnd = Number(variant.priceVnd);
    const availability = variant.availability ?? "AVAILABLE";
    if (
      !variantName ||
      !Number.isSafeInteger(priceVnd) ||
      priceVnd < 0 ||
      !statuses.includes(availability)
    )
      throw new Error("VALIDATION_ERROR");
    return {
      ...variant,
      name: variantName,
      priceVnd,
      availability,
      sortOrder: Number.isFinite(variant.sortOrder)
        ? Number(variant.sortOrder)
        : index,
    };
  });
  const categoryIds =
    body.categoryIds ?? (body.categoryId ? [body.categoryId] : undefined);
  if (
    categoryIds !== undefined &&
    (!Array.isArray(categoryIds) ||
      categoryIds.some((value) => typeof value !== "string" || !value.trim()) ||
      new Set(categoryIds).size !== categoryIds.length)
  )
    throw new Error("VALIDATION_ERROR");
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
    throw new Error("VALIDATION_ERROR");
  if (
    body.tagIds !== undefined &&
    (!Array.isArray(body.tagIds) ||
      body.tagIds.some((value) => typeof value !== "string" || !value.trim()))
  )
    throw new Error("VALIDATION_ERROR");
  const images =
    body.images === undefined ? undefined : normalizeProductImages(body.images);
  return {
    ...body,
    name,
    slug,
    status: body.status ?? "AVAILABLE",
    featured: body.featured ? 1 : 0,
    sortOrder: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0,
    variants,
    brandId,
    minAgeMonths,
    isBestSeller: isBestSeller ? 1 : 0,
    bestSellerRank,
    categoryIds,
    tagIds: body.tagIds,
    images,
  };
}

async function getAdminProduct(id: string, env: Env) {
  const product = await env.DB.prepare(
    `SELECT p.id, p.name, p.slug, COALESCE(b.name, p.brand) AS brand,
      p.brand_id AS brandId, b.slug AS brandSlug, p.min_age_months AS minAgeMonths,
      p.is_best_seller AS isBestSeller, p.best_seller_rank AS bestSellerRank,
      p.archived_at AS archivedAt, p.short_description AS shortDescription,
      p.description, p.status, p.featured, p.sort_order AS sortOrder
     FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!product)
    return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  const variants = await env.DB.prepare(
    "SELECT id, name, sku, price_vnd AS priceVnd, compare_at_price_vnd AS compareAtPriceVnd, availability, sort_order AS sortOrder FROM product_variants WHERE product_id = ? ORDER BY sort_order",
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
  return json({
    data: {
      ...product,
      variants: variants.results,
      categoryIds: categories.results.map((item) => item.id),
      tagIds: tags.results.map((item) => item.id),
      images: images.results.map((image) => ({
        ...image,
        url: getPublicImageUrl(image.r2Key),
      })),
    },
  });
}

async function saveAdminProduct(request: Request, env: Env, id?: string) {
  let body: ReturnType<typeof validateAdminProduct>;
  try {
    body = validateAdminProduct(await readBoundedJson(request));
  } catch {
    return error("VALIDATION_ERROR", "Thông tin sản phẩm chưa hợp lệ.", 422);
  }
  const productId = id ?? crypto.randomUUID();
  if (
    id &&
    !(await env.DB.prepare("SELECT id FROM products WHERE id = ?")
      .bind(id)
      .first())
  )
    return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
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
  const now = new Date().toISOString();
  const statements = id
    ? [
        env.DB.prepare(
          "UPDATE products SET name = ?, slug = ?, brand = CASE WHEN ? IS NULL THEN brand ELSE NULL END, brand_id = ?, min_age_months = ?, is_best_seller = ?, best_seller_rank = ?, short_description = ?, description = ?, status = ?, archived_at = CASE WHEN ? != 'HIDDEN' THEN NULL ELSE archived_at END, featured = ?, sort_order = ?, updated_at = ? WHERE id = ?",
        ).bind(
          body.name,
          body.slug,
          body.brandId,
          body.brandId,
          body.minAgeMonths,
          body.isBestSeller,
          body.bestSellerRank,
          body.shortDescription ?? "",
          body.description ?? "",
          body.status,
          body.status,
          body.featured,
          body.sortOrder,
          now,
          productId,
        ),
      ]
    : [
        env.DB.prepare(
          "INSERT INTO products (id, name, slug, brand_id, min_age_months, is_best_seller, best_seller_rank, short_description, description, status, featured, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ",
        ).bind(
          productId,
          body.name,
          body.slug,
          body.brandId,
          body.minAgeMonths,
          body.isBestSeller,
          body.bestSellerRank,
          body.shortDescription ?? "",
          body.description ?? "",
          body.status,
          body.featured,
          body.sortOrder,
          now,
          now,
        ),
      ];
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
  const existingVariants = id
    ? await env.DB.prepare(
        "SELECT id FROM product_variants WHERE product_id = ?",
      )
        .bind(productId)
        .all<{ id: string }>()
    : { results: [] as Array<{ id: string }> };
  const existingVariantIds = new Set(
    existingVariants.results.map((variant) => variant.id),
  );
  body.variants.forEach((variant) => {
    const variantId =
      variant.id && existingVariantIds.has(variant.id)
        ? variant.id
        : crypto.randomUUID();
    statements.push(
      env.DB.prepare(
        "INSERT INTO product_variants (id, product_id, name, sku, price_vnd, compare_at_price_vnd, availability, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, sku = excluded.sku, price_vnd = excluded.price_vnd, compare_at_price_vnd = excluded.compare_at_price_vnd, availability = excluded.availability, sort_order = excluded.sort_order, updated_at = excluded.updated_at",
      ).bind(
        variantId,
        productId,
        variant.name,
        variant.sku?.trim() || null,
        variant.priceVnd,
        variant.compareAtPriceVnd ?? null,
        variant.availability,
        variant.sortOrder,
        now,
        now,
      ),
    );
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
  return json(
    { success: true, id: productId, slug: body.slug },
    id ? 200 : 201,
  );
}

async function duplicateAdminProduct(id: string, env: Env) {
  const source = await env.DB.prepare("SELECT * FROM products WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!source)
    return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  const variants = await env.DB.prepare(
    "SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order",
  )
    .bind(id)
    .all<Record<string, unknown>>();
  const newId = crypto.randomUUID();
  const suffix = crypto.randomUUID().slice(0, 6);
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      "INSERT INTO products (id, name, slug, brand, short_description, description, status, featured, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'HIDDEN', 0, ?, ?, ?)",
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
    statements.push(
      env.DB.prepare(
        "INSERT INTO product_variants (id, product_id, name, sku, price_vnd, compare_at_price_vnd, availability, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'HIDDEN', ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        newId,
        variant.name,
        variant.sku ? `${variant.sku}-COPY-${suffix}` : null,
        variant.price_vnd,
        variant.compare_at_price_vnd,
        variant.sort_order,
        now,
        now,
      ),
    ),
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

async function handleApi(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/categories")
    return listCategories(env);
  if (request.method === "GET" && path === "/api/brands")
    return listBrands(env);
  if (
    request.method === "GET" &&
    (path === "/api/products" || path === "/api/search")
  )
    return listProducts(request, env);
  if (request.method === "GET" && path.startsWith("/api/products/"))
    return getProduct(decodeURIComponent(path.slice(14)), env);
  if (request.method === "GET" && path === "/api/checkout-config")
    return checkoutConfigResponse(env);
  if (request.method === "POST" && path === "/api/cart/share/prepare")
    return prepareCartShare(request, env);
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
  if (path.startsWith("/api/admin/")) {
    const authorization = await authorizeAdminRequest(request, env);
    if (!authorization.authorized) {
      if (authorization.reason === "MISSING_CONFIG")
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
  }
  if (request.method === "GET" && path === "/api/admin/products")
    return listProducts(request, env, true);
  const productMatch = path.match(/^\/api\/admin\/products\/([^/]+)$/);
  const duplicateMatch = path.match(
    /^\/api\/admin\/products\/([^/]+)\/duplicate$/,
  );
  if (request.method === "POST" && path === "/api/admin/products")
    return saveAdminProduct(request, env);
  if (request.method === "GET" && productMatch)
    return getAdminProduct(productMatch[1], env);
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
  const retryMessengerMatch = path.match(
    /^\/api\/admin\/cart-requests\/([^/]+)\/retry-messenger$/,
  );
  if (request.method === "POST" && retryMessengerMatch)
    return retryMessengerDelivery(retryMessengerMatch[1], env);
  if (request.method === "POST" && path === "/api/admin/images")
    return uploadImage(request, env);
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
      if (url.pathname.startsWith("/api/"))
        return await handleApi(request, env, ctx);
      if (url.pathname.startsWith("/media/"))
        return await handleMedia(url.pathname, env);
      const response = await requestHandler(request);
      if (/^\/c\/[^/]+$/.test(url.pathname)) {
        const headers = new Headers(response.headers);
        headers.set("x-robots-tag", "noindex, nofollow, noarchive");
        headers.set("referrer-policy", "no-referrer");
        headers.set("cache-control", "private, no-store");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
      return response;
    } catch (caught) {
      console.error(
        JSON.stringify({
          message: "unexpected route error",
          path: url.pathname,
          error: caught instanceof Error ? caught.message : String(caught),
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
} satisfies ExportedHandler<Env>;
