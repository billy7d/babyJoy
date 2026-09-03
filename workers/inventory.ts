import {
  DEFAULT_CHECKOUT_RESERVATION_MINUTES,
  MAX_CHECKOUT_RESERVATION_MINUTES,
  MIN_CHECKOUT_RESERVATION_MINUTES,
  reservationDurationMs,
} from "../shared/reservation";
import {
  MAX_CRON_CLEANUP_LIMIT,
  sanitizeCronErrorType,
  type CronCleanupMetrics,
} from "../shared/cron-health";

export {
  DEFAULT_CHECKOUT_RESERVATION_MINUTES,
  MAX_CHECKOUT_RESERVATION_MINUTES,
  MIN_CHECKOUT_RESERVATION_MINUTES,
} from "../shared/reservation";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
export const CHECKOUT_RESERVATION_SETTING_KEY = "checkout_reservation_minutes";

export const checkoutStates = [
  "LEGACY",
  "READY_TO_SEND",
  "WAITING_SELLER_CONFIRM",
  "CONFIRMED",
  "EXPIRED",
  "CANCELLED",
] as const;

export type CheckoutState = (typeof checkoutStates)[number];

export type ReservationLine = {
  variantId: string;
  quantity: number;
  trackInventory?: boolean | number;
};

export type ReservationGiftLine = ReservationLine & {
  promotionId: string;
};

export type CleanupExpiredReservationsResult = CronCleanupMetrics;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function failure(code: string, message: string, status: number, extra = {}) {
  return json({ success: false, error: { code, message, ...extra } }, status);
}

export function normalizeCheckoutReservationMinutes(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : Number.NaN;
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_CHECKOUT_RESERVATION_MINUTES ||
    parsed > MAX_CHECKOUT_RESERVATION_MINUTES
  )
    return null;
  return parsed;
}

export function validateCheckoutReservationMinutes(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return normalizeCheckoutReservationMinutes(value);
}

export async function getCheckoutReservationMinutes(env: Env) {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = ?",
    )
      .bind(CHECKOUT_RESERVATION_SETTING_KEY)
      .first<{ value: string }>();
    return (
      normalizeCheckoutReservationMinutes(row?.value) ??
      DEFAULT_CHECKOUT_RESERVATION_MINUTES
    );
  } catch {
    // Fallback để checkout vẫn hoạt động trong giai đoạn migration đang rollout.
    return DEFAULT_CHECKOUT_RESERVATION_MINUTES;
  }
}

export async function getCheckoutReservationConfig(env: Env) {
  const minutes = await getCheckoutReservationMinutes(env);
  return {
    minutes,
    reservationMinutes: minutes,
    durationMs: reservationDurationMs(minutes),
  };
}

export async function getAdminCheckoutSettings(env: Env) {
  return json({
    data: {
      checkoutReservationMinutes: await getCheckoutReservationMinutes(env),
    },
  });
}

async function readBoundedJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (text.length > 64 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(text) as unknown;
}

export async function saveAdminCheckoutSettings(request: Request, env: Env) {
  let value: unknown;
  try {
    value = await readBoundedJson(request);
  } catch {
    return failure("VALIDATION_ERROR", "Thời gian giữ hàng chưa hợp lệ.", 422);
  }
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).checkoutReservationMinutes
      : undefined;
  const next = validateCheckoutReservationMinutes(raw);
  if (next === null)
    return failure(
      "VALIDATION_ERROR",
      typeof raw === "number" && raw < MIN_CHECKOUT_RESERVATION_MINUTES
        ? "Thời gian giữ hàng tối thiểu là 3 phút."
        : typeof raw === "number" && raw > MAX_CHECKOUT_RESERVATION_MINUTES
          ? "Thời gian giữ hàng tối đa là 24 giờ."
          : "Thời gian giữ hàng phải là số phút hoặc số giờ hợp lệ.",
      422,
    );
  const previous = await getCheckoutReservationMinutes(env);
  const updatedAt = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .bind(CHECKOUT_RESERVATION_SETTING_KEY, String(next), updatedAt)
      .run();
  } catch {
    return failure("SETTINGS_SAVE_FAILED", "Chưa thể lưu thời gian giữ hàng.", 500);
  }
  console.info(
    JSON.stringify({
      event: "checkout_reservation_setting_changed",
      setting: CHECKOUT_RESERVATION_SETTING_KEY,
      oldValue: previous,
      newValue: next,
      at: updatedAt,
    }),
  );
  return getAdminCheckoutSettings(env);
}

