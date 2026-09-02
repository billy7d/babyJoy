import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapApiProduct } from "../app/lib/catalog-context";
import {
  MAX_STORED_IMAGE_BYTES,
  PRODUCT_IMAGE_PLACEHOLDER,
  getProductImageUrl,
  getProductImageUrlStrategy,
  getPublicImageUrl,
} from "../shared/images";
import {
  ImageUploadError,
  normalizeProductImages,
  uploadImmutableProductImage,
  validateAssociatedImages,
} from "../workers/image-service";
import { mapCartItemSnapshot } from "../workers/services";

async function consumeUploadBody(value: unknown) {
  if (value instanceof ReadableStream) {
    const reader = value.getReader();
    let byteLength = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) return byteLength;
      byteLength += chunk.byteLength;
    }
  }
  if (value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === "string") return new TextEncoder().encode(value).byteLength;
  return 0;
}

function fakeBucket(heads = new Map<string, R2Object>()) {
  const puts: Array<{
    key: string;
    value: unknown;
    options: R2PutOptions;
    byteLength: number;
  }> = [];
  return {
    puts,
    bucket: {
      async put(key: string, value: unknown, options: R2PutOptions) {
        const byteLength = await consumeUploadBody(value);
        puts.push({ key, value, options, byteLength });
        return { key } as R2Object;
      },
      async head(key: string) {
        return heads.get(key) ?? null;
      },
    } as R2Bucket,
  };
}

describe("resolver ảnh R2", () => {
  const key = "products/2026-08-26/a b.webp";

  it("resolve production bằng custom domain và encode từng segment", () => {
    expect(getProductImageUrl(key, "production")).toBe(
      "https://images.metraphuong.com/products/2026-08-26/a%20b.webp",
    );
  });

  it("resolve local qua /media mà không đổi khóa R2", () => {
    expect(getProductImageUrl(key, "local")).toBe(
      "/media/products/2026-08-26/a%20b.webp",
    );
  });

  it("chọn strategy local cho development/test và production cho production", () => {
    expect(getProductImageUrlStrategy("development")).toBe("local");
    expect(getProductImageUrlStrategy("test")).toBe("local");
    expect(getProductImageUrlStrategy("production")).toBe("production");
  });

  it("dùng placeholder cho khóa null hoặc đường dẫn không an toàn ở cả hai strategy", () => {
    expect(getProductImageUrl(null, "local")).toBe(PRODUCT_IMAGE_PLACEHOLDER);
    expect(getProductImageUrl("../secret.webp", "production")).toBe(
      PRODUCT_IMAGE_PLACEHOLDER,
    );
    expect(getPublicImageUrl(null)).toBe(PRODUCT_IMAGE_PLACEHOLDER);
  });
});

