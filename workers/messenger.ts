import { generatePublicCode, type PricedItem } from "./services";
import { consumeRateLimit, RateLimitError, sha256 } from "./rate-limit";
import { STORE_BRAND } from "../shared/branding";

export { sha256 } from "./rate-limit";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const sessionTtlMs = 30 * 60 * 1000;
const messagingWindowMs = 24 * 60 * 60 * 1000;
const maxWebhookBytes = 256 * 1024;

type MessengerSessionStatus =
  | "CREATED"
  | "IDENTIFIED"
  | "CONFIRMED"
  | "EXPIRED"
  | "CANCELLED";
type MessengerDeliveryStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "FAILED";

type MessengerStartBody = {
  submissionToken: string;
  items: Array<{ variantId: string; quantity: number }>;
};

type MessengerConfig = {
  pageId: string;
  pageUsername: string;
  graphApiVersion: string;
  appSecret: string;
  pageAccessToken: string;
  webhookVerifyToken: string;
};

type ParsedMessengerEvent = {
  type: "REFERRAL" | "GET_STARTED" | "CONFIRM_CART" | "MESSAGE" | "UNSUPPORTED";
  senderPsid: string;
  timestamp: number | null;
  referralToken?: string;
  sessionId?: string;
  messageId?: string;
  canonicalKey: string;
};

type SessionRow = {
  id: string;
  cartRequestId: string;
  publicCode: string;
  status: MessengerSessionStatus;
  psid: string | null;
  expiresAt: string;
};

type ExistingStartRow = SessionRow & {
  itemLineCount: number;
  totalQuantity: number;
  subtotalVnd: number;
  createdAt: string;
  deliveryStatus: string;
};

type DeliveryRow = {
  id: string;
  code: string;
  psid: string;
  subtotalVnd: number;
  deliveryStatus: MessengerDeliveryStatus;
};

class MessengerDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

class MetaApiError extends Error {
  constructor(
    readonly errorCode: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

class MetaDeliveryUncertainError extends Error {}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function error(code: string, message: string, status: number) {
  return json({ success: false, error: { code, message } }, status);
}

function requiredString(value: unknown, max: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max)
    throw new MessengerDomainError(
      "VALIDATION_ERROR",
      "Thông tin gửi chưa hợp lệ.",
      422,
    );
  return normalized;
}

export function validateMessengerStart(value: unknown): MessengerStartBody {
  if (!value || typeof value !== "object")
    throw new MessengerDomainError(
      "VALIDATION_ERROR",
      "Thông tin gửi chưa hợp lệ.",
      422,
    );
  const body = value as Record<string, unknown>;
  const submissionToken = requiredString(body.submissionToken, 120);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50)
    throw new MessengerDomainError("CART_EMPTY", "Giỏ hàng đang trống.", 422);
  const seen = new Set<string>();
  const items = body.items.map((value) => {
    if (!value || typeof value !== "object")
      throw new MessengerDomainError(
        "VALIDATION_ERROR",
        "Thông tin gửi chưa hợp lệ.",
        422,
      );
    const item = value as Record<string, unknown>;
    const variantId = requiredString(item.variantId, 120);
    if (
      seen.has(variantId) ||
      !Number.isInteger(item.quantity) ||
      Number(item.quantity) < 1 ||
      Number(item.quantity) > 99
    )
      throw new MessengerDomainError(
        "VALIDATION_ERROR",
        "Thông tin gửi chưa hợp lệ.",
        422,
      );
    seen.add(variantId);
    return { variantId, quantity: Number(item.quantity) };
  });
  return { submissionToken, items };
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function generateOpaqueToken(bytes?: Uint8Array) {
  const source = bytes ?? crypto.getRandomValues(new Uint8Array(24));
  if (source.byteLength < 16) throw new Error("TOKEN_ENTROPY_TOO_LOW");
  return bytesToBase64Url(source);
}

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
}

async function deriveSessionTokens(
  appSecret: string,
  sessionId: string,
  submissionToken: string,
) {
  // Token được dẫn xuất từ secret và hai nonce ngẫu nhiên để retry idempotent
  // có thể trả lại đúng session mà không lưu raw token trong D1.
  const [refBytes, statusBytes] = await Promise.all([
    hmacSha256(appSecret, `babyjoy-ref-v1:${sessionId}:${submissionToken}`),
    hmacSha256(appSecret, `babyjoy-status-v1:${sessionId}:${submissionToken}`),
  ]);
  return {
    referralToken: bytesToBase64Url(refBytes),
    statusToken: bytesToBase64Url(statusBytes),
  };
}

function getSecret(env: Env, key: "META_APP_SECRET" | "META_PAGE_ACCESS_TOKEN" | "META_WEBHOOK_VERIFY_TOKEN") {
  if (key === "META_APP_SECRET") {
    // @ts-expect-error Secret chỉ được Wrangler inject ở runtime.
    return String(env.META_APP_SECRET ?? "");
  }
  if (key === "META_PAGE_ACCESS_TOKEN") {
    // @ts-expect-error Secret chỉ được Wrangler inject ở runtime.
    return String(env.META_PAGE_ACCESS_TOKEN ?? "");
  }
  // @ts-expect-error Secret chỉ được Wrangler inject ở runtime.
  return String(env.META_WEBHOOK_VERIFY_TOKEN ?? "");
}

