import { getPublicImageUrl } from "../shared/images";
import {
  derivePromotionState,
  parseStoredPromotion,
  promotionStatuses,
  promotionTypes,
  validatePromotionInput,
  type PromotionDefinition,
  type PromotionInput,
  type PromotionStatus,
  type PromotionType,
} from "../shared/promotions";

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

async function readBoundedJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (text.length > 64 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(text) as unknown;
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

function promotionSelect() {
  return `SELECT id, name, description, type, status, priority, stackable,
    starts_at AS startsAt, ends_at AS endsAt,
    usage_limit_total AS usageLimitTotal,
    usage_limit_per_customer AS usageLimitPerCustomer,
    usage_count_total AS usageCountTotal, config_json AS configJson,
    archived_at AS archivedAt, deleted_at AS deletedAt,
    created_at AS createdAt, updated_at AS updatedAt
    FROM promotions`;
}

function toDto(promotion: PromotionDefinition) {
  return {
    ...promotion,
    currentState: derivePromotionState(promotion),
  };
}

export async function getAdminPromotion(id: string, env: Env) {
  const row = await env.DB.prepare(`${promotionSelect()} WHERE id = ?`)
    .bind(id)
    .first<PromotionRow>();
  if (!row) return error("PROMOTION_NOT_FOUND", "Không tìm thấy chương trình khuyến mãi.", 404);
  const promotion = parseStoredPromotion(row);
  if (!promotion)
    return error("PROMOTION_INVALID", "Cấu hình chương trình khuyến mãi không hợp lệ.", 409);
  return json({ data: toDto(promotion) });
}

export async function listAdminPromotions(request: Request, env: Env) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const status = url.searchParams.get("status") ?? "ALL";
  const where: string[] = [];
  const values: Array<string | number> = [];
  if (query) {
    where.push("(name LIKE ? OR description LIKE ?)");
    values.push(`%${query}%`, `%${query}%`);
  }
  if (status !== "ALL" && promotionStatuses.includes(status as PromotionStatus)) {
    where.push("status = ?");
    values.push(status);
  }
  const result = await env.DB.prepare(
    `${promotionSelect()} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY CASE WHEN status = 'ARCHIVED' THEN 1 ELSE 0 END,
       priority DESC, created_at DESC, id DESC LIMIT 200`,
  )
    .bind(...values)
    .all<PromotionRow>();
  const data = result.results.map((row) => {
    const parsed = parseStoredPromotion(row);
    return parsed
      ? toDto(parsed)
      : {
          id: row.id,
          name: row.name,
          description: row.description,
          type: row.type,
          status: row.status,
          priority: row.priority,
          stackable: Boolean(row.stackable),
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          usageLimitTotal: row.usageLimitTotal,
          usageLimitPerCustomer: row.usageLimitPerCustomer,
          usageCountTotal: row.usageCountTotal,
          archivedAt: row.archivedAt,
          deletedAt: row.deletedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          currentState: row.status === "ARCHIVED" ? "ARCHIVED" : "INACTIVE",
          invalidConfig: true,
        };
  });
  return json({ data });
}

function targetIds(config: PromotionDefinition["config"]) {
  const products = new Set<string>();
  const categories = new Set<string>();
  if (config.type === "ORDER_GIFT") products.add(config.giftProductId);
  if (config.type === "BUY_X_GET_Y") {
    products.add(config.triggerProductId);
    products.add(config.rewardProductId);
  }
  if (config.type === "PRODUCT_DISCOUNT") config.productIds.forEach((id) => products.add(id));
  if (config.type === "CATEGORY_DISCOUNT") config.categoryIds.forEach((id) => categories.add(id));
  if (config.type === "QUANTITY_DISCOUNT") {
    config.productIds?.forEach((id) => products.add(id));
    config.categoryIds?.forEach((id) => categories.add(id));
  }
  if (config.type === "COMBO_DISCOUNT") config.items.forEach((item) => products.add(item.productId));
  return { products: [...products], categories: [...categories] };
}

async function validateTargetReferences(
  config: PromotionDefinition["config"],
  env: Env,
) {
  const ids = targetIds(config);
  if (ids.products.length) {
    const rows = await env.DB.prepare(
      `SELECT id FROM products WHERE id IN (${ids.products.map(() => "?").join(",")})`,
    )
      .bind(...ids.products)
      .all<{ id: string }>();
    const found = new Set(rows.results.map((row) => row.id));
    const missing = ids.products.filter((id) => !found.has(id));
    if (missing.length)
      return error(
        "INVALID_PRODUCT_REFERENCE",
        "Một sản phẩm được chọn không còn tồn tại.",
        422,
        { ids: missing },
      );
  }
  if (ids.categories.length) {
    const rows = await env.DB.prepare(
      `SELECT id FROM categories WHERE id IN (${ids.categories.map(() => "?").join(",")})`,
    )
      .bind(...ids.categories)
      .all<{ id: string }>();
    const found = new Set(rows.results.map((row) => row.id));
    const missing = ids.categories.filter((id) => !found.has(id));
    if (missing.length)
      return error(
        "INVALID_CATEGORY_REFERENCE",
        "Một danh mục được chọn không còn tồn tại.",
        422,
        { ids: missing },
      );
  }
  return null;
}

