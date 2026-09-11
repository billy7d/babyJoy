import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicPages = readFileSync("app/components/public-pages.tsx", "utf8");
const appCss = readFileSync("app/app.css", "utf8");
const listingSource = publicPages.slice(
  publicPages.indexOf("export function ProductListPage"),
  publicPages.indexOf("export function CategoriesPage"),
);

describe("Desktop /shop filter UI", () => {
  it("namespace presentation chỉ cho /shop desktop", () => {
    expect(listingSource).toContain(
      "const isShopListingPage = !searchMode && !categorySlug;",
    );
    expect(listingSource).toContain(
      'className="filters-inner shop-desktop-filter"',
    );
    expect(appCss).toContain("@media(min-width:640px)");
    expect(appCss).toContain(
      ".shop-listing-page .shop-desktop-filter",
    );
    expect(appCss).toContain(
      ".shop-listing-page .shop-filter-card",
    );

    const nonShopFilterSource = listingSource.slice(
      listingSource.indexOf("  ) : ("),
      listingSource.indexOf("  const applyMobileFilters"),
    );
    expect(nonShopFilterSource).toContain('<h3>Độ tuổi</h3>');
    expect(nonShopFilterSource).toContain('<h3>Đặc điểm</h3>');
    expect(nonShopFilterSource).not.toContain("shop-filter-card");
  });

  it("bind data thật và giữ canonical handlers/accessibility", () => {
    expect(listingSource).toContain(
      "renderDesktopFilterOptions(ageFilterOptions, \"age\")",
    );
    expect(listingSource).toContain(
      "renderDesktopFilterOptions(characteristicFilterOptions, \"tag\")",
    );
    expect(listingSource).toContain("ageFilterOptions.length > 0");
    expect(listingSource).toContain("characteristicFilterOptions.length > 0");
    expect(listingSource).toContain("toggleTagFilter(option.id)");
    expect(listingSource).toContain("setFilter(key, currentValue === option.id ? \"\" : option.id)");
    expect(listingSource).toContain("onClick={clearProductFilters}");
    expect(listingSource).toContain("aria-pressed={selected}");
    expect(listingSource).not.toContain('["5 tháng", "6 tháng", "7 tháng"]');
    expect(listingSource).not.toContain('"Organic"');
  });

  it("không đưa namespace desktop vào mobile filter sheet", () => {
    const mobileSheetSource = publicPages.slice(
      publicPages.indexOf("function MobileFilterSheet"),
      publicPages.indexOf("export function CategoriesPage"),
    );
    expect(mobileSheetSource).not.toContain("shop-desktop-filter");
    expect(mobileSheetSource).toContain("mobile-filter-sheet");
    expect(mobileSheetSource).toContain("mobile-filter-chip");
    expect(mobileSheetSource).toContain("mobile-filter-actions");
  });
});
