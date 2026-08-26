import { createRequestHandler } from "react-router";
import { composeTelegramMessage, generatePublicCode, splitTelegramMessage, validateSubmission, type PricedItem } from "./services";

const requestHandler = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function error(code: string, message: string, status: number, details?: unknown) {
  return json({ success: false, error: { code, message, details } }, status);
}

async function readBoundedJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (text.length > 64 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(text) as unknown;
}

function requireAdmin(request: Request, env: Env) {
  if (env.ENVIRONMENT !== "production") return true;
  return Boolean(request.headers.get("cf-access-authenticated-user-email"));
}

async function listCategories(env: Env) {
  const result = await env.DB.prepare("SELECT id, parent_id AS parentId, name, slug, description, image_key AS imageKey, sort_order AS sortOrder FROM categories WHERE is_active = 1 ORDER BY sort_order, name").all();
  return json({ data: result.results });
}

async function listProducts(request: Request, env: Env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const category = url.searchParams.get("category");
  const sort = url.searchParams.get("sort") ?? "default";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(24, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "24", 10) || 24));
  const where = ["p.status != 'HIDDEN'", "v.availability != 'HIDDEN'"];
  const values: Array<string | number> = [];
  if (q) { where.push("(p.name LIKE ? OR p.brand LIKE ? OR v.sku LIKE ?)"); values.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category) { where.push("c.slug = ?"); values.push(category); }
  const order = sort === "price_asc" ? "v.price_vnd ASC" : sort === "price_desc" ? "v.price_vnd DESC" : sort === "newest" ? "p.created_at DESC" : "p.sort_order, p.name";
  values.push(limit, (page - 1) * limit);
  const sql = `SELECT p.id, p.name, p.slug, p.brand, p.short_description AS shortDescription, p.description, p.status, p.featured, v.id AS variantId, v.name AS variantName, v.sku, v.price_vnd AS priceVnd, v.compare_at_price_vnd AS compareAtPriceVnd, v.availability, c.slug AS categorySlug FROM products p JOIN product_variants v ON v.product_id = p.id LEFT JOIN product_categories pc ON pc.product_id = p.id LEFT JOIN categories c ON c.id = pc.category_id WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`;
  const result = await env.DB.prepare(sql).bind(...values).all();
  return json({ data: result.results, pagination: { page, limit } });
}

async function getProduct(slug: string, env: Env) {
  const product = await env.DB.prepare("SELECT id, name, slug, brand, short_description AS shortDescription, description, status, featured FROM products WHERE slug = ? AND status != 'HIDDEN'").bind(slug).first<Record<string, unknown>>();
  if (!product) return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  const variants = await env.DB.prepare("SELECT id, name, sku, price_vnd AS priceVnd, compare_at_price_vnd AS compareAtPriceVnd, availability FROM product_variants WHERE product_id = ? AND availability != 'HIDDEN' ORDER BY sort_order").bind(product.id).all();
  const images = await env.DB.prepare("SELECT id, r2_key AS r2Key, alt_text AS altText, sort_order AS sortOrder FROM product_images WHERE product_id = ? ORDER BY sort_order").bind(product.id).all();
  return json({ data: { ...product, variants: variants.results, images: images.results } });
}

type VariantRow = { variantId: string; variantName: string; sku: string | null; priceVnd: number; availability: string; productId: string; productName: string; productStatus: string; imageKey: string | null };

