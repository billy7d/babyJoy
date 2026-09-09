import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";

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

function migrationNames() {
  return readdirSync(new URL("../migrations", import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

function createDatabase(until?: string) {
  const database = new DatabaseSync(":memory:");
  for (const name of migrationNames()) {
    if (until && name >= until) break;
    database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  databases.push(database);
  return database;
}

function createEnv() {
  const database = createDatabase();
  return {
    database,
    env: {
      DB: new D1Adapter(database),
      PRODUCT_IMAGES: {
        head: async () => ({
          size: 1024,
          httpMetadata: { contentType: "image/webp" },
        }),
      },
      ENVIRONMENT: "development",
      STOREFRONT_ACCESS_GATE_ENABLED: "false",
      DIRECT_SELLER_SHARE_ENABLED: "false",
      MESSENGER_CHECKOUT_ENABLED: "false",
    } as unknown as Env,
  };
}

function api(env: Env, path: string, init?: RequestInit) {
  return worker.fetch(
    new Request(`https://metraphuong.com${path}`, init),
    env,
    {} as ExecutionContext,
  );
}

function insertProduct(
  database: DatabaseSync,
  productId: string,
  slug: string,
  variants: Array<{
    id: string;
    name: string;
    sku: string;
    priceVnd: number;
    availability?: "AVAILABLE" | "OUT_OF_STOCK" | "HIDDEN";
    sortOrder: number;
  }>,
) {
  database
    .prepare(
      `INSERT INTO products
        (id, name, slug, brand, short_description, description, status,
         featured, sort_order, min_age_months, is_best_seller, best_seller_rank)
       VALUES (?, ?, ?, ?, '', '', 'AVAILABLE', 0, 1, NULL, 0, NULL)`,
    )
    .run(productId, `Facet ${productId}`, slug, "Facet Brand");
  database
    .prepare("INSERT INTO product_categories (product_id, category_id) VALUES (?, 'cat-cereal')")
    .run(productId);
  const statement = database.prepare(
    `INSERT INTO product_variants
      (id, product_id, name, sku, price_vnd, availability, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const variant of variants)
    statement.run(
      variant.id,
      productId,
      variant.name,
      variant.sku,
      variant.priceVnd,
      variant.availability ?? "AVAILABLE",
      variant.sortOrder,
    );
}

function assignTags(database: DatabaseSync, variantId: string, tagIds: string[]) {
  const statement = database.prepare(
    "INSERT INTO variant_tags (variant_id, tag_id) VALUES (?, ?)",
  );
  for (const tagId of tagIds) statement.run(variantId, tagId);
}

async function jsonBody<T>(response: Response) {
  return (await response.json()) as T;
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("Variant Facet / Tag Group Engine", () => {
  it("migration giữ product_tags, backfill tag cũ cho mọi variant và tạo tag tuổi từ min_age_months", () => {
    const database = createDatabase("0018_variant_tag_groups_v1.sql");
    database
      .prepare(
        `INSERT INTO products
          (id, name, slug, brand, short_description, description, status,
           featured, sort_order, min_age_months, is_best_seller, best_seller_rank)
         VALUES ('legacy-facet-product', 'Legacy facet', 'legacy-facet', 'Legacy', '', '', 'AVAILABLE', 0, 1, 18, 1, 3)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO product_variants (id, product_id, name, sku, price_vnd, availability, sort_order)
         VALUES
           ('legacy-facet-variant-a', 'legacy-facet-product', 'A', 'LEGACY-A', 10000, 'AVAILABLE', 1),
           ('legacy-facet-variant-b', 'legacy-facet-product', 'B', 'LEGACY-B', 12000, 'AVAILABLE', 2)`,
      )
      .run();
    database
      .prepare("INSERT INTO product_tags (product_id, tag_id) VALUES ('legacy-facet-product', 'tag-organic')")
      .run();
    database.exec(
      readFileSync(
        new URL("../migrations/0018_variant_tag_groups_v1.sql", import.meta.url),
        "utf8",
      ),
    );

    const assignments = database
      .prepare(
        `SELECT variant_id AS variantId, tag_id AS tagId
         FROM variant_tags WHERE variant_id LIKE 'legacy-facet-variant-%'
         ORDER BY variantId, tagId`,
      )
      .all();
    expect(assignments).toEqual([
      { variantId: "legacy-facet-variant-a", tagId: "tag-age-18" },
      { variantId: "legacy-facet-variant-a", tagId: "tag-best-seller" },
      { variantId: "legacy-facet-variant-a", tagId: "tag-organic" },
      { variantId: "legacy-facet-variant-b", tagId: "tag-age-18" },
      { variantId: "legacy-facet-variant-b", tagId: "tag-best-seller" },
      { variantId: "legacy-facet-variant-b", tagId: "tag-organic" },
    ]);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM product_tags WHERE product_id = 'legacy-facet-product'")
        .get(),
    ).toEqual({ count: 1 });
    expect(() =>
      database
        .prepare("INSERT INTO tags (id, name, slug) VALUES ('ungrouped', 'Ungrouped', 'ungrouped')")
        .run(),
    ).toThrow(/TAG_GROUP_REQUIRED/);
  });

  it("public chỉ trả group filterable, admin bảo vệ system key và tag hệ thống", async () => {
    const { env } = createEnv();
    const publicResponse = await api(env, "/api/tag-groups");
    expect(publicResponse.status).toBe(200);
    const publicBody = await jsonBody<{
      supported: boolean;
      groups: Array<{ id: string; displayName: string; tags: Array<{ name: string }> }>;
    }>(publicResponse);
    expect(publicBody.supported).toBe(true);
    expect(publicBody.groups.map((group) => group.id)).toEqual([
      "tag-group-age",
      "tag-group-attributes",
    ]);
    expect(publicBody.groups.find((group) => group.id === "tag-group-age")?.tags.map((tag) => tag.name)).toEqual([
      "6 tháng",
      "8 tháng",
      "10 tháng",
      "12 tháng",
    ]);

    const adminResponse = await api(env, "/api/admin/tag-groups");
    expect(adminResponse.status).toBe(200);
    const adminBody = await jsonBody<{
      supported: boolean;
      data: Array<{ id: string; systemKey: string | null }>;
    }>(adminResponse);
    expect(adminBody.supported).toBe(true);
    expect(adminBody.data.some((group) => group.id === "tag-group-merchandising")).toBe(true);

    const protectedGroup = await api(env, "/api/admin/tag-groups/tag-group-age", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Độ tuổi",
        slug: "do-tuoi",
        displayName: "Tuổi bé",
        systemKey: "renamed-age",
        assignmentMode: "SINGLE",
        isActive: true,
        isFilterable: true,
        sortOrder: 10,
      }),
    });
    expect(protectedGroup.status).toBe(409);
    expect((await jsonBody<{ error: { code: string } }>(protectedGroup)).error.code).toBe(
      "SYSTEM_TAG_GROUP_KEY_IMMUTABLE",
    );

    const protectedTag = await api(
      env,
      "/api/admin/tag-groups/tag-group-age/tags/tag-age-8",
      { method: "DELETE" },
    );
    expect(protectedTag.status).toBe(409);
    expect((await jsonBody<{ error: { code: string } }>(protectedTag)).error.code).toBe(
      "SYSTEM_TAG_PROTECTED",
    );

    const createdGroup = await api(env, "/api/admin/tag-groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Dị ứng",
        slug: "di-ung",
        displayName: "Dị ứng",
        assignmentMode: "MULTI",
        isActive: true,
        isFilterable: true,
        sortOrder: 40,
      }),
    });
    expect(createdGroup.status).toBe(201);
    const createdGroupBody = await jsonBody<{ id: string }>(createdGroup);
    const createdTag = await api(env, `/api/admin/tag-groups/${createdGroupBody.id}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Không đậu nành",
        slug: "khong-dau-nanh",
        displayName: "Không đậu nành",
        isActive: true,
        showBadge: false,
        sortOrder: 1,
      }),
    });
    expect(createdTag.status).toBe(201);
    const createdTagBody = await jsonBody<{ id: string }>(createdTag);
    expect(
      (await api(env, `/api/admin/tag-groups/${createdGroupBody.id}`, { method: "DELETE" })).status,
    ).toBe(409);
    expect(
      (await api(env, `/api/admin/tag-groups/${createdGroupBody.id}/tags/${createdTagBody.id}`, {
        method: "DELETE",
      })).status,
    ).toBe(200);
    expect(
      (await api(env, `/api/admin/tag-groups/${createdGroupBody.id}`, { method: "DELETE" })).status,
    ).toBe(200);
  });

  it("lọc AND giữa group, OR trong group và trả matchedVariantId đúng thứ tự", async () => {
    const { env, database } = createEnv();
    insertProduct(database, "facet-product", "facet-product", [
      { id: "facet-variant-a", name: "Variant A", sku: "FACET-A", priceVnd: 10000, sortOrder: 1 },
      { id: "facet-variant-b", name: "Variant B", sku: "FACET-B", priceVnd: 20000, sortOrder: 2 },
    ]);
    assignTags(database, "facet-variant-a", ["tag-age-8", "tag-organic"]);
    assignTags(database, "facet-variant-b", ["tag-age-10", "tag-no-sugar"]);

    const crossVariantUnion = await api(env, "/api/products?tagIds=tag-age-8,tag-no-sugar");
    expect((await jsonBody<{ data: unknown[] }>(crossVariantUnion)).data).toEqual([]);

    const sameVariantMatch = await api(env, "/api/products?tagIds=tag-age-8,tag-organic");
    const sameVariantBody = await jsonBody<{
      data: Array<{
        id: string;
        matchedVariantId: string | null;
        variants: Array<{ id: string; tags: Array<{ id: string }> }>;
      }>;
    }>(sameVariantMatch);
    expect(sameVariantBody.data).toHaveLength(1);
    expect(sameVariantBody.data[0]).toMatchObject({
      id: "facet-product",
      matchedVariantId: "facet-variant-a",
    });
    expect(sameVariantBody.data[0].variants.find((variant) => variant.id === "facet-variant-a")?.tags.map((tag) => tag.id)).toEqual([
      "tag-age-8",
      "tag-organic",
    ]);

    const sameGroupOr = await api(env, "/api/products?tagIds=tag-age-8,tag-age-10");
    const sameGroupOrBody = await jsonBody<{
      data: Array<{ id: string; matchedVariantId: string | null }>;
    }>(sameGroupOr);
    expect(sameGroupOrBody.data).toHaveLength(1);
    expect(sameGroupOrBody.data[0]).toMatchObject({
      id: "facet-product",
      matchedVariantId: "facet-variant-a",
    });
  });

  it("Product API lưu tag theo variant và chặn nhiều tag trong group SINGLE", async () => {
    const { env, database } = createEnv();
    const conflict = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Sản phẩm conflict",
        slug: "san-pham-conflict",
        status: "AVAILABLE",
        variants: [
          {
            name: "Gói conflict",
            sku: "CONFLICT-FACET",
            priceVnd: 10000,
            availability: "AVAILABLE",
            tagIds: ["tag-age-8", "tag-age-10"],
          },
        ],
      }),
    });
    expect(conflict.status).toBe(422);
    expect((await jsonBody<{ error: { code: string } }>(conflict)).error.code).toBe(
      "SINGLE_TAG_GROUP_CONFLICT",
    );
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM products WHERE slug = 'san-pham-conflict'").get(),
    ).toEqual({ count: 0 });

    const created = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Sản phẩm facet",
        slug: "san-pham-facet",
        status: "AVAILABLE",
        variants: [
          {
            name: "Gói 8 tháng",
            sku: "FACET-SAVED",
            priceVnd: 11000,
            availability: "AVAILABLE",
            tagIds: ["tag-age-8", "tag-organic"],
          },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = await jsonBody<{ id: string }>(created);
    const detail = await api(env, `/api/admin/products/${createdBody.id}`);
    const detailBody = await jsonBody<{
      data: { variants: Array<{ tags: Array<{ id: string }> }> };
    }>(detail);
    expect(detailBody.data.variants[0].tags.map((tag) => tag.id)).toEqual([
      "tag-age-8",
      "tag-organic",
    ]);
    const savedVariantId = database
      .prepare("SELECT id FROM product_variants WHERE product_id = ?")
      .get(createdBody.id)?.id;
    expect(() =>
      database
        .prepare("INSERT INTO variant_tags (variant_id, tag_id) VALUES (?, ?)")
        .run(savedVariantId, "tag-age-10"),
    ).toThrow(/SINGLE_TAG_GROUP_CONFLICT/);
    expect(() =>
      database
        .prepare("UPDATE variant_tags SET tag_id = ? WHERE variant_id = ? AND tag_id = ?")
        .run("tag-age-10", savedVariantId, "tag-organic"),
    ).toThrow(/SINGLE_TAG_GROUP_CONFLICT/);
  });

  it("curated trả card theo từng variant, gồm OUT_OF_STOCK nhưng loại hidden", async () => {
    const { env, database } = createEnv();
    insertProduct(database, "curated-product", "curated-product", [
      { id: "curated-best-a", name: "Best A", sku: "CURATED-A", priceVnd: 10000, sortOrder: 1 },
      { id: "curated-best-b", name: "Best B", sku: "CURATED-B", priceVnd: 12000, sortOrder: 2 },
      { id: "curated-oos", name: "Best OOS", sku: "CURATED-OOS", priceVnd: 13000, availability: "OUT_OF_STOCK", sortOrder: 3 },
      { id: "curated-hidden", name: "Best hidden", sku: "CURATED-HIDDEN", priceVnd: 14000, availability: "HIDDEN", sortOrder: 4 },
    ]);
    assignTags(database, "curated-best-a", ["tag-best-seller", "tag-must-try"]);
    assignTags(database, "curated-best-b", ["tag-best-seller"]);
    assignTags(database, "curated-oos", ["tag-best-seller"]);
    assignTags(database, "curated-hidden", ["tag-best-seller"]);

    const response = await api(env, "/api/curated-variants");
    expect(response.status).toBe(200);
    const body = await jsonBody<{
      supported: boolean;
      bestSellers: Array<{ id: string; matchedVariantId: string | null; variants: Array<{ id: string; availability: string }> }>;
      mustTry: Array<{ id: string; matchedVariantId: string | null }>;
    }>(response);
    expect(body.supported).toBe(true);
    expect(body.bestSellers.map((product) => product.matchedVariantId)).toEqual([
      "curated-best-a",
      "curated-best-b",
      "curated-oos",
    ]);
    expect(body.bestSellers).toHaveLength(3);
    expect(body.bestSellers.find((product) => product.matchedVariantId === "curated-oos")?.variants.find((variant) => variant.id === "curated-oos")?.availability).toBe("OUT_OF_STOCK");
    expect(body.mustTry).toEqual([
      expect.objectContaining({ id: "curated-product", matchedVariantId: "curated-best-a" }),
    ]);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM variant_tags WHERE variant_id = 'curated-hidden'").get(),
    ).toEqual({ count: 1 });
  });
});