function messengerConfig(env: Env): MessengerConfig {
  const config = {
    pageId: env.META_PAGE_ID.trim(),
    pageUsername: env.MESSENGER_PAGE_USERNAME.trim(),
    graphApiVersion: env.META_GRAPH_API_VERSION.trim(),
    appSecret: getSecret(env, "META_APP_SECRET"),
    pageAccessToken: getSecret(env, "META_PAGE_ACCESS_TOKEN"),
    webhookVerifyToken: getSecret(env, "META_WEBHOOK_VERIFY_TOKEN"),
  };
  if (Object.values(config).some((value) => !value))
    throw new MessengerDomainError(
      "META_CONFIG_MISSING",
      "Messenger chưa được cấu hình đầy đủ.",
      503,
    );
  return config;
}

function messengerStartConfig(env: Env) {
  const appSecret =
    getSecret(env, "META_APP_SECRET") ||
    (env.ENVIRONMENT === "development" ? "babyjoy-local-messenger-v1" : "");
  const pageUsername = env.MESSENGER_PAGE_USERNAME.trim();
  if (!appSecret || !pageUsername)
    throw new MessengerDomainError(
      "META_CONFIG_MISSING",
      "Messenger chưa được cấu hình đầy đủ.",
      503,
    );
  return { appSecret, pageUsername };
}

export function isMessengerCheckoutEnabled(env: Env) {
  return env.MESSENGER_CHECKOUT_ENABLED.trim().toLowerCase() === "true";
}

export function messengerCheckoutConfigResponse(env: Env) {
  return json({ messengerCheckoutEnabled: isMessengerCheckoutEnabled(env) });
}

async function readBoundedJson(request: Request, maxBytes = 64 * 1024) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes)
    throw new MessengerDomainError(
      "VALIDATION_ERROR",
      "Dữ liệu gửi quá lớn.",
      413,
    );
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new MessengerDomainError(
      "VALIDATION_ERROR",
      "Dữ liệu gửi quá lớn.",
      413,
    );
  return JSON.parse(text) as unknown;
}

async function loadMessengerPricedItems(body: MessengerStartBody, env: Env) {
  const placeholders = body.items.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `SELECT v.id AS variantId, v.name AS variantName, v.sku, v.price_vnd AS priceVnd,
      v.availability, p.id AS productId, p.name AS productName, p.status AS productStatus,
      (SELECT r2_key FROM product_images WHERE product_id = p.id ORDER BY sort_order, created_at LIMIT 1) AS imageKey
     FROM product_variants v JOIN products p ON p.id = v.product_id
     WHERE v.id IN (${placeholders})`,
  )
    .bind(...body.items.map((item) => item.variantId))
    .all<{
      variantId: string;
      variantName: string;
      sku: string | null;
      priceVnd: number;
      availability: string;
      productId: string;
      productName: string;
      productStatus: string;
      imageKey: string | null;
    }>();
  if (result.results.length !== body.items.length)
    throw new MessengerDomainError(
      "VARIANT_NOT_FOUND",
      "Một phân loại sản phẩm không còn tồn tại.",
      404,
    );
  const byId = new Map(result.results.map((row) => [row.variantId, row]));
  return body.items.map((item) => {
    const row = byId.get(item.variantId);
    if (!row)
      throw new MessengerDomainError(
        "VARIANT_NOT_FOUND",
        "Một phân loại sản phẩm không còn tồn tại.",
        404,
      );
    if (row.availability !== "AVAILABLE" || row.productStatus !== "AVAILABLE")
      throw new MessengerDomainError(
        "VARIANT_UNAVAILABLE",
        "Một số sản phẩm hiện không còn sẵn sàng.",
        409,
      );
    return {
      productId: row.productId,
      variantId: row.variantId,
      productName: row.productName,
      variantName: row.variantName,
      sku: row.sku,
      imageKey: row.imageKey,
      priceVnd: row.priceVnd,
      quantity: item.quantity,
      lineTotalVnd: row.priceVnd * item.quantity,
    } satisfies PricedItem;
  });
}

async function findExistingStart(submissionToken: string, env: Env) {
  return env.DB.prepare(
    `SELECT s.id, s.cart_request_id AS cartRequestId, c.public_code AS publicCode,
      s.status, s.psid, s.expires_at AS expiresAt, c.item_line_count AS itemLineCount,
      c.total_quantity AS totalQuantity, c.subtotal_vnd AS subtotalVnd, c.created_at AS createdAt,
      c.messenger_delivery_status AS deliveryStatus
     FROM cart_requests c JOIN messenger_checkout_sessions s ON s.cart_request_id = c.id
     WHERE c.submission_token = ? AND c.contact_channel = 'MESSENGER'`,
  )
    .bind(submissionToken)
    .first<ExistingStartRow>();
}