async function loadPricedItems(body: ReturnType<typeof validateSubmission>, env: Env) {
  const placeholders = body.items.map(() => "?").join(",");
  const rows = await env.DB.prepare(`SELECT v.id AS variantId, v.name AS variantName, v.sku, v.price_vnd AS priceVnd, v.availability, p.id AS productId, p.name AS productName, p.status AS productStatus, (SELECT r2_key FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1) AS imageKey FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id IN (${placeholders})`).bind(...body.items.map((item) => item.variantId)).all<VariantRow>();
  const byId = new Map(rows.results.map((row) => [row.variantId, row]));
  const unavailable: string[] = [];
  const changed: Array<{ variantId: string; currentPrice: number }> = [];
  const pricedItems: PricedItem[] = body.items.map((item) => {
    const row = byId.get(item.variantId);
    if (!row) throw new Error("VARIANT_NOT_FOUND");
    if (row.availability !== "AVAILABLE" || row.productStatus !== "AVAILABLE") unavailable.push(item.variantId);
    if (item.displayedPrice !== undefined && item.displayedPrice !== row.priceVnd) changed.push({ variantId: item.variantId, currentPrice: row.priceVnd });
    return { productId: row.productId, variantId: row.variantId, productName: row.productName, variantName: row.variantName, sku: row.sku, imageKey: row.imageKey, priceVnd: row.priceVnd, quantity: item.quantity, lineTotalVnd: row.priceVnd * item.quantity };
  });
  return { pricedItems, unavailable, changed };
}

type RequestRow = { id: string; publicCode: string; itemLineCount: number; totalQuantity: number; subtotalVnd: number; createdAt: string; telegramStatus: string };

async function findSubmission(token: string, env: Env) {
  return env.DB.prepare("SELECT id, public_code AS publicCode, item_line_count AS itemLineCount, total_quantity AS totalQuantity, subtotal_vnd AS subtotalVnd, created_at AS createdAt, telegram_status AS telegramStatus FROM cart_requests WHERE submission_token = ?").bind(token).first<RequestRow>();
}

async function sendTelegram(env: Env, text: string) {
  // Wrangler không sinh type cho secret chưa được khai báo bằng `wrangler secret put`.
  // @ts-expect-error Secret được inject vào Env ở runtime production.
  const token: string | undefined = env.TELEGRAM_BOT_TOKEN;
  // @ts-expect-error Secret được inject vào Env ở runtime production.
  const chatId: string | undefined = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("Telegram chưa được cấu hình.");
  let messageId: string | null = null;
  for (const chunk of splitTelegramMessage(text)) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: chunk }) });
    const result = await response.json<{ ok?: boolean; result?: { message_id?: number }; description?: string }>();
    if (!response.ok || !result.ok) throw new Error(result.description ?? `Telegram HTTP ${response.status}`);
    if (result.result?.message_id) messageId = String(result.result.message_id);
  }
  return messageId;
}

