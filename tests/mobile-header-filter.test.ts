import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ui = readFileSync("app/components/ui.tsx", "utf8");
const publicPages = readFileSync("app/components/public-pages.tsx", "utf8");
const css = readFileSync("app/app.css", "utf8");

describe("Mobile header filter và bottom navigation", () => {
  it("thay Search bằng route Categories thật và vẫn giữ desktop search", () => {
    expect(ui).toContain('["/categories", "category", "Danh mục"]');
    expect(ui).toContain("<MobileBottomNav />");
    expect(ui).toContain('className="header-search"');
    expect(ui).not.toContain("onSearch");
    expect(ui).not.toContain('aria-label="Mở tìm kiếm"');
  });

  it("đưa action lọc vào header listing thay vì filter block cũ", () => {
    const listingStart = publicPages.indexOf("export function ProductListPage");
    const categoriesStart = publicPages.indexOf("export function CategoriesPage");
    const listingSource = publicPages.slice(listingStart, categoriesStart);

    expect(listingSource).toContain('className="mobile-filter-trigger"');
    expect(listingSource).toContain("<MobileFilterSheet");
    expect(listingSource).toContain("applyMobileFilters");
    expect(listingSource).not.toContain('className="mobile-filter-btn"');
    expect(listingSource).toContain("characteristicFilterOptions.length > 0");
    expect(listingSource).toContain("setMobileFilters(false)");
  });

  it("giữ transaction draft, URL canonical và accessibility của sheet", () => {
    expect(publicPages).toContain('role="dialog"');
    expect(publicPages).toContain('aria-modal="true"');
    expect(publicPages).toContain('aria-label="Đóng bộ lọc"');
    expect(publicPages).toContain('event.key === "Escape"');
    expect(publicPages).toContain("tagIds: [...draftTagIds]");
    expect(publicPages).toContain('next.set("page", "1")');
    expect(publicPages).toContain('next.delete("tagIds")');
  });

  it("đủ token visual, safe-area và animation cho bottom sheet", () => {
    expect(css).toContain(".mobile-filter-backdrop");
    expect(css).toContain("border-radius:24px 24px 0 0");
    expect(css).toContain("max-height:85dvh");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("mobile-filter-panel-in");
    expect(css).toContain("mobile-filter-panel-out");
    expect(css).toContain(".listing-title{position:absolute");
  });
});