async function startResponse(
  row: ExistingStartRow,
  submissionToken: string,
  config: Pick<MessengerConfig, "appSecret" | "pageUsername">,
  status = 200,
) {
  const tokens = await deriveSessionTokens(
    config.appSecret,
    row.id,
    submissionToken,
  );
  return json(
    {
      success: true,
      code: row.publicCode,
      messengerUrl: `https://m.me/${encodeURIComponent(config.pageUsername)}?ref=${encodeURIComponent(tokens.referralToken)}`,
      statusToken: tokens.statusToken,
      expiresAt: row.expiresAt,
      messengerStatus: publicMessengerStatus(
        row.status,
        row.deliveryStatus,
        row.expiresAt,
      ),
      cartRequest: {
        code: row.publicCode,
        itemLineCount: row.itemLineCount,
        totalQuantity: row.totalQuantity,
        subtotalVnd: row.subtotalVnd,
        createdAt: row.createdAt,
      },
    },
    status,
  );
}

export async function startMessengerCheckout(request: Request, env: Env) {
  if (!isMessengerCheckoutEnabled(env))
    return error(
      "FEATURE_DISABLED",
      "Tính năng Messenger chưa được bật.",
      404,
    );
  try {
    await consumeRateLimit(env, request, "messenger-start", 10);
    const config = messengerStartConfig(env);
    const body = validateMessengerStart(await readBoundedJson(request));
    const existing = await findExistingStart(body.submissionToken, env);
    if (existing) return startResponse(existing, body.submissionToken, config);

    const pricedItems = await loadMessengerPricedItems(body, env);
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + sessionTtlMs).toISOString();
    const cartRequestId = crypto.randomUUID();
    const sessionId = generateOpaqueToken();
    const publicCode = generatePublicCode(now);
    const totalQuantity = pricedItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const subtotalVnd = pricedItems.reduce(
      (sum, item) => sum + item.lineTotalVnd,
      0,
    );
    const tokens = await deriveSessionTokens(
      config.appSecret,
      sessionId,
      body.submissionToken,
    );
    const [refHash, statusTokenHash] = await Promise.all([
      sha256(tokens.referralToken),
      sha256(tokens.statusToken),
    ]);
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO cart_requests (
          id, public_code, submission_token, customer_name, customer_phone,
          item_line_count, total_quantity, subtotal_vnd, status, telegram_status,
          contact_channel, messenger_delivery_status, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, 'SUBMITTED', 'PENDING', 'MESSENGER', 'PENDING', ?, ?)`,
      ).bind(
        cartRequestId,
        publicCode,
        body.submissionToken,
        pricedItems.length,
        totalQuantity,
        subtotalVnd,
        createdAt,
        createdAt,
      ),
      env.DB.prepare(
        `INSERT INTO messenger_checkout_sessions (
          id, cart_request_id, ref_hash, status_token_hash, status,
          expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'CREATED', ?, ?, ?)`,
      ).bind(
        sessionId,
        cartRequestId,
        refHash,
        statusTokenHash,
        expiresAt,
        createdAt,
        createdAt,
      ),
    ];
    pricedItems.forEach((item) =>
      statements.push(
        env.DB.prepare(
          `INSERT INTO cart_request_items (
            id, cart_request_id, product_id, variant_id, product_name_snapshot,
            variant_name_snapshot, sku_snapshot, image_key_snapshot, unit_price_vnd,
            quantity, line_total_vnd, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
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
      ),
    );
    try {
      await env.DB.batch(statements);
    } catch (caught) {
      const duplicate = await findExistingStart(body.submissionToken, env);
      if (duplicate) return startResponse(duplicate, body.submissionToken, config);
      throw caught;
    }
    return startResponse(
      {
        id: sessionId,
        cartRequestId,
        publicCode,
        status: "CREATED",
        psid: null,
        expiresAt,
        itemLineCount: pricedItems.length,
        totalQuantity,
        subtotalVnd,
        createdAt,
        deliveryStatus: "PENDING",
      },
      body.submissionToken,
      config,
      201,
    );
  } catch (caught) {
    if (caught instanceof RateLimitError)
      return error(caught.code, caught.message, caught.status);
    if (caught instanceof MessengerDomainError)
      return error(caught.code, caught.message, caught.status);
    console.error(
      JSON.stringify({
        message: "messenger checkout start failed",
        error: caught instanceof Error ? caught.message : String(caught),
      }),
    );
    return error(
      "SUBMISSION_FAILED",
      "Chưa thể tạo phiên Messenger. Giỏ hàng của bạn vẫn được giữ lại.",
      500,
    );
  }
}

export function publicMessengerStatus(
  sessionStatus: MessengerSessionStatus,
  deliveryStatus: string,
  expiresAt: string,
) {
  if (
    (sessionStatus === "CREATED" || sessionStatus === "IDENTIFIED") &&
    new Date(expiresAt).getTime() <= Date.now()
  )
    return "EXPIRED";
  if (deliveryStatus === "SENT") return "SENT";
  if (deliveryStatus === "FAILED") return "FAILED";
  if (deliveryStatus === "SENDING") return "SENDING";
  if (sessionStatus === "CONFIRMED") return "CONFIRMED";
  if (sessionStatus === "IDENTIFIED") return "IDENTIFIED";
  if (sessionStatus === "EXPIRED" || sessionStatus === "CANCELLED")
    return "EXPIRED";
  return "AWAITING_USER";
}

