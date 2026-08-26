import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getProductEditPath,
  ProductEditorSaveController,
  type ProductEditorSavePayload,
} from "../app/lib/product-editor-save";
import {
  findProductConflict,
  productConflictError,
} from "../workers/product-conflicts";

const payload: ProductEditorSavePayload = {
  name: "Smoke test",
  slug: "smoke-test",
  images: [
    {
      r2Key: "products/2026-08-27/primary.jpg",
      altText: "Ảnh chính",
      sortOrder: 0,
    },
    {
      r2Key: "products/2026-08-27/gallery.jpg",
      altText: "Ảnh phụ",
      sortOrder: 1,
    },
  ],
  variants: [{ name: "Gói test", sku: "SMOKE-A", priceVnd: 123000 }],
};

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("Product Editor save lifecycle", () => {
  it("UI khóa Save khi pending và chuyển sang edit route sau create", () => {
    const source = readFileSync("app/components/admin-pages.tsx", "utf8");
    expect(source).toContain(
      "disabled={saving || uploading || Boolean(id && !editing)}",
    );
    expect(source).toContain(
      "navigate(getProductEditPath(result.id), { replace: true })",
    );
  });

  it("create một lần chỉ gửi đúng một POST khi double click", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    let resolveRequest!: (value: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const controller = new ProductEditorSaveController(undefined, (input, init) => {
      calls.push({ input, init });
      return pendingResponse;
    });

    const first = controller.save(payload);
    const second = controller.save(payload);
    expect(second).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      input: "/api/admin/products",
      init: { method: "POST" },
    });

    resolveRequest(
      new Response(JSON.stringify({ success: true, id: "product-1" }), {
        status: 201,
      }),
    );
    await expect(first).resolves.toMatchObject({
      ok: true,
      id: "product-1",
      created: true,
    });
  });

  it("create success chuyển controller sang edit và Save sau dùng UPDATE", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const controller = new ProductEditorSaveController(undefined, (input, init) => {
      calls.push({ input, init });
      return response({ success: true, id: "product-1", slug: "smoke-test" }, calls.length === 1 ? 201 : 200);
    });

    await controller.save(payload);
    expect(controller.getProductId()).toBe("product-1");
    expect(getProductEditPath(controller.getProductId()!)).toBe(
      "/admin/products/product-1/edit",
    );
    await controller.save(payload);
    expect(calls.map((call) => [call.input, call.init.method])).toEqual([
      ["/api/admin/products", "POST"],
      ["/api/admin/products/product-1", "PUT"],
    ]);
  });

  it("Save lại giữ nguyên hai image keys và không gọi endpoint upload", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const controller = new ProductEditorSaveController(undefined, (input, init) => {
      calls.push({ input, init });
      return response({ success: true, id: "product-1" }, calls.length === 1 ? 201 : 200);
    });

    await controller.save(payload);
    await controller.save(payload);
    expect(calls.every((call) => !call.input.includes("/images"))).toBe(true);
    for (const call of calls) {
      const body = JSON.parse(String(call.init.body)) as ProductEditorSavePayload;
      expect(body.images.map((image) => image.r2Key)).toEqual(
        payload.images.map((image) => image.r2Key),
      );
      expect(new Set(body.images.map((image) => image.r2Key)).size).toBe(2);
    }
  });

  it.each([
    ["SLUG_CONFLICT", 'Slug "smoke-test" đã tồn tại.'],
    ["SKU_CONFLICT", 'SKU "SMOKE-A" đã được sử dụng.'],
  ])("hiển thị lỗi %s rõ ràng", async (code, message) => {
    const controller = new ProductEditorSaveController(undefined, () =>
      response({ success: false, error: { code, message } }, 409),
    );
    await expect(controller.save(payload)).resolves.toEqual({
      ok: false,
      code,
      message,
      details: undefined,
    });
  });
});

describe("Product API conflict response", () => {
  function conflictDatabase(options: {
    slugOwnerId?: string;
    skuOwner?: { productId: string; sku: string };
  }) {
    return {
      prepare(query: string) {
        return {
          bind() {
            return {
              async first<T>() {
                const value = query.includes("FROM products")
                  ? options.slugOwnerId
                    ? { id: options.slugOwnerId }
                    : null
                  : options.skuOwner ?? null;
                return value as T | null;
              },
            };
          },
        };
      },
    };
  }

  it("phân biệt slug conflict", () => {
    expect(
      productConflictError({
        field: "slug",
        value: "smoke-test",
        ownerId: "product-existing",
      }),
    ).toMatchObject({
      code: "SLUG_CONFLICT",
      message: 'Slug "smoke-test" đã tồn tại.',
    });
  });

  it("phân biệt SKU conflict", () => {
    expect(
      productConflictError({
        field: "sku",
        value: "SMOKE-A",
        ownerId: "product-existing",
      }),
    ).toMatchObject({
      code: "SKU_CONFLICT",
      message: 'SKU "SMOKE-A" đã được sử dụng.',
    });
  });

  it("tìm đúng Product đang giữ slug", async () => {
    await expect(
      findProductConflict(conflictDatabase({ slugOwnerId: "product-existing" }), {
        productId: "product-new",
        slug: "smoke-test",
        skus: ["SMOKE-A"],
      }),
    ).resolves.toEqual({
      field: "slug",
      value: "smoke-test",
      ownerId: "product-existing",
    });
  });

  it("tìm đúng Product đang giữ SKU", async () => {
    await expect(
      findProductConflict(
        conflictDatabase({
          skuOwner: { productId: "product-existing", sku: "SMOKE-A" },
        }),
        {
          productId: "product-new",
          slug: "smoke-test",
          skus: ["SMOKE-A"],
        },
      ),
    ).resolves.toEqual({
      field: "sku",
      value: "SMOKE-A",
      ownerId: "product-existing",
    });
  });
});