async function inspectInventorySchema(env: Env) {
  try {
    const table = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'inventory_reservations'",
    ).first<{ name: string }>();
    if (!table?.name) return { available: false };
    const column = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('cart_requests') WHERE name = 'checkout_state'",
    ).first<{ name: string }>();
    return { available: Boolean(column?.name) };
  } catch (error) {
    return { available: false, error };
  }
}

export async function hasInventorySchema(env: Env) {
  return (await inspectInventorySchema(env)).available;
}

export async function hasVariantRetirementSchema(env: Env) {
  try {
    const column = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('product_variants') WHERE name = 'archived_at'",
    ).first<{ name: string }>();
    return Boolean(column?.name);
  } catch {
    // Giữ tương thích với DB chưa apply migration retire variant.
    return false;
  }
}

function isoNow(value: Date | string) {
  const timestamp = typeof value === "string" ? Date.parse(value) : value.getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function boundedCleanupLimit(limit: number) {
  const normalized = Number.isFinite(limit) ? Math.floor(limit) : MAX_CRON_CLEANUP_LIMIT;
  return Math.min(MAX_CRON_CLEANUP_LIMIT, Math.max(1, normalized));
}

function mapInventoryError(caught: unknown) {
  const message = caught instanceof Error ? caught.message : String(caught);
  if (message.includes("INSUFFICIENT_STOCK"))
    return failure(
      "INSUFFICIENT_STOCK",
      "Một số sản phẩm vừa hết hàng. Vui lòng kiểm tra lại giỏ hàng.",
      409,
    );
  if (message.includes("PROMOTION_USAGE_LIMIT"))
    return failure(
      "PROMOTION_USAGE_LIMIT",
      "Một chương trình khuyến mãi vừa hết lượt áp dụng. Vui lòng thử lại.",
      409,
    );
  if (message.includes("INVENTORY_NOT_TRACKED"))
    return failure(
      "INVENTORY_CONFLICT",
      "Sản phẩm vừa thay đổi trạng thái tồn kho. Vui lòng kiểm tra lại giỏ hàng.",
      409,
    );
  if (message.includes("INVENTORY_CONFLICT"))
    return failure(
      "INVENTORY_CONFLICT",
      "Tồn kho vừa thay đổi. Vui lòng kiểm tra lại giỏ hàng.",
      409,
    );
  if (message.includes("ORDER_EXPIRED"))
    return failure("ORDER_EXPIRED", "Đơn hàng đã hết thời gian giữ hàng.", 409);
  if (message.includes("INVALID_ORDER_TRANSITION"))
    return failure("INVALID_ORDER_TRANSITION", "Trạng thái đơn hàng không hợp lệ.", 409);
  return null;
}

export async function cleanupExpiredReservationsDetailed(
  env: Env,
  now = new Date(),
  limit = 100,
  options: { runId?: string } = {},
): Promise<CleanupExpiredReservationsResult> {
  const effectiveLimit = boundedCleanupLimit(limit);
  const schema = await inspectInventorySchema(env);
  if (schema.error && options.runId) throw schema.error;
  if (!schema.available)
    return {
      schemaAvailable: false,
      candidateCount: 0,
      releasedCount: 0,
      failedCount: 0,
      limit: effectiveLimit,
    };
  const timestamp = isoNow(now);
  const rows = await env.DB.prepare(
    `SELECT id FROM cart_requests
     WHERE checkout_state = 'WAITING_SELLER_CONFIRM'
       AND reservation_expires_at IS NOT NULL
       AND reservation_expires_at <= ?
     ORDER BY reservation_expires_at, id LIMIT ?`,
  )
    .bind(timestamp, effectiveLimit)
    .all<{ id: string }>();
  const candidates = rows.results ?? [];
  let released = 0;
  let failed = 0;
  for (const row of candidates) {
    try {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE inventory_reservations
           SET status = 'RELEASED', released_at = ?, release_reason = 'TTL_EXPIRED'
           WHERE cart_request_id = ? AND status = 'ACTIVE'`,
        ).bind(timestamp, row.id),
        env.DB.prepare(
          `UPDATE promotion_reservations
           SET status = 'RELEASED', released_at = ?, release_reason = 'TTL_EXPIRED'
           WHERE cart_request_id = ? AND status = 'ACTIVE'`,
        ).bind(timestamp, row.id),
        env.DB.prepare(
          `UPDATE cart_requests
           SET checkout_state = 'EXPIRED', status = 'CANCELLED', updated_at = ?
           WHERE id = ? AND checkout_state = 'WAITING_SELLER_CONFIRM'`,
        ).bind(timestamp, row.id),
      ]);
      released += 1;
    } catch (caught) {
      failed += 1;
      console.error(
        JSON.stringify({
          event: "inventory_expiry_failed",
          cartRequestId: row.id,
          ...(options.runId ? { runId: options.runId } : {}),
          errorType: sanitizeCronErrorType(caught),
        }),
      );
    }
  }
  return {
    schemaAvailable: true,
    candidateCount: candidates.length,
    releasedCount: released,
    failedCount: failed,
    limit: effectiveLimit,
  };
}

export async function cleanupExpiredReservations(
  env: Env,
  now = new Date(),
  limit = 100,
) {
  const result = await cleanupExpiredReservationsDetailed(env, now, limit);
  return result.releasedCount;
}

export function buildInventoryReservationStatements(
  prepare: (sql: string) => D1PreparedStatement,
  cartRequestId: string,
  createdAt: string,
  expiresAt: string,
  items: ReservationLine[],
  gifts: ReservationGiftLine[],
) {
  const grouped = new Map<string, { variantId: string; quantity: number; sourceType: string }>();
  const add = (item: ReservationLine, sourceType: string) => {
    if (!item.trackInventory || item.quantity < 1) return;
    const key = `${sourceType}:${item.variantId}`;
    const current = grouped.get(key);
    if (current) current.quantity += item.quantity;
    else grouped.set(key, { variantId: item.variantId, quantity: item.quantity, sourceType });
  };
  items.forEach((item) => add(item, "CART_ITEM"));
  gifts.forEach((gift) => add(gift, "PROMOTION_GIFT"));
  return [...grouped.values()].map((item) =>
    prepare(
      `INSERT INTO inventory_reservations (
        id, cart_request_id, variant_id, quantity, source_type, status,
        expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      cartRequestId,
      item.variantId,
      item.quantity,
      item.sourceType,
      expiresAt,
      createdAt,
    ),
  );
}

export function buildPromotionReservationStatements(
  prepare: (sql: string) => D1PreparedStatement,
  cartRequestId: string,
  createdAt: string,
  expiresAt: string,
  promotionIds: string[],
) {
  return [...new Set(promotionIds)].map((promotionId) =>
    prepare(
      `INSERT INTO promotion_reservations (
        id, cart_request_id, promotion_id, customer_key, status, expires_at, created_at
      ) VALUES (?, ?, ?, NULL, 'ACTIVE', ?, ?)`,
    ).bind(crypto.randomUUID(), cartRequestId, promotionId, expiresAt, createdAt),
  );
}

async function readCheckoutRequest(id: string, env: Env) {
  return env.DB.prepare(
    `SELECT id, checkout_state AS checkoutState,
      reservation_started_at AS reservationStartedAt,
      reservation_expires_at AS reservationExpiresAt,
      reservation_duration_minutes AS reservationDurationMinutes
     FROM cart_requests WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      checkoutState: CheckoutState;
      reservationStartedAt: string | null;
      reservationExpiresAt: string | null;
      reservationDurationMinutes: number | null;
    }>();
}

function transitionMessage(state: CheckoutState) {
  if (state === "EXPIRED") return failure("ORDER_EXPIRED", "Đơn hàng đã hết thời gian giữ hàng.", 409);
  if (state === "CANCELLED") return failure("ORDER_CANCELLED", "Đơn hàng đã bị hủy.", 409);
  if (state === "CONFIRMED") return failure("ORDER_ALREADY_CONFIRMED", "Đơn hàng đã được xác nhận.", 409);
  return failure("INVALID_ORDER_TRANSITION", "Trạng thái đơn hàng không hợp lệ.", 409);
}

export async function confirmInventoryOrder(id: string, env: Env) {
  if (!(await hasInventorySchema(env)))
    return failure("INVALID_ORDER_TRANSITION", "Đơn hàng này chưa dùng reservation inventory.", 409);
  await cleanupExpiredReservations(env);
  const current = await readCheckoutRequest(id, env);
  if (!current) return failure("ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.", 404);
  if (current.checkoutState === "CONFIRMED")
    return json({ success: true, id, checkoutState: "CONFIRMED", idempotent: true });
  if (current.checkoutState !== "WAITING_SELLER_CONFIRM")
    return transitionMessage(current.checkoutState);
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE cart_requests
         SET checkout_state = 'CONFIRMED', status = 'CONFIRMED',
             seller_confirmed_at = ?, updated_at = ?
         WHERE id = ? AND checkout_state = 'WAITING_SELLER_CONFIRM'`,
      ).bind(now, now, id),
      env.DB.prepare(
        `UPDATE inventory_reservations
         SET status = 'CONSUMED', consumed_at = ?
         WHERE cart_request_id = ? AND status = 'ACTIVE'
           AND EXISTS (
             SELECT 1 FROM cart_requests
             WHERE id = ? AND checkout_state = 'CONFIRMED'
               AND seller_confirmed_at = ?
           )`,
      ).bind(now, id, id, now),
      env.DB.prepare(
        `UPDATE promotion_reservations
         SET status = 'CONSUMED', consumed_at = ?
         WHERE cart_request_id = ? AND status = 'ACTIVE'
           AND EXISTS (
             SELECT 1 FROM cart_requests
             WHERE id = ? AND checkout_state = 'CONFIRMED'
               AND seller_confirmed_at = ?
           )`,
      ).bind(now, id, id, now),
    ]);
  } catch (caught) {
    return mapInventoryError(caught) ?? failure("CONFIRM_FAILED", "Chưa thể xác nhận đơn hàng.", 500);
  }
  const after = await readCheckoutRequest(id, env);
  if (after?.checkoutState === "CONFIRMED")
    return json({
      success: true,
      id,
      checkoutState: "CONFIRMED",
      sellerConfirmedAt: now,
    });
  if (after) return transitionMessage(after.checkoutState);
  return failure("ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.", 404);
}

