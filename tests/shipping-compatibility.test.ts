import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";
import {
  activateCartShare,
  deriveShareToken,
  hashShareToken,
  prepareCartShare,
} from "../workers/cart-share";
import { startMessengerCheckout } from "../workers/messenger";
import {
  SHIPPING_PRICING_NOT_READY_CODE,
  shippingPricingWriteBlock,
} from "../shared/shipping";

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

function createEnv(withShippingSchema: boolean, environment: "development" | "production" = "development") {
  const database = new DatabaseSync(":memory:");
  const names = readdirSync(new URL("../migrations", import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  names.forEach((name) => {
    if (!withShippingSchema && name === "0025_shipping_fee_v1.sql") return;
    database.exec(migration(name));
  });
  database.exec(`
    INSERT INTO app_settings (key, value, updated_at) VALUES
      ('seller_display_name', 'Nguyễn A', CURRENT_TIMESTAMP),
      ('seller_contact_label', 'Người bán BabyJoy', CURRENT_TIMESTAMP),
      ('seller_messenger_url', 'https://m.me/nguyena', CURRENT_TIMESTAMP),
      ('seller_avatar_key', '', CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
  `);
  database.prepare(
    `INSERT INTO products (id, name, slug, status, featured, sort_order, created_at, updated_at)
     VALUES ('compatibility-product', 'Compatibility test product', 'compatibility-test-product', 'AVAILABLE', 0, 99, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).run();
  database.prepare(
    `INSERT INTO product_variants (id, product_id, name, sku, price_vnd, availability, sort_order, created_at, updated_at)
     VALUES ('compatibility-variant', 'compatibility-product', 'Hộp 125g', 'COMPAT-125', 125000, 'AVAILABLE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).run();
  const env = {
    DB: new SqliteD1Adapter(database),
    DIRECT_SELLER_SHARE_ENABLED: "true",
    MESSENGER_CHECKOUT_ENABLED: "false",
    STOREFRONT_ACCESS_GATE_ENABLED: "false",
    CART_SHARE_SECRET: "test-cart-share-secret-that-is-long-enough-123",
    PRODUCT_IMAGES: { head: async () => ({}) },
    ENVIRONMENT: environment,
    ACCESS_TEAM_DOMAIN: "",
    ACCESS_AUD: "",
    META_PAGE_ID: "compatibility-page",
    META_APP_SECRET: "compatibility-app-secret",
    MESSENGER_PAGE_USERNAME: "babyjoy-test",
  } as unknown as Env;
  databases.push(database);
  return { database, env };
}

function api(env: Env, path: string, body: unknown) {
  return worker.fetch(
    new Request(`https://metraphuong.com${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    {} as ExecutionContext,
  );
}

const cartItems = [{ variantId: "compatibility-variant", quantity: 1 }];

async function insertLegacyShare(database: DatabaseSync, env: Env) {
  const id = "legacy-compatibility-share";
  const submissionToken = "legacy-compatibility-token";
  const createdAt = "2026-09-16T00:00:00.000Z";
  const rawToken = await deriveShareToken(
    env.CART_SHARE_SECRET,
    id,
    submissionToken,
  );
  database.prepare(
    `INSERT INTO cart_requests (
      id, public_code, submission_token, item_line_count, total_quantity,
      subtotal_vnd, promotion_discount_vnd, final_total_vnd, status,
      telegram_status, contact_channel, messenger_delivery_status,
      checkout_state, created_at, updated_at
    ) VALUES (?, ?, ?, 1, 1, 125000, 0, 125000, 'SUBMITTED',
      'NOT_APPLICABLE', 'SHARE', 'NOT_APPLICABLE', 'READY_TO_SEND', ?, ?)`,
  ).run(id, "GH-LEGACY-COMPAT", submissionToken, createdAt, createdAt);
  database.prepare(
    `INSERT INTO cart_request_items (
      id, cart_request_id, product_id, variant_id, product_name_snapshot,
      variant_name_snapshot, sku_snapshot, image_key_snapshot, unit_price_vnd,
      quantity, line_total_vnd, created_at
    ) VALUES (?, ?, NULL, ?, 'Sản phẩm lịch sử', 'Hộp 227g', NULL, NULL, 125000, 1, 125000, ?)`,
  ).run("legacy-compatibility-item", id, "variant-gerber-227", createdAt);
  database.prepare(
    `INSERT INTO cart_share_links (
      id, cart_request_id, token_hash, expires_at, created_at
    ) VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).run(
    "legacy-compatibility-link",
    id,
    await hashShareToken(rawToken),
    createdAt,
  );
  return { id, submissionToken, rawToken };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("Shipping compatibility release", () => {
  it("chặn ghi mới khi thiếu schema và mở khi schema đã có", () => {
    expect(shippingPricingWriteBlock(false)).toMatchObject({
      code: SHIPPING_PRICING_NOT_READY_CODE,
      status: 503,
    });
    expect(shippingPricingWriteBlock(true)).toBeNull();
    expect(shippingPricingWriteBlock(false, "development")).toBeNull();
    expect(shippingPricingWriteBlock(false, "staging")).toMatchObject({
      code: SHIPPING_PRICING_NOT_READY_CODE,
      status: 503,
    });
  });

  it("old schema + compatibility code: evaluate/prepare/activate không ghi giá sai", async () => {
    const { database, env } = createEnv(false, "production");
    const evaluated = await api(env, "/api/cart/evaluate", { items: cartItems });
    expect(evaluated.status).toBe(503);
    expect(await evaluated.json()).toMatchObject({
      error: { code: SHIPPING_PRICING_NOT_READY_CODE },
    });

    const prepare = await prepareCartShare(
      new Request("https://metraphuong.com/api/cart/share/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionToken: "blocked-legacy-prepare",
          acceptCurrentPrices: true,
          items: cartItems,
        }),
      }),
      env,
    );
    expect(prepare.status).toBe(503);
    expect(await prepare.json()).toMatchObject({
      error: { code: SHIPPING_PRICING_NOT_READY_CODE },
    });

    const legacy = await insertLegacyShare(database, env);
    const activate = await activateCartShare(
      new Request("https://metraphuong.com/api/cart/share/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionToken: legacy.submissionToken,
          acceptCurrentPrices: true,
          items: cartItems,
        }),
      }),
      env,
    );
    expect(activate.status).toBe(503);
    expect(await activate.json()).toMatchObject({
      error: { code: SHIPPING_PRICING_NOT_READY_CODE },
    });
    expect(
      database
        .prepare("SELECT final_total_vnd FROM cart_requests WHERE id = ?")
        .get(legacy.id),
    ).toEqual({ final_total_vnd: 125000 });
  });

  it("old schema + compatibility code: recovery chỉ đọc snapshot lịch sử", async () => {
    const { database, env } = createEnv(false, "production");
    const legacy = await insertLegacyShare(database, env);
    const response = await prepareCartShare(
      new Request("https://metraphuong.com/api/cart/share/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionToken: legacy.submissionToken,
          acceptCurrentPrices: false,
          items: cartItems,
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cartRequest: {
        finalTotalVnd: 125000,
        shippingFeeVnd: 0,
      },
    });
    expect(
      database
        .prepare("SELECT final_total_vnd FROM cart_requests WHERE id = ?")
        .get(legacy.id),
    ).toEqual({ final_total_vnd: 125000 });
  });

  it("old schema + compatibility code: Messenger không tạo Cart Request mới", async () => {
    const { database, env } = createEnv(false, "production");
    const messengerEnv = {
      ...env,
      MESSENGER_CHECKOUT_ENABLED: "true",
    } as Env;
    const response = await startMessengerCheckout(
      new Request("https://metraphuong.com/api/cart/messenger/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionToken: "blocked-legacy-messenger",
          items: cartItems,
        }),
      }),
      messengerEnv,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: SHIPPING_PRICING_NOT_READY_CODE },
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_requests").get()).toEqual({ count: 0 });
  });

  it("new schema + compatibility code: no-promo snapshot có ship một lần", async () => {
    const { database, env } = createEnv(true);
    const evaluated = await api(env, "/api/cart/evaluate", { items: cartItems });
    expect(evaluated.status).toBe(200);
    expect(await evaluated.json()).toMatchObject({
      subtotalVnd: 125000,
      discountTotalVnd: 0,
      shippingFeeVnd: 15000,
      finalTotalVnd: 140000,
    });
    const prepared = await prepareCartShare(
      new Request("https://metraphuong.com/api/cart/share/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionToken: "new-schema-compatibility",
          acceptCurrentPrices: true,
          items: cartItems,
        }),
      }),
      env,
    );
    expect(prepared.status).toBe(201);
    expect(await prepared.json()).toMatchObject({
      cartRequest: { shippingFeeVnd: 15000, finalTotalVnd: 140000 },
    });
    expect(database.prepare(
      "SELECT shipping_fee_vnd, final_total_vnd FROM cart_requests WHERE submission_token = ?",
    ).get("new-schema-compatibility")).toEqual({
      shipping_fee_vnd: 15000,
      final_total_vnd: 140000,
    });
  });

  it("new schema + rollback artifact code: retry recovery giữ nguyên snapshot và không cộng ship hai lần", async () => {
    const { database, env } = createEnv(true);
    const body = {
      submissionToken: "new-schema-rollback-recovery",
      acceptCurrentPrices: true,
      items: cartItems,
    };
    const first = await prepareCartShare(
      new Request("https://metraphuong.com/api/cart/share/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
    );
    const second = await prepareCartShare(
      new Request("https://metraphuong.com/api/cart/share/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      cartRequest: { shippingFeeVnd: 15000, finalTotalVnd: 140000 },
    });
    expect(database.prepare(
      "SELECT COUNT(*) AS count, shipping_fee_vnd, final_total_vnd FROM cart_requests WHERE submission_token = ?",
    ).get(body.submissionToken)).toEqual({
      count: 1,
      shipping_fee_vnd: 15000,
      final_total_vnd: 140000,
    });
  });
});
