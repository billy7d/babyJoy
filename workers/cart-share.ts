import { getPublicImageUrl, normalizeR2Key } from "../shared/images";
import { generatePublicCode, type PricedItem } from "./services";
import { consumeRateLimit, RateLimitError } from "./rate-limit";
import { STORE_BRAND } from "../shared/branding";
import {
  buildPromotionPersistenceStatements,
  evaluateAuthoritativeCart,
  hasPromotionSchema,
  loadPromotionHistory,
  PromotionCartError,
  type AuthoritativeCartEvaluation,
} from "./promotions";
import {
  buildInventoryReservationStatements,
  buildPromotionReservationStatements,
  cleanupExpiredReservations,
  getCheckoutReservationConfig,
  hasInventorySchema,
  mapInventoryError,
} from "./inventory";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const publicShareHeaders = {
  ...jsonHeaders,
  "x-robots-tag": "noindex, nofollow, noarchive",
  "referrer-policy": "no-referrer",
  "cache-control": "private, no-store",
};
const sellerSettingKeys = [
  "seller_display_name",
  "seller_contact_label",
  "seller_messenger_url",
  "seller_avatar_key",
] as const;

export type SellerContact = {
  displayName: string;
  label: string;
  messengerUrl: string;
  avatarKey: string | null;
  avatarUrl: string | null;
};

export type CartSharePrepareBody = {
  submissionToken: string;
  acceptCurrentPrices: boolean;
  items: Array<{ variantId: string; quantity: number; displayedPrice?: number }>;
};

export type CartShareActivateBody = CartSharePrepareBody;

type ShareRequestRow = {
  id: string;
  publicCode: string;
  submissionToken: string;
  itemLineCount: number;
  totalQuantity: number;
  subtotalVnd: number;
  createdAt: string;
  contactChannel: string;
  checkoutState?: string;
  reservationStartedAt?: string | null;
  reservationExpiresAt?: string | null;
  reservationDurationMinutes?: number | null;
};

type ShareLinkRow = {
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
};

type SnapshotRow = {
  variantId?: string | null;
  productName: string;
  variantName: string;
  imageKey: string | null;
  unitPriceVnd: number;
  quantity: number;
  lineTotalVnd: number;
};

function json(data: unknown, status = 200, headers = jsonHeaders) {
  return new Response(JSON.stringify(data), { status, headers });
}

function failure(code: string, message: string, status: number, extra = {}) {
  return json({ success: false, error: { code, message, ...extra } }, status);
}

function requiredString(value: unknown, max: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max) throw new Error("VALIDATION_ERROR");
  return normalized;
}

export function validateCartSharePrepare(value: unknown): CartSharePrepareBody {
  if (!value || typeof value !== "object") throw new Error("VALIDATION_ERROR");
  const body = value as Record<string, unknown>;
  const submissionToken = requiredString(body.submissionToken, 120);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50)
    throw new Error("VALIDATION_ERROR");
  const seen = new Set<string>();
  const items = body.items.map((item) => {
    if (!item || typeof item !== "object") throw new Error("VALIDATION_ERROR");
    const row = item as Record<string, unknown>;
    const variantId = requiredString(row.variantId, 120);
    if (seen.has(variantId)) throw new Error("VALIDATION_ERROR");
    seen.add(variantId);
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99)
      throw new Error("VALIDATION_ERROR");
    const displayedPrice =
      row.displayedPrice === undefined ? undefined : Number(row.displayedPrice);
    if (
      displayedPrice !== undefined &&
      (!Number.isInteger(displayedPrice) || displayedPrice < 0)
    )
      throw new Error("VALIDATION_ERROR");
    return { variantId, quantity, displayedPrice };
  });
  return {
    submissionToken,
    acceptCurrentPrices: body.acceptCurrentPrices === true,
    items,
  };
}

