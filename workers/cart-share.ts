import { getPublicImageUrl, normalizeR2Key } from "../shared/images";
import { generatePublicCode, type PricedItem } from "./services";

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

type ShareRequestRow = {
  id: string;
  publicCode: string;
  submissionToken: string;
  itemLineCount: number;
  totalQuantity: number;
  subtotalVnd: number;
  createdAt: string;
  contactChannel: string;
};

type ShareLinkRow = {
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
};

type SnapshotRow = {
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
  // @ts-expect-error Secret chỉ được Wrangler inject ở runtime, không khai báo trong vars.
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
}) {
  const maximumLines = Math.min(input.items.length, 8);
  const build = (count: number) => {
    const lines = ["🛒 GIỎ HÀNG BABYJOY", `Mã: ${input.code}`, ""];
    input.items.slice(0, count).forEach((item) => {
      lines.push(
        `• ${item.productName} — ${item.variantName} × ${item.quantity}`,
        `  ${formatVnd(item.lineTotalVnd)}`,
        "",
      );
    });
    if (input.items.length > count)
      lines.push(`+ ${input.items.length - count} sản phẩm khác`, "");
    lines.push(
      `Tạm tính: ${formatVnd(input.subtotalVnd)}`,
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
  return json({
    mode: "DIRECT_SELLER_SHARE",
    enabled: isDirectSellerShareEnabled(env) && Boolean(seller),
    seller,
    webShareAvailableServerHint: true,
    // Trường legacy giữ storefront cũ hoạt động khi flag cutover còn tắt.
    messengerCheckoutEnabled:
      !isDirectSellerShareEnabled(env) &&
      env.MESSENGER_CHECKOUT_ENABLED.trim().toLowerCase() === "true",
  });
}

async function loadPricedItems(body: CartSharePrepareBody, env: Env) {
  const placeholders = body.items.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT v.id AS variantId, v.name AS variantName, v.sku,
      v.price_vnd AS priceVnd, v.availability, p.id AS productId,
      p.name AS productName, p.status AS productStatus,
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
  const byId = new Map(rows.results.map((row) => [row.variantId, row]));
  const unavailable: string[] = [];
  const changed: Array<{
    variantId: string;
    displayedPrice: number;
    currentPrice: number;
  }> = [];
  const pricedItems = body.items.map((item) => {
    const row = byId.get(item.variantId);
    if (!row) throw new Error("VARIANT_NOT_FOUND");
    if (row.productStatus !== "AVAILABLE" || row.availability !== "AVAILABLE")
      unavailable.push(item.variantId);
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
      lineTotalVnd: row.priceVnd * item.quantity,
    } satisfies PricedItem;
  });
  return { pricedItems, unavailable, changed };
}

async function findShareRequest(submissionToken: string, env: Env) {
  return env.DB.prepare(
    `SELECT id, public_code AS publicCode, submission_token AS submissionToken,
      item_line_count AS itemLineCount, total_quantity AS totalQuantity,
      subtotal_vnd AS subtotalVnd, created_at AS createdAt,
      contact_channel AS contactChannel
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
    `SELECT product_name_snapshot AS productName,
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
) {
  const expectedHash = await hashShareToken(rawToken);
  if (expectedHash !== link.tokenHash || link.revokedAt)
    throw new Error("SHARE_LINK_RECOVERY_FAILED");
  const items = await loadSnapshots(row.id, env);
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
  });
  return {
    success: true,
    cartRequest: {
      code: row.publicCode,
      itemLineCount: row.itemLineCount,
      totalQuantity: row.totalQuantity,
      subtotalVnd: row.subtotalVnd,
      createdAt: row.createdAt,
    },
    share: {
      title: `Giỏ hàng BabyJoy ${row.publicCode}`,
      text,
      url,
      copyText: text,
      expiresAt: link.expiresAt,
    },
    seller,
  };
}

export async function prepareCartShare(request: Request, env: Env) {
  const startedAt = Date.now();
  console.info(JSON.stringify({ event: "cart_share_prepare_started" }));
  if (!isDirectSellerShareEnabled(env))
    return failure("FEATURE_DISABLED", "Tính năng chốt giỏ hàng chưa được bật.", 404);
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

  let loaded: Awaited<ReturnType<typeof loadPricedItems>>;
  try {
    loaded = await loadPricedItems(body, env);
  } catch {
    return failure("VARIANT_NOT_FOUND", "Một phân loại sản phẩm không còn tồn tại.", 404);
  }
  if (loaded.unavailable.length)
    return failure(
      "VARIANT_UNAVAILABLE",
      "Một số sản phẩm hiện không còn sẵn sàng.",
      409,
      { variantIds: loaded.unavailable },
    );
  const subtotalVnd = loaded.pricedItems.reduce(
    (sum, item) => sum + item.lineTotalVnd,
    0,
  );
  const totalQuantity = loaded.pricedItems.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
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
  const statements = [
    env.DB.prepare(
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
      loaded.pricedItems.length,
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
    itemLineCount: loaded.pricedItems.length,
    totalQuantity,
    subtotalVnd,
    createdAt,
    contactChannel: "SHARE",
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
  const tokenHash = await hashShareToken(rawToken);
  const row = await env.DB.prepare(
    `SELECT c.id, c.public_code AS code, c.created_at AS createdAt,
      c.item_line_count AS itemLineCount, c.total_quantity AS totalQuantity,
      c.subtotal_vnd AS subtotalVnd, l.expires_at AS expiresAt,
      l.revoked_at AS revokedAt
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
      items: items.map((item) => ({
        productName: item.productName,
        variantName: item.variantName,
        imageUrl: getPublicImageUrl(item.imageKey),
        unitPriceVnd: item.unitPriceVnd,
        quantity: item.quantity,
        lineTotalVnd: item.lineTotalVnd,
      })),
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
      label: "Người bán BabyJoy",
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
