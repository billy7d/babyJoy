import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";
import { cartDetails } from "../app/components/ui";
import { cartShareFingerprint } from "../app/lib/cart-share";
import { parseStoredCart } from "../app/lib/cart";
import { getDefaultVariant, getDisplayVariant } from "../app/lib/catalog";
import {
  createDraftVariant,
  mapVariantValidationIssue,
  validateEditableVariants,
} from "../app/lib/product-variants";

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

function createEnv(options: { seed?: boolean } = {}) {
  const database = new DatabaseSync(":memory:");
  const migrations = [
    "0001_initial.sql",
    ...(options.seed === false ? [] : ["0002_seed.sql"]),
    "0003_messenger_checkout_v1.sql",
    "0004_direct_seller_cart_share_v1.sql",
    "0005_remove_demo_cart_request.sql",
    "0006_product_taxonomy_v1.sql",
  ];
  for (const name of migrations)
    database.exec(migration(name));
  databases.push(database);
  return {
    database,
    env: {
      DB: new D1Adapter(database),
      PRODUCT_IMAGES: { head: async () => ({}) },
      ENVIRONMENT: "development",
      DIRECT_SELLER_SHARE_ENABLED: "false",
      MESSENGER_CHECKOUT_ENABLED: "false",
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

function productPayload(slug = "multi-variant-product") {
  return {
    name: "Sản phẩm nhiều phân loại",
    slug,
    status: "AVAILABLE",
    variants: [
      { name: "50g", sku: "MULTI-50", priceVnd: 150000, availability: "AVAILABLE" },
      { name: "100g", sku: "MULTI-100", priceVnd: 270000, availability: "AVAILABLE" },
      { name: "200g", sku: "MULTI-200", priceVnd: 490000, availability: "OUT_OF_STOCK" },
    ],
  };
}

describe("Admin Product multi-variant", () => {
  it("tạo và đọc đủ N variants, public API không cắt còn một dòng", async () => {
    const { env } = createEnv();
    const createdResponse = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(productPayload()),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { id: string; product: { variants: Array<{ id: string }> } };
    expect(created.product.variants).toHaveLength(3);
    expect(new Set(created.product.variants.map((variant) => variant.id)).size).toBe(3);

    const publicResponse = await api(env, "/api/products?q=S%E1%BA%A3n%20ph%E1%BA%A9m%20nhi%E1%BB%81u");
    const publicBody = (await publicResponse.json()) as { data: Array<{ variants: unknown[] }> };
    expect(publicBody.data[0]?.variants).toHaveLength(3);
  });

  it("cùng một Save update + insert + explicit delete, giữ ID và ảnh", async () => {
    const { env, database } = createEnv();
    const created = (await (
      await api(env, "/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(productPayload("multi-variant-update")),
      })
    ).json()) as { id: string; product: { variants: Array<{ id: string; sku: string }> } };
    const [first, second] = created.product.variants;
    database
      .prepare(
        "INSERT INTO product_images (id, product_id, r2_key, alt_text, sort_order) VALUES (?, ?, ?, ?, ?)",
      )
      .run("keep-image", created.id, "products/keep.jpg", "Ảnh giữ lại", 0);

    const updated = await api(env, `/api/admin/products/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...productPayload("multi-variant-update"),
        variants: [
          { id: first.id, name: "55g", sku: "MULTI-55", priceVnd: 160000, availability: "AVAILABLE" },
          { id: created.product.variants[2].id, name: "200g", sku: "MULTI-200", priceVnd: 490000, availability: "OUT_OF_STOCK" },
          { name: "500g", sku: "MULTI-500", priceVnd: 900000, availability: "AVAILABLE" },
        ],
        deletedVariantIds: [second.id],
      }),
    });
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as { product: { variants: Array<{ id: string; name: string; sku: string }> } };
    expect(body.product.variants.map((variant) => variant.sku)).toEqual([
      "MULTI-55",
      "MULTI-200",
      "MULTI-500",
    ]);
    expect(body.product.variants.find((variant) => variant.sku === "MULTI-55")?.id).toBe(first.id);
    expect(database.prepare("SELECT COUNT(*) AS count FROM product_variants WHERE product_id = ?").get(created.id)).toEqual({ count: 3 });
    expect(database.prepare("SELECT id, r2_key AS r2Key FROM product_images WHERE product_id = ?").get(created.id)).toEqual({ id: "keep-image", r2Key: "products/keep.jpg" });
    const adminRead = await api(env, `/api/admin/products/${created.id}`);
    const adminBody = (await adminRead.json()) as {
      data?: { images?: Array<{ id?: string; r2Key: string; altText: string; sortOrder: number; url: string }> };
    };
    expect(adminBody.data?.images?.[0]).toEqual({
      id: "keep-image",
      r2Key: "products/keep.jpg",
      altText: "Ảnh giữ lại",
      sortOrder: 0,
      url: "https://images.metraphuong.com/products/keep.jpg",
    });
    const publicRead = await api(env, "/api/products/multi-variant-update");
    const publicBody = (await publicRead.json()) as {
      data?: { images?: Array<{ r2Key: string; url: string }> };
    };
    expect(publicBody.data?.images?.[0]).toMatchObject({
      r2Key: "products/keep.jpg",
      url: "https://images.metraphuong.com/products/keep.jpg",
    });
  });

  it("từ chối SKU trùng với DB trước khi batch, không có partial update", async () => {
    const { env, database } = createEnv();
    const created = (await (
      await api(env, "/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(productPayload("multi-variant-atomic")),
      })
    ).json()) as { id: string; product: { variants: Array<{ id: string }> } };
    database
      .prepare(
        "INSERT INTO products (id, name, slug) VALUES (?, ?, ?)",
      )
      .run("other-product", "Sản phẩm khác", "other-product");
    database
      .prepare(
        "INSERT INTO product_variants (id, product_id, name, sku, price_vnd) VALUES (?, ?, ?, ?, ?)",
      )
      .run("other-variant", "other-product", "Đã giữ SKU", "CONFLICT-SKU", 1000);
    const first = created.product.variants[0];
    const second = created.product.variants[1];
    const response = await api(env, `/api/admin/products/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...productPayload("multi-variant-atomic"),
        variants: [{ id: first.id, name: "Đổi nhưng phải rollback", sku: "CONFLICT-SKU", priceVnd: 160000, availability: "AVAILABLE" }],
        deletedVariantIds: [second.id],
      }),
    });
    expect(response.status).toBe(409);
    expect(database.prepare("SELECT name, price_vnd AS priceVnd FROM product_variants WHERE id = ?").get(first.id)).toMatchObject({ name: "50g", priceVnd: 150000 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM product_variants WHERE id = ?").get(second.id)).toEqual({ count: 1 });
  });

  it("rollback cả batch nếu bước insert cuối thất bại", async () => {
    const { env, database } = createEnv();
    const created = (await (
      await api(env, "/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(productPayload("multi-variant-trigger")),
      })
    ).json()) as { id: string; product: { variants: Array<{ id: string; sku: string }> } };
    const [first, second] = created.product.variants;
    database.exec(
      "CREATE TRIGGER fail_variant_insert BEFORE INSERT ON product_variants WHEN NEW.sku = 'TRIGGER-FAIL' BEGIN SELECT RAISE(ABORT, 'trigger failure'); END",
    );
    const response = await api(env, `/api/admin/products/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...productPayload("multi-variant-trigger"),
        variants: [
          { id: first.id, name: "50g", sku: "MULTI-55", priceVnd: 160000, availability: "AVAILABLE" },
          { name: "500g", sku: "TRIGGER-FAIL", priceVnd: 900000, availability: "AVAILABLE" },
        ],
        deletedVariantIds: [second.id],
      }),
    });
    expect(response.status).toBe(409);
    expect(database.prepare("SELECT name, sku, price_vnd AS priceVnd FROM product_variants WHERE id = ?").get(first.id)).toMatchObject({ name: "50g", sku: "MULTI-50", priceVnd: 150000 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM product_variants WHERE id = ?").get(second.id)).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM product_variants WHERE sku = 'TRIGGER-FAIL'").get()).toEqual({ count: 0 });
  });

  it("D1 SQLite thật rollback update + delete khi INSERT duplicate SKU trong batch", async () => {
    const { env, database } = createEnv({ seed: false });
    const payload = productPayload("multi-variant-d1-rollback");
    payload.name = "D1 rollback product";
    payload.variants = [
      { name: "50g", sku: "RICE-50", priceVnd: 150000, availability: "AVAILABLE" },
      { name: "100g", sku: "RICE-100", priceVnd: 270000, availability: "AVAILABLE" },
    ];
    const created = (await (
      await api(env, "/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
    ).json()) as { id: string; product: { variants: Array<{ id: string }> } };
    const [first, second] = created.product.variants;
    database.exec(`
      CREATE TRIGGER fail_duplicate_sku
      BEFORE INSERT ON product_variants
      WHEN NEW.sku = 'RICE-CONFLICT'
      BEGIN
        INSERT INTO product_variants
          (id, product_id, name, sku, price_vnd, availability, sort_order, created_at, updated_at)
        VALUES
          ('trigger-duplicate-row', NEW.product_id, 'trigger', NEW.sku, 1, 'AVAILABLE', 99, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      END
    `);
    const response = await api(env, `/api/admin/products/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        variants: [
          { id: first.id, name: "50g", sku: "RICE-50", priceVnd: 160000, availability: "AVAILABLE" },
          { name: "200g", sku: "RICE-CONFLICT", priceVnd: 490000, availability: "AVAILABLE" },
        ],
        deletedVariantIds: [second.id],
      }),
    });
    expect(response.status).toBe(409);
    expect(
      database
        .prepare(
          "SELECT id, name, sku, price_vnd AS priceVnd FROM product_variants WHERE product_id = ? ORDER BY sort_order, id",
        )
        .all(created.id),
    ).toEqual([
      { id: first.id, name: "50g", sku: "RICE-50", priceVnd: 150000 },
      { id: second.id, name: "100g", sku: "RICE-100", priceVnd: 270000 },
    ]);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM product_variants WHERE id = 'trigger-duplicate-row'").get(),
    ).toEqual({ count: 0 });
  });

  it.each([
    ["name", { name: "" }, "INVALID_VARIANT_NAME"],
    ["sku", { sku: "" }, "INVALID_SKU"],
    ["empty price", { priceVnd: "" }, "INVALID_PRICE"],
    ["zero price", { priceVnd: 0 }, "INVALID_PRICE"],
    ["negative price", { priceVnd: -100 }, "INVALID_PRICE"],
    ["text price", { priceVnd: "abc" }, "INVALID_PRICE"],
    ["invalid availability", { availability: "DISCONTINUED" }, "INVALID_AVAILABILITY"],
  ])("server validate %s", async (_label, patch, code) => {
    const { env } = createEnv();
    const body = productPayload(`multi-variant-invalid-${String(_label)}`) as {
      variants: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    body.variants[0] = { ...body.variants[0], ...patch };
    const response = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(422);
    expect((await response.json()) as { error?: { code?: string; details?: { field?: string } } }).toMatchObject({
      error: { code, details: { field: code === "INVALID_PRICE" ? "priceVnd" : String(_label) === "name" ? "name" : String(_label) === "sku" ? "sku" : "availability" } },
    });
  });

  it("chặn duplicate SKU ngay trong cùng payload", async () => {
    const { env } = createEnv();
    const body = productPayload("multi-variant-payload-duplicate");
    body.variants[1].sku = body.variants[0].sku;
    const response = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(422);
    expect((await response.json()) as { error?: { code?: string; details?: { field?: string } } }).toMatchObject({
      error: { code: "DUPLICATE_SKU", details: { field: "sku" } },
    });
  });

  it("chặn zero variant và foreign variant ID", async () => {
    const { env } = createEnv();
    const created = (await (
      await api(env, "/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(productPayload("multi-variant-validation")),
      })
    ).json()) as { id: string; product: { variants: Array<{ id: string }> } };
    const allIds = created.product.variants.map((variant) => variant.id);
    const zero = await api(env, `/api/admin/products/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...productPayload("multi-variant-validation"), variants: [], deletedVariantIds: allIds }),
    });
    expect(zero.status).toBe(422);
    const foreign = await api(env, `/api/admin/products/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...productPayload("multi-variant-validation"), variants: [{ id: "foreign-id", name: "50g", sku: "FOREIGN", priceVnd: 1000, availability: "AVAILABLE" }] }),
    });
    expect(foreign.status).toBe(422);
    expect((await foreign.json()) as { error?: { code?: string; details?: { variantId?: string } } }).toMatchObject({ error: { code: "VARIANT_OWNERSHIP", details: { variantId: "foreign-id" } } });
  });

  it("tìm SKU của mọi variant và sort theo giá đại diện thấp nhất", async () => {
    const { env } = createEnv({ seed: false });
    const cheap = productPayload("multi-variant-sort-cheap");
    cheap.name = "Nhóm sort multi variant";
    cheap.variants = [
      { name: "500g", sku: "SORT-HIGH", priceVnd: 500000, availability: "AVAILABLE" },
      { name: "50g", sku: "SORT-LOW", priceVnd: 100000, availability: "AVAILABLE" },
    ];
    const expensive = productPayload("multi-variant-sort-expensive");
    expensive.name = cheap.name;
    expensive.variants = [
      { name: "200g", sku: "SORT-MID", priceVnd: 200000, availability: "AVAILABLE" },
    ];
    for (const value of [cheap, expensive])
      await api(env, "/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });
    const bySku = await api(env, "/api/products?q=SORT-LOW");
    const bySkuBody = (await bySku.json()) as {
      data: Array<{ slug: string; variants: Array<{ sku: string }> }>;
    };
    expect(bySkuBody.data).toHaveLength(1);
    expect(bySkuBody.data[0]?.variants.some((variant) => variant.sku === "SORT-LOW")).toBe(true);
    const sorted = await api(env, "/api/products?q=Nh%C3%B3m%20sort%20multi%20variant&sort=price_asc");
    const sortedBody = (await sorted.json()) as { data: Array<{ slug: string }> };
    expect(sortedBody.data.map((product) => product.slug)).toEqual([
      "multi-variant-sort-cheap",
      "multi-variant-sort-expensive",
    ]);
  });
});