export async function getMessengerStatus(
  request: Request,
  code: string,
  env: Env,
) {
  try {
    await consumeRateLimit(env, request, "messenger-status", 60);
    const authorization = request.headers.get("authorization") ?? "";
    const statusToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";
    if (!statusToken)
      return error(
        "MESSENGER_SESSION_NOT_FOUND",
        "Không tìm thấy phiên Messenger.",
        404,
      );
    const tokenHash = await sha256(statusToken);
    const row = await env.DB.prepare(
      `SELECT s.id, s.status, s.expires_at AS expiresAt,
        c.messenger_delivery_status AS deliveryStatus
       FROM messenger_checkout_sessions s JOIN cart_requests c ON c.id = s.cart_request_id
       WHERE c.public_code = ? AND s.status_token_hash = ?`,
    )
      .bind(code, tokenHash)
      .first<{
        id: string;
        status: MessengerSessionStatus;
        expiresAt: string;
        deliveryStatus: string;
      }>();
    if (!row)
      return error(
        "MESSENGER_SESSION_NOT_FOUND",
        "Không tìm thấy phiên Messenger.",
        404,
      );
    const status = publicMessengerStatus(
      row.status,
      row.deliveryStatus,
      row.expiresAt,
    );
    if (status === "EXPIRED" && row.status !== "EXPIRED")
      await env.DB.prepare(
        "UPDATE messenger_checkout_sessions SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND status IN ('CREATED', 'IDENTIFIED')",
      )
        .bind(new Date().toISOString(), row.id)
        .run();
    return json({ code, status });
  } catch (caught) {
    if (caught instanceof RateLimitError)
      return error(caught.code, caught.message, caught.status);
    if (caught instanceof MessengerDomainError)
      return error(caught.code, caught.message, caught.status);
    return error(
      "MESSENGER_SESSION_NOT_FOUND",
      "Chưa thể kiểm tra trạng thái Messenger.",
      500,
    );
  }
}

function safeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
  };
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(left, right);
  // Node test runtime chưa có extension của Workers; production luôn đi nhánh trên.
  let mismatch = 0;
  for (let index = 0; index < left.byteLength; index += 1)
    mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export async function verifyMetaSignature(
  rawBody: ArrayBuffer,
  signatureHeader: string | null,
  appSecret: string,
) {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const suppliedHex = signatureHeader.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) return false;
  const supplied = new Uint8Array(
    suppliedHex.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? [],
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  return safeEqual(expected, supplied);
}

function normalizePostback(payload: unknown) {
  return typeof payload === "string" ? payload.trim() : "";
}

export function parseMessengerWebhook(value: unknown): ParsedMessengerEvent[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.entry)) return [];
  const events: ParsedMessengerEvent[] = [];
  root.entry.forEach((entryValue) => {
    if (!entryValue || typeof entryValue !== "object") return;
    const entry = entryValue as Record<string, unknown>;
    if (!Array.isArray(entry.messaging)) return;
    entry.messaging.forEach((eventValue) => {
      if (!eventValue || typeof eventValue !== "object") return;
      const event = eventValue as Record<string, unknown>;
      const sender = event.sender as Record<string, unknown> | undefined;
      const senderPsid = typeof sender?.id === "string" ? sender.id : "";
      if (!senderPsid) return;
      const postback = event.postback as Record<string, unknown> | undefined;
      const directReferral = event.referral as Record<string, unknown> | undefined;
      const postbackReferral = postback?.referral as
        | Record<string, unknown>
        | undefined;
      const referral = postbackReferral ?? directReferral;
      const referralToken =
        typeof referral?.ref === "string" ? referral.ref.trim() : undefined;
      const payload = normalizePostback(postback?.payload);
      const message = event.message as Record<string, unknown> | undefined;
      const messageId = typeof message?.mid === "string" ? message.mid : undefined;
      let type: ParsedMessengerEvent["type"] = "UNSUPPORTED";
      let sessionId: string | undefined;
      if (payload.startsWith("BABYJOY_CONFIRM_CART:")) {
        type = "CONFIRM_CART";
        sessionId = payload.slice("BABYJOY_CONFIRM_CART:".length).trim();
      } else if (payload === "BABYJOY_GET_STARTED") type = "GET_STARTED";
      else if (referralToken) type = "REFERRAL";
      else if (message) type = "MESSAGE";
      const timestamp =
        typeof event.timestamp === "number" ? event.timestamp : null;
      events.push({
        type,
        senderPsid,
        timestamp,
        referralToken,
        sessionId,
        messageId,
        canonicalKey: JSON.stringify({
          entryId: entry.id ?? null,
          senderPsid,
          timestamp,
          type,
          messageId: messageId ?? null,
          payload: payload || null,
          referralToken: referralToken ?? null,
        }),
      });
    });
  });
  return events;
}

export async function messengerEventKey(event: ParsedMessengerEvent) {
  return event.messageId
    ? `mid:${event.messageId}`
    : `sha256:${await sha256(event.canonicalKey)}`;
}

