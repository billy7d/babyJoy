import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";
import {
  DEFAULT_STORE_SETTINGS,
  type StoreSettings,
} from "../shared/store-settings";
import {
  getAdminStoreSettings,
  getPublicStoreSettings,
  saveAdminStoreSettings,
} from "../app/lib/store-settings";
import { composeCartShareText } from "../workers/cart-share";
import { composeMessengerCartSummary } from "../workers/messenger";

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
    return Promise.resolve({
      results: this.statement.all(...this.values) as T[],
      success: true,
    });
  }

  first<T>() {
    return Promise.resolve(
      (this.statement.get(...this.values) as T | undefined) ?? null,
    );
  }

  run() {
    const result = this.statement.run(...this.values);
    return Promise.resolve({
      success: true,
      meta: { changes: Number(result.changes) },
    });
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

function createEnv(overrides: Record<string, unknown> = {}) {
  const database = new DatabaseSync(":memory:");
  for (const name of [
    "0001_initial.sql",
    "0002_seed.sql",
    "0003_messenger_checkout_v1.sql",
    "0004_direct_seller_cart_share_v1.sql",
    "0005_remove_demo_cart_request.sql",
    "0006_product_taxonomy_v1.sql",
  ])
    database.exec(migration(name));
  databases.push(database);
  return {
    database,
    env: {
      DB: new D1Adapter(database),
      PRODUCT_IMAGES: { head: async () => ({}) },
      ENVIRONMENT: "development",
      DIRECT_SELLER_SHARE_ENABLED: "true",
      MESSENGER_CHECKOUT_ENABLED: "false",
      ...overrides,
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

async function put(env: Env, settings: Partial<StoreSettings>) {
  const response = await api(env, "/api/admin/settings/store", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
  return {
    response,
    body: (await response.json()) as {
      success?: boolean;
      data?: StoreSettings;
      error?: { code?: string; message?: string; details?: { field?: string } };
    },
  };
}

describe("Store settings API", () => {
  it("GET admin khi thiếu key trả fallback legacy", async () => {
    const { env } = createEnv();
    const response = await api(env, "/api/admin/settings/store");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: DEFAULT_STORE_SETTINGS,
    });
  });

  it("PUT valid lưu đủ ba key và GET admin/public round-trip cùng canonical data", async () => {
    const { env, database } = createEnv();
    const settings = {
      displayName: "BabyJoy E2E 🍼 Cửa hàng",
      contactEmail: "store-e2e@example.com",
      contactPhone: "0816 950 666",
    };
    const saved = await put(env, settings);
    expect(saved.response.status).toBe(200);
    expect(saved.body).toEqual({ success: true, data: settings });

    const admin = await api(env, "/api/admin/settings/store");
    const publicResponse = await api(env, "/api/store-settings");
    expect(await admin.json()).toEqual({ success: true, data: settings });
    expect(await publicResponse.json()).toEqual({
      success: true,
      data: settings,
    });

    const rows = database
      .prepare(
        "SELECT key, value, updated_at FROM app_settings WHERE key IN (?, ?, ?) ORDER BY key",
      )
      .all(
        "store_contact_email",
        "store_contact_phone",
        "store_display_name",
      ) as Array<{ key: string; value: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "store_contact_email", value: settings.contactEmail },
      { key: "store_contact_phone", value: settings.contactPhone },
      { key: "store_display_name", value: settings.displayName },
    ]);
    expect(rows.every(({ updated_at }) => typeof updated_at === "string" && updated_at.length > 0)).toBe(true);
  });

  it("public GET chỉ allow-list ba public values và không leak app_settings secrets", async () => {
    const { env, database } = createEnv();
    database
      .prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)",
      )
      .run("messenger_access_token", "do-not-return-this", new Date().toISOString());
    const response = await api(env, "/api/store-settings");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ success: true, data: DEFAULT_STORE_SETTINGS });
    expect(JSON.stringify(body)).not.toContain("do-not-return-this");
    expect(JSON.stringify(body)).not.toContain("messenger_access_token");
  });

  it("giữ Unicode/emoji và số 0 đầu của phone", async () => {
    const { env } = createEnv();
    const settings = {
      displayName: "Đồ ăn dặm 🍼 Trà Phương",
      contactEmail: "",
      contactPhone: "0816 950 666",
    };
    const saved = await put(env, settings);
    expect(saved.response.status).toBe(200);
    expect(saved.body.data).toEqual(settings);
    const publicResponse = await api(env, "/api/store-settings");
    const publicBody = (await publicResponse.json()) as { data: StoreSettings };
    expect(publicBody.data).toEqual(settings);
  });

  it.each([
    ["email invalid", { displayName: "Shop", contactEmail: "not-an-email", contactPhone: "" }, "contactEmail"],
    ["display name empty", { displayName: "   ", contactEmail: "", contactPhone: "" }, "displayName"],
    ["display name control character", { displayName: "Shop\nName", contactEmail: "", contactPhone: "" }, "displayName"],
    ["phone control character", { displayName: "Shop", contactEmail: "", contactPhone: "0816\n950" }, "contactPhone"],
  ])("từ chối %s với 422 và field ổn định", async (_label, settings, field) => {
    const { env } = createEnv();
    const result = await put(env, settings);
    expect(result.response.status).toBe(422);
    expect(result.body.success).toBe(false);
    expect(result.body.error?.code).toBe("STORE_SETTINGS_VALIDATION_ERROR");
    expect(result.body.error?.details?.field).toBe(field);
  });

  it("từ chối display name quá dài và payload quá lớn", async () => {
    const { env } = createEnv();
    const tooLong = await put(env, {
      displayName: "x".repeat(121),
      contactEmail: "",
      contactPhone: "",
    });
    expect(tooLong.response.status).toBe(422);
    expect(tooLong.body.error?.code).toBe("STORE_SETTINGS_VALIDATION_ERROR");

    const response = await api(env, "/api/admin/settings/store", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Shop",
        contactEmail: "",
        contactPhone: "",
        padding: "x".repeat(17 * 1024),
      }),
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("admin GET/PUT production không có Access token đều bị reject", async () => {
    const { env } = createEnv({
      ENVIRONMENT: "production",
      ACCESS_TEAM_DOMAIN: "metraphuong.cloudflareaccess.com",
      ACCESS_AUD: "audience",
    });
    const getResponse = await api(env, "/api/admin/settings/store");
    const putResult = await put(env, {
      displayName: "Should not save",
      contactEmail: "",
      contactPhone: "",
    });
    expect(getResponse.status).toBe(401);
    expect(putResult.response.status).toBe(401);
    expect(putResult.body.error?.code).toBe("UNAUTHORIZED");
  });

  it("D1 write failure không trả false-success và không lưu một phần", async () => {
    const { env } = createEnv({
      DB: {
        prepare: () => ({ bind: () => ({}) }),
        batch: async () => {
          throw new Error("D1 unavailable");
        },
      },
    });
    const result = await put(env, {
      displayName: "Should fail",
      contactEmail: "store@example.com",
      contactPhone: "0816 950 666",
    });
    expect(result.response.status).toBe(500);
    expect(result.body.success).toBe(false);
    expect(result.body.error?.code).toBe("STORE_SETTINGS_SAVE_FAILED");
  });

  it("legacy DB có app_settings nhưng chưa có store keys vẫn đọc fallback an toàn", async () => {
    const { env, database } = createEnv();
    database
      .prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)",
      )
      .run("seller_display_name", "Legacy seller", new Date().toISOString());
    const response = await api(env, "/api/store-settings");
    const body = (await response.json()) as { data: StoreSettings };
    expect(body.data).toEqual(DEFAULT_STORE_SETTINGS);
  });
});