describe("Public variant, cart và fingerprint", () => {
  const product = {
    id: "product-public",
    slug: "product-public",
    name: "Baby Rice",
    brand: "BabyJoy",
    shortDescription: "",
    description: "",
    image: "/images/product-gerber.jpg",
    category: "bot-an-dam",
    age: "6+ tháng",
    tags: [],
    variants: [
      { id: "variant-oos", name: "100g", sku: "OOS", priceVnd: 270000, availability: "OUT_OF_STOCK" as const },
      { id: "variant-available", name: "50g", sku: "AVAILABLE", priceVnd: 150000, availability: "AVAILABLE" as const },
    ],
  };

  it("chọn mặc định có thể mua và giá đại diện thấp nhất", () => {
    expect(getDefaultVariant(product)?.id).toBe("variant-available");
    expect(getDisplayVariant(product)?.id).toBe("variant-available");
  });

  it("giữ HIDDEN trong enum schema đã có trước feature", () => {
    const schema = migration("0001_initial.sql");
    expect(schema).toContain("availability TEXT NOT NULL DEFAULT 'AVAILABLE'");
    expect(schema).toContain("'OUT_OF_STOCK', 'HIDDEN'");
  });

  it("phân biệt hai variant cùng product và giữ dòng đã bị xóa để remove", () => {
    expect(
      cartShareFingerprint([
        { variantId: "variant-oos", quantity: 1 },
        { variantId: "variant-available", quantity: 1 },
      ]),
    ).not.toBe(cartShareFingerprint([{ variantId: "variant-available", quantity: 2 }]));
    const details = cartDetails(
      [{ variantId: "deleted-variant", quantity: 2, productName: "Baby Rice", variantName: "200g", sku: "RICE-200", priceVnd: 490000 }],
      [],
    );
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({ unavailable: true, variant: { id: "deleted-variant", sku: "RICE-200", priceVnd: 490000 }, lineTotal: 980000 });
    expect(parseStoredCart(JSON.stringify({ items: [{ variantId: "deleted-variant", quantity: 2 }] }))).toEqual([
      { variantId: "deleted-variant", quantity: 2 },
    ]);
  });
});