async function recordWebhookEvent(
  event: ParsedMessengerEvent,
  env: Env,
  receivedAt: string,
) {
  const [eventKey, senderHash] = await Promise.all([
    messengerEventKey(event),
    sha256(event.senderPsid),
  ]);
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO messenger_webhook_events (
      event_key, event_type, sender_psid_hash, processing_status, received_at
    ) VALUES (?, ?, ?, 'RECEIVED', ?)`,
  )
    .bind(eventKey, event.type, senderHash, receivedAt)
    .run();
  return { eventKey, inserted: (result.meta.changes ?? 0) > 0 };
}

async function updateWebhookEvent(
  eventKey: string,
  env: Env,
  status: "STATE_PERSISTED" | "PROCESSED" | "FAILED" | "IGNORED",
  cartRequestId?: string,
  errorCode?: string,
) {
  await env.DB.prepare(
    `UPDATE messenger_webhook_events SET processing_status = ?, cart_request_id = COALESCE(?, cart_request_id),
      error_code = ?, processed_at = CASE WHEN ? IN ('PROCESSED', 'FAILED', 'IGNORED') THEN ? ELSE processed_at END
     WHERE event_key = ?`,
  )
    .bind(
      status,
      cartRequestId ?? null,
      errorCode ?? null,
      status,
      new Date().toISOString(),
      eventKey,
    )
    .run();
}

async function bindReferral(
  rawReferral: string,
  senderPsid: string,
  env: Env,
  now: string,
) {
  const refHash = await sha256(rawReferral);
  const row = await env.DB.prepare(
    `SELECT s.id, s.cart_request_id AS cartRequestId, c.public_code AS publicCode,
      s.status, s.psid, s.expires_at AS expiresAt
     FROM messenger_checkout_sessions s JOIN cart_requests c ON c.id = s.cart_request_id
     WHERE s.ref_hash = ?`,
  )
    .bind(refHash)
    .first<SessionRow>();
  if (!row)
    throw new MessengerDomainError(
      "MESSENGER_SESSION_NOT_FOUND",
      "Không tìm thấy phiên Messenger.",
      404,
    );
  if (
    row.status === "CANCELLED" ||
    row.status === "EXPIRED" ||
    new Date(row.expiresAt).getTime() <= new Date(now).getTime()
  ) {
    await env.DB.prepare(
      "UPDATE messenger_checkout_sessions SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND status IN ('CREATED', 'IDENTIFIED')",
    )
      .bind(now, row.id)
      .run();
    throw new MessengerDomainError(
      "MESSENGER_SESSION_EXPIRED",
      "Phiên Messenger đã hết hạn.",
      410,
    );
  }
  if (row.psid && row.psid !== senderPsid)
    throw new MessengerDomainError(
      "MESSENGER_SESSION_ALREADY_CLAIMED",
      "Phiên Messenger đã được liên kết.",
      409,
    );
  const identifiedAt = row.status === "CREATED" ? now : null;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE messenger_checkout_sessions SET psid = COALESCE(psid, ?),
        status = CASE WHEN status = 'CREATED' THEN 'IDENTIFIED' ELSE status END,
        identified_at = COALESCE(identified_at, ?), updated_at = ?
       WHERE id = ? AND (psid IS NULL OR psid = ?)`,
    ).bind(senderPsid, identifiedAt, now, row.id, senderPsid),
    env.DB.prepare(
      `UPDATE cart_requests SET messenger_psid = COALESCE(messenger_psid, ?),
        messenger_last_user_interaction_at = ?, updated_at = ?
       WHERE id = ? AND (messenger_psid IS NULL OR messenger_psid = ?)`,
    ).bind(senderPsid, now, now, row.cartRequestId, senderPsid),
  ]);
  const claimed = await sessionById(row.id, env);
  if (!claimed || claimed.psid !== senderPsid)
    throw new MessengerDomainError(
      "MESSENGER_SESSION_ALREADY_CLAIMED",
      "Phiên Messenger đã được liên kết.",
      409,
    );
  return { ...row, psid: senderPsid, status: "IDENTIFIED" as const };
}

async function findIdentifiedSession(senderPsid: string, env: Env, now: string) {
  return env.DB.prepare(
    `SELECT s.id, s.cart_request_id AS cartRequestId, c.public_code AS publicCode,
      s.status, s.psid, s.expires_at AS expiresAt
     FROM messenger_checkout_sessions s JOIN cart_requests c ON c.id = s.cart_request_id
     WHERE s.psid = ? AND s.status = 'IDENTIFIED' AND s.expires_at > ?
     ORDER BY s.identified_at DESC LIMIT 1`,
  )
    .bind(senderPsid, now)
    .first<SessionRow>();
}

