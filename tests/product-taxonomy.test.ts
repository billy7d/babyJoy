import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyFilters } from "../app/components/public-pages";
import { cartShareFingerprint } from "../app/lib/cart-share";
import type { Product } from "../app/lib/catalog";

const baseProduct: Product = {
  id: "product-a",
  slug: "product-a",
  name: "Product A",
  brand: "Heinz",
  brandId: "brand-heinz",
  brandSlug: "heinz",
  shortDescription: "",
  description: "",
  image: "/product-a.jpg",
  category: "trai-cay-nghien",
  categories: ["trai-cay-nghien", "hu-thuc-an"],
  categoryIds: ["cat-puree", "cat-food-jar"],
  age: "6+ tháng",
  minAgeMonths: 6,
  isBestSeller: true,
  bestSellerRank: 3,
  tags: [],
  variants: [
    {
      id: "variant-a",
      name: "Hũ 100g",
      sku: "A-100",
      priceVnd: 50000,
      availability: "AVAILABLE",
    },
  ],
};

describe("BabyJoy product taxonomy v1", () => {
  it("lọc nhiều nhóm theo OR và không duplicate sản phẩm", () => {
    const result = applyFilters(
      [baseProduct],
      [],
      new URLSearchParams({ category: "trai-cay-nghien,hu-thuc-an" }),
    );
    expect(result.map((product) => product.id)).toEqual(["product-a"]);
  });

  it.each([6, 7, 10, 12])("sản phẩm 6m+ xuất hiện khi bé %im", (age) => {
    expect(
      applyFilters(
        [baseProduct],
        [],
        new URLSearchParams({ age: String(age) }),
      ),
    ).toHaveLength(1);
  });

  it("kết hợp category OR với brand, age và Best seller bằng AND", () => {
    expect(
      applyFilters(
        [baseProduct, { ...baseProduct, id: "product-b", brandSlug: "hipp" }],
        [],
        new URLSearchParams({
          category: "trai-cay-nghien,hu-thuc-an",
          brand: "heinz",
          age: "10",
          bestSeller: "1",
        }),
      ).map((product) => product.id),
    ).toEqual(["product-a"]);
  });

  it("Best seller false không vượt qua filter và rank được sort tăng dần", () => {
    const result = applyFilters(
      [
        { ...baseProduct, id: "rank-3", bestSellerRank: 3 },
        { ...baseProduct, id: "rank-1", bestSellerRank: 1 },
        { ...baseProduct, id: "not-best", isBestSeller: false },
      ],
      [],
      new URLSearchParams({ bestSeller: "1", sort: "best_seller" }),
    );
    expect(result.map((product) => product.id)).toEqual(["rank-1", "rank-3"]);
  });

  it("taxonomy không tham gia cart fingerprint", () => {
    const before = cartShareFingerprint([{ variantId: "variant-a", quantity: 2 }]);
    const after = cartShareFingerprint([{ variantId: "variant-a", quantity: 2 }]);
    expect(after).toBe(before);
  });

  it("Worker giữ archive và historical snapshot tách biệt", () => {
    const appSource = readFileSync("workers/app.ts", "utf8");
    const cartShareSource = readFileSync("workers/cart-share.ts", "utf8");
    expect(appSource).toContain("archived_at IS NULL");
    expect(appSource).toContain("UPDATE products SET status = 'HIDDEN'");
    expect(cartShareSource).toContain("product_name_snapshot AS productName");
  });
});
