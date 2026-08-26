import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapApiProduct } from "../app/lib/catalog-context";
import {
  MAX_IMAGE_BYTES,
  PRODUCT_IMAGE_PLACEHOLDER,
  getPublicImageUrl,
} from "../shared/images";
import {
  ImageUploadError,
  normalizeProductImages,
  uploadImmutableProductImage,
} from "../workers/image-service";
import { mapCartItemSnapshot } from "../workers/services";

function fakeBucket() {
  const puts: Array<{
    key: string;
    value: ArrayBuffer;
    options: R2PutOptions;
  }> = [];
  return {
    puts,
    bucket: {
      async put(key: string, value: ArrayBuffer, options: R2PutOptions) {
        puts.push({ key, value, options });
        return { key } as R2Object;
      },
    } as R2Bucket,
  };
}

describe("resolver ảnh R2", () => {
  it("resolve khóa hợp lệ và encode từng segment", () => {
    expect(getPublicImageUrl("products/2026-08-26/a b.webp")).toBe(
      "https://images.metraphuong.com/products/2026-08-26/a%20b.webp",
    );
  });

  it("dùng placeholder cho khóa null hoặc đường dẫn không an toàn", () => {
    expect(getPublicImageUrl(null)).toBe(PRODUCT_IMAGE_PLACEHOLDER);
    expect(getPublicImageUrl("../secret.webp")).toBe(PRODUCT_IMAGE_PLACEHOLDER);
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
      expect(result.url).toBe(`https://images.metraphuong.com/${result.key}`);
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

  it("từ chối ảnh lớn hơn 5 MB trước khi đọc body", async () => {
    const { bucket } = fakeBucket();
    await expect(
      uploadImmutableProductImage(
        new Request("https://example.test", {
          method: "POST",
          headers: {
            "content-type": "image/webp",
            "content-length": String(MAX_IMAGE_BYTES + 1),
          },
          body: new Uint8Array([1]),
        }),
        bucket,
      ),
    ).rejects.toMatchObject<ImageUploadError>({ code: "TOO_LARGE" });
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