export async function saveAdminPromotion(request: Request, env: Env, id?: string) {
  let input: Omit<PromotionDefinition, "id" | "createdAt" | "updatedAt" | "usageCountTotal" | "archivedAt" | "deletedAt">;
  try {
    input = validatePromotionInput(await readBoundedJson(request));
  } catch (caught) {
    if (caught instanceof Error && "issue" in caught) {
      const issue = (caught as { issue: { code: string; field?: string; message: string } }).issue;
      return error(issue.code, issue.message, 422, issue);
    }
    return error("VALIDATION_ERROR", "Thông tin chương trình khuyến mãi chưa hợp lệ.", 422);
  }
  if (id) {
    const existing = await env.DB.prepare(
      "SELECT id, usage_count_total AS usageCountTotal FROM promotions WHERE id = ?",
    )
      .bind(id)
      .first<{ id: string; usageCountTotal: number }>();
    if (!existing)
      return error("PROMOTION_NOT_FOUND", "Không tìm thấy chương trình khuyến mãi.", 404);
    if (
      input.usageLimitTotal !== null &&
      existing.usageCountTotal > input.usageLimitTotal
    )
      return error(
        "USAGE_LIMIT_INVALID",
        "Giới hạn tổng không được nhỏ hơn số lượt đã sử dụng.",
        422,
      );
  }
  const referenceError = await validateTargetReferences(input.config, env);
  if (referenceError) return referenceError;
  const promotionId = id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const archivedAt = input.status === "ARCHIVED" ? now : null;
  try {
    const statement = id
      ? env.DB.prepare(
          `UPDATE promotions SET name = ?, description = ?, type = ?, status = ?,
            priority = ?, stackable = ?, starts_at = ?, ends_at = ?,
            usage_limit_total = ?, usage_limit_per_customer = ?, config_json = ?,
            archived_at = CASE WHEN ? = 'ARCHIVED' THEN COALESCE(archived_at, ?) ELSE NULL END,
            deleted_at = NULL, updated_at = ? WHERE id = ?`,
        ).bind(
          input.name,
          input.description,
          input.type,
          input.status,
          input.priority,
          input.stackable ? 1 : 0,
          input.startsAt,
          input.endsAt,
          input.usageLimitTotal,
          input.usageLimitPerCustomer,
          JSON.stringify(input.config),
          input.status,
          archivedAt,
          now,
          promotionId,
        )
      : env.DB.prepare(
          `INSERT INTO promotions (
            id, name, description, type, status, priority, stackable,
            starts_at, ends_at, usage_limit_total, usage_limit_per_customer,
            usage_count_total, config_json, archived_at, deleted_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)`,
        ).bind(
          promotionId,
          input.name,
          input.description,
          input.type,
          input.status,
          input.priority,
          input.stackable ? 1 : 0,
          input.startsAt,
          input.endsAt,
          input.usageLimitTotal,
          input.usageLimitPerCustomer,
          JSON.stringify(input.config),
          archivedAt,
          now,
          now,
        );
    const result = await statement.run();
    if (id && !result.meta.changes)
      return error("PROMOTION_NOT_FOUND", "Không tìm thấy chương trình khuyến mãi.", 404);
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "promotion_save_failed",
        promotionId,
        errorType: caught instanceof Error ? caught.name : "UNKNOWN",
      }),
    );
    return error("PROMOTION_SAVE_FAILED", "Chưa thể lưu chương trình khuyến mãi.", 409);
  }
  const saved = await env.DB.prepare(`${promotionSelect()} WHERE id = ?`)
    .bind(promotionId)
    .first<PromotionRow>();
  const promotion = saved ? parseStoredPromotion(saved) : null;
  return json(
    { success: true, id: promotionId, data: promotion ? toDto(promotion) : null },
    id ? 200 : 201,
  );
}

