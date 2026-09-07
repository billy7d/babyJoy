import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";
import {
  authorizeStorefrontSession,
  createAccessLink,
  handleAccessRequest,
  type AccessLinkDto,
} from "../workers/storefront-access";
import { consumeRateLimit } from "../workers/rate-limit";
import { getPublicCartShare } from "../workers/cart-share";

function migration(name: string) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

const migrationNames = [
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
  "0013_variant_retirement_v1.sql",
  "0014_product_rich_description_v1.sql",
  "0015_content_pages_cms_v1.sql",
  "0016_product_variant_media_v1.sql",
  "0017_storefront_reservation_security_v1.sql",
];

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
    return Promise.resolve(
      (this.statement.get(...this.values) as T | undefined) ?? null,
    );
  }

  run() {
    const result = this.statement.run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }
}

class SqliteD1Adapter {
  constructor(
    readonly database: DatabaseSync,
    readonly queries: string[] = [],
  ) {}

  prepare(sql: string) {
    this.queries.push(sql);
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

function createDatabase(upTo = migrationNames.length) {
  const database = new DatabaseSync(":memory:");
  migrationNames
    .slice(0, upTo)
    .forEach((name) => database.exec(migration(name)));
  databases.push(database);
  return database;
}

function createEnv(options: { gateEnabled?: boolean; queries?: string[] } = {}) {
  const database = createDatabase();
  database.exec(`
    INSERT INTO app_settings (key, value, updated_at) VALUES
      ('seller_display_name', 'Nguyễn A', CURRENT_TIMESTAMP),
      ('seller_contact_label', 'Người bán BabyJoy', CURRENT_TIMESTAMP),
      ('seller_messenger_url', 'https://m.me/nguyena', CURRENT_TIMESTAMP),
      ('seller_avatar_key', '', CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
  `);
  const d1 = new SqliteD1Adapter(database, options.queries);
  return {
    database,
    env: {
      DB: d1,
      PRODUCT_IMAGES: { head: async () => ({}) },
      ENVIRONMENT: "development",
      ACCESS_TEAM_DOMAIN: "",
      ACCESS_AUD: "",
      DIRECT_SELLER_SHARE_ENABLED: "true",
      MESSENGER_CHECKOUT_ENABLED: "false",
      CART_SHARE_SECRET: "test-cart-share-secret-that-is-long-enough-123",
      STOREFRONT_ACCESS_GATE_ENABLED: options.gateEnabled === false ? "false" : "true",
      STOREFRONT_ACCESS_SECRET: "test-storefront-access-secret-123456",
    } as unknown as Env,
  };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function cookieValues(response: Response) {
  const typedHeaders = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const values = typedHeaders.getSetCookie?.() ?? [
    response.headers.get("set-cookie") ?? "",
  ];
  return values.flatMap((value) => {
    const first = value.split(";")[0];
    const separator = first.indexOf("=");
    return separator > 0
      ? [[first.slice(0, separator), first.slice(separator + 1)] as const]
      : [];
  });
}

function applyCookies(jar: Map<string, string>, response: Response) {
  for (const [name, value] of cookieValues(response)) jar.set(name, value);
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function requestFor(url: string, jar = new Map<string, string>(), init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const cookies = cookieHeader(jar);
  if (cookies) headers.set("cookie", cookies);
  return new Request(
    url.startsWith("/") ? `https://metraphuong.com${url}` : url,
    { ...init, headers },
  );
}

async function api(
  env: Env,
  path: string,
  init: RequestInit = {},
  jar?: Map<string, string>,
  ip = "198.51.100.10",
) {
  const request = requestFor(path, jar, init);
  request.headers.set("cf-connecting-ip", ip);
  return worker.fetch(request, env, {} as ExecutionContext);
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function seedVariant(
  database: DatabaseSync,
  suffix: string,
  stockOnHand: number,
) {
  const productId = `security-product-${suffix}`;
  const variantId = `security-variant-${suffix}`;
  database
    .prepare(
      `INSERT INTO products (
        id, name, slug, status, featured, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, 'AVAILABLE', 0, 99, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .run(productId, `Sản phẩm bảo mật ${suffix}`, `security-product-${suffix}`);
  database
    .prepare(
      `INSERT INTO product_variants (
        id, product_id, name, sku, price_vnd, availability,
        track_inventory, stock_on_hand, reserved_quantity,
        sort_order, created_at, updated_at
      ) VALUES (?, ?, 'Hộp test', ?, 100000, 'AVAILABLE', 1, ?, 0, 1,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .run(variantId, productId, `SECURITY-${suffix}`, stockOnHand);
  return variantId;
}

async function createSession(env: Env) {
  const response = await createAccessLink(
    new Request("https://metraphuong.com/api/admin/access-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Nhóm kiểm thử bảo mật",
        notes: "security hardening",
        groups: [{ name: "BabyJoy security" }],
        sessionTtlSeconds: null,
      }),
    }),
    env,
    "security-test@metraphuong.com",
  );
  expect(response.status).toBe(201);
  const link = (await response.json() as { data: AccessLinkDto }).data;
  const jar = new Map<string, string>();
  const opened = await handleAccessRequest(requestFor(link.accessUrl, jar), env);
  expect(opened.status).toBe(303);
  applyCookies(jar, opened);
  const authorization = await authorizeStorefrontSession(
    requestFor("/", jar),
    env,
  );
  expect(authorization.valid).toBe(true);
  expect(authorization.session?.id).toBeTruthy();
  return { jar, sessionId: authorization.session!.id };
}

function shareBody(
  submissionToken: string,
  variantId: string,
  quantity = 1,
  extra: Record<string, unknown> = {},
) {
  return {
    submissionToken,
    acceptCurrentPrices: false,
    items: [{ variantId, quantity, displayedPrice: 100000 }],
    ...extra,
  };
}

describe("storefront reservation security", () => {
  it("gate mọi API nhạy cảm, chỉ public token đúng format và không tin session từ body", async () => {
    const { database, env } = createEnv();
    const variantId = seedVariant(database, "gate", 3);
    expect((await api(env, "/api/products")).status).toBe(401);
    expect((await api(env, "/api/tags")).status).toBe(401);
    expect((await api(env, "/api/cart/share/foo")).status).toBe(401);
    expect((await api(env, "/api/cart/share/prepare")).status).toBe(401);
    expect((await api(env, "/api/cart/share/activate", jsonInit("POST", {}))).status).toBe(401);
    expect((await api(env, `/api/cart/share/${"a".repeat(43)}`, { method: "POST" })).status).toBe(401);
    expect((await api(env, `/api/cart/share/${"a".repeat(43)}`)).status).toBe(404);

    const session = await createSession(env);
    expect((await api(env, "/api/products", {}, session.jar)).status).toBe(200);
    const prepared = await api(
      env,
      "/api/cart/share/prepare",
      jsonInit(
        "POST",
        shareBody("gate-submission", variantId, 1, { sessionId: "forged-client-id" }),
      ),
      session.jar,
    );
    expect(prepared.status).toBe(201);
    expect(
      database
        .prepare(
          "SELECT storefront_session_id AS storefrontSessionId FROM cart_requests WHERE submission_token = ?",
        )
        .get("gate-submission"),
    ).toEqual({ storefrontSessionId: session.sessionId });
  });

  it("giới hạn độ dài bộ lọc catalog trước khi chạy cleanup/query nặng", async () => {
    const { env } = createEnv({ gateEnabled: false });
    expect((await api(env, `/api/products?q=${"x".repeat(121)}`)).status).toBe(422);
    expect(
      (
        await api(
          env,
          `/api/products?category=${Array.from({ length: 21 }, (_, index) => `x${index}`).join(",")}`,
        )
      ).status,
    ).toBe(422);
    expect((await api(env, `/api/search?sort=${"x".repeat(33)}`)).status).toBe(422);
    expect((await api(env, "/api/products?page=999999999999999999999")).status).toBe(200);
  });

  it("idempotency chỉ cùng session, session khác nhận lỗi structured và không ghi token", async () => {
    const { database, env } = createEnv();
    const variantId = seedVariant(database, "idempotency", 5);
    const first = await createSession(env);
    const second = await createSession(env);
    const body = shareBody("same-submission", variantId);
    expect((await api(env, "/api/cart/share/prepare", jsonInit("POST", body), first.jar)).status).toBe(201);
    expect((await api(env, "/api/cart/share/activate", jsonInit("POST", body), first.jar)).status).toBe(200);
    expect((await api(env, "/api/cart/share/prepare", jsonInit("POST", body), first.jar)).status).toBe(200);
    expect((await api(env, "/api/cart/share/activate", jsonInit("POST", body), first.jar)).status).toBe(200);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM inventory_reservations")
        .get(),
    ).toEqual({ count: 1 });

    for (const path of ["/api/cart/share/prepare", "/api/cart/share/activate"]) {
      const response = await api(env, path, jsonInit("POST", body), second.jar);
      expect(response.status).toBe(409);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({
        success: false,
        error: { code: "SUBMISSION_SESSION_MISMATCH" },
      });
      expect(text).not.toContain(first.sessionId);
      expect(text).not.toContain("same-submission");
    }
  });

  it("giới hạn hai reservation active và tổng units, không tạo reservation thứ ba", async () => {
    const { database, env } = createEnv();
    const variantId = seedVariant(database, "active-limit", 10);
    const session = await createSession(env);
    for (const token of ["active-one", "active-two"]) {
      expect((await api(env, "/api/cart/share/prepare", jsonInit("POST", shareBody(token, variantId)), session.jar)).status).toBe(201);
      expect((await api(env, "/api/cart/share/activate", jsonInit("POST", shareBody(token, variantId)), session.jar)).status).toBe(200);
    }
    expect((await api(env, "/api/cart/share/prepare", jsonInit("POST", shareBody("active-three", variantId)), session.jar)).status).toBe(201);
    const denied = await api(
      env,
      "/api/cart/share/activate",
      jsonInit("POST", shareBody("active-three", variantId)),
      session.jar,
    );
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({
      error: { code: "ACTIVE_RESERVATION_LIMIT" },
    });
    expect(
      database
        .prepare("SELECT checkout_state AS checkoutState FROM cart_requests WHERE submission_token = 'active-three'")
        .get(),
    ).toEqual({ checkoutState: "READY_TO_SEND" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM inventory_reservations").get()).toEqual({ count: 2 });
    expect(() =>
      database
        .prepare(
          `UPDATE cart_requests
           SET checkout_state = 'WAITING_SELLER_CONFIRM',
               reservation_started_at = CURRENT_TIMESTAMP,
               reservation_expires_at = '2099-01-01T00:00:00.000Z',
               reservation_duration_minutes = 15
           WHERE submission_token = 'active-three'`,
        )
        .run(),
    ).toThrow(/ACTIVE_RESERVATION_LIMIT/);

    database
      .prepare(
        "UPDATE app_settings SET value = '10' WHERE key = 'storefront_max_active_reservations_per_session'",
      )
      .run();
    database
      .prepare(
        "UPDATE app_settings SET value = '2' WHERE key = 'storefront_max_total_reserved_units_per_session'",
      )
      .run();
    database
      .prepare("UPDATE inventory_reservations SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP WHERE 1")
      .run();
    database
      .prepare("UPDATE cart_requests SET checkout_state = 'CANCELLED', status = 'CANCELLED' WHERE storefront_session_id = ?")
      .run(session.sessionId);
    const unitsSession = await createSession(env);
    const twoUnits = shareBody("units-two", variantId, 2);
    expect((await api(env, "/api/cart/share/prepare", jsonInit("POST", twoUnits), unitsSession.jar)).status).toBe(201);
    expect((await api(env, "/api/cart/share/activate", jsonInit("POST", twoUnits), unitsSession.jar)).status).toBe(200);
    const oneMore = shareBody("units-three", variantId, 1);
    expect((await api(env, "/api/cart/share/prepare", jsonInit("POST", oneMore), unitsSession.jar)).status).toBe(201);
    const unitDenied = await api(env, "/api/cart/share/activate", jsonInit("POST", oneMore), unitsSession.jar);
    expect(unitDenied.status).toBe(409);
    expect(await unitDenied.json()).toMatchObject({
      error: { code: "RESERVED_UNITS_LIMIT" },
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM inventory_reservations WHERE status = 'ACTIVE'").get()).toEqual({ count: 1 });
  });

  it("batch activation rollback toàn bộ khi promotion quota fail", async () => {
    const { database, env } = createEnv();
    const variantId = seedVariant(database, "promotion-rollback", 5);
    database
      .prepare(
        `INSERT INTO promotions (
          id, name, description, type, status, priority, stackable,
          usage_limit_total, usage_count_total, config_json, created_at, updated_at
        ) VALUES ('security-promotion', 'Khuyến mãi đầy quota', '',
          'ORDER_FIXED_DISCOUNT', 'ACTIVE', 1, 0, 1, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(JSON.stringify({ type: "ORDER_FIXED_DISCOUNT", minimumSubtotal: 1, discountAmount: 1000 }));
    database
      .prepare(
        `INSERT INTO cart_requests (
          id, public_code, submission_token, item_line_count, total_quantity,
          subtotal_vnd, telegram_status, contact_channel,
          messenger_delivery_status, created_at, updated_at
        ) VALUES ('promotion-blocker', 'GH-PROMO-BLOCK', 'promotion-blocker',
          1, 1, 100000, 'NOT_APPLICABLE', 'SHARE', 'NOT_APPLICABLE',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO promotion_reservations (
          id, cart_request_id, promotion_id, status, expires_at, created_at
        ) VALUES ('promotion-blocker-reservation', 'promotion-blocker',
          'security-promotion', 'ACTIVE', '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP)`,
      )
      .run();
    const session = await createSession(env);
    const body = shareBody("promotion-rollback", variantId);
    expect((await api(env, "/api/cart/share/prepare", jsonInit("POST", body), session.jar)).status).toBe(201);
    const activation = await api(env, "/api/cart/share/activate", jsonInit("POST", body), session.jar);
    expect(activation.status).toBe(409);
    expect(await activation.json()).toMatchObject({
      error: { code: "PROMOTION_USAGE_LIMIT" },
    });
    expect(
      database
        .prepare("SELECT checkout_state AS checkoutState FROM cart_requests WHERE submission_token = 'promotion-rollback'")
        .get(),
    ).toEqual({ checkoutState: "READY_TO_SEND" });
    expect(database.prepare("SELECT reserved_quantity FROM product_variants WHERE id = ?").get(variantId)).toEqual({ reserved_quantity: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM inventory_reservations").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM promotion_reservations").get()).toEqual({ count: 1 });
  });

  it("public share token ngẫu nhiên không chạy cleanup và public rate-limit không lưu IP", async () => {
    const queries: string[] = [];
    const { database, env } = createEnv({ gateEnabled: false, queries });
    queries.length = 0;
    const random = await getPublicCartShare(
      "x".repeat(43),
      env,
      requestFor("/api/cart/share/" + "x".repeat(43), new Map(), {
        headers: { "cf-connecting-ip": "203.0.113.70" },
      }),
    );
    expect(random.status).toBe(404);
    expect(queries.some((sql) => sql.includes("UPDATE inventory_reservations"))).toBe(false);
    expect(queries.some((sql) => sql.includes("WHERE checkout_state = 'WAITING_SELLER_CONFIRM'"))).toBe(false);

    for (let index = 0; index < 60; index += 1)
      await getPublicCartShare(
        "a".repeat(43),
        env,
        requestFor("/api/cart/share/" + "a".repeat(43), new Map(), {
          headers: { "cf-connecting-ip": "203.0.113.71" },
        }),
      );
    const denied = await getPublicCartShare(
      "a".repeat(43),
      env,
      requestFor("/api/cart/share/" + "a".repeat(43), new Map(), {
        headers: { "cf-connecting-ip": "203.0.113.71" },
      }),
    );
    expect(denied.status).toBe(429);
    const rateRows = database
      .prepare("SELECT scope_key, request_count FROM messenger_rate_limits")
      .all() as Array<{ scope_key: string; request_count: number }>;
    expect(rateRows).toHaveLength(2);
    expect(JSON.stringify(rateRows)).not.toContain("203.0.113.71");
  });

  it("rate-limit thêm bucket session hash và migration mới giữ lịch sử/FK", async () => {
    const { database, env } = createEnv({ gateEnabled: false });
    const request = requestFor("/api/cart/evaluate", new Map(), {
      headers: { "cf-connecting-ip": "198.51.100.90" },
    });
    await consumeRateLimit(env, request, "security-session", 2, {
      storefrontSessionId: "server-session-opaque-id",
    });
    await consumeRateLimit(env, request, "security-session", 2, {
      storefrontSessionId: "server-session-opaque-id",
    });
    await expect(
      consumeRateLimit(env, request, "security-session", 2, {
        storefrontSessionId: "server-session-opaque-id",
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const rows = database
      .prepare("SELECT scope_key FROM messenger_rate_limits")
      .all() as Array<{ scope_key: string }>;
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain("server-session-opaque-id");

    const legacy = createDatabase(migrationNames.length - 1);
    legacy.exec(`
      INSERT INTO cart_requests (
        id, public_code, submission_token, item_line_count, total_quantity,
        subtotal_vnd, telegram_status, contact_channel,
        messenger_delivery_status, created_at, updated_at
      ) VALUES ('legacy-security', 'GH-LEGACY-1', 'legacy-security-token',
        1, 1, 100000, 'NOT_APPLICABLE', 'SHARE', 'NOT_APPLICABLE',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    legacy.exec(migration("0017_storefront_reservation_security_v1.sql"));
    expect(legacy.prepare("SELECT storefront_session_id FROM cart_requests WHERE id = 'legacy-security'").get()).toEqual({ storefront_session_id: null });
    expect(legacy.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(legacy.prepare("SELECT value FROM app_settings WHERE key = 'storefront_max_active_reservations_per_session'").get()).toEqual({ value: "2" });
    expect(legacy.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name LIKE '%storefront%' ORDER BY name").all()).toEqual([
      { name: "cart_requests_guard_storefront_active_limit" },
      { name: "cart_requests_guard_storefront_session_binding" },
      { name: "inventory_reservations_guard_storefront_units" },
    ]);
  });
});