export async function cancelInventoryOrder(id: string, env: Env) {
  if (!(await hasInventorySchema(env)))
    return failure("INVALID_ORDER_TRANSITION", "Đơn hàng này chưa dùng reservation inventory.", 409);
  await cleanupExpiredReservations(env);
  const current = await readCheckoutRequest(id, env);
  if (!current) return failure("ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.", 404);
  if (current.checkoutState === "CANCELLED")
    return json({ success: true, id, checkoutState: "CANCELLED", idempotent: true });
  if (current.checkoutState === "CONFIRMED")
    return failure("ORDER_ALREADY_CONFIRMED", "Đơn hàng đã được xác nhận.", 409);
  if (current.checkoutState !== "WAITING_SELLER_CONFIRM" && current.checkoutState !== "READY_TO_SEND")
    return transitionMessage(current.checkoutState);
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE inventory_reservations
         SET status = 'RELEASED', released_at = ?, release_reason = 'SELLER_CANCELLED'
         WHERE cart_request_id = ? AND status = 'ACTIVE'`,
      ).bind(now, id),
      env.DB.prepare(
        `UPDATE promotion_reservations
         SET status = 'RELEASED', released_at = ?, release_reason = 'SELLER_CANCELLED'
         WHERE cart_request_id = ? AND status = 'ACTIVE'`,
      ).bind(now, id),
      env.DB.prepare(
        `UPDATE cart_requests
         SET checkout_state = 'CANCELLED', status = 'CANCELLED', updated_at = ?
         WHERE id = ? AND checkout_state IN ('READY_TO_SEND', 'WAITING_SELLER_CONFIRM')`,
      ).bind(now, id),
    ]);
  } catch (caught) {
    return mapInventoryError(caught) ?? failure("CANCEL_FAILED", "Chưa thể hủy đơn hàng.", 500);
  }
  const after = await readCheckoutRequest(id, env);
  if (after?.checkoutState === "CANCELLED")
    return json({ success: true, id, checkoutState: "CANCELLED" });
  if (after) return transitionMessage(after.checkoutState);
  return failure("ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.", 404);
}

export async function listActiveReservations(id: string, env: Env) {
  if (!(await hasInventorySchema(env))) return [];
  const rows = await env.DB.prepare(
    `SELECT ir.id, ir.variant_id AS variantId, ir.quantity,
      ir.source_type AS sourceType, ir.status, ir.expires_at AS expiresAt,
      ir.created_at AS createdAt
     FROM inventory_reservations ir
     WHERE ir.cart_request_id = ? ORDER BY ir.created_at, ir.id`,
  )
    .bind(id)
    .all();
  return rows.results;
}

export async function listPromotionReservations(id: string, env: Env) {
  if (!(await hasInventorySchema(env))) return [];
  const rows = await env.DB.prepare(
    `SELECT id, promotion_id AS promotionId, status,
      expires_at AS expiresAt, created_at AS createdAt,
      consumed_at AS consumedAt, released_at AS releasedAt,
      release_reason AS releaseReason
     FROM promotion_reservations
     WHERE cart_request_id = ? ORDER BY created_at, id`,
  )
    .bind(id)
    .all();
  return rows.results;
}

export { mapInventoryError };