export function validateSellerMessengerUrl(value: unknown) {
  const input = requiredString(value, 500);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("SELLER_URL_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "m.me" ||
    !/^\/[A-Za-z0-9._-]+\/?$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error("SELLER_URL_INVALID");
  return `https://m.me/${url.pathname.split("/").filter(Boolean)[0]}`;
}

export function isDirectSellerShareEnabled(env: Env) {
  return env.DIRECT_SELLER_SHARE_ENABLED === "true";
}

function getCartShareSecret(env: Env) {
  return String(env.CART_SHARE_SECRET ?? "");
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function deriveShareToken(
  secret: string,
  cartRequestId: string,
  submissionToken: string,
) {
  if (!secret || secret.length < 32) throw new Error("CART_SHARE_SECRET_MISSING");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `babyjoy-share-v1:${cartRequestId}:${submissionToken}`,
    ),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function hashShareToken(rawToken: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawToken),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function formatVnd(value: number) {
  return `${new Intl.NumberFormat("vi-VN").format(value)} ₫`;
}

export function composeCartShareText(input: {
  code: string;
  items: Array<Pick<PricedItem, "productName" | "variantName" | "quantity" | "lineTotalVnd">>;
  subtotalVnd: number;
  url: string;
  promotionDiscountVnd?: number;
  finalTotalVnd?: number;
  promotions?: Array<{ promotionName: string; discountAmountVnd: number }>;
  gifts?: Array<Pick<PricedItem, "productName" | "variantName" | "quantity">>;
  reservationExpiresAt?: string | null;
}) {
  const maximumLines = Math.min(input.items.length, 8);
  const build = (count: number) => {
    const lines = [`🛒 GIỎ HÀNG ${STORE_BRAND}`, `Mã: ${input.code}`, ""];
    input.items.slice(0, count).forEach((item) => {
      lines.push(
        `• ${item.productName} — ${item.variantName} × ${item.quantity}`,
        `  ${formatVnd(item.lineTotalVnd)}`,
        "",
      );
    });
    if (input.items.length > count)
      lines.push(`+ ${input.items.length - count} sản phẩm khác`, "");
    if (input.gifts?.length) {
      input.gifts.forEach((gift) =>
        lines.push(
          `🎁 ${gift.productName} — ${gift.variantName} × ${gift.quantity}`,
          "  Quà tặng khuyến mãi · 0 ₫",
          "",
        ),
      );
    }
    if (input.promotions?.length) {
      input.promotions.forEach((promotion) => {
        if (promotion.discountAmountVnd > 0)
          lines.push(
            `Khuyến mãi ${promotion.promotionName}: -${formatVnd(promotion.discountAmountVnd)}`,
          );
      });
      lines.push("");
    }
    lines.push(
      `Tạm tính: ${formatVnd(input.subtotalVnd)}`,
      ...(input.promotionDiscountVnd
        ? [`Khuyến mãi: -${formatVnd(input.promotionDiscountVnd)}`]
        : []),
      ...(input.finalTotalVnd !== undefined
        ? [`Tổng thanh toán: ${formatVnd(input.finalTotalVnd)}`]
        : []),
      ...(input.reservationExpiresAt
        ? [`Hàng và ưu đãi được giữ đến ${new Date(input.reservationExpiresAt).toLocaleString("vi-VN")}.`]
        : []),
      "",
      "Xem chi tiết:",
      input.url,
      "",
      "Nhờ shop kiểm tra giúp mình ạ.",
    );
    return lines.join("\n");
  };
  for (let count = maximumLines; count >= 1; count -= 1) {
    const message = build(count);
    if (message.length <= 1500 || count === 1) return message;
  }
  return build(1);
}

async function readBoundedJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64 * 1024) throw new Error("VALIDATION_ERROR");
  const text = await request.text();
  if (text.length > 64 * 1024) throw new Error("VALIDATION_ERROR");
  return JSON.parse(text) as unknown;
}

async function readSellerContact(env: Env): Promise<SellerContact | null> {
  const result = await env.DB.prepare(
    "SELECT key, value FROM app_settings WHERE key IN (?, ?, ?, ?)",
  )
    .bind(...sellerSettingKeys)
    .all<{ key: string; value: string }>();
  const values = new Map(result.results.map((row) => [row.key, row.value]));
  const displayName = values.get("seller_display_name")?.trim() ?? "";
  const label = values.get("seller_contact_label")?.trim() ?? "";
  const rawUrl = values.get("seller_messenger_url")?.trim() ?? "";
  if (!displayName || !label || !rawUrl) return null;
  let messengerUrl: string;
  try {
    messengerUrl = validateSellerMessengerUrl(rawUrl);
  } catch {
    return null;
  }
  const avatarKey = values.get("seller_avatar_key")?.trim() || null;
  return {
    displayName,
    label,
    messengerUrl,
    avatarKey,
    avatarUrl: avatarKey ? getPublicImageUrl(avatarKey) : null,
  };
}

export async function checkoutConfigResponse(env: Env) {
  const seller = await readSellerContact(env);
  const reservation = await getCheckoutReservationConfig(env);
  return json({
    mode: "DIRECT_SELLER_SHARE",
    enabled: isDirectSellerShareEnabled(env) && Boolean(seller),
    seller,
    reservationMinutes: reservation.reservationMinutes,
    webShareAvailableServerHint: true,
    // Trường legacy giữ storefront cũ hoạt động khi flag cutover còn tắt.
    messengerCheckoutEnabled:
      !isDirectSellerShareEnabled(env) &&
      env.MESSENGER_CHECKOUT_ENABLED.trim().toLowerCase() === "true",
  });
}

async function findShareRequest(submissionToken: string, env: Env) {
  const inventorySchema = await hasInventorySchema(env);
  return env.DB.prepare(
    `SELECT id, public_code AS publicCode, submission_token AS submissionToken,
      item_line_count AS itemLineCount, total_quantity AS totalQuantity,
      subtotal_vnd AS subtotalVnd, created_at AS createdAt,
      contact_channel AS contactChannel${inventorySchema
        ? ", checkout_state AS checkoutState, reservation_started_at AS reservationStartedAt, reservation_expires_at AS reservationExpiresAt, reservation_duration_minutes AS reservationDurationMinutes"
        : ", 'LEGACY' AS checkoutState, NULL AS reservationStartedAt, NULL AS reservationExpiresAt, NULL AS reservationDurationMinutes"}
     FROM cart_requests WHERE submission_token = ?`,
  )
    .bind(submissionToken)
    .first<ShareRequestRow>();
}

