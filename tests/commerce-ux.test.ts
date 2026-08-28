import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { categories, products } from "../app/lib/catalog";
import { changeCartItemQuantity } from "../app/lib/cart";
import { copyCartText } from "../app/lib/cart-share";
import { normalizeSearchText, searchCatalog } from "../app/lib/search";

describe("inline cart quantity", () => {
  it("adds, increments rapidly, decrements, and removes through one cart authority", () => {
    let items: Array<{ variantId: string; quantity: number }> = [];
    items = changeCartItemQuantity(items, "variant-gerber-227", 1);
    for (let index = 0; index < 5; index += 1)
      items = changeCartItemQuantity(items, "variant-gerber-227", 1);
    expect(items).toEqual([{ variantId: "variant-gerber-227", quantity: 6 }]);
    for (let index = 0; index < 6; index += 1)
      items = changeCartItemQuantity(items, "variant-gerber-227", -1);
    expect(items).toEqual([]);
  });

  it("caps quantity at the existing maximum", () => {
    expect(
      changeCartItemQuantity(
        [{ variantId: "variant-gerber-227", quantity: 99 }],
        "variant-gerber-227",
        1,
      ),
    ).toEqual([{ variantId: "variant-gerber-227", quantity: 99 }]);
  });
});

describe("catalog search", () => {
  it.each(["bot", "bột", "an", "ăn"])("normalizes Vietnamese query %s", (query) => {
    const result = searchCatalog(products, categories, query);
    expect(result.products.some((product) => product.id === "prod-gerber")).toBe(true);
  });

  it("supports prefix/substring, category fields, and light typo tolerance", () => {
    expect(normalizeSearchText("  BỘT Ăn Dặm  ")).toBe("bot an dam");
    expect(searchCatalog(products, categories, "gerbr").products[0]?.id).toBe("prod-gerber");
    expect(searchCatalog(products, categories, "banh").categories[0]?.slug).toBe("banh-an-dam");
    expect(
      searchCatalog(products, categories, "trai cay").products.some(
        (product) => product.category === "trai-cay-nghien",
      ),
    ).toBe(true);
  });

  it("does not use fuzzy matching for a short unrelated query", () => {
    expect(searchCatalog(products, categories, "zz").products).toEqual([]);
  });

  it("keeps existing tag search behavior", () => {
    expect(
      searchCatalog(products, [], "không thêm đường").products.map(
        (product) => product.id,
      ),
    ).toContain("prod-little-sprouts");
  });
});

describe("post-checkout clipboard guide", () => {
  it("reports clipboard success and uses fallback after denial", async () => {
    const writeText = vi.fn(async () => undefined);
    await expect(copyCartText("cart", { clipboard: { writeText } })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("cart");
    await expect(
      copyCartText("cart", {
        clipboard: { writeText: async () => { throw new DOMException("denied", "NotAllowedError"); } },
        fallback: () => true,
      }),
    ).resolves.toBe(true);
    await expect(copyCartText("cart", { clipboard: null, fallback: () => false })).resolves.toBe(false);
  });

  it("routes prepared carts to the guide without auto-opening Messenger", () => {
    const pages = readFileSync("app/components/public-pages.tsx", "utf8");
    const routes = readFileSync("app/routes/site.tsx", "utf8");
    const prepareStart = pages.indexOf("function DirectSellerShareControls");
    const prepareEnd = pages.indexOf("type MessengerStartResult");
    const prepareSource = pages.slice(prepareStart, prepareEnd);
    expect(prepareSource).toContain("await showGuide(value)");
    expect(prepareSource).toContain("/cart/guide/");
    expect(prepareSource).not.toContain("window.location.assign");
    expect(routes).toContain('pathname.startsWith("/cart/guide/")');
    expect(pages).toContain("Mở → Dán → Gửi");
    expect(pages).toContain("Sao chép lại giỏ hàng");
    expect(pages).toContain("prepared.seller.messengerUrl");
    expect(pages).not.toContain("Đặt hàng thành công");
    expect(pages).not.toContain("Thanh toán thành công");
  });

  it("keeps the mobile search modal and shared card control wired together", () => {
    const ui = readFileSync("app/components/ui.tsx", "utf8");
    const css = readFileSync("app/app.css", "utf8");
    expect(ui).toContain("MobileSearchModal");
    expect(ui).toContain("<InlineCartControl product={product} />");
    expect(ui).toContain('aria-modal="true"');
    expect(ui).toContain('document.body.style.overflow = "hidden"');
    expect(css).toContain(".mobile-search-modal");
    expect(css).toMatch(/\.inline-cart-quantity button\{[^}]*width:44px[^}]*height:44px/);
  });
});
