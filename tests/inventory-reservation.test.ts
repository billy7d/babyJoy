import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../workers/app";
import {
  cleanupExpiredReservations,
  getCheckoutReservationConfig,
} from "../workers/inventory";
import {
  DEFAULT_CHECKOUT_RESERVATION_MINUTES,
  formatReservationDuration,
  reservationDurationMs,
} from "../shared/reservation";

function migration(name: string) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

class SqliteStatementAdapter {
  private values: unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]) {
    const next = new SqliteStatementAdapter(this.statement);
    next.values = values;
    return next;
  }

  all<T>() {
    return Promise.resolve({ results: this.statement.all(...this.values) as T[] });
  }

  first<T>() {
    return Promise.resolve((this.statement.get(...this.values) as T | undefined) ?? null);
  }

  run() {
    const result = this.statement.run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }
}

class SqliteD1Adapter {
  constructor(readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteStatementAdapter(this.database.prepare(sql));
  }

  async batch(statements: SqliteStatementAdapter[]) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (caught) {
      this.database.exec("ROLLBACK");
      throw caught;
    }
  }
}

const databases: DatabaseSync[] = [];
const migrations = [
  "0001_initial.sql",
  "0002_seed.sql",
  "0003_messenger_checkout_v1.sql",
  "0004_direct_seller_cart_share_v1.sql",
  "0005_remove_demo_cart_request.sql",
  "0006_product_taxonomy_v1.sql",
  "0007_storefront_access_gate_v1.sql",
  "0008_cleanup_test_products.sql",
  "0009_cleanup_seed_test_products.sql",
  "0010_storefront_brand_v1.sql",
  "0011_promotion_management_p0_p1.sql",
  "0012_inventory_messenger_reservation.sql",
];

function createEnv() {
  const database = new DatabaseSync(":memory:");
  migrations.forEach((name) => database.exec(migration(name)));
  database.exec(`
    INSERT INTO app_settings (key, value, updated_at) VALUES
      ('seller_display_name', 'Nguyễn A', CURRENT_TIMESTAMP),
      ('seller_contact_label', 'Người bán BabyJoy', CURRENT_TIMESTAMP),
      ('seller_messenger_url', 'https://m.me/nguyena', CURRENT_TIMESTAMP),
      ('seller_avatar_key', '', CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
  `);
  databases.push(database);
  return {
    database,
    env: {
      DB: new SqliteD1Adapter(database),
      PRODUCT_IMAGES: { head: async () => ({}) },
      ENVIRONMENT: "development",
      ACCESS_TEAM_DOMAIN: "",
      ACCESS_AUD: "",
      DIRECT_SELLER_SHARE_ENABLED: "true",
      MESSENGER_CHECKOUT_ENABLED: "false",
      CART_SHARE_SECRET: "test-cart-share-secret-that-is-long-enough-123",
      STOREFRONT_ACCESS_GATE_ENABLED: "false",
  } as unknown as Env,
  };
}