async function loadLink(cartRequestId: string, env: Env) {
  return env.DB.prepare(
    "SELECT token_hash AS tokenHash, expires_at AS expiresAt, revoked_at AS revokedAt FROM cart_share_links WHERE cart_request_id = ?",
  )
    .bind(cartRequestId)
    .first<ShareLinkRow>();
}

async function loadSnapshots(cartRequestId: string, env: Env) {
  const rows = await env.DB.prepare(
    `SELECT variant_id AS variantId, product_name_snapshot AS productName,
      variant_name_snapshot AS variantName, image_key_snapshot AS imageKey,
      unit_price_vnd AS unitPriceVnd, quantity, line_total_vnd AS lineTotalVnd
     FROM cart_request_items WHERE cart_request_id = ? ORDER BY created_at, id`,
  )
    .bind(cartRequestId)
    .all<SnapshotRow>();
  return rows.results;
}

async function buildPreparedResponse(
  row: ShareRequestRow,
  link: ShareLinkRow,
  rawToken: string,
  seller: SellerContact,
  env: Env,
  serverNow = new Date().toISOString(),
) {
  const expectedHash = await hashShareToken(rawToken);
  if (expectedHash !== link.tokenHash || link.revokedAt)
    throw new Error("SHARE_LINK_RECOVERY_FAILED");
  const items = await loadSnapshots(row.id, env);
  const schema = await hasPromotionSchema(env);
  const history = await loadPromotionHistory(row.id, env);
  const promotionDiscountVnd = schema ? history.discountAmountVnd : 0;
  const finalTotalVnd = schema ? history.finalTotalVnd : row.subtotalVnd;
  const url = `https://metraphuong.com/c/${rawToken}`;
  const text = composeCartShareText({
    code: row.publicCode,
    items: items.map((item) => ({
      productName: item.productName,
      variantName: item.variantName,
      quantity: item.quantity,
      lineTotalVnd: item.lineTotalVnd,
    })),
    subtotalVnd: row.subtotalVnd,
    url,
    promotionDiscountVnd,
    finalTotalVnd,
    promotions: history.promotions.map((promotion) => ({
      promotionName: promotion.promotionName,
      discountAmountVnd: promotion.discountAmountVnd,
    })),
    gifts: history.gifts,
    reservationExpiresAt: row.reservationExpiresAt,
  });
  return {
    success: true,
    cartRequest: {
      code: row.publicCode,
      itemLineCount: row.itemLineCount,
      totalQuantity: row.totalQuantity,
      subtotalVnd: row.subtotalVnd,
      promotionDiscountVnd,
      finalTotalVnd,
      createdAt: row.createdAt,
      checkoutState: row.checkoutState ?? "LEGACY",
      reservationStartedAt: row.reservationStartedAt ?? null,
      reservationExpiresAt: row.reservationExpiresAt ?? null,
      reservationDurationMinutes: row.reservationDurationMinutes ?? null,
    },
    share: {
      title: `Giỏ hàng ${STORE_BRAND} ${row.publicCode}`,
      text,
      url,
      copyText: text,
      expiresAt: link.expiresAt,
      promotions: history.promotions.map(({ configSnapshot: _configSnapshot, ...promotion }) => promotion),
      gifts: history.gifts,
    },
    seller,
    serverNow,
  };
}

export const validateCartShareActivate = validateCartSharePrepare;

