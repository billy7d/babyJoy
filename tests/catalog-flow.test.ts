import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyFilters } from "../app/components/public-pages";
import {
  adminProductMatchesStatus,
  buildAdminProductsUrl,
  mapAdminProductRow,
} from "../app/components/admin-pages";
import { categories } from "../app/lib/catalog";
import { mapApiProduct } from "../app/lib/catalog-context";

const smokeApiRow = {
  id: "b25e2654-a980-4a14-b522-919faa6b574c",
  name: "BabyJoy Production Smoke Test 2026-08-27 AB",
  slug: "babyjoy-production-smoke-test-20260827",
  brand: "Khác",
  shortDescription: "Smoke test",
  description: "Production catalog",
  status: "AVAILABLE",
  featured: 0,
  categorySlug: "banh-an-dam",
  variants: [
    {
      id: "smoke-variant",
      name: "Gói test 100g",
      sku: "SMOKE-20260827",
      priceVnd: 123000,
      availability: "AVAILABLE",
      sortOrder: 0,
    },
  ],
  images: [
    {
      id: "smoke-image",
      r2Key: "products/smoke.jpg",
      altText: "Smoke",
      sortOrder: 0,
      url: "https://images.metraphuong.com/products/smoke.jpg",
    },
  ],
  tagNames: [],
};

describe("D1 catalog flow", () => {
  it("maps D1 product and keeps custom image URL", () => {
    const product = mapApiProduct(smokeApiRow);
    expect(product.id).toBe(smokeApiRow.id);
    expect(product.slug).toBe(smokeApiRow.slug);
    expect(product.variants[0].name).toBe("Gói test 100g");
    expect(product.image).toBe(
      "https://images.metraphuong.com/products/smoke.jpg",
    );
  });

  it("filtered listing includes every D1 product after hydration", () => {
    const fallback = mapApiProduct({
      ...smokeApiRow,
      id: "fallback",
      slug: "fallback",
      name: "Fallback",
    });
    const d1Products = [fallback, mapApiProduct(smokeApiRow)];
    const rendered = applyFilters(d1Products, categories, new URLSearchParams());
    expect(rendered).toHaveLength(2);
    expect(rendered.map((product) => product.slug)).toContain(
      smokeApiRow.slug,
    );
  });

  it("recomputes ProductGrid when CatalogProvider replaces fallback state", () => {
    const source = readFileSync("app/components/public-pages.tsx", "utf8");
    expect(source).toContain("[products, categories, params, categorySlug]");
  });
});

describe("catalog cleanup empty state", () => {
  it("success với products [] không khôi phục static catalog", () => {
    const source = readFileSync("app/lib/catalog-context.tsx", "utf8");

    expect(source).toContain("products: productsBody.data.map(mapApiProduct)");
    expect(source).not.toContain(
      "Array.isArray(productsBody.data) && productsBody.data.length",
    );
    expect(source).toContain("setCatalogProducts(catalog.products)");
  });

  it("success với taxonomy [] vẫn là authoritative", () => {
    const source = readFileSync("app/lib/catalog-context.tsx", "utf8");

    expect(source).toContain("categories: categoriesBody.data.map(mapApiCategory)");
    expect(source).toContain("tags: [...new Set(tagsBody.data.map");
    expect(
      applyFilters([], categories, new URLSearchParams("category=trai-cay-nghien")),
    ).toEqual([]);
    expect(
      applyFilters([], categories, new URLSearchParams("tag=H%E1%BB%AFu%20c%C6%A1")),
    ).toEqual([]);
  });

  it("giữ nguyên access redirect và error boundary của remote", () => {
    const source = readFileSync("app/lib/catalog-context.tsx", "utf8");

    expect(source).toContain(
      "(response) => response.status === 401 || response.status === 503",
    );
    expect(source).toContain('window.location.assign(path)');
    expect(source).toContain('throw new Error("CATALOG_LOAD_FAILED")');
    expect(source).toContain('throw new Error("CATALOG_INVALID_RESPONSE")');
  });

  it("không thay đổi behavior non-empty của storefront và admin", () => {
    const publicSource = readFileSync("app/components/public-pages.tsx", "utf8");
    const adminSource = readFileSync("app/components/admin-pages.tsx", "utf8");

    expect(publicSource).toContain("featured.map((product) =>");
    expect(publicSource).toContain("if (!product)");
    expect(adminSource).toContain("filteredProducts.map((product) =>");
    expect(adminSource).toContain("products.length");
  });
});

describe("admin product listing", () => {
  it("dùng URL admin có pagination và không cắt còn bốn dòng", () => {
    expect(buildAdminProductsUrl(2, "  Gerber ")).toBe(
      "/api/admin/products?limit=24&page=2&q=Gerber",
    );
    const source = readFileSync("app/components/admin-pages.tsx", "utf8");
    expect(source).toContain("/api/admin/products");
    expect(source).not.toContain("products.slice(0, 4)");
    expect(source).not.toContain("Tất cả (24)");
  });

  it("giữ sản phẩm hidden từ admin API và lọc trạng thái ở UI", () => {
    const hidden = mapAdminProductRow({ ...smokeApiRow, status: "HIDDEN" });
    expect(hidden.adminStatus).toBe("HIDDEN");
    expect(adminProductMatchesStatus(hidden, "HIDDEN")).toBe(true);
    expect(adminProductMatchesStatus(hidden, "AVAILABLE")).toBe(false);
  });
});
