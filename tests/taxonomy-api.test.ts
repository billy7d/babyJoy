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

const productPayload = {
  name: "Product Taxonomy A",
  slug: "product-taxonomy-a",
  brandId: "brand-heinz",
  minAgeMonths: 6,
  isBestSeller: true,
  bestSellerRank: 2,
  status: "AVAILABLE",
  categoryIds: ["cat-puree", "cat-food-jar"],
  variants: [
    {
      name: "Hũ 100g",
      sku: "TAXONOMY-A-100",
      priceVnd: 50000,
      availability: "AVAILABLE",
    },
  ],
};

describe("Product Taxonomy API", () => {
  it("lưu atomically product, brand, age, Best seller và nhiều nhóm", async () => {
    const { env } = createEnv();
    const response = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(productPayload),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    const detail = await api(env, `/api/admin/products/${created.id}`);
    expect(await detail.json()).toMatchObject({
      data: {
        brandId: "brand-heinz",
        minAgeMonths: 6,
        isBestSeller: 1,
        bestSellerRank: 2,
        categoryIds: expect.arrayContaining(["cat-puree", "cat-food-jar"]),
      },
    });
  });

  it("lọc category OR + brand + age + Best seller không duplicate", async () => {
    const { env } = createEnv();
    await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(productPayload),
    });
    const response = await api(
      env,
      "/api/products?category=trai-cay-nghien,hu-thuc-an&brand=heinz&age=10&bestSeller=1&sort=best_seller",
    );
    const body = (await response.json()) as { data: Array<{ slug: string }> };
    expect(body.data.filter((product) => product.slug === productPayload.slug)).toHaveLength(1);
  });

  it("rollback toàn bộ khi category không tồn tại", async () => {
    const { env, database } = createEnv();
    const response = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...productPayload, slug: "invalid-category", categoryIds: ["missing"] }),
    });
    expect(response.status).toBe(422);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM products WHERE slug = 'invalid-category'").get(),
    ).toEqual({ count: 0 });
  });

  it("archive chặn catalog/add mới nhưng không xóa dữ liệu sản phẩm", async () => {
    const { env, database } = createEnv();
    const created = (await (
      await api(env, "/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(productPayload),
      })
    ).json()) as { id: string };
    expect((await api(env, `/api/admin/products/${created.id}`, { method: "DELETE" })).status).toBe(200);
    const catalog = (await (await api(env, "/api/products?q=Product%20Taxonomy")).json()) as {
      data: unknown[];
    };
    expect(catalog.data).toEqual([]);
    expect(
      database.prepare("SELECT status, archived_at IS NOT NULL AS archived FROM products WHERE id = ?").get(created.id),
    ).toEqual({ status: "HIDDEN", archived: 1 });
  });

  it("ẩn category giữ relation và public không còn trả category", async () => {
    const { env, database } = createEnv();
    const before = database.prepare("SELECT COUNT(*) AS count FROM product_categories WHERE category_id = 'cat-puree'").get();
    expect((await api(env, "/api/admin/categories/cat-puree", { method: "DELETE" })).status).toBe(200);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM product_categories WHERE category_id = 'cat-puree'").get(),
    ).toEqual(before);
    const publicCategories = (await (await api(env, "/api/categories")).json()) as {
      data: Array<{ id: string }>;
    };
    expect(publicCategories.data.some((category) => category.id === "cat-puree")).toBe(false);
  });

  it("xóa vĩnh viễn category chưa dùng khỏi D1", async () => {
    const { env, database } = createEnv();
    const response = await api(env, "/api/admin/categories/cat-pudding-custard-nutrition-jar/permanent", {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      id: "cat-pudding-custard-nutrition-jar",
      deleted: true,
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM categories WHERE id = ?").get("cat-pudding-custard-nutrition-jar"),
    ).toEqual({ count: 0 });
  });

  it("xóa category đang dùng, cascade chỉ dọn junction và giữ product", async () => {
    const { env, database } = createEnv();
    const before = database
      .prepare("SELECT name, slug, brand, status FROM products WHERE id = 'prod-little-sprouts'")
      .get();
    database
      .prepare("UPDATE categories SET is_active = 0 WHERE id = 'cat-puree'")
      .run();

    const response = await api(env, "/api/admin/categories/cat-puree/permanent", {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM categories WHERE id = 'cat-puree'").get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM product_categories WHERE category_id = 'cat-puree'").get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT name, slug, brand, status FROM products WHERE id = 'prod-little-sprouts'").get(),
    ).toEqual(before);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM product_categories WHERE product_id = 'prod-little-sprouts'").get(),
    ).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect((await api(env, "/api/admin/products/prod-little-sprouts")).status).toBe(200);
    const publicProducts = (await (await api(env, "/api/products?q=Little%20Sprouts")).json()) as {
      data: Array<{ id: string }>;
    };
    expect(publicProducts.data.some((product) => product.id === "prod-little-sprouts")).toBe(true);
  });

  it("xóa một trong nhiều category, giữ các category còn lại", async () => {
    const { env, database } = createEnv();
    database
      .prepare("INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)")
      .run("prod-gerber", "cat-food-jar");

    const response = await api(env, "/api/admin/categories/cat-food-jar/permanent", {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    expect(
      database.prepare("SELECT category_id FROM product_categories WHERE product_id = 'prod-gerber' ORDER BY category_id").all(),
    ).toEqual([{ category_id: "cat-cereal" }]);
    expect(database.prepare("SELECT id FROM products WHERE id = 'prod-gerber'").get()).toEqual({ id: "prod-gerber" });
  });

  it("từ chối xóa category có child mà không đụng dữ liệu", async () => {
    const { env, database } = createEnv();
    database
      .prepare("INSERT INTO categories (id, parent_id, name, slug) VALUES (?, ?, ?, ?)")
      .run("cat-child", "cat-cereal", "Danh mục con", "danh-muc-con");

    const response = await api(env, "/api/admin/categories/cat-cereal/permanent", {
      method: "DELETE",
    });
    expect(response.status).toBe(409);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "CATEGORY_HAS_CHILDREN" },
    });
    expect(database.prepare("SELECT id FROM categories WHERE id IN ('cat-cereal', 'cat-child') ORDER BY id").all()).toEqual([
      { id: "cat-cereal" },
      { id: "cat-child" },
    ]);
  });

  it("xóa category không tồn tại trả 404 và không gây 500", async () => {
    const { env } = createEnv();
    const response = await api(env, "/api/admin/categories/missing-category/permanent", {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "CATEGORY_NOT_FOUND" },
    });
  });

  it("xóa tag đang dùng chỉ dọn association và giữ các tag khác", async () => {
    const { env, database } = createEnv();
    const before = database
      .prepare("SELECT name, slug, brand, status FROM products WHERE id = 'prod-gerber'")
      .get();
    database
      .prepare("INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?), (?, ?)")
      .run("prod-gerber", "tag-organic", "prod-gerber", "tag-no-sugar");

    const response = await api(env, "/api/admin/tags/tag-organic/permanent", {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    expect(database.prepare("SELECT id FROM tags WHERE id = 'tag-organic'").get()).toBeUndefined();
    expect(
      database.prepare("SELECT tag_id FROM product_tags WHERE product_id = 'prod-gerber'").all(),
    ).toEqual([{ tag_id: "tag-no-sugar" }]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      database.prepare("SELECT name, slug, brand, status FROM products WHERE id = 'prod-gerber'").get(),
    ).toEqual(before);
    const publicTags = (await (await api(env, "/api/tags")).json()) as {
      data: Array<{ id: string }>;
    };
    expect(publicTags.data.some((tag) => tag.id === "tag-organic")).toBe(false);
    const publicProducts = (await (await api(env, "/api/products?q=Gerber")).json()) as {
      data: Array<{ id: string; tagNames?: string[] }>;
    };
    expect(publicProducts.data.find((product) => product.id === "prod-gerber")?.tagNames).toEqual([
      "Không thêm đường",
    ]);
  });

  it("xóa tag hidden vẫn hoạt động và tag không tồn tại trả 404", async () => {
    const { env, database } = createEnv();
    database.prepare("UPDATE tags SET is_active = 0 WHERE id = 'tag-dairy-free'").run();
    expect((await api(env, "/api/admin/tags/tag-dairy-free/permanent", { method: "DELETE" })).status).toBe(200);

    const missing = await api(env, "/api/admin/tags/missing-tag/permanent", { method: "DELETE" });
    expect(missing.status).toBe(404);
    expect((await missing.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "TAG_NOT_FOUND" },
    });
    expect(database.prepare("SELECT id FROM tags WHERE id = 'tag-dairy-free'").get()).toBeUndefined();
  });

  it("delete taxonomy vẫn nằm sau admin authorization boundary", async () => {
    const { env } = createEnv();
    const productionEnv = {
      ...env,
      ENVIRONMENT: "production",
      ACCESS_TEAM_DOMAIN: "metraphuong.cloudflareaccess.com",
      ACCESS_AUD: "test-audience",
    } as Env;
    const response = await api(productionEnv, "/api/admin/tags/tag-organic/permanent", {
      method: "DELETE",
    });
    expect(response.status).toBe(401);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });
});
