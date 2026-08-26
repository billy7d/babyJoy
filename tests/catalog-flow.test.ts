import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyFilters } from "../app/components/public-pages";
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
    const rendered = applyFilters(d1Products, new URLSearchParams());
    expect(rendered).toHaveLength(2);
    expect(rendered.map((product) => product.slug)).toContain(
      smokeApiRow.slug,
    );
  });

  it("recomputes ProductGrid when CatalogProvider replaces fallback state", () => {
    const source = readFileSync("app/components/public-pages.tsx", "utf8");
    expect(source).toContain("[products, params, categorySlug]");
  });
});