describe("upload ảnh immutable", () => {
  for (const [mime, extension] of [
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ] as const) {
    it(`chấp nhận ${mime}`, async () => {
      const { bucket, puts } = fakeBucket();
      const result = await uploadImmutableProductImage(
        new Request("https://example.test/api/admin/images", {
          method: "POST",
          headers: { "content-type": mime },
          body: new Uint8Array([1, 2, 3]),
        }),
        bucket,
        {
          now: new Date("2026-08-26T01:02:03Z"),
          createUuid: () => "123e4567-e89b-42d3-a456-426614174000",
        },
      );
      expect(result.key).toBe(
        `products/2026-08-26/123e4567-e89b-42d3-a456-426614174000.${extension}`,
      );
      expect(puts[0].options.httpMetadata).toMatchObject({
        contentType: mime,
        cacheControl: "public, max-age=31536000, immutable",
      });
      expect(puts[0].options.storageClass).toBe("Standard");
      expect(new Headers(puts[0].options.onlyIf).get("if-none-match")).toBe("*");
    });
  }

  it("từ chối MIME không hỗ trợ", async () => {
    const { bucket } = fakeBucket();
    await expect(
      uploadImmutableProductImage(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-type": "image/gif" },
          body: new Uint8Array([1]),
        }),
        bucket,
      ),
    ).rejects.toMatchObject<ImageUploadError>({ code: "UNSUPPORTED_TYPE" });
  });

  it("đưa bounded ReadableStream vào R2.put và đếm đủ body", async () => {
    const { bucket, puts } = fakeBucket();
    const result = await uploadImmutableProductImage(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "image/webp" },
        body: new Uint8Array([1, 2, 3, 4]),
      }),
      bucket,
    );
    expect(result.key).toContain("products/");
    expect(puts[0].value).toBeInstanceOf(ReadableStream);
    expect(puts[0].byteLength).toBe(4);
  });

  it("từ chối Content-Length lớn hơn 1.5 MiB trước khi đọc body", async () => {
    const { bucket } = fakeBucket();
    await expect(
      uploadImmutableProductImage(
        new Request("https://example.test", {
          method: "POST",
          headers: {
            "content-type": "image/webp",
            "content-length": String(MAX_STORED_IMAGE_BYTES + 1),
          },
          body: new Uint8Array([1]),
        }),
        bucket,
      ),
    ).rejects.toMatchObject<ImageUploadError>({ code: "TOO_LARGE" });
  });

  it("từ chối stream thực tế vượt 1.5 MiB dù thiếu Content-Length", async () => {
    const { bucket } = fakeBucket();
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "image/webp" },
      body: new Blob([new Uint8Array(MAX_STORED_IMAGE_BYTES + 1)]),
    });
    request.headers.delete("content-length");
    await expect(uploadImmutableProductImage(request, bucket)).rejects.toMatchObject<
      ImageUploadError
    >({ code: "TOO_LARGE" });
  });

  it("từ chối body rỗng mà không tạo R2 object", async () => {
    const { bucket, puts } = fakeBucket();
    await expect(
      uploadImmutableProductImage(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-type": "image/webp" },
          body: new Uint8Array(),
        }),
        bucket,
      ),
    ).rejects.toMatchObject<ImageUploadError>({ code: "EMPTY" });
    expect(puts).toHaveLength(0);
  });

  it("hai upload tạo hai key và luôn dùng create-only PUT", async () => {
    const { bucket, puts } = fakeBucket();
    let index = 0;
    const uuids = [
      "123e4567-e89b-42d3-a456-426614174000",
      "123e4567-e89b-42d3-a456-426614174001",
    ];
    for (let upload = 0; upload < 2; upload += 1) {
      await uploadImmutableProductImage(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-type": "image/webp" },
          body: new Uint8Array([upload + 1]),
        }),
        bucket,
        { createUuid: () => uuids[index++] },
      );
    }
    expect(new Set(puts.map((put) => put.key)).size).toBe(2);
    expect(
      puts.every(
        (put) => new Headers(put.options.onlyIf).get("if-none-match") === "*",
      ),
    ).toBe(true);
  });

  it("association chỉ chấp nhận object không quá 1.5 MiB", async () => {
    const key =
      "products/2026-08-26/123e4567-e89b-42d3-a456-426614174000.webp";
    const { bucket } = fakeBucket(
      new Map([
        [
          key,
          {
            size: MAX_STORED_IMAGE_BYTES + 1,
            httpMetadata: { contentType: "image/webp" },
          } as R2Object,
        ],
      ]),
    );
    await expect(
      validateAssociatedImages(
        [{ r2Key: key, altText: "", sortOrder: 0 }],
        bucket,
      ),
    ).rejects.toThrow("INVALID_IMAGE_REFERENCE");
  });
});

describe("association ảnh sản phẩm", () => {
  const keys = [
    "products/2026-08-26/123e4567-e89b-42d3-a456-426614174000.webp",
    "products/2026-08-26/123e4567-e89b-42d3-a456-426614174001.png",
  ];

  it("chuẩn hóa gallery theo thứ tự mảng và ảnh đầu là primary", () => {
    const images = normalizeProductImages([
      { r2Key: keys[1], altText: "Phụ", sortOrder: 99 },
      { r2Key: keys[0], altText: "Chính", sortOrder: 50 },
    ]);
    expect(images.map((image) => image.sortOrder)).toEqual([0, 1]);
    expect(images[0].r2Key).toBe(keys[1]);
  });

  it("catalog D1 dùng URL R2 của primary image", () => {
    const product = mapApiProduct({
      id: "p-r2",
      slug: "san-pham-r2",
      name: "Sản phẩm R2",
      variants: [
        {
          id: "v-r2",
          name: "Mặc định",
          sku: "R2-1",
          priceVnd: 10,
          availability: "AVAILABLE",
        },
      ],
      images: [
        { r2Key: keys[0], altText: "Ảnh chính", sortOrder: 0, url: getPublicImageUrl(keys[0]) },
      ],
    });
    expect(product.imageKey).toBe(keys[0]);
    expect(product.image).toBe(getPublicImageUrl(keys[0]));
  });
});

describe("snapshot ảnh giỏ hàng", () => {
  it("history resolve từ image_key_snapshot cũ", () => {
    const imageKey =
      "products/2026-08-25/123e4567-e89b-42d3-a456-426614174000.webp";
    const snapshot = mapCartItemSnapshot({
      id: "item-1",
      productId: "product-1",
      variantId: "variant-1",
      productName: "Tên lúc gửi",
      variantName: "Hũ 120g",
      sku: "SKU-1",
      imageKey,
      priceVnd: 89000,
      quantity: 2,
      lineTotalVnd: 178000,
      createdAt: "2026-08-25T00:00:00Z",
    });
    expect(snapshot.imageUrl).toBe(getPublicImageUrl(imageKey));
  });

  it("admin history và public catalog không dùng static product làm nguồn chính", () => {
    const adminSource = readFileSync("app/components/admin-pages.tsx", "utf8");
    const publicSource = readFileSync("app/components/public-pages.tsx", "utf8");
    expect(adminSource).toContain("item.imageKey");
    expect(adminSource).toContain("item.imageUrl");
    expect(publicSource).not.toMatch(/import\s*\{[^}]*\bproducts\b[^}]*\}\s*from\s*["']\.\.\/lib\/catalog["']/s);
    expect(publicSource).not.toContain('src="/media/');
  });
});