async function submitCart(request: Request, env: Env) {
  let body: ReturnType<typeof validateSubmission>;
  try { body = validateSubmission(await readBoundedJson(request)); } catch (caught) {
    const code = caught instanceof Error && caught.message === "PAYLOAD_TOO_LARGE" ? "VALIDATION_ERROR" : caught instanceof Error ? caught.message : "VALIDATION_ERROR";
    return error(code, "Thông tin gửi chưa hợp lệ.", code === "VALIDATION_ERROR" ? 422 : 400);
  }
  const existing = await findSubmission(body.submissionToken, env);
  if (existing) return json({ success: true, cartRequest: { code: existing.publicCode, itemLineCount: existing.itemLineCount, totalQuantity: existing.totalQuantity, subtotalVnd: existing.subtotalVnd, createdAt: existing.createdAt }, telegramStatus: existing.telegramStatus });
  let loaded: Awaited<ReturnType<typeof loadPricedItems>>;
  try { loaded = await loadPricedItems(body, env); } catch { return error("VARIANT_NOT_FOUND", "Một phân loại sản phẩm không còn tồn tại.", 404); }
  if (loaded.unavailable.length) return error("ITEM_UNAVAILABLE", "Một số sản phẩm hiện không còn sẵn sàng.", 409, { variantIds: loaded.unavailable });
  const subtotalVnd = loaded.pricedItems.reduce((sum, item) => sum + item.lineTotalVnd, 0);
  const totalQuantity = loaded.pricedItems.reduce((sum, item) => sum + item.quantity, 0);
  if (loaded.changed.length && !body.acceptCurrentPrices) return error("PRICE_CHANGED", "Giá sản phẩm đã thay đổi. Vui lòng xác nhận giá mới.", 409, { items: loaded.changed, subtotalVnd });
  const id = crypto.randomUUID();
  const publicCode = generatePublicCode();
  const createdAt = new Date().toISOString();
  const statements = [env.DB.prepare("INSERT INTO cart_requests (id, public_code, submission_token, customer_name, customer_phone, customer_contact, customer_note, item_line_count, total_quantity, subtotal_vnd, status, telegram_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', 'PENDING', ?, ?)").bind(id, publicCode, body.submissionToken, body.customerName, body.customerPhone, body.customerContact || null, body.customerNote || null, loaded.pricedItems.length, totalQuantity, subtotalVnd, createdAt, createdAt)];
  loaded.pricedItems.forEach((item) => statements.push(env.DB.prepare("INSERT INTO cart_request_items (id, cart_request_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, image_key_snapshot, unit_price_vnd, quantity, line_total_vnd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, item.productId, item.variantId, item.productName, item.variantName, item.sku, item.imageKey, item.priceVnd, item.quantity, item.lineTotalVnd, createdAt)));
  try { await env.DB.batch(statements); } catch (caught) {
    const duplicate = await findSubmission(body.submissionToken, env);
    if (duplicate) return json({ success: true, cartRequest: { code: duplicate.publicCode, itemLineCount: duplicate.itemLineCount, totalQuantity: duplicate.totalQuantity, subtotalVnd: duplicate.subtotalVnd, createdAt: duplicate.createdAt }, telegramStatus: duplicate.telegramStatus });
    console.error(JSON.stringify({ message: "cart request database failure", error: caught instanceof Error ? caught.message : String(caught) }));
    return error("SUBMISSION_FAILED", "Chưa thể lưu giỏ hàng. Vui lòng thử lại.", 500);
  }
  let telegramStatus = "SENT";
  try {
    const messageId = await sendTelegram(env, composeTelegramMessage({ code: publicCode, createdAt, customerName: body.customerName, customerPhone: body.customerPhone, customerContact: body.customerContact, customerNote: body.customerNote, items: loaded.pricedItems, totalQuantity, subtotalVnd }));
    await env.DB.prepare("UPDATE cart_requests SET telegram_status = 'SENT', telegram_message_id = ?, telegram_last_error = NULL, updated_at = ? WHERE id = ?").bind(messageId, new Date().toISOString(), id).run();
  } catch (caught) {
    telegramStatus = "FAILED";
    const message = caught instanceof Error ? caught.message.slice(0, 500) : "Telegram error";
    await env.DB.prepare("UPDATE cart_requests SET telegram_status = 'FAILED', telegram_last_error = ?, updated_at = ? WHERE id = ?").bind(message, new Date().toISOString(), id).run();
    console.error(JSON.stringify({ message: "telegram notification failed", cartRequestId: id, error: message }));
  }
  return json({ success: true, cartRequest: { code: publicCode, itemLineCount: loaded.pricedItems.length, totalQuantity, subtotalVnd, createdAt }, telegramStatus }, 201);
}

async function getAdminRequests(env: Env) {
  const result = await env.DB.prepare("SELECT id, public_code AS publicCode, customer_name AS customerName, customer_phone AS customerPhone, item_line_count AS itemLineCount, total_quantity AS totalQuantity, subtotal_vnd AS subtotalVnd, status, telegram_status AS telegramStatus, created_at AS createdAt FROM cart_requests ORDER BY created_at DESC LIMIT 100").all();
  return json({ data: result.results });
}

async function getAdminRequest(id: string, env: Env) {
  const cartRequest = await env.DB.prepare("SELECT * FROM cart_requests WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!cartRequest) return error("PRODUCT_NOT_FOUND", "Không tìm thấy giỏ hàng.", 404);
  const items = await env.DB.prepare("SELECT * FROM cart_request_items WHERE cart_request_id = ? ORDER BY created_at").bind(id).all();
  return json({ data: { ...cartRequest, items: items.results } });
}

async function updateRequestStatus(request: Request, id: string, env: Env) {
  const body = await readBoundedJson(request) as { status?: string };
  const allowed = ["SUBMITTED", "CONTACTED", "CONFIRMED", "COMPLETED", "CANCELLED"];
  if (!body.status || !allowed.includes(body.status)) return error("VALIDATION_ERROR", "Trạng thái không hợp lệ.", 422);
  await env.DB.prepare("UPDATE cart_requests SET status = ?, updated_at = ? WHERE id = ?").bind(body.status, new Date().toISOString(), id).run();
  return json({ success: true, status: body.status });
}

async function retryTelegram(id: string, env: Env) {
  const row = await env.DB.prepare("SELECT public_code AS code, customer_name AS customerName, customer_phone AS customerPhone, customer_contact AS customerContact, customer_note AS customerNote, total_quantity AS totalQuantity, subtotal_vnd AS subtotalVnd, created_at AS createdAt FROM cart_requests WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) return error("PRODUCT_NOT_FOUND", "Không tìm thấy giỏ hàng.", 404);
  const result = await env.DB.prepare("SELECT product_id AS productId, variant_id AS variantId, product_name_snapshot AS productName, variant_name_snapshot AS variantName, sku_snapshot AS sku, image_key_snapshot AS imageKey, unit_price_vnd AS priceVnd, quantity, line_total_vnd AS lineTotalVnd FROM cart_request_items WHERE cart_request_id = ?").bind(id).all<PricedItem>();
  try {
    const messageId = await sendTelegram(env, composeTelegramMessage({ code: String(row.code), createdAt: String(row.createdAt), customerName: String(row.customerName), customerPhone: String(row.customerPhone), customerContact: row.customerContact ? String(row.customerContact) : undefined, customerNote: row.customerNote ? String(row.customerNote) : undefined, items: result.results, totalQuantity: Number(row.totalQuantity), subtotalVnd: Number(row.subtotalVnd) }));
    await env.DB.prepare("UPDATE cart_requests SET telegram_status = 'SENT', telegram_message_id = ?, telegram_last_error = NULL, telegram_retry_count = telegram_retry_count + 1, updated_at = ? WHERE id = ?").bind(messageId, new Date().toISOString(), id).run();
    return json({ success: true, telegramStatus: "SENT" });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message.slice(0, 500) : "Telegram error";
    await env.DB.prepare("UPDATE cart_requests SET telegram_status = 'FAILED', telegram_last_error = ?, telegram_retry_count = telegram_retry_count + 1, updated_at = ? WHERE id = ?").bind(message, new Date().toISOString(), id).run();
    return error("TELEGRAM_FAILED", "Chưa thể gửi lại Telegram.", 502);
  }
}

async function uploadImage(request: Request, env: Env) {
  const contentType = request.headers.get("content-type")?.split(";")[0] ?? "";
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return error("IMAGE_UPLOAD_FAILED", "Định dạng ảnh không được hỗ trợ.", 415);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 5 * 1024 * 1024) return error("IMAGE_UPLOAD_FAILED", "Ảnh vượt quá 5MB.", 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 5 * 1024 * 1024) return error("IMAGE_UPLOAD_FAILED", "Ảnh vượt quá 5MB.", 413);
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const key = `products/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
  await env.PRODUCT_IMAGES.put(key, bytes, { httpMetadata: { contentType } });
  return json({ success: true, key }, 201);
}

type AdminProductInput = {
  name?: string; slug?: string; brand?: string; shortDescription?: string; description?: string;
  status?: string; featured?: boolean; sortOrder?: number; categoryId?: string;
  variants?: Array<{ id?: string; name?: string; sku?: string; priceVnd?: number; compareAtPriceVnd?: number | null; availability?: string; sortOrder?: number }>;
};

function normalizeSlug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function validateAdminProduct(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("VALIDATION_ERROR");
  const body = input as AdminProductInput;
  const name = body.name?.trim() ?? "";
  const slug = normalizeSlug(body.slug?.trim() || name);
  const statuses = ["AVAILABLE", "OUT_OF_STOCK", "HIDDEN"];
  if (!name || name.length > 180 || !slug || !statuses.includes(body.status ?? "AVAILABLE") || !Array.isArray(body.variants) || !body.variants.length) throw new Error("VALIDATION_ERROR");
  const variants = body.variants.map((variant, index) => {
    const variantName = variant.name?.trim() ?? "";
    const priceVnd = Number(variant.priceVnd);
    const availability = variant.availability ?? "AVAILABLE";
    if (!variantName || !Number.isSafeInteger(priceVnd) || priceVnd < 0 || !statuses.includes(availability)) throw new Error("VALIDATION_ERROR");
    return { ...variant, name: variantName, priceVnd, availability, sortOrder: Number.isFinite(variant.sortOrder) ? Number(variant.sortOrder) : index };
  });
  return { ...body, name, slug, status: body.status ?? "AVAILABLE", featured: body.featured ? 1 : 0, sortOrder: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0, variants };
}

async function getAdminProduct(id: string, env: Env) {
  const product = await env.DB.prepare("SELECT id, name, slug, brand, short_description AS shortDescription, description, status, featured, sort_order AS sortOrder FROM products WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!product) return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  const variants = await env.DB.prepare("SELECT id, name, sku, price_vnd AS priceVnd, compare_at_price_vnd AS compareAtPriceVnd, availability, sort_order AS sortOrder FROM product_variants WHERE product_id = ? ORDER BY sort_order").bind(id).all();
  const categories = await env.DB.prepare("SELECT category_id AS id FROM product_categories WHERE product_id = ?").bind(id).all();
  const tags = await env.DB.prepare("SELECT tag_id AS id FROM product_tags WHERE product_id = ?").bind(id).all();
  const images = await env.DB.prepare("SELECT id, r2_key AS r2Key, alt_text AS altText, sort_order AS sortOrder FROM product_images WHERE product_id = ? ORDER BY sort_order").bind(id).all();
  return json({ data: { ...product, variants: variants.results, categoryIds: categories.results.map((item) => item.id), tagIds: tags.results.map((item) => item.id), images: images.results } });
}

async function saveAdminProduct(request: Request, env: Env, id?: string) {
  let body: ReturnType<typeof validateAdminProduct>;
  try { body = validateAdminProduct(await readBoundedJson(request)); } catch { return error("VALIDATION_ERROR", "Thông tin sản phẩm chưa hợp lệ.", 422); }
  const productId = id ?? crypto.randomUUID();
  if (id && !(await env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(id).first())) return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  const now = new Date().toISOString();
  const statements = id
    ? [env.DB.prepare("UPDATE products SET name = ?, slug = ?, brand = ?, short_description = ?, description = ?, status = ?, featured = ?, sort_order = ?, updated_at = ? WHERE id = ?").bind(body.name, body.slug, body.brand ?? null, body.shortDescription ?? "", body.description ?? "", body.status, body.featured, body.sortOrder, now, productId)]
    : [env.DB.prepare("INSERT INTO products (id, name, slug, brand, short_description, description, status, featured, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(productId, body.name, body.slug, body.brand ?? null, body.shortDescription ?? "", body.description ?? "", body.status, body.featured, body.sortOrder, now, now)];
  if (body.categoryId) {
    statements.push(env.DB.prepare("DELETE FROM product_categories WHERE product_id = ?").bind(productId));
    statements.push(env.DB.prepare("INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)").bind(productId, body.categoryId));
  }
  body.variants.forEach((variant) => {
    const variantId = variant.id ?? crypto.randomUUID();
    statements.push(env.DB.prepare("INSERT INTO product_variants (id, product_id, name, sku, price_vnd, compare_at_price_vnd, availability, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, sku = excluded.sku, price_vnd = excluded.price_vnd, compare_at_price_vnd = excluded.compare_at_price_vnd, availability = excluded.availability, sort_order = excluded.sort_order, updated_at = excluded.updated_at").bind(variantId, productId, variant.name, variant.sku?.trim() || null, variant.priceVnd, variant.compareAtPriceVnd ?? null, variant.availability, variant.sortOrder, now, now));
  });
  try { await env.DB.batch(statements); } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return error("VALIDATION_ERROR", message.includes("UNIQUE") ? "Slug hoặc SKU đã tồn tại." : "Chưa thể lưu sản phẩm.", 409);
  }
  return json({ success: true, id: productId, slug: body.slug }, id ? 200 : 201);
}

async function duplicateAdminProduct(id: string, env: Env) {
  const source = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!source) return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  const variants = await env.DB.prepare("SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order").bind(id).all<Record<string, unknown>>();
  const newId = crypto.randomUUID();
  const suffix = crypto.randomUUID().slice(0, 6);
  const now = new Date().toISOString();
  const statements = [env.DB.prepare("INSERT INTO products (id, name, slug, brand, short_description, description, status, featured, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'HIDDEN', 0, ?, ?, ?)").bind(newId, `${source.name} (Bản sao)`, `${source.slug}-copy-${suffix}`, source.brand, source.short_description, source.description, source.sort_order, now, now)];
  variants.results.forEach((variant) => statements.push(env.DB.prepare("INSERT INTO product_variants (id, product_id, name, sku, price_vnd, compare_at_price_vnd, availability, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'HIDDEN', ?, ?, ?)").bind(crypto.randomUUID(), newId, variant.name, variant.sku ? `${variant.sku}-COPY-${suffix}` : null, variant.price_vnd, variant.compare_at_price_vnd, variant.sort_order, now, now)));
  await env.DB.batch(statements);
  return json({ success: true, id: newId }, 201);
}

async function saveTaxonomy(request: Request, env: Env, kind: "categories" | "tags", id?: string) {
  const body = await readBoundedJson(request) as { name?: string; slug?: string; description?: string; groupType?: string; sortOrder?: number; isActive?: boolean };
  const name = body.name?.trim() ?? "";
  const slug = normalizeSlug(body.slug?.trim() || name);
  if (!name || !slug) return error("VALIDATION_ERROR", "Tên và slug không hợp lệ.", 422);
  const rowId = id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  if (kind === "categories") {
    await env.DB.prepare(id ? "UPDATE categories SET name = ?, slug = ?, description = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?" : "INSERT INTO categories (id, name, slug, description, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(...(id ? [name, slug, body.description ?? "", body.sortOrder ?? 0, body.isActive === false ? 0 : 1, now, rowId] : [rowId, name, slug, body.description ?? "", body.sortOrder ?? 0, body.isActive === false ? 0 : 1, now, now])).run();
  } else {
    await env.DB.prepare(id ? "UPDATE tags SET name = ?, slug = ?, group_type = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?" : "INSERT INTO tags (id, name, slug, group_type, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(...(id ? [name, slug, body.groupType ?? null, body.sortOrder ?? 0, body.isActive === false ? 0 : 1, now, rowId] : [rowId, name, slug, body.groupType ?? null, body.sortOrder ?? 0, body.isActive === false ? 0 : 1, now, now])).run();
  }
  return json({ success: true, id: rowId }, id ? 200 : 201);
}

async function deleteImage(id: string, env: Env) {
  const image = await env.DB.prepare("SELECT r2_key AS r2Key FROM product_images WHERE id = ?").bind(id).first<{ r2Key: string }>();
  if (!image) return error("PRODUCT_NOT_FOUND", "Không tìm thấy ảnh.", 404);
  await env.PRODUCT_IMAGES.delete(image.r2Key);
  await env.DB.prepare("DELETE FROM product_images WHERE id = ?").bind(id).run();
  return json({ success: true });
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/categories") return listCategories(env);
  if (request.method === "GET" && (path === "/api/products" || path === "/api/search")) return listProducts(request, env);
  if (request.method === "GET" && path.startsWith("/api/products/")) return getProduct(decodeURIComponent(path.slice(14)), env);
  if (request.method === "POST" && path === "/api/cart-requests") return submitCart(request, env);
  if (path.startsWith("/api/admin/") && !requireAdmin(request, env)) return error("UNAUTHORIZED", "Bạn chưa được Cloudflare Access xác thực.", 401);
  if (request.method === "GET" && path === "/api/admin/products") return listProducts(request, env);
  const productMatch = path.match(/^\/api\/admin\/products\/([^/]+)$/);
  const duplicateMatch = path.match(/^\/api\/admin\/products\/([^/]+)\/duplicate$/);
  if (request.method === "POST" && path === "/api/admin/products") return saveAdminProduct(request, env);
  if (request.method === "GET" && productMatch) return getAdminProduct(productMatch[1], env);
  if (request.method === "PUT" && productMatch) return saveAdminProduct(request, env, productMatch[1]);
  if (request.method === "POST" && duplicateMatch) return duplicateAdminProduct(duplicateMatch[1], env);
  if (request.method === "GET" && path === "/api/admin/categories") return listCategories(env);
  if (request.method === "GET" && path === "/api/admin/tags") { const result = await env.DB.prepare("SELECT * FROM tags ORDER BY sort_order, name").all(); return json({ data: result.results }); }
  const categoryMatch = path.match(/^\/api\/admin\/categories\/([^/]+)$/);
  const tagMatch = path.match(/^\/api\/admin\/tags\/([^/]+)$/);
  if (request.method === "POST" && path === "/api/admin/categories") return saveTaxonomy(request, env, "categories");
  if (request.method === "PUT" && categoryMatch) return saveTaxonomy(request, env, "categories", categoryMatch[1]);
  if (request.method === "POST" && path === "/api/admin/tags") return saveTaxonomy(request, env, "tags");
  if (request.method === "PUT" && tagMatch) return saveTaxonomy(request, env, "tags", tagMatch[1]);
  if (request.method === "GET" && path === "/api/admin/cart-requests") return getAdminRequests(env);
  const requestMatch = path.match(/^\/api\/admin\/cart-requests\/([^/]+)$/);
  if (request.method === "GET" && requestMatch) return getAdminRequest(requestMatch[1], env);
  const statusMatch = path.match(/^\/api\/admin\/cart-requests\/([^/]+)\/status$/);
  if (request.method === "PATCH" && statusMatch) return updateRequestStatus(request, statusMatch[1], env);
  const retryMatch = path.match(/^\/api\/admin\/cart-requests\/([^/]+)\/retry-telegram$/);
  if (request.method === "POST" && retryMatch) return retryTelegram(retryMatch[1], env);
  if (request.method === "POST" && path === "/api/admin/images") return uploadImage(request, env);
  const imageMatch = path.match(/^\/api\/admin\/images\/([^/]+)$/);
  if (request.method === "DELETE" && imageMatch) return deleteImage(imageMatch[1], env);
  return error("PRODUCT_NOT_FOUND", "Không tìm thấy API.", 404);
}

async function handleMedia(path: string, env: Env) {
  const object = await env.PRODUCT_IMAGES.get(decodeURIComponent(path.slice(7)));
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env);
      if (url.pathname.startsWith("/media/")) return await handleMedia(url.pathname, env);
      return await requestHandler(request);
    } catch (caught) {
      console.error(JSON.stringify({ message: "unexpected route error", path: url.pathname, error: caught instanceof Error ? caught.message : String(caught) }));
      if (url.pathname.startsWith("/api/")) return error("SUBMISSION_FAILED", "Đã có lỗi máy chủ. Vui lòng thử lại.", 500);
      return new Response("Đã có lỗi xảy ra.", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