export async function duplicateAdminPromotion(id: string, env: Env) {
  const sourceResponse = await getAdminPromotion(id, env);
  if (!sourceResponse.ok) return sourceResponse;
  const sourceBody = (await sourceResponse.json()) as { data?: PromotionDefinition };
  const source = sourceBody.data;
  if (!source) return error("PROMOTION_NOT_FOUND", "Không tìm thấy chương trình khuyến mãi.", 404);
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO promotions (
      id, name, description, type, status, priority, stackable, starts_at, ends_at,
      usage_limit_total, usage_limit_per_customer, usage_count_total, config_json,
      archived_at, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?)`,
  )
    .bind(
      newId,
      `${source.name} - Copy`,
      source.description,
      source.type,
      source.priority,
      source.stackable ? 1 : 0,
      source.startsAt,
      source.endsAt,
      source.usageLimitTotal,
      source.usageLimitPerCustomer,
      JSON.stringify(source.config),
      now,
      now,
    )
    .run();
  return json({ success: true, id: newId }, 201);
}

export async function updateAdminPromotionStatus(request: Request, id: string, env: Env) {
  let body: { status?: unknown };
  try {
    const value = await readBoundedJson(request);
    if (!value || typeof value !== "object") throw new Error("VALIDATION_ERROR");
    body = value as { status?: unknown };
  } catch {
    return error("VALIDATION_ERROR", "Trạng thái promotion chưa hợp lệ.", 422);
  }
  if (
    typeof body.status !== "string" ||
    !promotionStatuses.includes(body.status as PromotionStatus)
  )
    return error("VALIDATION_ERROR", "Trạng thái promotion chưa hợp lệ.", 422);
  const existing = await env.DB.prepare("SELECT id FROM promotions WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return error("PROMOTION_NOT_FOUND", "Không tìm thấy chương trình khuyến mãi.", 404);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE promotions SET status = ?,
      archived_at = CASE WHEN ? = 'ARCHIVED' THEN COALESCE(archived_at, ?) ELSE NULL END,
      updated_at = ? WHERE id = ?`,
  )
    .bind(body.status, body.status, now, now, id)
    .run();
  if (!result.meta.changes) return error("PROMOTION_NOT_FOUND", "Không tìm thấy chương trình khuyến mãi.", 404);
  return json({ success: true, id, status: body.status });
}

export async function deleteAdminPromotion(id: string, env: Env) {
  const existing = await env.DB.prepare("SELECT id FROM promotions WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return error("PROMOTION_NOT_FOUND", "Không tìm thấy chương trình khuyến mãi.", 404);
  const usage = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM promotion_redemptions WHERE promotion_id = ?",
  )
    .bind(id)
    .first<{ count: number }>();
  if ((usage?.count ?? 0) > 0) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE promotions SET status = 'ARCHIVED', archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ?",
    )
      .bind(now, now, id)
      .run();
    return json({ success: true, id, archived: true, deleted: false });
  }
  await env.DB.prepare("DELETE FROM promotions WHERE id = ?").bind(id).run();
  return json({ success: true, id, archived: false, deleted: true });
}

type PromotionOptionProduct = {
  id: string;
  name: string;
  slug: string;
  status: string;
  imageUrl: string | null;
  priceVnd: number | null;
};

export async function listPromotionOptions(request: Request, env: Env) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const selectedIds = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const queryClause = query ? "p.name LIKE ? OR p.slug LIKE ?" : "1 = 1";
  const queryValues: string[] = query ? [`%${query}%`, `%${query}%`] : [];
  const selectedClause = selectedIds.length
    ? ` OR p.id IN (${selectedIds.map(() => "?").join(",")})`
    : "";
  const rows = await env.DB.prepare(
    `SELECT p.id, p.name, p.slug, p.status,
      (SELECT r2_key FROM product_images WHERE product_id = p.id ORDER BY sort_order, created_at, id LIMIT 1) AS imageKey,
      (SELECT MIN(price_vnd) FROM product_variants WHERE product_id = p.id) AS priceVnd
     FROM products p
     WHERE (${queryClause}${selectedClause})
     ORDER BY p.name, p.id LIMIT 100`,
  )
    .bind(...queryValues, ...selectedIds)
    .all<PromotionOptionProduct & { imageKey: string | null }>();
  const categories = await env.DB.prepare(
    `SELECT id, name, slug, is_active AS isActive
     FROM categories ORDER BY is_active DESC, sort_order, name LIMIT 200`,
  ).all<{ id: string; name: string; slug: string; isActive: number }>();
  return json({
    products: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      imageUrl: row.imageKey ? getPublicImageUrl(row.imageKey) : null,
      priceVnd: row.priceVnd,
    })),
    categories: categories.results.map((row) => ({ ...row, isActive: Boolean(row.isActive) })),
  });
}

export function isPromotionType(value: unknown): value is PromotionType {
  return typeof value === "string" && promotionTypes.includes(value as PromotionType);
}

export type { PromotionInput };
