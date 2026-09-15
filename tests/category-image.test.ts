import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";
import { processProductStorageCleanup } from "../workers/product-delete";
import { MAX_STORED_IMAGE_BYTES } from "../shared/images";

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

type StoredObject = {
  bytes: Uint8Array;
  contentType: string;
};

async function byteLength(value: unknown) {
  if (value instanceof Blob) return value.size;
  if (value instanceof Uint8Array) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (value instanceof ReadableStream) {
    const reader = value.getReader();
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return size;
      size += chunk.value.byteLength;
    }
  }
  return 0;
}

function createEnv() {
  const database = new DatabaseSync(":memory:");
  for (const name of [
    "0001_initial.sql",
    "0002_seed.sql",
    "0003_messenger_checkout_v1.sql",
    "0004_direct_seller_cart_share_v1.sql",
    "0005_remove_demo_cart_request.sql",
    "0006_product_taxonomy_v1.sql",
    "0023_product_storage_cleanup_queue_v1.sql",
  ])
    database.exec(migration(name));

  const objects = new Map<string, StoredObject>();
  const deletedKeys: string[] = [];
  let failDeletes = false;
  const bucket = {
    async put(key: string, value: unknown, options: R2PutOptions) {
      const size = await byteLength(value);
      objects.set(key, {
        bytes: new Uint8Array(size),
        contentType: options.httpMetadata?.contentType ?? "",
      });
      return {
        key,
        size,
        httpMetadata: { contentType: options.httpMetadata?.contentType },
      } as R2Object;
    },
    async head(key: string) {
      const object = objects.get(key);
      return object
        ? ({
            key,
            size: object.bytes.byteLength,
            httpMetadata: { contentType: object.contentType },
          } as R2Object)
        : null;
    },
    async delete(keys: string | string[]) {
      if (failDeletes) throw new Error("R2_TEMPORARY_FAILURE");
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        deletedKeys.push(key);
        objects.delete(key);
      }
    },
  };
  const pendingWaitUntil: Promise<unknown>[] = [];
  const env = {
    DB: new D1Adapter(database),
    PRODUCT_IMAGES: bucket,
    ENVIRONMENT: "development",
    DIRECT_SELLER_SHARE_ENABLED: "false",
    MESSENGER_CHECKOUT_ENABLED: "false",
    STOREFRONT_ACCESS_GATE_ENABLED: "false",
  } as unknown as Env;
  return {
    database,
    bucket,
    objects,
    deletedKeys,
    pendingWaitUntil,
    env,
    setFailDeletes(value: boolean) {
      failDeletes = value;
    },
  };
}

const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

async function api(
  env: Env,
  path: string,
  init?: RequestInit,
  pendingWaitUntil: Promise<unknown>[] = [],
) {
  const response = await worker.fetch(
    new Request(`https://metraphuong.com${path}`, init),
    env,
    {
      waitUntil(promise: Promise<unknown>) {
        pendingWaitUntil.push(promise);
      },
    } as ExecutionContext,
  );
  await Promise.all(pendingWaitUntil.splice(0));
  return response;
}

async function uploadImage(env: Env, pendingWaitUntil: Promise<unknown>[] = []) {
  const response = await api(
    env,
    "/api/admin/category-images",
    {
      method: "POST",
      headers: { "content-type": "image/webp" },
      body: new Uint8Array([1, 2, 3, 4]),
    },
    pendingWaitUntil,
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { key: string; url: string };
}

async function createCategory(
  env: Env,
  name: string,
  slug: string,
  imageKey: string | null,
  pendingWaitUntil: Promise<unknown>[] = [],
) {
  const response = await api(
    env,
    "/api/admin/categories",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        slug,
        description: "Ảnh đại diện test",
        imageKey,
        sortOrder: 99,
        isActive: true,
      }),
    },
    pendingWaitUntil,
  );
  return {
    response,
    body: (await response.json()) as {
      id?: string;
      error?: { code?: string; message?: string };
    },
  };
}

async function category(env: Env, id: string) {
  const response = await api(env, `/api/admin/categories/${id}`);
  return (await response.json()) as {
    data?: { id: string; imageKey: string | null; imageUrl: string | null };
  };
}

