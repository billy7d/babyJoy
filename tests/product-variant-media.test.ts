import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";
import { evaluateAuthoritativeCart } from "../workers/promotions";
import {
  buildVariantGallery,
  resolveGallerySelection,
} from "../app/components/public-pages";
import type { Product } from "../app/lib/catalog";

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
const imageKeys = {
  common: "products/2026-09-06/123e4567-e89b-42d3-a456-426614174010.webp",
  apple: "products/2026-09-06/123e4567-e89b-42d3-a456-426614174011.webp",
  banana: "products/2026-09-06/123e4567-e89b-42d3-a456-426614174012.webp",
  hidden: "products/2026-09-06/123e4567-e89b-42d3-a456-426614174013.webp",
  appleBack: "products/2026-09-06/123e4567-e89b-42d3-a456-426614174014.webp",
  appleNutrition: "products/2026-09-06/123e4567-e89b-42d3-a456-426614174015.webp",
  bananaBack: "products/2026-09-06/123e4567-e89b-42d3-a456-426614174016.webp",
};

function createEnv() {
  const database = new DatabaseSync(":memory:");
  const names = readdirSync(new URL("../migrations", import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const name of names)
    database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  databases.push(database);
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

function productPayload() {
  const image = (r2Key: string) => [{ r2Key, altText: "Ảnh phân loại", isPrimary: true }];
  return {
    name: "Bột Heinz",
    slug: "bot-heinz-variant-media",
    status: "AVAILABLE",
    images: [{ r2Key: imageKeys.common, altText: "Ảnh chung" }],
    variants: [
      { name: "Vị Táo", packageSize: "120g", sku: "HEINZ-APPLE-MEDIA", priceVnd: 129000, status: "SELLING", trackInventory: true, stockOnHand: 15, images: image(imageKeys.apple) },
      { name: "Vị Chuối", packageSize: "120g", sku: "HEINZ-BANANA-MEDIA", priceVnd: 125000, status: "OUT_OF_STOCK", trackInventory: true, stockOnHand: 20, images: image(imageKeys.banana) },
      { name: "Vị Rau củ", packageSize: "120g", sku: "HEINZ-VEG-MEDIA", priceVnd: 135000, status: "HIDDEN", trackInventory: true, stockOnHand: 8, images: image(imageKeys.hidden) },
    ],
  };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("Migration và API ảnh riêng theo variant", () => {
  it("giữ dữ liệu cũ, FK sạch và chỉ cho một ảnh đại diện", () => {
    const { database } = createEnv();
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM product_variants").get()).toMatchObject({ count: expect.any(Number) });
    expect(() =>
      database.exec(`
        INSERT INTO product_variant_images (id, variant_id, r2_key, is_primary) VALUES
          ('primary-a', 'variant-little-120', '${imageKeys.apple}', 1),
          ('primary-b', 'variant-little-120', '${imageKeys.banana}', 1);
      `),
    ).toThrow();
  });

  it("persist package/status/gallery, ẩn hoàn toàn variant hidden và giữ status sibling", async () => {
    const { env, database } = createEnv();
    const createdResponse = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(productPayload()),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      id: string;
      product: { variants: Array<{ id: string; name: string; packageSize: string; status: string; images: unknown[] }> };
    };
    expect(created.product.variants.map((variant) => variant.status)).toEqual([
      "SELLING",
      "OUT_OF_STOCK",
      "HIDDEN",
    ]);
    expect(created.product.variants[0]).toMatchObject({ packageSize: "120g" });
    expect(created.product.variants[0].images).toHaveLength(1);

    const publicResponse = await api(env, "/api/products/bot-heinz-variant-media");
    const publicBody = (await publicResponse.json()) as {
      data: { variants: Array<{ name: string; status: string; images: Array<{ r2Key: string }> }> };
    };
    expect(publicBody.data.variants.map((variant) => variant.name)).toEqual(["Vị Táo", "Vị Chuối"]);
    expect(JSON.stringify(publicBody)).not.toContain(imageKeys.hidden);

    const [apple, banana, hidden] = created.product.variants;
    const update = {
      ...productPayload(),
      variants: created.product.variants.map((variant) => ({
        ...productPayload().variants.find((item) => item.name === variant.name),
        ...variant,
        status: variant.id === hidden.id ? "SELLING" : variant.status,
      })),
    };
    const updatedResponse = await api(env, `/api/admin/products/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(update),
    });
    expect(updatedResponse.status).toBe(200);
    const persistedStatuses = database
      .prepare("SELECT id, availability FROM product_variants WHERE product_id = ? ORDER BY sort_order")
      .all(created.id) as Array<{ id: string; availability: string }>;
    expect(persistedStatuses).toEqual([
      { id: apple.id, availability: "AVAILABLE" },
      { id: banana.id, availability: "OUT_OF_STOCK" },
      { id: hidden.id, availability: "AVAILABLE" },
    ]);
  });

  it("reorder, đổi primary, xóa ảnh và giữ ID ảnh còn lại", async () => {
    const { env } = createEnv();
    const payload = productPayload();
    payload.variants[0].images = [
      { r2Key: imageKeys.apple, altText: "Táo trước", isPrimary: true },
      { r2Key: imageKeys.appleBack, altText: "Táo sau", isPrimary: false },
      { r2Key: imageKeys.appleNutrition, altText: "Táo dinh dưỡng", isPrimary: false },
    ];
    payload.variants[1].images = [
      { r2Key: imageKeys.banana, altText: "Chuối trước", isPrimary: true },
      { r2Key: imageKeys.bananaBack, altText: "Chuối sau", isPrimary: false },
    ];
    const created = (await (await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })).json()) as { id: string; product: { variants: Array<Record<string, unknown> & { id: string; name: string; images: Array<{ id: string; r2Key: string }> }> } };
    const apple = created.product.variants.find((variant) => variant.name === "Vị Táo")!;
    const retainedIds = new Map(apple.images.map((image) => [image.r2Key, image.id]));
    const updatedVariants = created.product.variants.map((variant) => ({
      ...variant,
      images: variant.id === apple.id
        ? [
            { ...apple.images[2], isPrimary: true },
            { ...apple.images[0], isPrimary: false },
          ]
        : variant.images,
    }));
    const updatedResponse = await api(env, `/api/admin/products/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, variants: updatedVariants }),
    });
    expect(updatedResponse.status).toBe(200);
    const admin = (await (await api(env, `/api/admin/products/${created.id}`)).json()) as {
      data: { variants: Array<{ id: string; images: Array<{ id: string; r2Key: string; sortOrder: number; isPrimary: boolean }> }> };
    };
    const persisted = admin.data.variants.find((variant) => variant.id === apple.id)!.images;
    expect(persisted.map((image) => image.r2Key)).toEqual([imageKeys.appleNutrition, imageKeys.apple]);
    expect(persisted.map((image) => image.isPrimary)).toEqual([true, false]);
    expect(persisted.map((image) => image.id)).toEqual([
      retainedIds.get(imageKeys.appleNutrition),
      retainedIds.get(imageKeys.apple),
    ]);
  });

  it("ẩn/bật Product không cascade hoặc làm mất trạng thái variant", async () => {
    const { env, database } = createEnv();
    const created = (await (await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(productPayload()),
    })).json()) as { id: string; product: { variants: Array<Record<string, unknown>> } };
    const originalStatuses = database
      .prepare("SELECT availability FROM product_variants WHERE product_id = ? ORDER BY sort_order")
      .all(created.id);
    for (const status of ["HIDDEN", "AVAILABLE"]) {
      const response = await api(env, `/api/admin/products/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...productPayload(), status, variants: created.product.variants }),
      });
      expect(response.status).toBe(200);
      expect(database
        .prepare("SELECT availability FROM product_variants WHERE product_id = ? ORDER BY sort_order")
        .all(created.id)).toEqual(originalStatuses);
    }
  });

  it("snapshot authoritative dùng đúng ảnh/tên/quy cách variant và chặn OUT_OF_STOCK", async () => {
    const { env } = createEnv();
    const created = (await (
      await api(env, "/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(productPayload()),
      })
    ).json()) as { product: { variants: Array<{ id: string; name: string }> } };
    const apple = created.product.variants.find((variant) => variant.name === "Vị Táo")!;
    const banana = created.product.variants.find((variant) => variant.name === "Vị Chuối")!;
    const evaluated = await evaluateAuthoritativeCart(
      [{ variantId: apple.id, quantity: 1, displayedPrice: 1 }],
      env,
    );
    expect(evaluated.pricedItems[0]).toMatchObject({
      variantName: "Vị Táo · 120g",
      imageKey: imageKeys.apple,
      priceVnd: 129000,
    });
    const unavailable = await evaluateAuthoritativeCart(
      [{ variantId: banana.id, quantity: 1 }],
      env,
    );
    expect(unavailable.unavailable).toEqual([banana.id]);
    const hidden = created.product.variants.find((variant) => variant.name === "Vị Rau củ")!;
    expect((await evaluateAuthoritativeCart(
      [{ variantId: hidden.id, quantity: 1 }],
      env,
    )).unavailable).toEqual([hidden.id]);
  });

  it("variant cũ không có ảnh fallback về ảnh Product trong cart authoritative", async () => {
    const { env } = createEnv();
    const payload = productPayload();
    payload.variants = [
      { ...payload.variants[0], images: [] },
    ];
    const created = (await (await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })).json()) as { product: { variants: Array<{ id: string }> } };
    const evaluated = await evaluateAuthoritativeCart(
      [{ variantId: created.product.variants[0].id, quantity: 1 }],
      env,
    );
    expect(evaluated.pricedItems[0].imageKey).toBe(imageKeys.common);
  });
});

describe("Gallery đồng bộ hai chiều", () => {
  it("ảnh variant đổi selector còn ảnh chung giữ nguyên selector", () => {
    const product = {
      id: "p",
      slug: "p",
      name: "Bột Heinz",
      brand: "Heinz",
      shortDescription: "",
      description: "",
      image: "/fallback.webp",
      images: [{ r2Key: imageKeys.common, altText: "Chung", sortOrder: 0, url: "/common.webp" }],
      category: "",
      age: "",
      tags: [],
      variants: [
        { id: "a", name: "Táo", sku: "A", priceVnd: 1, availability: "AVAILABLE", images: [{ id: "a1", variantId: "a", r2Key: imageKeys.apple, altText: "Táo", sortOrder: 0, isPrimary: true, url: "/a.webp" }] },
        { id: "b", name: "Chuối", sku: "B", priceVnd: 2, availability: "OUT_OF_STOCK", images: [{ id: "b1", variantId: "b", r2Key: imageKeys.banana, altText: "Chuối", sortOrder: 0, isPrimary: true, url: "/b.webp" }] },
      ],
    } satisfies Product;
    const gallery = buildVariantGallery(product);
    expect(gallery.map((image) => image.variantId)).toEqual([null, "a", "b"]);
    expect(resolveGallerySelection(gallery, 2, "a")).toEqual({ imageIndex: 2, variantId: "b" });
    expect(resolveGallerySelection(gallery, 0, "b")).toEqual({ imageIndex: 0, variantId: "b" });
  });
});