describe("Store settings frontend contract", () => {
  it("client API layer gọi đúng public/admin endpoints và canonical response", async () => {
    const requests: Array<{ path: string; method: string; body?: string }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        path: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(
        JSON.stringify({ success: true, data: DEFAULT_STORE_SETTINGS }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    await getAdminStoreSettings(fetcher);
    await getPublicStoreSettings(fetcher);
    await saveAdminStoreSettings(DEFAULT_STORE_SETTINGS, fetcher);
    expect(requests).toEqual([
      { path: "/api/admin/settings/store", method: "GET" },
      { path: "/api/store-settings", method: "GET" },
      {
        path: "/api/admin/settings/store",
        method: "PUT",
        body: JSON.stringify(DEFAULT_STORE_SETTINGS),
      },
    ]);
  });

  it("Settings UI là controlled form, có load/save/dirty/error feedback", () => {
    const source = readFileSync("app/components/admin-pages.tsx", "utf8");
    const provider = readFileSync("app/lib/store-settings.tsx", "utf8");
    expect(source).toContain('getAdminStoreSettings()');
    expect(source).toContain('saveAdminStoreSettings(storeSettingsForm)');
    expect(source).toContain("onSubmit={(event)");
    expect(source).toContain('value={storeSettingsForm.displayName}');
    expect(source).toContain('value={storeSettingsForm.contactEmail}');
    expect(source).toContain('value={storeSettingsForm.contactPhone}');
    expect(source).toContain('storeSettingsSaving ? "ĐANG LƯU..."');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('"Đã lưu thông tin cửa hàng."');
    expect(source).toContain("storeSettingsDirty");
    expect(provider).toContain('requestStoreSettings("/api/store-settings"');
    expect(provider).toContain("DEFAULT_STORE_SETTINGS");
  });
});

describe("Runtime store name propagation", () => {
  const item = {
    productId: "p1",
    variantId: "v1",
    productName: "Bột ăn dặm",
    variantName: "227g",
    sku: "SKU-1",
    imageKey: null,
    priceVnd: 125000,
    quantity: 1,
    lineTotalVnd: 125000,
  };

  it("cart-share text nhận tên runtime và vẫn có fallback", () => {
    const custom = composeCartShareText({
      storeDisplayName: "BabyJoy E2E 🍼",
      code: "GH-1",
      items: [item],
      subtotalVnd: 125000,
      url: "https://example.com/c/GH-1",
    });
    expect(custom).toContain("🛒 GIỎ HÀNG BabyJoy E2E 🍼");
    expect(custom).not.toContain(DEFAULT_STORE_SETTINGS.displayName);
    const fallback = composeCartShareText({
      code: "GH-2",
      items: [item],
      subtotalVnd: 125000,
      url: "https://example.com/c/GH-2",
    });
    expect(fallback).toContain(`🛒 GIỎ HÀNG ${DEFAULT_STORE_SETTINGS.displayName}`);
  });

  it("Messenger summary nhận tên runtime", () => {
    const text = composeMessengerCartSummary({
      storeDisplayName: "BabyJoy E2E 🍼",
      code: "GH-3",
      items: [item],
      subtotalVnd: 125000,
    });
    expect(text).toContain("🛒 GIỎ HÀNG BabyJoy E2E 🍼");
    expect(text).toContain("✅ BabyJoy E2E 🍼 đã nhận giỏ hàng.");
  });
});