describe("CRUD ảnh đại diện danh mục", () => {
  it("upload, save và đọc lại URL local từ D1/R2", async () => {
    const fixture = createEnv();
    databases.push(fixture.database);
    const uploaded = await uploadImage(fixture.env);
    expect(uploaded.key).toMatch(/^categories\/\d{4}-\d{2}-\d{2}\/.+\.webp$/);
    expect(uploaded.url).toContain(`/media/${uploaded.key}`);

    const created = await createCategory(
      fixture.env,
      "Ảnh đại diện CRUD",
      "anh-dai-dien-crud",
      uploaded.key,
    );
    expect(created.response.status).toBe(201);
    expect(created.body.id).toBeTruthy();
    const id = created.body.id!;

    const firstRead = await category(fixture.env, id);
    const secondRead = await category(fixture.env, id);
    expect(firstRead.data).toMatchObject({
      id,
      imageKey: uploaded.key,
      imageUrl: `/media/${uploaded.key}`,
    });
    expect(secondRead.data).toEqual(firstRead.data);

    const publicResponse = await api(fixture.env, "/api/categories");
    const publicBody = (await publicResponse.json()) as {
      data: Array<{ id: string; imageKey: string | null; imageUrl: string | null }>;
    };
    expect(publicBody.data.find((row) => row.id === id)).toMatchObject({
      imageKey: uploaded.key,
      imageUrl: `/media/${uploaded.key}`,
    });
  });

  it("replace rồi delete ảnh, cleanup object cũ và object hiện tại", async () => {
    const fixture = createEnv();
    databases.push(fixture.database);
    const first = await uploadImage(fixture.env);
    const created = await createCategory(
      fixture.env,
      "Ảnh replace",
      "anh-replace",
      first.key,
    );
    const id = created.body.id!;
    const second = await uploadImage(fixture.env);

    const replace = await api(fixture.env, `/api/admin/categories/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ảnh replace",
        slug: "anh-replace",
        description: "",
        imageKey: second.key,
        sortOrder: 99,
        isActive: true,
      }),
    });
    expect(replace.status).toBe(200);
    expect(fixture.objects.has(first.key)).toBe(false);
    expect(fixture.objects.has(second.key)).toBe(true);

    const remove = await api(fixture.env, `/api/admin/categories/${id}/image`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(200);
    expect((await category(fixture.env, id)).data).toMatchObject({
      imageKey: null,
      imageUrl: null,
    });
    expect(fixture.objects.has(second.key)).toBe(false);
    expect(fixture.deletedKeys).toEqual(expect.arrayContaining([first.key, second.key]));
  });

  it("slug conflict rollback giữ ảnh A và dọn ảnh B chưa được gắn", async () => {
    const fixture = createEnv();
    databases.push(fixture.database);
    const first = await uploadImage(fixture.env);
    const created = await createCategory(
      fixture.env,
      "Ảnh rollback",
      "anh-rollback",
      first.key,
    );
    const second = await createCategory(
      fixture.env,
      "Slug đích",
      "slug-dich",
      null,
    );
    const secondImage = await uploadImage(fixture.env);
    const response = await api(fixture.env, `/api/admin/categories/${created.body.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ảnh rollback",
        slug: "slug-dich",
        description: "",
        imageKey: secondImage.key,
        sortOrder: 99,
        isActive: true,
      }),
    });
    expect(response.status).toBe(409);
    expect((await category(fixture.env, created.body.id!)).data?.imageKey).toBe(first.key);
    expect(fixture.objects.has(first.key)).toBe(true);
    expect(fixture.objects.has(secondImage.key)).toBe(false);
    expect(second.body.id).toBeTruthy();
  });

  it("create conflict rollback dọn object upload nhưng không đụng category hiện có", async () => {
    const fixture = createEnv();
    databases.push(fixture.database);
    const existing = await createCategory(
      fixture.env,
      "Slug đã dùng",
      "slug-da-dung",
      null,
    );
    const uploaded = await uploadImage(fixture.env);
    const duplicate = await createCategory(
      fixture.env,
      "Tên mới",
      "slug-da-dung",
      uploaded.key,
    );
    expect(duplicate.response.status).toBe(409);
    expect(fixture.objects.has(uploaded.key)).toBe(false);
    expect(existing.body.id).toBeTruthy();
  });

  it("shared reference chỉ xóa object sau khi category cuối cùng bỏ ảnh", async () => {
    const fixture = createEnv();
    databases.push(fixture.database);
    const uploaded = await uploadImage(fixture.env);
    const first = await createCategory(
      fixture.env,
      "Shared một",
      "shared-mot",
      uploaded.key,
    );
    const second = await createCategory(
      fixture.env,
      "Shared hai",
      "shared-hai",
      uploaded.key,
    );
    const firstRemove = await api(
      fixture.env,
      `/api/admin/categories/${first.body.id}/image`,
      { method: "DELETE" },
    );
    expect(firstRemove.status).toBe(200);
    expect(fixture.objects.has(uploaded.key)).toBe(true);

    const secondRemove = await api(
      fixture.env,
      `/api/admin/categories/${second.body.id}/image`,
      { method: "DELETE" },
    );
    expect(secondRemove.status).toBe(200);
    expect(fixture.objects.has(uploaded.key)).toBe(false);
  });

  it("hard-delete category cleanup và child guard giữ object khi bị chặn", async () => {
    const fixture = createEnv();
    databases.push(fixture.database);
    const parentImage = await uploadImage(fixture.env);
    const parent = await createCategory(
      fixture.env,
      "Category parent image",
      "category-parent-image",
      parentImage.key,
    );
    const childImage = await uploadImage(fixture.env);
    const child = await createCategory(
      fixture.env,
      "Category child image",
      "category-child-image",
      childImage.key,
    );
    fixture.database
      .prepare("UPDATE categories SET parent_id = ? WHERE id = ?")
      .run(parent.body.id, child.body.id);

    const blocked = await api(
      fixture.env,
      `/api/admin/categories/${parent.body.id}/permanent`,
      { method: "DELETE" },
    );
    expect(blocked.status).toBe(409);
    expect(fixture.objects.has(parentImage.key)).toBe(true);

    const deletedChild = await api(
      fixture.env,
      `/api/admin/categories/${child.body.id}/permanent`,
      { method: "DELETE" },
    );
    expect(deletedChild.status).toBe(200);
    expect(fixture.objects.has(childImage.key)).toBe(false);

    const deletedParent = await api(
      fixture.env,
      `/api/admin/categories/${parent.body.id}/permanent`,
      { method: "DELETE" },
    );
    expect(deletedParent.status).toBe(200);
    expect(fixture.objects.has(parentImage.key)).toBe(false);
  });

  it("image reference invalid, object thiếu và hard cap đều fail closed", async () => {
    const fixture = createEnv();
    databases.push(fixture.database);
    const invalid = await createCategory(
      fixture.env,
      "Key không hợp lệ",
      "key-khong-hop-le",
      "products/2026-08-26/123e4567-e89b-42d3-a456-426614174000.webp",
    );
    expect(invalid.response.status).toBe(422);

    const missing = await createCategory(
      fixture.env,
      "Key thiếu object",
      "key-thieu-object",
      "categories/2026-08-26/123e4567-e89b-42d3-a456-426614174000.webp",
    );
    expect(missing.response.status).toBe(422);

    const oversized = await api(fixture.env, "/api/admin/category-images", {
      method: "POST",
      headers: {
        "content-type": "image/webp",
        "content-length": String(MAX_STORED_IMAGE_BYTES + 1),
      },
      body: new Uint8Array([1]),
    });
    expect(oversized.status).toBe(413);
    expect(fixture.objects.size).toBe(0);
  });

  it("R2 failure đưa key vào queue để Cron retry mà API CRUD vẫn giữ D1", async () => {
    const fixture = createEnv();
    databases.push(fixture.database);
    const first = await uploadImage(fixture.env);
    const created = await createCategory(
      fixture.env,
      "Queue retry",
      "queue-retry",
      first.key,
    );
    const second = await uploadImage(fixture.env);
    fixture.setFailDeletes(true);
    const replace = await api(fixture.env, `/api/admin/categories/${created.body.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Queue retry",
        slug: "queue-retry",
        description: "",
        imageKey: second.key,
        sortOrder: 99,
        isActive: true,
      }),
    });
    expect(replace.status).toBe(200);
    expect(fixture.objects.has(first.key)).toBe(true);
    expect(
      fixture.database
        .prepare("SELECT attempt_count AS attemptCount FROM product_storage_cleanup WHERE r2_key = ?")
        .get(first.key),
    ).toEqual({ attemptCount: 1 });

    fixture.setFailDeletes(false);
    await processProductStorageCleanup(fixture.env);
    expect(fixture.objects.has(first.key)).toBe(false);
    expect(
      fixture.database
        .prepare("SELECT COUNT(*) AS count FROM product_storage_cleanup WHERE r2_key = ?")
        .get(first.key),
    ).toEqual({ count: 0 });
  });
});