async function confirmSession(
  row: SessionRow,
  senderPsid: string,
  env: Env,
  now: string,
) {
  if (row.psid !== senderPsid)
    throw new MessengerDomainError(
      "MESSENGER_IDENTITY_MISMATCH",
      "Messenger không khớp với phiên giỏ hàng.",
      403,
    );
  if (
    row.status === "CANCELLED" ||
    row.status === "EXPIRED" ||
    new Date(row.expiresAt).getTime() <= new Date(now).getTime()
  )
    throw new MessengerDomainError(
      "MESSENGER_SESSION_EXPIRED",
      "Phiên Messenger đã hết hạn.",
      410,
    );
  if (row.status !== "IDENTIFIED" && row.status !== "CONFIRMED")
    throw new MessengerDomainError(
      "MESSENGER_SESSION_NOT_FOUND",
      "Phiên Messenger chưa sẵn sàng xác nhận.",
      409,
    );
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE messenger_checkout_sessions SET status = 'CONFIRMED',
        confirmed_at = COALESCE(confirmed_at, ?), updated_at = ?
       WHERE id = ? AND psid = ? AND status IN ('IDENTIFIED', 'CONFIRMED')`,
    ).bind(now, now, row.id, senderPsid),
    env.DB.prepare(
      `UPDATE cart_requests SET messenger_confirmed_at = COALESCE(messenger_confirmed_at, ?),
        messenger_last_user_interaction_at = ?, updated_at = ?
       WHERE id = ? AND messenger_psid = ?`,
    ).bind(now, now, now, row.cartRequestId, senderPsid),
  ]);
  return { ...row, status: "CONFIRMED" as const };
}

async function sessionById(sessionId: string, env: Env) {
  return env.DB.prepare(
    `SELECT s.id, s.cart_request_id AS cartRequestId, c.public_code AS publicCode,
      s.status, s.psid, s.expires_at AS expiresAt
     FROM messenger_checkout_sessions s JOIN cart_requests c ON c.id = s.cart_request_id
     WHERE s.id = ?`,
  )
    .bind(sessionId)
    .first<SessionRow>();
}

function formatVnd(value: number) {
  return `${new Intl.NumberFormat("vi-VN").format(value)} ₫`;
}

export function composeMessengerCartSummary(request: {
  code: string;
  items: PricedItem[];
  subtotalVnd: number;
}) {
  const lines = [`🛒 GIỎ HÀNG ${STORE_BRAND}`, "", `Mã: ${request.code}`, ""];
  request.items.forEach((item) => {
    lines.push(
      `• ${item.productName}`,
      `  ${item.variantName} × ${item.quantity}`,
      `  ${formatVnd(item.lineTotalVnd)}`,
      "",
    );
  });
  lines.push(
    "────────────────",
    `Tạm tính: ${formatVnd(request.subtotalVnd)}`,
    "",
    `✅ ${STORE_BRAND} đã nhận giỏ hàng.`,
    "",
    "Shop sẽ tư vấn và xác nhận hàng với bạn ngay tại cuộc trò chuyện này.",
  );
  return lines.join("\n");
}

async function readMetaJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return {} as Record<string, unknown>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > 32 * 1024) {
      await reader.cancel();
      if (response.ok)
        throw new MetaDeliveryUncertainError(
          "Meta đã trả success nhưng response quá lớn để xác minh message ID.",
        );
      throw new MetaApiError(
        "META_RESPONSE_TOO_LARGE",
        response.status,
        "Meta response quá lớn.",
      );
    }
    chunks.push(result.value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  });
  try {
    return JSON.parse(new TextDecoder().decode(merged)) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

export async function sendMessengerMessage(
  env: Env,
  psid: string,
  message: Record<string, unknown>,
) {
  const config = messengerConfig(env);
  const startedAt = Date.now();
  const response = await fetch(
    `https://graph.facebook.com/${encodeURIComponent(config.graphApiVersion)}/${encodeURIComponent(config.pageId)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.pageAccessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message,
      }),
    },
  );
  const body = await readMetaJson(response);
  if (!response.ok) {
    const metaError = body.error as Record<string, unknown> | undefined;
    throw new MetaApiError(
      typeof metaError?.code === "number"
        ? `META_${metaError.code}`
        : `META_HTTP_${response.status}`,
      response.status,
      typeof metaError?.message === "string"
        ? metaError.message.slice(0, 500)
        : `Meta HTTP ${response.status}`,
    );
  }
  console.info(
    JSON.stringify({
      message: "messenger send api success",
      meta_http_status: response.status,
      duration: Date.now() - startedAt,
    }),
  );
  if (typeof body.message_id !== "string" || !body.message_id)
    throw new MetaDeliveryUncertainError(
      "Meta đã trả success nhưng thiếu message ID.",
    );
  return body.message_id;
}

async function sendConfirmationPrompt(session: SessionRow, env: Env) {
  if (!session.psid) return;
  await sendMessengerMessage(env, session.psid, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: `Bạn đang xác nhận giỏ hàng ${session.publicCode}.\n\nChạm nút bên dưới để ${STORE_BRAND} gửi chi tiết giỏ hàng vào cuộc trò chuyện này.`,
        buttons: [
          {
            type: "postback",
            title: "XÁC NHẬN GIỎ HÀNG",
            payload: `BABYJOY_CONFIRM_CART:${session.id}`,
          },
        ],
      },
    },
  });
}

async function loadDelivery(cartRequestId: string, env: Env) {
  return env.DB.prepare(
    `SELECT id, public_code AS code, messenger_psid AS psid,
      subtotal_vnd AS subtotalVnd, messenger_delivery_status AS deliveryStatus
     FROM cart_requests WHERE id = ? AND contact_channel = 'MESSENGER'`,
  )
    .bind(cartRequestId)
    .first<DeliveryRow>();
}

