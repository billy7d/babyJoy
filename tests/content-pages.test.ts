import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";
import type { ProductDescriptionDocument } from "../shared/product-description";

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
    "0006_product_taxonomy_v1.sql",
    "0014_product_rich_description_v1.sql",
    "0015_content_pages_cms_v1.sql",
  ])
    database.exec(migration(name));
  const objects = new Map<string, R2Object>();
  const bucket = {
    async put(key: string, value: unknown, options: R2PutOptions) {
      let size = 0;
      if (value instanceof Blob) size = value.size;
      else if (value instanceof Uint8Array) size = value.byteLength;
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
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
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

function api(env: Env, path: string, init?: RequestInit) {
  return worker.fetch(
    new Request(`https://metraphuong.com${path}`, init),
    env,
    { waitUntil: (promise: Promise<unknown>) => void promise } as ExecutionContext,
  );
}

describe("Content Pages CMS", () => {
  it("migration tạo đúng ba system page và public GET chỉ trả page đã publish", async () => {
    const { env, database } = createEnv();
    expect(database.prepare("SELECT COUNT(*) AS count FROM content_pages").get()).toEqual({ count: 3 });
    expect(database.prepare("SELECT COUNT(DISTINCT slug) AS count FROM content_pages").get()).toEqual({ count: 3 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const response = await api(env, "/api/content-pages/shipping-policy");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { page: Record<string, unknown> };
    expect(body.page).toMatchObject({ slug: "shipping-policy", title: "Chính sách vận chuyển" });
    expect(body.page).not.toHaveProperty("status");
    expect(body.page).not.toHaveProperty("id");

    const unknown = await api(env, "/api/content-pages/not-a-system-page");
    expect(unknown.status).toBe(404);
  });

  it("Admin PUT persist title/rich content, bảo vệ revision và không expose draft", async () => {
    const { env } = createEnv();
    const read = await api(env, "/api/admin/content-pages/buying-guide");
    const current = (await read.json()) as { page: { updatedAt: string } };
    const content: ProductDescriptionDocument = {
      version: 1,
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Cách mua hàng" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Xem sản phẩm",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    };
    const saved = await api(env, "/api/admin/content-pages/buying-guide", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Hướng dẫn mua hàng mới",
        status: "PUBLISHED",
        content,
        updatedAt: current.page.updatedAt,
      }),
    });
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as { page: { updatedAt: string } };
    expect(savedBody.page.updatedAt).not.toBe(current.page.updatedAt);

    const publicResponse = await api(env, "/api/content-pages/buying-guide");
    expect(publicResponse.status).toBe(200);
    expect((await publicResponse.json())).toMatchObject({ page: { title: "Hướng dẫn mua hàng mới" } });

    const stale = await api(env, "/api/admin/content-pages/buying-guide", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Ghi đè cũ", status: "PUBLISHED", content, updatedAt: current.page.updatedAt }),
    });
    expect(stale.status).toBe(409);

    const draft = await api(env, "/api/admin/content-pages/buying-guide", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Bản nháp", status: "DRAFT", content }),
    });
    expect(draft.status).toBe(200);
    expect((await api(env, "/api/content-pages/buying-guide")).status).toBe(404);
  });

  it("reject title/body/link nguy hiểm và giữ auth Admin", async () => {
    const { env } = createEnv();
    const read = await api(env, "/api/admin/content-pages/returns-refunds");
    const current = (await read.json()) as { page: { updatedAt: string } };
    const unsafeContent: ProductDescriptionDocument = {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Không an toàn",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    };
    const unsafe = await api(env, "/api/admin/content-pages/returns-refunds", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Đổi trả", status: "PUBLISHED", content: unsafeContent, updatedAt: current.page.updatedAt }),
    });
    expect(unsafe.status).toBe(422);
    expect((await unsafe.json()).error.code).toBe("INVALID_CONTENT");

    const emptyTitle = await api(env, "/api/admin/content-pages/returns-refunds", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: " ", status: "PUBLISHED", content: { version: 1, type: "doc", content: [] } }),
    });
    expect(emptyTitle.status).toBe(422);

    const productionEnv = {
      ...env,
      ENVIRONMENT: "production",
      ACCESS_TEAM_DOMAIN: "metraphuong.cloudflareaccess.com",
      ACCESS_AUD: "aud",
    } as unknown as Env;
    expect((await api(productionEnv, "/api/admin/content-pages")).status).toBe(401);
  });

  it("dùng chung asset R2 cho Content Page và giữ asset sau khi claim", async () => {
    const { env, database, bucket } = createEnv();
    const session = "content-page-image-session";
    const upload = await api(env, "/api/admin/product-description-assets", {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "x-upload-session-id": session,
        "x-content-page-slug": "shipping-policy",
      },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(upload.status).toBe(201);
    const uploadBody = (await upload.json()) as { asset: { id: string; r2Key: string } };
    expect(bucket).toBeDefined();
    const content: ProductDescriptionDocument = {
      version: 1,
      type: "doc",
      content: [
        {
          type: "productDescriptionImage",
          attrs: { assetId: uploadBody.asset.id, alignment: "center", size: "medium", alt: "Ảnh hướng dẫn" },
        },
      ],
    };
    const read = await api(env, "/api/admin/content-pages/shipping-policy");
    const current = (await read.json()) as { page: { updatedAt: string } };
    const saved = await api(env, "/api/admin/content-pages/shipping-policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Chính sách vận chuyển",
        status: "PUBLISHED",
        content,
        updatedAt: current.page.updatedAt,
        contentPageUploadSessionId: session,
      }),
    });
    expect(saved.status).toBe(200);
    expect(database.prepare("SELECT content_page_slug AS slug, claimed_at AS claimedAt FROM product_description_assets WHERE id = ?").get(uploadBody.asset.id)).toMatchObject({ slug: "shipping-policy" });
    const publicBody = (await (await api(env, "/api/content-pages/shipping-policy")).json()) as { page: { assets: Array<{ id: string; r2Key?: string }> } };
    expect(publicBody.page.assets).toEqual([{ id: uploadBody.asset.id, altText: "Ảnh hướng dẫn", url: expect.any(String) }]);
    expect(publicBody.page.assets[0]).not.toHaveProperty("r2Key");
  });
});