function createPreInventoryDatabase() {
  const database = new DatabaseSync(":memory:");
  migrations.slice(0, -1).forEach((name) => database.exec(migration(name)));
  database
    .prepare(
      `INSERT INTO products (id, name, slug, status, featured, sort_order, created_at, updated_at)
       VALUES ('legacy-history-product', 'Sản phẩm lịch sử', 'legacy-history-product', 'AVAILABLE', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO product_variants (
        id, product_id, name, sku, price_vnd, availability,
        sort_order, created_at, updated_at
      ) VALUES ('legacy-history-variant', 'legacy-history-product', 'Hộp cũ', 'LEGACY-HISTORY-SKU', 100000, 'AVAILABLE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .run();
  databases.push(database);
  return database;
}

afterEach(() => {
  vi.useRealTimers();
  while (databases.length) databases.pop()?.close();
});

function api(env: Env, path: string, init?: RequestInit) {
  return worker.fetch(
    new Request(`https://metraphuong.com${path}`, init),
    env,
    {} as ExecutionContext,
  );
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function setClock(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

function seedVariant(
  database: DatabaseSync,
  suffix: string,
  stockOnHand: number,
  options: { trackInventory?: boolean; priceVnd?: number } = {},
) {
  const productId = `inventory-product-${suffix}`;
  const variantId = `inventory-variant-${suffix}`;
  database
    .prepare(
      `INSERT INTO products (id, name, slug, status, featured, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'AVAILABLE', 0, 99, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .run(productId, `Sản phẩm ${suffix}`, `inventory-product-${suffix}`);
  database
    .prepare(
      `INSERT INTO product_variants (
        id, product_id, name, sku, price_vnd, availability,
        track_inventory, stock_on_hand, reserved_quantity,
        sort_order, created_at, updated_at
      ) VALUES (?, ?, 'Hộp test', ?, ?, 'AVAILABLE', ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .run(
      variantId,
      productId,
      `INVENTORY-${suffix}`,
      options.priceVnd ?? 100000,
      options.trackInventory === false ? 0 : 1,
      stockOnHand,
    );
  return { productId, variantId };
}

function prepareBody(submissionToken: string, variantId: string, quantity = 1) {
  return {
    submissionToken,
    acceptCurrentPrices: false,
    items: [{ variantId, quantity, displayedPrice: 100000 }],
  };
}

async function prepare(env: Env, submissionToken: string, variantId: string) {
  return api(
    env,
    "/api/cart/share/prepare",
    jsonInit("POST", prepareBody(submissionToken, variantId)),
  );
}

async function activate(env: Env, submissionToken: string, variantId: string) {
  return api(
    env,
    "/api/cart/share/activate",
    jsonInit("POST", prepareBody(submissionToken, variantId)),
  );
}

function requestRow(database: DatabaseSync, submissionToken: string) {
  return database
    .prepare(
      `SELECT id, checkout_state AS checkoutState,
        reservation_started_at AS reservationStartedAt,
        reservation_expires_at AS reservationExpiresAt,
        reservation_duration_minutes AS reservationDurationMinutes
       FROM cart_requests WHERE submission_token = ?`,
    )
    .get(submissionToken) as {
    id: string;
    checkoutState: string;
    reservationStartedAt: string | null;
    reservationExpiresAt: string | null;
    reservationDurationMinutes: number | null;
  };
}

describe("Configurable inventory and promotion reservation", () => {
  it("upgrade DB hiện hữu theo kiểu expand-only và giữ catalog/cart/promotion history", () => {
    const database = createPreInventoryDatabase();
    const sourceVariant = database
      .prepare(
        `SELECT v.id AS variantId, v.product_id AS productId
         FROM product_variants v ORDER BY v.id LIMIT 1`,
      )
      .get() as { variantId: string; productId: string };
    const requestId = "legacy-history-request";
    const promotionId = "legacy-history-promotion";
    database
      .prepare(
        `INSERT INTO cart_requests (
          id, public_code, submission_token, customer_name, customer_phone,
          item_line_count, total_quantity, subtotal_vnd, status, telegram_status,
          contact_channel, messenger_delivery_status, promotion_discount_vnd,
          final_total_vnd, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, 1, 100000, 'SUBMITTED', 'NOT_APPLICABLE',
          'SHARE', 'NOT_APPLICABLE', 10000, 90000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(
        requestId,
        "GH-LEGACY-HISTORY",
        "legacy-history-token",
        "Khách cũ",
        "0900000000",
      );
    database
      .prepare(
        `INSERT INTO cart_request_items (
          id, cart_request_id, product_id, variant_id, product_name_snapshot,
          variant_name_snapshot, sku_snapshot, image_key_snapshot,
          unit_price_vnd, quantity, line_total_vnd, created_at
        ) VALUES (?, ?, ?, ?, 'Sản phẩm cũ', 'Phân loại cũ', 'OLD-SKU', NULL,
          100000, 1, 100000, CURRENT_TIMESTAMP)`,
      )
      .run(
        "legacy-history-item",
        requestId,
        sourceVariant.productId,
        sourceVariant.variantId,
      );
    database
      .prepare(
        `INSERT INTO promotions (
          id, name, description, type, status, priority, stackable,
          usage_count_total, config_json, created_at, updated_at
        ) VALUES (?, 'Khuyến mãi cũ', '', 'ORDER_FIXED_DISCOUNT', 'ACTIVE',
          1, 0, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(
        promotionId,
        JSON.stringify({
          type: "ORDER_FIXED_DISCOUNT",
          minimumSubtotal: 1,
          discountAmount: 10000,
        }),
      );
    database
      .prepare(
        `INSERT INTO cart_request_promotions (
          id, cart_request_id, promotion_id, promotion_name_snapshot,
          promotion_type_snapshot, discount_amount_vnd, config_snapshot, created_at
        ) VALUES (?, ?, ?, 'Khuyến mãi cũ', 'ORDER_FIXED_DISCOUNT', 10000, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        "legacy-history-promotion-snapshot",
        requestId,
        promotionId,
        JSON.stringify({ type: "ORDER_FIXED_DISCOUNT" }),
      );
    database
      .prepare(
        `INSERT INTO promotion_redemptions (
          id, promotion_id, cart_request_id, customer_key, created_at
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run("legacy-history-redemption", promotionId, requestId, "legacy-customer");

    database.exec(migration("0012_inventory_messenger_reservation.sql"));

    expect(
      database
        .prepare(
          "SELECT track_inventory, stock_on_hand, reserved_quantity FROM product_variants WHERE id = ?",
        )
        .get(sourceVariant.variantId),
    ).toEqual({ track_inventory: 0, stock_on_hand: 0, reserved_quantity: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_requests").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_request_items").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_request_promotions").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM promotion_redemptions").get()).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('inventory_reservations', 'promotion_reservations', 'inventory_movements') ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: "inventory_movements" },
      { name: "inventory_reservations" },
      { name: "promotion_reservations" },
    ]);
    expect(
      database
        .prepare("SELECT value FROM app_settings WHERE key = 'checkout_reservation_minutes'")
        .get(),
    ).toEqual({ value: "15" });
  });

  it("customer copy dùng formatter động và seller countdown đọc deadline persisted", () => {
    const pages = readFileSync(new URL("../app/components/public-pages.tsx", import.meta.url), "utf8");
    const admin = readFileSync(new URL("../app/components/admin-pages.tsx", import.meta.url), "utf8");
    expect(pages).toContain("Gửi ngay để giữ hàng & ưu đãi ${formatReservationDuration(reservationMinutes)}");
    expect(pages).toContain("Sau khi bạn bấm gửi, hệ thống sẽ giữ tối đa {formatReservationDuration(reservationMinutes)}");
    expect(pages).not.toContain("Gửi ngay để giữ hàng & ưu đãi 15 phút");
    expect(admin).toContain("formatReservationRemaining(detail.reservationExpiresAt, now)");
    expect(admin).toContain("formatReservationDuration(detail.reservationDurationMinutes)");
  });

  it("format đúng các boundary TTL và fallback default khi setting thiếu hoặc hỏng", async () => {
    const { database, env } = createEnv();
    expect(
      [
        [3, "3 phút"],
        [15, "15 phút"],
        [60, "1 giờ"],
        [90, "1 giờ 30 phút"],
        [120, "2 giờ"],
        [720, "12 giờ"],
        [1440, "24 giờ"],
      ],
    ).toEqual(
      [3, 15, 60, 90, 120, 720, 1440].map((minutes) => [
        minutes,
        formatReservationDuration(minutes),
      ]),
    );
    database.prepare("DELETE FROM app_settings WHERE key = 'checkout_reservation_minutes'").run();
    const missing = await api(env, "/api/admin/settings/checkout");
    expect(await missing.json()).toMatchObject({
      data: { checkoutReservationMinutes: DEFAULT_CHECKOUT_RESERVATION_MINUTES },
    });
    database
      .prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
      .run("checkout_reservation_minutes", "not-a-number");
    const malformed = await api(env, "/api/admin/settings/checkout");
    expect(await malformed.json()).toMatchObject({
      data: { checkoutReservationMinutes: DEFAULT_CHECKOUT_RESERVATION_MINUTES },
    });
    const config = await getCheckoutReservationConfig(env);
    expect(config).toMatchObject({
      minutes: DEFAULT_CHECKOUT_RESERVATION_MINUTES,
      reservationMinutes: DEFAULT_CHECKOUT_RESERVATION_MINUTES,
      durationMs: reservationDurationMs(DEFAULT_CHECKOUT_RESERVATION_MINUTES),
    });
  });

  it("enforce đúng min/max và cho phép 61 đến 1440 phút", async () => {
    const { database, env } = createEnv();
    for (const value of [3, 15, 60, 61, 120, 720, 1439, 1440]) {
      const response = await api(
        env,
        "/api/admin/settings/checkout",
        jsonInit("PUT", { checkoutReservationMinutes: value }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: { checkoutReservationMinutes: value },
      });
    }
    const previous = database
      .prepare("SELECT value FROM app_settings WHERE key = 'checkout_reservation_minutes'")
      .get() as { value: string };
    for (const value of [2, 1441, -1, 1.5, "120"]) {
      const response = await api(
        env,
        "/api/admin/settings/checkout",
        jsonInit("PUT", { checkoutReservationMinutes: value }),
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        success: false,
        error: { code: "VALIDATION_ERROR" },
      });
    }
    expect(
      database
        .prepare("SELECT value FROM app_settings WHERE key = 'checkout_reservation_minutes'")
        .get(),
    ).toEqual(previous);
  });

  it("Chốt giỏ không giữ hàng; activation snapshot TTL 24 giờ và retry không extend", async () => {
    setClock("2026-08-31T10:00:00.000Z");
    const { database, env } = createEnv();
    const { variantId } = seedVariant(database, "prepare", 1);
    const token = "inventory-prepare-activation";
    const prepared = await prepare(env, token, variantId);
    expect(prepared.status).toBe(201);
    expect(requestRow(database, token)).toMatchObject({
      checkoutState: "READY_TO_SEND",
      reservationStartedAt: null,
      reservationExpiresAt: null,
      reservationDurationMinutes: null,
    });
    expect(database.prepare("SELECT reserved_quantity FROM product_variants WHERE id = ?").get(variantId)).toEqual({ reserved_quantity: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM inventory_reservations").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM promotion_reservations").get()).toEqual({ count: 0 });

    const setting = await api(
      env,
      "/api/admin/settings/checkout",
      jsonInit("PUT", { checkoutReservationMinutes: 1440 }),
    );
    expect(setting.status).toBe(200);
    const activated = await activate(env, token, variantId);
    expect(activated.status).toBe(200);
    const activatedBody = (await activated.json()) as {
      cartRequest: {
        checkoutState: string;
        reservationStartedAt: string;
        reservationExpiresAt: string;
        reservationDurationMinutes: number;
      };
      serverNow: string;
    };
    expect(activatedBody).toMatchObject({
      cartRequest: {
        checkoutState: "WAITING_SELLER_CONFIRM",
        reservationStartedAt: "2026-08-31T10:00:00.000Z",
        reservationExpiresAt: "2026-09-01T10:00:00.000Z",
        reservationDurationMinutes: 1440,
      },
      serverNow: "2026-08-31T10:00:00.000Z",
    });
    expect(database.prepare("SELECT stock_on_hand, reserved_quantity FROM product_variants WHERE id = ?").get(variantId)).toEqual({ stock_on_hand: 1, reserved_quantity: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM inventory_reservations WHERE status = 'ACTIVE'").get()).toEqual({ count: 1 });

    const retry = await activate(env, token, variantId);
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { cartRequest: { reservationExpiresAt: string } };
    expect(retryBody.cartRequest.reservationExpiresAt).toBe("2026-09-01T10:00:00.000Z");
    expect(database.prepare("SELECT COUNT(*) AS count FROM inventory_reservations").get()).toEqual({ count: 1 });
    const bypass = await api(
      env,
      `/api/admin/cart-requests/${requestRow(database, token).id}/status`,
      jsonInit("PATCH", { status: "CONFIRMED" }),
    );
    expect(bypass.status).toBe(409);
    expect(await bypass.json()).toMatchObject({ error: { code: "INVALID_ORDER_TRANSITION" } });
  });

  it("setting mới chỉ áp dụng order mới, confirm consume và expiry retry tạo reservation mới", async () => {
    setClock("2026-08-31T10:00:00.000Z");
    const { database, env } = createEnv();
    const first = seedVariant(database, "first", 1);
    const second = seedVariant(database, "second", 1);
    await api(env, "/api/admin/settings/checkout", jsonInit("PUT", { checkoutReservationMinutes: 1440 }));
    await prepare(env, "ttl-first", first.variantId);
    await activate(env, "ttl-first", first.variantId);
    const firstRow = requestRow(database, "ttl-first");
    expect(firstRow.reservationExpiresAt).toBe("2026-09-01T10:00:00.000Z");

    await api(env, "/api/admin/settings/checkout", jsonInit("PUT", { checkoutReservationMinutes: 5 }));
    setClock("2026-08-31T10:01:00.000Z");
    await prepare(env, "ttl-second", second.variantId);
    await activate(env, "ttl-second", second.variantId);
    const secondRow = requestRow(database, "ttl-second");
    expect(secondRow.reservationDurationMinutes).toBe(5);
    expect(secondRow.reservationExpiresAt).toBe("2026-08-31T10:06:00.000Z");
    expect(requestRow(database, "ttl-first").reservationExpiresAt).toBe("2026-09-01T10:00:00.000Z");

    const confirm = await api(
      env,
      `/api/admin/cart-requests/${firstRow.id}/confirm`,
      { method: "POST" },
    );
    expect(confirm.status).toBe(200);
    expect(database.prepare("SELECT stock_on_hand, reserved_quantity FROM product_variants WHERE id = ?").get(first.variantId)).toEqual({ stock_on_hand: 0, reserved_quantity: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE variant_id = ? AND movement_type = 'ORDER_CONFIRMED'").get(first.variantId)).toEqual({ count: 1 });
    const confirmAgain = await api(env, `/api/admin/cart-requests/${firstRow.id}/confirm`, { method: "POST" });
    expect(confirmAgain.status).toBe(200);
    expect(database.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE variant_id = ? AND movement_type = 'ORDER_CONFIRMED'").get(first.variantId)).toEqual({ count: 1 });

    setClock("2026-08-31T10:07:00.000Z");
    expect(await cleanupExpiredReservations(env, new Date())).toBe(1);
    expect(requestRow(database, "ttl-second").checkoutState).toBe("EXPIRED");
    expect(database.prepare("SELECT reserved_quantity FROM product_variants WHERE id = ?").get(second.variantId)).toEqual({ reserved_quantity: 0 });
    const expiredConfirm = await api(
      env,
      `/api/admin/cart-requests/${requestRow(database, "ttl-second").id}/confirm`,
      { method: "POST" },
    );
    expect(expiredConfirm.status).toBe(409);
    expect(await expiredConfirm.json()).toMatchObject({
      error: { code: "ORDER_EXPIRED" },
    });
    const retry = await activate(env, "ttl-second", second.variantId);
    expect(retry.status).toBe(200);
    const retried = requestRow(database, "ttl-second");
    expect(retried.checkoutState).toBe("WAITING_SELLER_CONFIRM");
    expect(retried.reservationStartedAt).toBe("2026-08-31T10:07:00.000Z");
    expect(retried.reservationExpiresAt).toBe("2026-08-31T10:12:00.000Z");
    expect(database.prepare("SELECT COUNT(*) AS count FROM inventory_reservations WHERE cart_request_id = ?").get(retried.id)).toEqual({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM inventory_reservations WHERE cart_request_id = ? AND status = 'ACTIVE'").get(retried.id)).toEqual({ count: 1 });
  });

  it("activation đối chiếu giá snapshot thay vì tin displayedPrice từ client", async () => {
    setClock("2026-08-31T10:00:00.000Z");
    const { database, env } = createEnv();
    const { productId, variantId } = seedVariant(database, "snapshot-price", 1);
    const token = "snapshot-price-activation";
    expect((await prepare(env, token, variantId)).status).toBe(201);
    database
      .prepare("UPDATE product_variants SET price_vnd = ? WHERE id = ? AND product_id = ?")
      .run(120000, variantId, productId);
    const response = await api(
      env,
      "/api/cart/share/activate",
      jsonInit("POST", {
        submissionToken: token,
        acceptCurrentPrices: false,
        items: [{ variantId, quantity: 1, displayedPrice: 120000 }],
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "PRICE_CHANGED" },
    });
    expect(requestRow(database, token).checkoutState).toBe("READY_TO_SEND");
    expect(database.prepare("SELECT reserved_quantity FROM product_variants WHERE id = ?").get(variantId)).toEqual({ reserved_quantity: 0 });
  });

  it("promotion chỉ reserve tại Messenger, dùng cùng deadline và consume đúng một lần khi confirm", async () => {
    setClock("2026-08-31T10:00:00.000Z");
    const { database, env } = createEnv();
    const { variantId } = seedVariant(database, "promotion", 2);
    await api(
      env,
      "/api/admin/settings/checkout",
      jsonInit("PUT", { checkoutReservationMinutes: 1440 }),
    );
    const promotionId = "promotion-reservation-test";
    database
      .prepare(
        `INSERT INTO promotions (
          id, name, description, type, status, priority, stackable,
          usage_limit_total, usage_count_total, config_json, created_at, updated_at
        ) VALUES (?, 'Giảm test', '', 'ORDER_FIXED_DISCOUNT', 'ACTIVE', 10, 0, 1, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(
        promotionId,
        JSON.stringify({ type: "ORDER_FIXED_DISCOUNT", minimumSubtotal: 1, discountAmount: 1000 }),
      );
    const token = "promotion-reservation";
    const prepared = await prepare(env, token, variantId);
    expect(prepared.status).toBe(201);
    expect(database.prepare("SELECT usage_count_total FROM promotions WHERE id = ?").get(promotionId)).toEqual({ usage_count_total: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM promotion_reservations").get()).toEqual({ count: 0 });
    const activated = await activate(env, token, variantId);
    expect(activated.status).toBe(200);
    const row = requestRow(database, token);
    const promotionReservation = database
      .prepare("SELECT status, expires_at AS expiresAt FROM promotion_reservations WHERE cart_request_id = ?")
      .get(row.id) as { status: string; expiresAt: string };
    expect(promotionReservation).toEqual({ status: "ACTIVE", expiresAt: row.reservationExpiresAt });
    expect(database.prepare("SELECT usage_count_total FROM promotions WHERE id = ?").get(promotionId)).toEqual({ usage_count_total: 0 });
    const confirmed = await api(env, `/api/admin/cart-requests/${row.id}/confirm`, { method: "POST" });
    expect(confirmed.status).toBe(200);
    expect(database.prepare("SELECT usage_count_total FROM promotions WHERE id = ?").get(promotionId)).toEqual({ usage_count_total: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM promotion_redemptions WHERE promotion_id = ?").get(promotionId)).toEqual({ count: 1 });
    const confirmedAgain = await api(env, `/api/admin/cart-requests/${row.id}/confirm`, { method: "POST" });
    expect(confirmedAgain.status).toBe(200);
    expect(database.prepare("SELECT COUNT(*) AS count FROM promotion_redemptions WHERE promotion_id = ?").get(promotionId)).toEqual({ count: 1 });
  });

  it("seller cancel giải phóng inventory/promotion ngay và lặp lại không trừ thêm", async () => {
    setClock("2026-08-31T10:00:00.000Z");
    const { database, env } = createEnv();
    const { variantId } = seedVariant(database, "cancel", 1);
    const token = "cancel-reservation";
    await prepare(env, token, variantId);
    await activate(env, token, variantId);
    const row = requestRow(database, token);
    const cancelled = await api(
      env,
      `/api/admin/cart-requests/${row.id}/cancel`,
      { method: "POST" },
    );
    expect(cancelled.status).toBe(200);
    expect(requestRow(database, token).checkoutState).toBe("CANCELLED");
    expect(database.prepare("SELECT stock_on_hand, reserved_quantity FROM product_variants WHERE id = ?").get(variantId)).toEqual({ stock_on_hand: 1, reserved_quantity: 0 });
    expect(database.prepare("SELECT status, release_reason AS releaseReason FROM inventory_reservations WHERE cart_request_id = ?").get(row.id)).toEqual({ status: "RELEASED", releaseReason: "SELLER_CANCELLED" });
    const cancelledAgain = await api(
      env,
      `/api/admin/cart-requests/${row.id}/cancel`,
      { method: "POST" },
    );
    expect(cancelledAgain.status).toBe(200);
    expect(database.prepare("SELECT stock_on_hand, reserved_quantity FROM product_variants WHERE id = ?").get(variantId)).toEqual({ stock_on_hand: 1, reserved_quantity: 0 });
  });

  it("quà tặng vật lý cũng reserve và consume cùng một deadline", async () => {
    setClock("2026-08-31T10:00:00.000Z");
    const { database, env } = createEnv();
    const main = seedVariant(database, "gift-main", 2);
    const gift = seedVariant(database, "gift-item", 1);
    await api(env, "/api/admin/settings/checkout", jsonInit("PUT", { checkoutReservationMinutes: 1440 }));
    const promotionId = "promotion-gift-reservation-test";
    database
      .prepare(
        `INSERT INTO promotions (
          id, name, description, type, status, priority, stackable,
          usage_count_total, config_json, created_at, updated_at
        ) VALUES (?, 'Tặng quà test', '', 'ORDER_GIFT', 'ACTIVE', 10, 0, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(
        promotionId,
        JSON.stringify({
          type: "ORDER_GIFT",
          minimumSubtotal: 1,
          giftProductId: gift.productId,
          giftQuantity: 1,
        }),
      );
    const token = "gift-reservation";
    await prepare(env, token, main.variantId);
    const activated = await activate(env, token, main.variantId);
    expect(activated.status).toBe(200);
    const row = requestRow(database, token);
    const reservations = database
      .prepare(
        "SELECT variant_id AS variantId, source_type AS sourceType, status, expires_at AS expiresAt FROM inventory_reservations WHERE cart_request_id = ? ORDER BY source_type",
      )
      .all(row.id) as Array<{ variantId: string; sourceType: string; status: string; expiresAt: string }>;
    expect(reservations).toEqual([
      { variantId: main.variantId, sourceType: "CART_ITEM", status: "ACTIVE", expiresAt: row.reservationExpiresAt },
      { variantId: gift.variantId, sourceType: "PROMOTION_GIFT", status: "ACTIVE", expiresAt: row.reservationExpiresAt },
    ]);
    expect(database.prepare("SELECT expires_at AS expiresAt FROM promotion_reservations WHERE cart_request_id = ?").get(row.id)).toEqual({ expiresAt: row.reservationExpiresAt });
    expect(database.prepare("SELECT reserved_quantity FROM product_variants WHERE id = ?").get(gift.variantId)).toEqual({ reserved_quantity: 1 });
    const confirmed = await api(env, `/api/admin/cart-requests/${row.id}/confirm`, { method: "POST" });
    expect(confirmed.status).toBe(200);
    expect(database.prepare("SELECT stock_on_hand, reserved_quantity FROM product_variants WHERE id = ?").get(main.variantId)).toEqual({ stock_on_hand: 1, reserved_quantity: 0 });
    expect(database.prepare("SELECT stock_on_hand, reserved_quantity FROM product_variants WHERE id = ?").get(gift.variantId)).toEqual({ stock_on_hand: 0, reserved_quantity: 0 });
    expect(database.prepare("SELECT usage_count_total FROM promotions WHERE id = ?").get(promotionId)).toEqual({ usage_count_total: 1 });
  });

  it("race hai activation chỉ giữ được một stock cuối cùng", async () => {
    setClock("2026-08-31T10:00:00.000Z");
    const { database, env } = createEnv();
    const { variantId } = seedVariant(database, "race", 1);
    expect((await prepare(env, "race-a", variantId)).status).toBe(201);
    expect((await prepare(env, "race-b", variantId)).status).toBe(201);
    const responses = await Promise.all([
      activate(env, "race-a", variantId),
      activate(env, "race-b", variantId),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const body = await responses.find((response) => response.status === 409)!.json();
    expect(body).toMatchObject({ error: { code: "INSUFFICIENT_STOCK" } });
    expect(database.prepare("SELECT stock_on_hand, reserved_quantity FROM product_variants WHERE id = ?").get(variantId)).toEqual({ stock_on_hand: 1, reserved_quantity: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM inventory_reservations WHERE status = 'ACTIVE'").get()).toEqual({ count: 1 });
  });

  it("pagination public lọc tracked variant theo tồn khả dụng và trả metadata", async () => {
    const { database, env } = createEnv();
    const unavailable = seedVariant(database, "pagination-oos", 0);
    const available = seedVariant(database, "pagination-available", 1);

    const response = await api(env, "/api/products?available=1&limit=24&page=1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{
        id: string;
        variants?: Array<{
          id: string;
          trackInventory?: boolean;
          availableQuantity?: number;
        }>;
      }>;
      pagination: {
        page: number;
        limit: number;
        totalItems: number;
        totalPages: number;
        hasPrevious: boolean;
        hasNext: boolean;
      };
    };
    expect(body.pagination).toMatchObject({
      page: 1,
      limit: 24,
      totalItems: expect.any(Number),
      totalPages: expect.any(Number),
      hasPrevious: false,
    });
    expect(body.data.some((product) => product.id === unavailable.productId)).toBe(false);
    const availableProduct = body.data.find((product) => product.id === available.productId);
    expect(availableProduct?.variants?.[0]).toMatchObject({
      id: available.variantId,
      trackInventory: true,
      availableQuantity: 1,
    });
    expect(database.prepare("SELECT reserved_quantity FROM product_variants WHERE id = ?").get(unavailable.variantId)).toEqual({ reserved_quantity: 0 });
  });
});
