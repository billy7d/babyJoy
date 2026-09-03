import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";
import type { ProductDescriptionDocument } from "../shared/product-description";
import { cleanupOrphanedProductDescriptionAssets } from "../workers/product-description-assets";

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

async function bodyBytes(value: unknown) {
  if (value instanceof Blob) return value.size;
  if (value instanceof ReadableStream) {
    const reader = value.getReader();
    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return total;
      total += chunk.value.byteLength;
    }
  }
  return 0;
}

const databases: DatabaseSync[] = [];

function createEnv() {
  const database = new DatabaseSync(":memory:");
  database.exec(migration("0001_initial.sql"));
  database.exec(migration("0006_product_taxonomy_v1.sql"));
  database.exec(migration("0014_product_rich_description_v1.sql"));
  const objects = new Map<string, R2Object>();
  const deletedKeys: string[] = [];
  const bucket = {
    objects,
    deletedKeys,
    async put(key: string, value: unknown, options: R2PutOptions) {
      const size = await bodyBytes(value);
      const object = {
        key,
        size,
        httpMetadata: { contentType: options.httpMetadata?.contentType },
      } as R2Object;
      objects.set(key, object);
      return object;
    },
    async head(key: string) {
      return objects.get(key) ?? null;
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        deletedKeys.push(key);
        objects.delete(key);
      }
    },
  };
  databases.push(database);
  return {
    database,
    bucket,
    env: {
      DB: new D1Adapter(database),
      PRODUCT_IMAGES: bucket,
      ENVIRONMENT: "development",
      DIRECT_SELLER_SHARE_ENABLED: "false",
      MESSENGER_CHECKOUT_ENABLED: "false",
      STOREFRONT_ACCESS_GATE_ENABLED: "false",
    } as unknown as Env,
  };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function api(env: Env, path: string, init?: RequestInit, ctx?: ExecutionContext) {
  return worker.fetch(
    new Request(`https://metraphuong.com${path}`, init),
    env,
    ctx ?? ({ waitUntil: (promise: Promise<unknown>) => void promise } as ExecutionContext),
  );
}

function productPayload(slug: string, descriptionContent: ProductDescriptionDocument, session = "rich-description-session") {
  return {
    name: `Rich ${slug}`,
    slug,
    shortDescription: "Tóm tắt riêng của sản phẩm.",
    description: "Legacy sẽ được đồng bộ từ rich content.",
    descriptionContent,
    descriptionUploadSessionId: session,
    status: "AVAILABLE",
    variants: [{ name: "Hộp", sku: `RICH-${slug}`, priceVnd: 120000, availability: "AVAILABLE" }],
  };
}

describe("Product rich description API", () => {
  it("create và GET round-trip document, đồng bộ legacy plain text", async () => {
    const { env, database } = createEnv();
    const content: ProductDescriptionDocument = {
      version: 1,
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, textAlign: "left" }, content: [{ type: "text", text: "Nội dung A" }] },
        { type: "paragraph", content: [{ type: "text", text: "Đoạn A" }] },
      ],
    };
    const response = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(productPayload("rich-a", content)),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string; product: { descriptionContent: ProductDescriptionDocument } };
    expect(created.product.descriptionContent).toEqual(content);
    expect(database.prepare("SELECT description, description_content AS content FROM products WHERE id = ?").get(created.id)).toEqual({
      description: "Nội dung A\nĐoạn A",
      content: JSON.stringify(content),
    });
    const publicResponse = await api(env, "/api/products/rich-a");
    expect(publicResponse.status).toBe(200);
    const publicBody = (await publicResponse.json()) as { data: { descriptionContent: ProductDescriptionDocument; descriptionAssets: unknown[] } };
    expect(publicBody.data.descriptionContent).toEqual(content);
    expect(publicBody.data.descriptionAssets).toEqual([]);
  });

  it("từ chối document sai schema bằng 422 và request product quá lớn bằng 413", async () => {
    const { env } = createEnv();
    const invalid = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...productPayload("rich-invalid", { version: 1, type: "doc", content: [] }),
        descriptionContent: { version: 1, type: "doc", content: [{ type: "script" }] },
      }),
    });
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.code).toBe("INVALID_PRODUCT_DESCRIPTION");
    const tooLarge = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{" + "x".repeat(520 * 1024) + "}",
    });
    expect(tooLarge.status).toBe(413);
  });

  it("upload asset R2, claim khi Save và chặn cross-product reference", async () => {
    const { env, bucket, database } = createEnv();
    const session = "rich-image-session-123";
    const upload = await api(env, "/api/admin/product-description-assets", {
      method: "POST",
      headers: { "content-type": "image/png", "x-upload-session-id": session },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(upload.status).toBe(201);
    const uploadBody = (await upload.json()) as { asset: { id: string; r2Key: string; url: string } };
    expect(uploadBody.asset.r2Key).toMatch(/^product-descriptions\//);
    expect(bucket.objects.has(uploadBody.asset.r2Key)).toBe(true);
    expect(
      database
        .prepare("SELECT product_id AS productId, claimed_at AS claimedAt FROM product_description_assets WHERE id = ?")
        .get(uploadBody.asset.id),
    ).toEqual({ productId: null, claimedAt: null });
    const imageContent: ProductDescriptionDocument = {
      version: 1,
      type: "doc",
      content: [{ type: "productDescriptionImage", attrs: { assetId: uploadBody.asset.id, alignment: "center", size: "medium", alt: "Ảnh A" } }],
    };
    const created = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(productPayload("rich-image-a", imageContent, session)),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string };
    const read = await api(env, `/api/admin/products/${createdBody.id}`);
    const readBody = (await read.json()) as { data: { descriptionAssets: Array<{ id: string; url: string }> } };
    expect(readBody.data.descriptionAssets.map((asset) => asset.id)).toEqual([uploadBody.asset.id]);
    const other = await api(env, "/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(productPayload("rich-image-b", imageContent, "other-session-12345")),
    });
    expect(other.status).toBe(422);
    expect((await other.json()).error.code).toBe("INVALID_PRODUCT_DESCRIPTION");

    const abandonedUpload = await api(env, "/api/admin/product-description-assets", {
      method: "POST",
      headers: { "content-type": "image/png", "x-upload-session-id": "abandoned-rich-session" },
      body: new Uint8Array([4, 5, 6]),
    });
    const abandonedBody = (await abandonedUpload.json()) as { asset: { id: string; r2Key: string } };
    database
      .prepare("UPDATE product_description_assets SET updated_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), abandonedBody.asset.id);
    expect(await cleanupOrphanedProductDescriptionAssets(env)).toMatchObject({ count: 1 });
    expect(bucket.deletedKeys).toContain(abandonedBody.asset.r2Key);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM product_description_assets WHERE id = ?")
        .get(abandonedBody.asset.id),
    ).toEqual({ count: 0 });
  });

  it("giữ admin authorization hiện tại cho endpoint upload", async () => {
    const { env } = createEnv();
    const productionEnv = { ...env, ENVIRONMENT: "production", ACCESS_TEAM_DOMAIN: "metraphuong.cloudflareaccess.com", ACCESS_AUD: "aud" } as unknown as Env;
    const response = await api(productionEnv, "/api/admin/product-description-assets", {
      method: "POST",
      headers: { "content-type": "image/png", "x-upload-session-id": "rich-auth-session" },
      body: new Uint8Array([1]),
    });
    expect(response.status).toBe(401);
  });
});
