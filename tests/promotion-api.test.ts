import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";

function migration(name: string) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

class StatementAdapter {
  private values: unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]) {
    const next = new StatementAdapter(this.statement);
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

class D1Adapter {
  constructor(readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new StatementAdapter(this.database.prepare(sql));
  }

  async batch(statements: StatementAdapter[]) {
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

function createEnv() {
  const database = new DatabaseSync(":memory:");
  for (const name of [
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
  ])
    database.exec(migration(name));
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
     VALUES ('promotion-test-product', 'Promotion test product', 'promotion-test-product', 'AVAILABLE', 0, 99, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).run();
  database.prepare(
    `INSERT INTO product_variants (id, product_id, name, sku, price_vnd, availability, sort_order, created_at, updated_at)
     VALUES ('promotion-test-variant', 'promotion-test-product', 'Hộp 125g', 'PROMO-125', 125000, 'AVAILABLE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).run();
  databases.push(database);
  return {
    database,
    env: {
      DB: new D1Adapter(database),
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

afterEach(() => {
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

const fixedPayload = {
  name: "Đơn từ 100k giảm 30k",
  description: "Ưu đãi test",
  type: "ORDER_FIXED_DISCOUNT",
  status: "DRAFT",
  priority: 20,
  stackable: false,
  config: {
    type: "ORDER_FIXED_DISCOUNT",
    minimumSubtotal: 100000,
    discountAmount: 30000,
  },
};

describe("Promotion API và D1 snapshot", () => {
  it("CRUD, status, duplicate và delete promotion qua admin API", async () => {
    const { env } = createEnv();
    const createdResponse = await api(env, "/api/admin/promotions", jsonInit("POST", fixedPayload));
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { id: string; data: { status: string; currentState: string } };
    expect(created.data).toMatchObject({ status: "DRAFT", currentState: "DRAFT" });

    const readResponse = await api(env, `/api/admin/promotions/${created.id}`);
    expect(readResponse.status).toBe(200);
    expect((await readResponse.json() as { data: { name: string } }).data.name).toBe(fixedPayload.name);

    const updatedResponse = await api(env, `/api/admin/promotions/${created.id}`, jsonInit("PUT", {
      ...fixedPayload,
      name: "Đơn từ 120k giảm 25k",
      status: "ACTIVE",
      config: { ...fixedPayload.config, minimumSubtotal: 120000, discountAmount: 25000 },
    }));
    expect(updatedResponse.status).toBe(200);
    expect((await updatedResponse.json() as { data: { status: string; config: { minimumSubtotal: number } } }).data).toMatchObject({ status: "ACTIVE", config: { minimumSubtotal: 120000 } });

    const deactivated = await api(env, `/api/admin/promotions/${created.id}/status`, jsonInit("PATCH", { status: "INACTIVE" }));
    expect(deactivated.status).toBe(200);
    const duplicated = await api(env, `/api/admin/promotions/${created.id}/duplicate`, { method: "POST" });
    expect(duplicated.status).toBe(201);
    const duplicate = (await duplicated.json()) as { id: string };
    const duplicateRead = await api(env, `/api/admin/promotions/${duplicate.id}`);
    expect((await duplicateRead.json() as { data: { name: string; status: string; usageCountTotal: number } }).data).toMatchObject({ name: "Đơn từ 120k giảm 25k - Copy", status: "DRAFT", usageCountTotal: 0 });

    const deleted = await api(env, `/api/admin/promotions/${duplicate.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect((await deleted.json() as { deleted: boolean }).deleted).toBe(true);
  });

  it("admin mutation bị từ chối nếu không có Access authorization production", async () => {
    const { env } = createEnv();
    const productionEnv = { ...env, ENVIRONMENT: "production" } as Env;
    const response = await api(productionEnv, "/api/admin/promotions", jsonInit("POST", fixedPayload));
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("ACCESS_NOT_CONFIGURED");
  });

  it("evaluate và order path chỉ dùng giá/promotion server, ghi snapshot bất biến", async () => {
    const { env, database } = createEnv();
    const createdResponse = await api(env, "/api/admin/promotions", jsonInit("POST", {
      ...fixedPayload,
      status: "ACTIVE",
      priority: 100,
      config: { ...fixedPayload.config, minimumSubtotal: 1 },
    }));
    const created = (await createdResponse.json()) as { id: string };

    const evaluation = await api(env, "/api/cart/evaluate", jsonInit("POST", {
      items: [{ variantId: "promotion-test-variant", quantity: 1, promotionId: created.id, discountAmountVnd: 999999, giftPriceVnd: 0 }],
    }));
    expect(evaluation.status).toBe(200);
    const evaluationBody = await evaluation.json() as { subtotalVnd: number; discountTotalVnd: number; finalTotalVnd: number };
    expect(evaluationBody).toMatchObject({ subtotalVnd: 125000, discountTotalVnd: 30000, finalTotalVnd: 95000 });

    const prepared = await api(env, "/api/cart/share/prepare", jsonInit("POST", {
      submissionToken: "promotion-snapshot-share-1",
      acceptCurrentPrices: false,
      items: [{ variantId: "promotion-test-variant", quantity: 1, displayedPrice: 125000, discountAmountVnd: 999999 }],
    }));
    expect(prepared.status).toBe(201);
    const preparedBody = (await prepared.json()) as {
      cartRequest: { subtotalVnd: number; promotionDiscountVnd: number; finalTotalVnd: number };
      share: { url: string };
    };
    expect(preparedBody.cartRequest).toMatchObject({ subtotalVnd: 125000, promotionDiscountVnd: 30000, finalTotalVnd: 95000 });
    expect(database.prepare("SELECT usage_count_total FROM promotions WHERE id = ?").get(created.id)).toEqual({ usage_count_total: 1 });
    expect(database.prepare("SELECT discount_amount_vnd FROM cart_request_promotions").get()).toEqual({ discount_amount_vnd: 30000 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM promotion_redemptions").get()).toEqual({ count: 1 });

    await api(env, `/api/admin/promotions/${created.id}`, jsonInit("PUT", {
      ...fixedPayload,
      status: "ACTIVE",
      priority: 100,
      config: { ...fixedPayload.config, minimumSubtotal: 1, discountAmount: 50000 },
    }));
    const publicShare = await api(env, `/api/cart/share/${preparedBody.share.url.split("/").at(-1)}`);
    expect(publicShare.status).toBe(200);
    const publicShareBody = await publicShare.json() as { promotionDiscountVnd: number; finalTotalVnd: number };
    expect(publicShareBody).toMatchObject({ promotionDiscountVnd: 30000, finalTotalVnd: 95000 });

    const archived = await api(env, `/api/admin/promotions/${created.id}`, { method: "DELETE" });
    expect((await archived.json()) as { archived: boolean }).toMatchObject({ archived: true });
    expect(database.prepare("SELECT status FROM promotions WHERE id = ?").get(created.id)).toEqual({ status: "ARCHIVED" });
  });
});