async function deliverCartSummary(cartRequestId: string, env: Env) {
  const claimedAt = new Date().toISOString();
  const claim = await env.DB.prepare(
    `UPDATE cart_requests SET messenger_delivery_status = 'SENDING',
      messenger_send_claimed_at = ?, messenger_last_attempt_at = ?,
      messenger_attempt_count = messenger_attempt_count + 1, updated_at = ?
     WHERE id = ? AND messenger_psid IS NOT NULL
       AND messenger_delivery_status IN ('PENDING', 'FAILED')`,
  )
    .bind(claimedAt, claimedAt, claimedAt, cartRequestId)
    .run();
  if ((claim.meta.changes ?? 0) !== 1) return;
  const delivery = await loadDelivery(cartRequestId, env);
  if (!delivery?.psid) return;
  const items = await env.DB.prepare(
    `SELECT product_id AS productId, variant_id AS variantId,
      product_name_snapshot AS productName, variant_name_snapshot AS variantName,
      sku_snapshot AS sku, image_key_snapshot AS imageKey, unit_price_vnd AS priceVnd,
      quantity, line_total_vnd AS lineTotalVnd
     FROM cart_request_items WHERE cart_request_id = ? ORDER BY created_at, id`,
  )
    .bind(cartRequestId)
    .all<PricedItem>();
  try {
    const messageId = await sendMessengerMessage(env, delivery.psid, {
      text: composeMessengerCartSummary({
        code: delivery.code,
        items: items.results,
        subtotalVnd: delivery.subtotalVnd,
      }),
    });
    const sentAt = new Date().toISOString();
    try {
      const finalized = await env.DB.prepare(
        `UPDATE cart_requests SET messenger_delivery_status = 'SENT',
          messenger_message_id = ?, messenger_sent_at = ?, messenger_last_error_code = NULL,
          messenger_last_error = NULL, updated_at = ?
         WHERE id = ? AND messenger_delivery_status = 'SENDING'
           AND messenger_send_claimed_at = ?`,
      )
        .bind(messageId, sentAt, sentAt, cartRequestId, claimedAt)
        .run();
      if ((finalized.meta.changes ?? 0) !== 1)
        throw new MetaDeliveryUncertainError(
          "Không thể chốt trạng thái SENT sau khi Meta đã nhận message.",
        );
    } catch (caught) {
      // Meta đã nhận message nhưng D1 chưa ghi SENT: giữ SENDING để không resend mù.
      console.error(
        JSON.stringify({
          message: "messenger sent but d1 finalization failed",
          cart_request_id: cartRequestId,
          delivery_state: "SENDING",
          error: caught instanceof Error ? caught.message : String(caught),
        }),
      );
      throw caught;
    }
  } catch (caught) {
    if (
      !(caught instanceof MetaApiError) &&
      !(caught instanceof MessengerDomainError)
    )
      throw caught;
    const failedAt = new Date().toISOString();
    const sensitiveValues = [
      delivery.psid,
      getSecret(env, "META_PAGE_ACCESS_TOKEN"),
    ].filter(Boolean);
    const safeMessage = sensitiveValues
      .reduce(
        (message, sensitive) => message.split(sensitive).join("[REDACTED]"),
        caught.message,
      )
      .slice(0, 500);
    const errorCode =
      caught instanceof MetaApiError ? caught.errorCode : caught.code;
    await env.DB.prepare(
      `UPDATE cart_requests SET messenger_delivery_status = 'FAILED',
        messenger_last_error_code = ?, messenger_last_error = ?, updated_at = ?
       WHERE id = ? AND messenger_delivery_status = 'SENDING'
         AND messenger_send_claimed_at = ?`,
    )
      .bind(
        errorCode,
        safeMessage,
        failedAt,
        cartRequestId,
        claimedAt,
      )
      .run();
    throw caught;
  }
}

async function processWebhookEvent(
  event: ParsedMessengerEvent,
  eventKey: string,
  env: Env,
  ctx: ExecutionContext,
  now: string,
) {
  try {
    let session: SessionRow | null = null;
    let action: "PROMPT" | "DELIVER" | null = null;
    if (event.type === "REFERRAL") {
      session = await bindReferral(
        event.referralToken ?? "",
        event.senderPsid,
        env,
        now,
      );
      action = "PROMPT";
    } else if (event.type === "GET_STARTED") {
      session = event.referralToken
        ? await bindReferral(event.referralToken, event.senderPsid, env, now)
        : await findIdentifiedSession(event.senderPsid, env, now);
      if (!session)
        throw new MessengerDomainError(
          "MESSENGER_SESSION_NOT_FOUND",
          "Không tìm thấy phiên Messenger.",
          404,
        );
      session = await confirmSession(session, event.senderPsid, env, now);
      action = "DELIVER";
    } else if (event.type === "CONFIRM_CART") {
      session = event.sessionId ? await sessionById(event.sessionId, env) : null;
      if (!session)
        throw new MessengerDomainError(
          "MESSENGER_SESSION_NOT_FOUND",
          "Không tìm thấy phiên Messenger.",
          404,
        );
      session = await confirmSession(session, event.senderPsid, env, now);
      action = "DELIVER";
    } else if (event.type === "MESSAGE") {
      session = await env.DB.prepare(
        `SELECT s.id, s.cart_request_id AS cartRequestId, c.public_code AS publicCode,
          s.status, s.psid, s.expires_at AS expiresAt
         FROM messenger_checkout_sessions s JOIN cart_requests c ON c.id = s.cart_request_id
         WHERE s.psid = ? ORDER BY s.updated_at DESC LIMIT 1`,
      )
        .bind(event.senderPsid)
        .first<SessionRow>();
      if (session)
        await env.DB.prepare(
          "UPDATE cart_requests SET messenger_last_user_interaction_at = ?, updated_at = ? WHERE id = ? AND messenger_psid = ?",
        )
          .bind(now, now, session.cartRequestId, event.senderPsid)
          .run();
    } else {
      await updateWebhookEvent(eventKey, env, "IGNORED");
      return;
    }
    await updateWebhookEvent(
      eventKey,
      env,
      "STATE_PERSISTED",
      session?.cartRequestId,
    );
    if (!action || !session) {
      await updateWebhookEvent(
        eventKey,
        env,
        "PROCESSED",
        session?.cartRequestId,
      );
      return;
    }
    const task =
      action === "PROMPT"
        ? sendConfirmationPrompt(session, env)
        : deliverCartSummary(session.cartRequestId, env);
    ctx.waitUntil(
      task.then(
        () => updateWebhookEvent(eventKey, env, "PROCESSED", session.cartRequestId),
        async (caught) => {
          const code =
            caught instanceof MetaApiError
              ? caught.errorCode
              : "MESSENGER_SEND_FAILED";
          await updateWebhookEvent(
            eventKey,
            env,
            "FAILED",
            session.cartRequestId,
            code,
          );
          console.error(
            JSON.stringify({
              message: "messenger webhook async action failed",
              cart_request_id: session.cartRequestId,
              event_type: event.type,
              error_code: code,
            }),
          );
        },
      ),
    );
  } catch (caught) {
    const code =
      caught instanceof MessengerDomainError
        ? caught.code
        : "MESSENGER_WEBHOOK_FAILED";
    await updateWebhookEvent(eventKey, env, "FAILED", undefined, code);
  }
}