export async function prepareCartShare(request: Request, env: Env) {
  const startedAt = Date.now();
  console.info(JSON.stringify({ event: "cart_share_prepare_started" }));
  if (!isDirectSellerShareEnabled(env))
    return failure("FEATURE_DISABLED", "Tính năng chốt giỏ hàng chưa được bật.", 404);
  try {
    await consumeRateLimit(env, request, "cart-share-prepare", 10);
  } catch (caught) {
    if (caught instanceof RateLimitError)
      return failure(caught.code, caught.message, caught.status);
    throw caught;
  }
  const seller = await readSellerContact(env);
  if (!seller)
    return failure("SELLER_NOT_CONFIGURED", "Người bán chưa được cấu hình.", 503);
  let body: CartSharePrepareBody;
  try {
    body = validateCartSharePrepare(await readBoundedJson(request));
  } catch {
    return failure("VALIDATION_ERROR", "Thông tin giỏ hàng chưa hợp lệ.", 422);
  }
  const secret = getCartShareSecret(env);
  if (!secret || secret.length < 32)
    return failure("CART_SHARE_NOT_CONFIGURED", "Chia sẻ giỏ hàng chưa được cấu hình.", 503);
  const inventorySchema = await hasInventorySchema(env);
  await cleanupExpiredReservations(env);

  const existing = await findShareRequest(body.submissionToken, env);
  if (existing) {
    if (existing.contactChannel !== "SHARE")
      return failure("SUBMISSION_CONFLICT", "Mã gửi đã được sử dụng.", 409);
    const link = await loadLink(existing.id, env);
    if (!link)
      return failure("SHARE_LINK_MISSING", "Chưa thể khôi phục liên kết giỏ hàng.", 500);
    const rawToken = await deriveShareToken(secret, existing.id, body.submissionToken);
    try {
      return json(await buildPreparedResponse(existing, link, rawToken, seller, env));
    } catch {
      return failure("SHARE_LINK_RECOVERY_FAILED", "Chưa thể khôi phục liên kết giỏ hàng.", 500);
    }
  }

  let loaded: AuthoritativeCartEvaluation;
  try {
    loaded = await evaluateAuthoritativeCart(body.items, env);
  } catch (caught) {
    if (caught instanceof PromotionCartError)
      return failure(caught.code, caught.message, caught.status, {
        variantIds: caught.variantIds,
      });
    throw caught;
  }
  if (loaded.unavailable.length)
    return failure(
      "VARIANT_UNAVAILABLE",
      "Một số sản phẩm hiện không còn sẵn sàng.",
      409,
      { variantIds: loaded.unavailable },
    );
  const subtotalVnd = loaded.evaluation.subtotalVnd;
  const totalQuantity = loaded.evaluation.totalQuantity;
  if (loaded.changed.length && !body.acceptCurrentPrices)
    return failure(
      "PRICE_CHANGED",
      "Giá của một số sản phẩm vừa thay đổi.",
      409,
      { items: loaded.changed, subtotalVnd },
    );

  const id = crypto.randomUUID();
  const publicCode = generatePublicCode();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const rawToken = await deriveShareToken(secret, id, body.submissionToken);
  const tokenHash = await hashShareToken(rawToken);
  const promotionStatements = buildPromotionPersistenceStatements(
    (sql) => env.DB.prepare(sql),
    id,
    createdAt,
    loaded,
    { consumeUsage: !inventorySchema },
  );
  const itemLineCount = loaded.pricedItems.length + loaded.evaluation.gifts.length;
  const statements: D1PreparedStatement[] = [
    ...promotionStatements.usage,
    inventorySchema
      ? env.DB.prepare(
          `INSERT INTO cart_requests (
            id, public_code, submission_token, customer_name, customer_phone,
            item_line_count, total_quantity, subtotal_vnd, promotion_discount_vnd,
            final_total_vnd, status, telegram_status, contact_channel,
            messenger_delivery_status, checkout_state, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 'SUBMITTED',
            'NOT_APPLICABLE', 'SHARE', 'NOT_APPLICABLE', 'READY_TO_SEND', ?, ?)`,
        ).bind(
          id,
          publicCode,
          body.submissionToken,
          itemLineCount,
          totalQuantity,
          subtotalVnd,
          loaded.evaluation.discountTotalVnd,
          loaded.evaluation.finalTotalVnd,
          createdAt,
          createdAt,
        )
      : loaded.promotionSchema
        ? env.DB.prepare(
            `INSERT INTO cart_requests (
              id, public_code, submission_token, customer_name, customer_phone,
              item_line_count, total_quantity, subtotal_vnd, promotion_discount_vnd,
              final_total_vnd, status, telegram_status, contact_channel,
              messenger_delivery_status, created_at, updated_at
            ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 'SUBMITTED',
              'NOT_APPLICABLE', 'SHARE', 'NOT_APPLICABLE', ?, ?)` ,
          ).bind(
            id,
            publicCode,
            body.submissionToken,
            itemLineCount,
            totalQuantity,
            subtotalVnd,
            loaded.evaluation.discountTotalVnd,
            loaded.evaluation.finalTotalVnd,
            createdAt,
            createdAt,
          )
        : env.DB.prepare(
          `INSERT INTO cart_requests (
            id, public_code, submission_token, customer_name, customer_phone,
            item_line_count, total_quantity, subtotal_vnd, status,
            telegram_status, contact_channel, messenger_delivery_status,
            created_at, updated_at
          ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, 'SUBMITTED',
            'NOT_APPLICABLE', 'SHARE', 'NOT_APPLICABLE', ?, ?)`,
        ).bind(
          id,
          publicCode,
          body.submissionToken,
          itemLineCount,
          totalQuantity,
          subtotalVnd,
          createdAt,
          createdAt,
        ),
  ];
  loaded.pricedItems.forEach((item) => {
    statements.push(
      env.DB.prepare(
        `INSERT INTO cart_request_items (
          id, cart_request_id, product_id, variant_id, product_name_snapshot,
          variant_name_snapshot, sku_snapshot, image_key_snapshot,
          unit_price_vnd, quantity, line_total_vnd, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        id,
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
  statements.push(
    ...promotionStatements.snapshots,
    ...promotionStatements.gifts,
    ...promotionStatements.redemptions,
  );
  statements.push(
    env.DB.prepare(
      "INSERT INTO cart_share_links (id, cart_request_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), id, tokenHash, expiresAt, createdAt),
  );
  try {
    await env.DB.batch(statements);
  } catch (caught) {
    const duplicate = await findShareRequest(body.submissionToken, env);
    if (duplicate?.contactChannel === "SHARE") {
      const link = await loadLink(duplicate.id, env);
      if (link) {
        const duplicateToken = await deriveShareToken(
          secret,
          duplicate.id,
          body.submissionToken,
        );
        return json(
          await buildPreparedResponse(duplicate, link, duplicateToken, seller, env),
        );
      }
    }
    if (caught instanceof Error && caught.message.includes("PROMOTION_USAGE_LIMIT"))
      return failure(
        "PROMOTION_USAGE_LIMIT",
        "Một chương trình khuyến mãi vừa hết lượt áp dụng. Vui lòng thử lại.",
        409,
      );
    console.error(
      JSON.stringify({
        event: "cart_share_prepare_failed",
        errorType: caught instanceof Error ? caught.name : "UNKNOWN",
        durationMs: Date.now() - startedAt,
      }),
    );
    return failure("PREPARE_FAILED", "Chưa thể chốt giỏ hàng. Vui lòng thử lại.", 500);
  }
  const row: ShareRequestRow = {
    id,
    publicCode,
    submissionToken: body.submissionToken,
    itemLineCount,
    totalQuantity,
    subtotalVnd,
    createdAt,
    contactChannel: "SHARE",
    checkoutState: inventorySchema ? "READY_TO_SEND" : "LEGACY",
    reservationStartedAt: null,
    reservationExpiresAt: null,
    reservationDurationMinutes: null,
  };
  console.info(
    JSON.stringify({
      event: "cart_share_prepare_success",
      cartRequestId: id,
      publicCode,
      itemCount: loaded.pricedItems.length,
      durationMs: Date.now() - startedAt,
    }),
  );
  return json(
    await buildPreparedResponse(
      row,
      { tokenHash, expiresAt, revokedAt: null },
      rawToken,
      seller,
      env,
    ),
    201,
  );
}

function sameCartItems(
  snapshots: SnapshotRow[],
  items: CartShareActivateBody["items"],
) {
  const current = new Map(
    items.map((item) => [item.variantId, item.quantity]),
  );
  if (snapshots.length !== current.size) return false;
  return snapshots.every(
    (snapshot) =>
      snapshot.variantId && current.get(snapshot.variantId) === snapshot.quantity,
  );
}

function promotionEvaluationChanged(
  history: Awaited<ReturnType<typeof loadPromotionHistory>>,
  loaded: AuthoritativeCartEvaluation,
) {
  const currentPromotions = loaded.evaluation.appliedPromotions
    .map((promotion) => `${promotion.promotionId}:${promotion.discountAmountVnd}`)
    .sort();
  const previousPromotions = history.promotions
    .map((promotion) => `${promotion.promotionId ?? ""}:${promotion.discountAmountVnd}`)
    .sort();
  if (currentPromotions.join("|") !== previousPromotions.join("|")) return true;
  if (history.discountAmountVnd !== loaded.evaluation.discountTotalVnd) return true;
  const currentGifts = loaded.evaluation.gifts
    .map((gift) => `${gift.promotionId}:${gift.productId}:${gift.variantId}:${gift.quantity}`)
    .sort();
  const previousGifts = history.gifts
    .map((gift) => `${gift.promotionId ?? ""}:${gift.productId}:${gift.variantId}:${gift.quantity}`)
    .sort();
  return currentGifts.join("|") !== previousGifts.join("|");
}

export async function activateCartShare(request: Request, env: Env) {
  const startedAt = Date.now();
  if (!isDirectSellerShareEnabled(env))
    return failure("FEATURE_DISABLED", "Tính năng gửi giỏ hàng chưa được bật.", 404);
  if (!(await hasInventorySchema(env)))
    return failure("FEATURE_NOT_READY", "Reservation inventory chưa được cài đặt.", 503);
  try {
    await consumeRateLimit(env, request, "cart-share-activate", 10);
  } catch (caught) {
    if (caught instanceof RateLimitError)
      return failure(caught.code, caught.message, caught.status);
    throw caught;
  }
  const seller = await readSellerContact(env);
  if (!seller)
    return failure("SELLER_NOT_CONFIGURED", "Người bán chưa được cấu hình.", 503);
  let body: CartShareActivateBody;
  try {
    body = validateCartShareActivate(await readBoundedJson(request));
  } catch {
    return failure("VALIDATION_ERROR", "Thông tin giỏ hàng chưa hợp lệ.", 422);
  }
  const secret = getCartShareSecret(env);
  if (!secret || secret.length < 32)
    return failure("CART_SHARE_NOT_CONFIGURED", "Chia sẻ giỏ hàng chưa được cấu hình.", 503);

  await cleanupExpiredReservations(env);
  const existing = await findShareRequest(body.submissionToken, env);
  if (!existing)
    return failure("ORDER_NOT_FOUND", "Không tìm thấy giỏ hàng đã chốt.", 404);
  if (existing.contactChannel !== "SHARE")
    return failure("SUBMISSION_CONFLICT", "Mã gửi đã được sử dụng.", 409);
  const link = await loadLink(existing.id, env);
  if (!link || link.revokedAt)
    return failure("SHARE_LINK_MISSING", "Chưa thể khôi phục liên kết giỏ hàng.", 500);
  if (existing.checkoutState === "WAITING_SELLER_CONFIRM") {
    const rawToken = await deriveShareToken(secret, existing.id, body.submissionToken);
    return json(await buildPreparedResponse(existing, link, rawToken, seller, env));
  }
  if (existing.checkoutState === "CONFIRMED")
    return failure("ORDER_ALREADY_CONFIRMED", "Đơn hàng đã được xác nhận.", 409);
  const retryAfterExpiry = existing.checkoutState === "EXPIRED";
  if (existing.checkoutState === "CANCELLED")
    return failure("ORDER_CANCELLED", "Đơn hàng đã bị hủy. Vui lòng chốt lại giỏ hàng.", 409);
  if (existing.checkoutState !== "READY_TO_SEND" && !retryAfterExpiry)
    return failure("INVALID_ORDER_TRANSITION", "Giỏ hàng chưa sẵn sàng để gửi.", 409);

  const snapshots = await loadSnapshots(existing.id, env);
  if (!sameCartItems(snapshots, body.items))
    return failure(
      "INVENTORY_CONFLICT",
      "Giỏ hàng đã thay đổi. Vui lòng quay lại chốt lại giỏ hàng.",
      409,
    );
  if (snapshots.some((snapshot) => !snapshot.variantId))
    return failure(
      "INVENTORY_CONFLICT",
      "Giỏ hàng không còn đủ thông tin để giữ hàng. Vui lòng chốt lại.",
      409,
    );
  const activationItems = snapshots.map((snapshot) => ({
    variantId: snapshot.variantId as string,
    quantity: snapshot.quantity,
    displayedPrice: snapshot.unitPriceVnd,
  }));
  let loaded: AuthoritativeCartEvaluation;
  try {
    loaded = await evaluateAuthoritativeCart(activationItems, env);
  } catch (caught) {
    if (caught instanceof PromotionCartError)
      return failure(caught.code, caught.message, caught.status, {
        variantIds: caught.variantIds,
      });
    throw caught;
  }
  if (loaded.unavailable.length)
    return failure(
      "VARIANT_UNAVAILABLE",
      "Một số sản phẩm hiện không còn sẵn sàng.",
      409,
      { variantIds: loaded.unavailable },
    );
  if (loaded.changed.length && !body.acceptCurrentPrices)
    return failure(
      "PRICE_CHANGED",
      "Giá của một số sản phẩm vừa thay đổi.",
      409,
      {
        items: loaded.changed,
        subtotalVnd: loaded.evaluation.subtotalVnd,
        discountTotalVnd: loaded.evaluation.discountTotalVnd,
        finalTotalVnd: loaded.evaluation.finalTotalVnd,
        gifts: loaded.evaluation.gifts,
      },
    );
  if (loaded.insufficientStock.length)
    return failure(
      "INSUFFICIENT_STOCK",
      "Một số sản phẩm vừa hết hàng. Vui lòng kiểm tra lại giỏ hàng.",
      409,
      { variantIds: loaded.insufficientStock },
    );
  const history = await loadPromotionHistory(existing.id, env);
  if (
    loaded.promotionSchema &&
    promotionEvaluationChanged(history, loaded) &&
    !body.acceptCurrentPrices
  )
    return failure(
      "PROMOTION_CHANGED",
      "Khuyến mãi hoặc quà tặng vừa thay đổi. Vui lòng kiểm tra và chốt lại.",
      409,
      {
        subtotalVnd: loaded.evaluation.subtotalVnd,
        discountTotalVnd: loaded.evaluation.discountTotalVnd,
        finalTotalVnd: loaded.evaluation.finalTotalVnd,
        gifts: loaded.evaluation.gifts,
      },
    );

  // Một lần resolve config tạo ra cả duration snapshot và deadline, không đọc lại setting giữa chừng.
  const reservation = await getCheckoutReservationConfig(env);
  const reservationStartedAt = new Date().toISOString();
  const reservationExpiresAt = new Date(
    Date.parse(reservationStartedAt) + reservation.durationMs,
  ).toISOString();
  const promotionStatements = buildPromotionPersistenceStatements(
    (sql) => env.DB.prepare(sql),
    existing.id,
    reservationStartedAt,
    loaded,
    { consumeUsage: false },
  );
  const inventoryStatements = buildInventoryReservationStatements(
    (sql) => env.DB.prepare(sql),
    existing.id,
    reservationStartedAt,
    reservationExpiresAt,
    loaded.pricedItems,
    loaded.evaluation.gifts,
  );
  const promotionReservationStatements = buildPromotionReservationStatements(
    (sql) => env.DB.prepare(sql),
    existing.id,
    reservationStartedAt,
    reservationExpiresAt,
    loaded.evaluation.appliedPromotions.map((promotion) => promotion.promotionId),
  );
  const itemLineCount = loaded.pricedItems.length + loaded.evaluation.gifts.length;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE cart_requests SET
        item_line_count = ?, total_quantity = ?, subtotal_vnd = ?,
        promotion_discount_vnd = ?, final_total_vnd = ?, status = 'CONTACTED',
        checkout_state = 'WAITING_SELLER_CONFIRM',
        reservation_started_at = ?, reservation_expires_at = ?,
        reservation_duration_minutes = ?, updated_at = ?
       WHERE id = ? AND checkout_state IN ('READY_TO_SEND', 'EXPIRED')`,
    ).bind(
      itemLineCount,
      loaded.evaluation.totalQuantity,
      loaded.evaluation.subtotalVnd,
      loaded.evaluation.discountTotalVnd,
      loaded.evaluation.finalTotalVnd,
      reservationStartedAt,
      reservationExpiresAt,
      reservation.reservationMinutes,
      reservationStartedAt,
      existing.id,
    ),
    env.DB.prepare("DELETE FROM cart_request_items WHERE cart_request_id = ?").bind(existing.id),
    env.DB.prepare("DELETE FROM cart_request_promotions WHERE cart_request_id = ?").bind(existing.id),
    env.DB.prepare("DELETE FROM cart_request_promotion_gifts WHERE cart_request_id = ?").bind(existing.id),
  ];
  loaded.pricedItems.forEach((item) =>
    statements.push(
      env.DB.prepare(
        `INSERT INTO cart_request_items (
          id, cart_request_id, product_id, variant_id, product_name_snapshot,
          variant_name_snapshot, sku_snapshot, image_key_snapshot,
          unit_price_vnd, quantity, line_total_vnd, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        existing.id,
        item.productId,
        item.variantId,
        item.productName,
        item.variantName,
        item.sku,
        item.imageKey,
        item.priceVnd,
        item.quantity,
        item.lineTotalVnd,
        reservationStartedAt,
      ),
    ),
  );
  statements.push(
    ...promotionStatements.snapshots,
    ...promotionStatements.gifts,
    ...inventoryStatements,
    ...promotionReservationStatements,
  );
  try {
    await env.DB.batch(statements);
  } catch (caught) {
    const duplicate = await findShareRequest(body.submissionToken, env);
    if (duplicate?.checkoutState === "WAITING_SELLER_CONFIRM") {
      const duplicateLink = await loadLink(duplicate.id, env);
      if (duplicateLink) {
        const duplicateToken = await deriveShareToken(
          secret,
          duplicate.id,
          body.submissionToken,
        );
        return json(
          await buildPreparedResponse(
            duplicate,
            duplicateLink,
            duplicateToken,
            seller,
            env,
          ),
        );
      }
    }
    return mapInventoryError(caught) ?? failure("ACTIVATION_FAILED", "Chưa thể giữ hàng. Vui lòng thử lại.", 500);
  }
  const persisted = await findShareRequest(body.submissionToken, env);
  if (!persisted) return failure("ACTIVATION_FAILED", "Chưa thể đọc lại đơn hàng sau khi giữ hàng.", 500);
  const rawToken = await deriveShareToken(secret, persisted.id, body.submissionToken);
  console.info(
    JSON.stringify({
      event: "cart_share_activation_success",
      cartRequestId: persisted.id,
      publicCode: persisted.publicCode,
      reservationDurationMinutes: reservation.reservationMinutes,
      durationMs: Date.now() - startedAt,
    }),
  );
  return json(
    await buildPreparedResponse(
      persisted,
      link,
      rawToken,
      seller,
      env,
      reservationStartedAt,
    ),
  );
}

export async function getPublicCartShare(rawToken: string, env: Env) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken))
    return json(
      {
        success: false,
        error: {
          code: "CART_SHARE_UNAVAILABLE",
          message: "Liên kết giỏ hàng không còn khả dụng.",
        },
      },
      404,
      publicShareHeaders,
    );
  await cleanupExpiredReservations(env);
  const tokenHash = await hashShareToken(rawToken);
  const inventorySchema = await hasInventorySchema(env);
  const row = await env.DB.prepare(
    `SELECT c.id, c.public_code AS code, c.created_at AS createdAt,
      c.item_line_count AS itemLineCount, c.total_quantity AS totalQuantity,
      c.subtotal_vnd AS subtotalVnd, l.expires_at AS expiresAt,
      l.revoked_at AS revokedAt${inventorySchema
        ? ", c.checkout_state AS checkoutState, c.reservation_started_at AS reservationStartedAt, c.reservation_expires_at AS reservationExpiresAt, c.reservation_duration_minutes AS reservationDurationMinutes"
        : ", 'LEGACY' AS checkoutState, NULL AS reservationStartedAt, NULL AS reservationExpiresAt, NULL AS reservationDurationMinutes"}
     FROM cart_share_links l JOIN cart_requests c ON c.id = l.cart_request_id
     WHERE l.token_hash = ? AND c.contact_channel = 'SHARE'`,
  )
    .bind(tokenHash)
    .first<{
      id: string;
      code: string;
      createdAt: string;
      itemLineCount: number;
      totalQuantity: number;
      subtotalVnd: number;
      expiresAt: string;
      revokedAt: string | null;
      checkoutState: string;
      reservationStartedAt: string | null;
      reservationExpiresAt: string | null;
      reservationDurationMinutes: number | null;
    }>();
  if (!row || row.revokedAt || Date.parse(row.expiresAt) <= Date.now())
    return json(
      {
        success: false,
        error: {
          code: "CART_SHARE_UNAVAILABLE",
          message: "Liên kết giỏ hàng không còn khả dụng.",
        },
      },
      404,
      publicShareHeaders,
    );
  const items = await loadSnapshots(row.id, env);
  const schema = await hasPromotionSchema(env);
  const history = await loadPromotionHistory(row.id, env);
  console.info(
    JSON.stringify({
      event: "cart_share_public_view",
      cartRequestId: row.id,
      publicCode: row.code,
      itemCount: items.length,
    }),
  );
  return json(
    {
      code: row.code,
      createdAt: row.createdAt,
      itemLineCount: row.itemLineCount,
      totalQuantity: row.totalQuantity,
      subtotalVnd: row.subtotalVnd,
      checkoutState: row.checkoutState,
      reservationStartedAt: row.reservationStartedAt,
      reservationExpiresAt: row.reservationExpiresAt,
      reservationDurationMinutes: row.reservationDurationMinutes,
      orderExpired: row.checkoutState === "EXPIRED",
      reservationMessage:
        row.checkoutState === "EXPIRED"
          ? "Đơn này đã hết thời gian giữ hàng."
          : undefined,
      promotionDiscountVnd: history.discountAmountVnd,
      finalTotalVnd: schema ? history.finalTotalVnd : row.subtotalVnd,
      promotions: history.promotions.map(({ configSnapshot: _configSnapshot, ...promotion }) => promotion),
      items: items.map((item) => ({
        productName: item.productName,
        variantName: item.variantName,
        imageUrl: getPublicImageUrl(item.imageKey),
        unitPriceVnd: item.unitPriceVnd,
        quantity: item.quantity,
        lineTotalVnd: item.lineTotalVnd,
      })).concat(
        history.gifts.map((gift) => ({
          productName: gift.productName,
          variantName: gift.variantName,
          imageUrl: gift.imageUrl,
          unitPriceVnd: 0,
          quantity: gift.quantity,
          lineTotalVnd: 0,
          isPromotionGift: true,
          promotionId: gift.promotionId,
        })),
      ),
    },
    200,
    publicShareHeaders,
  );
}

export async function getAdminSellerSettings(env: Env) {
  const seller = await readSellerContact(env);
  return json({
    data: seller ?? {
      displayName: "",
      label: `Người bán ${STORE_BRAND}`,
      messengerUrl: "",
      avatarKey: null,
      avatarUrl: null,
    },
  });
}

export async function saveAdminSellerSettings(request: Request, env: Env) {
  let body: Record<string, unknown>;
  try {
    const value = await readBoundedJson(request);
    if (!value || typeof value !== "object") throw new Error("VALIDATION_ERROR");
    body = value as Record<string, unknown>;
  } catch {
    return failure("VALIDATION_ERROR", "Thông tin người bán chưa hợp lệ.", 422);
  }
  let displayName: string;
  let label: string;
  let messengerUrl: string;
  try {
    displayName = requiredString(body.displayName, 120);
    label = requiredString(body.label, 120);
    messengerUrl = validateSellerMessengerUrl(body.messengerUrl);
  } catch (caught) {
    const code = caught instanceof Error ? caught.message : "VALIDATION_ERROR";
    return failure(
      code,
      code === "SELLER_URL_INVALID"
        ? "Messenger URL phải có dạng https://m.me/tennguoidung."
        : "Thông tin người bán chưa hợp lệ.",
      422,
    );
  }
  const avatarKey =
    typeof body.avatarKey === "string" && body.avatarKey.trim()
      ? body.avatarKey.trim()
      : "";
  if (avatarKey.length > 500)
    return failure("VALIDATION_ERROR", "Khóa ảnh đại diện chưa hợp lệ.", 422);
  if (
    avatarKey &&
    (normalizeR2Key(avatarKey) !== avatarKey ||
      !(await env.PRODUCT_IMAGES.head(avatarKey)))
  )
    return failure(
      "INVALID_IMAGE_REFERENCE",
      "Ảnh đại diện không tồn tại trong kho ảnh.",
      422,
    );
  const updatedAt = new Date().toISOString();
  const values = [displayName, label, messengerUrl, avatarKey];
  await env.DB.batch(
    sellerSettingKeys.map((key, index) =>
      env.DB.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(key, values[index], updatedAt),
    ),
  );
  return json({ success: true, data: await readSellerContact(env) });
}