describe("Admin variant form helpers", () => {
  it("tạo draft có clientId ổn định và validate name, SKU, price", () => {
    const first = createDraftVariant();
    const second = createDraftVariant();
    expect(first.clientId).not.toBe(second.clientId);
    const errors = validateEditableVariants([
      { ...first, sku: "DUP" },
      { ...second, name: "100g", sku: "DUP", priceVnd: "270000" },
      { ...createDraftVariant(), name: "200g", sku: "DUP", priceVnd: "0" },
    ]);
    expect(errors[first.clientId]).toMatchObject({
      name: "Tên phân loại là bắt buộc và tối đa 180 ký tự.",
      sku: "Mã SKU bị trùng trong danh sách.",
      priceVnd: "Giá bán phải là số nguyên lớn hơn 0.",
    });
  });

  it("map lỗi SKU từ API về persisted row hoặc draft row", () => {
    const persisted = {
      ...createDraftVariant(),
      id: "variant-1",
      clientId: "variant-1",
      name: "50g",
      sku: "RICE-50",
      priceVnd: "150000",
    };
    const draft = {
      ...createDraftVariant(),
      name: "100g",
      sku: "RICE-100",
      priceVnd: "270000",
    };
    expect(
      mapVariantValidationIssue(
        {
          code: "SKU_CONFLICT",
          field: "sku",
          value: "RICE-100",
          message: "Mã SKU đã được sử dụng.",
        },
        [persisted, draft],
        "Lỗi phân loại",
      ),
    ).toEqual({
      [draft.clientId]: { sku: "Mã SKU đã được sử dụng." },
    });
  });
});