export async function handleMessengerWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  try {
    const config = messengerConfig(env);
    const url = new URL(request.url);
    if (request.method === "GET") {
      const mode = url.searchParams.get("hub.mode") ?? "";
      const token = url.searchParams.get("hub.verify_token") ?? "";
      const challenge = url.searchParams.get("hub.challenge") ?? "";
      const expected = new TextEncoder().encode(config.webhookVerifyToken);
      const supplied = new TextEncoder().encode(token);
      if (
        mode === "subscribe" &&
        challenge &&
        safeEqual(expected, supplied)
      )
        return new Response(challenge, {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      return error("META_VERIFY_TOKEN_INVALID", "Webhook không hợp lệ.", 403);
    }
    if (request.method !== "POST")
      return error("METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.", 405);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > maxWebhookBytes)
      return error("VALIDATION_ERROR", "Webhook quá lớn.", 413);
    const rawBody = await request.arrayBuffer();
    if (rawBody.byteLength > maxWebhookBytes)
      return error("VALIDATION_ERROR", "Webhook quá lớn.", 413);
    if (
      !(await verifyMetaSignature(
        rawBody,
        request.headers.get("x-hub-signature-256"),
        config.appSecret,
      ))
    )
      return error("META_SIGNATURE_INVALID", "Chữ ký Meta không hợp lệ.", 403);
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return error("VALIDATION_ERROR", "Webhook không hợp lệ.", 400);
    }
    const now = new Date().toISOString();
    for (const event of parseMessengerWebhook(payload)) {
      const recorded = await recordWebhookEvent(event, env, now);
      if (!recorded.inserted) continue;
      await processWebhookEvent(event, recorded.eventKey, env, ctx, now);
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (caught) {
    if (caught instanceof MessengerDomainError)
      return error(caught.code, caught.message, caught.status);
    return error("META_CONFIG_MISSING", "Messenger chưa được cấu hình.", 503);
  }
}

export async function retryMessengerDelivery(id: string, env: Env) {
  const row = await env.DB.prepare(
    `SELECT messenger_delivery_status AS deliveryStatus,
      messenger_last_user_interaction_at AS lastInteractionAt,
      messenger_attempt_count AS attemptCount
     FROM cart_requests WHERE id = ? AND contact_channel = 'MESSENGER'`,
  )
    .bind(id)
    .first<{
      deliveryStatus: string;
      lastInteractionAt: string | null;
      attemptCount: number;
    }>();
  if (!row)
    return error("MESSENGER_SESSION_NOT_FOUND", "Không tìm thấy giỏ hàng Messenger.", 404);
  if (row.deliveryStatus !== "FAILED")
    return error("VALIDATION_ERROR", "Chỉ có thể thử lại giỏ hàng gửi lỗi.", 409);
  if (row.attemptCount >= 5)
    return error("RATE_LIMITED", "Giỏ hàng đã đạt giới hạn thử gửi lại.", 429);
  if (
    !row.lastInteractionAt ||
    Date.now() - new Date(row.lastInteractionAt).getTime() >= messagingWindowMs
  )
    return error(
      "MESSAGING_WINDOW_EXPIRED",
      "Đã hết cửa sổ phản hồi Messenger cho phép.",
      409,
    );
  try {
    await deliverCartSummary(id, env);
    const status = await env.DB.prepare(
      "SELECT messenger_delivery_status AS deliveryStatus FROM cart_requests WHERE id = ?",
    )
      .bind(id)
      .first<{ deliveryStatus: string }>();
    if (status?.deliveryStatus !== "SENT")
      return error("MESSENGER_SEND_FAILED", "Chưa thể gửi lại Messenger.", 502);
    return json({ success: true, messengerDeliveryStatus: "SENT" });
  } catch {
    return error("MESSENGER_SEND_FAILED", "Chưa thể gửi lại Messenger.", 502);
  }
}
