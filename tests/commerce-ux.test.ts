import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { applyFilters } from "../app/components/public-pages";
import { isInlineCartIncrementDisabled } from "../app/components/ui";
import { categories, products } from "../app/lib/catalog";
import { changeCartItemQuantity, parseStoredCart } from "../app/lib/cart";
import {
  cartShareFingerprint,
  copyCartText,
  isPreparedCartShareCurrent,
  runWithCurrentPreparedCartShare,
  type PreparedCartShare,
} from "../app/lib/cart-share";
import { normalizeSearchText, searchCatalog } from "../app/lib/search";

function preparedCart(items: Array<{ variantId: string; quantity: number }>) {
  return {
    fingerprint: cartShareFingerprint(items),
    cartRequest: {
      code: "GH-TEST",
      itemLineCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotalVnd: 0,
      createdAt: "2026-08-28T00:00:00.000Z",
    },
    share: {
      title: "Giỏ hàng BabyJoy",
      text: "Giỏ hàng",
      url: "https://example.com/c/test",
      copyText: "Giỏ hàng",
      expiresAt: "2026-09-27T00:00:00.000Z",
    },
    seller: {
      displayName: "BabyJoy",
      label: "Shop",
      messengerUrl: "https://m.me/babyjoy",
      avatarKey: null,
      avatarUrl: null,
    },
  } satisfies PreparedCartShare;
}

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

  it.each([
    ["AVAILABLE", 98, false],
    ["AVAILABLE", 99, true],
    ["OUT_OF_STOCK", 3, true],
    ["HIDDEN", 1, true],
  ] as const)(
    "guards increment for %s at quantity %i",
    (availability, quantity, expected) => {
      expect(isInlineCartIncrementDisabled(availability, quantity)).toBe(expected);
    },
  );

  it("keeps decrement enabled for unavailable items", () => {
    const ui = readFileSync("app/components/ui.tsx", "utf8");
    const decrementStart = ui.indexOf('aria-label={`Giảm số lượng');
    const incrementStart = ui.indexOf('aria-label={`Tăng số lượng');
    expect(ui.slice(decrementStart, incrementStart)).not.toContain("disabled=");
  });
});

describe("cart storage và hydrate", () => {
  it("cart mới không có storage bắt đầu rỗng", () => {
    expect(parseStoredCart(null)).toEqual([]);
  });

  it("storage hỏng hoặc có dòng không hợp lệ trở thành cart rỗng", () => {
    expect(parseStoredCart("không phải JSON")).toEqual([]);
    expect(
      parseStoredCart(JSON.stringify({ items: [{ variantId: "A", quantity: 0 }] })),
    ).toEqual([]);
  });

  it("khôi phục đúng persisted cart hợp lệ", () => {
    const items = [
      { variantId: "B", quantity: 2 },
      { variantId: "A", quantity: 1 },
    ];
    expect(parseStoredCart(JSON.stringify({ items }))).toEqual(items);
  });

  it("guide chờ hydrate nên cart persisted khớp fingerprint không bị stale giả", () => {
    const source = readFileSync("app/components/public-pages.tsx", "utf8");
    const cartSource = readFileSync("app/lib/cart.tsx", "utf8");
    const persisted = parseStoredCart(
      JSON.stringify({ items: [{ variantId: "A", quantity: 2 }] }),
    );
    expect(cartShareFingerprint(persisted)).toBe("A:2");
    expect(cartSource).toContain("const [items, setItems] = useState<CartLine[]>([])");
    expect(cartSource).not.toContain("useState<CartLine[]>(demoCart)");
    expect(cartSource).toContain("setHydrated(true)");
    expect(source).toContain("!cart.hydrated");
  });

  it("header chỉ hiển thị badge khi cart có món", () => {
    const ui = readFileSync("app/components/ui.tsx", "utf8");
    expect(ui).toContain("totalQuantity > 0 &&");
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

  it.each(["banh an dam", "bánh ăn dặm", "banh"])(
    "desktop filters match products through category metadata for %s",
    (query) => {
      const result = applyFilters(
        products,
        categories,
        new URLSearchParams({ q: query }),
      );
      expect(result.some((product) => product.category === "banh-an-dam")).toBe(true);
    },
  );

  it("applies the remaining desktop filters after category-name search", () => {
    const result = applyFilters(
      products,
      categories,
      new URLSearchParams({ q: "banh", age: "8+" }),
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((product) => product.age.startsWith("8+"))).toBe(true);
  });
});

describe("prepared cart freshness", () => {
  it("marks a quantity mutation stale", () => {
    const prepared = preparedCart([{ variantId: "A", quantity: 1 }]);
    expect(
      isPreparedCartShareCurrent(prepared, [{ variantId: "A", quantity: 2 }]),
    ).toBe(false);
  });

  it("marks item removal stale", () => {
    const prepared = preparedCart([
      { variantId: "A", quantity: 1 },
      { variantId: "B", quantity: 1 },
    ]);
    expect(
      isPreparedCartShareCurrent(prepared, [{ variantId: "A", quantity: 1 }]),
    ).toBe(false);
  });

  it("treats reordered equivalent contents as current", () => {
    const prepared = preparedCart([
      { variantId: "A", quantity: 1 },
      { variantId: "B", quantity: 2 },
    ]);
    expect(
      isPreparedCartShareCurrent(prepared, [
        { variantId: "B", quantity: 2 },
        { variantId: "A", quantity: 1 },
      ]),
    ).toBe(true);
  });

  it("blocks Messenger again when cart changes at click time", () => {
    const prepared = preparedCart([{ variantId: "A", quantity: 1 }]);
    const assign = vi.fn();
    const record = vi.fn();
    const analytics = vi.fn();
    expect(
      runWithCurrentPreparedCartShare(
        prepared,
        [{ variantId: "A", quantity: 2 }],
        () => {
          record();
          analytics();
          assign(prepared.seller.messengerUrl);
        },
      ),
    ).toBe(false);
    expect(record).not.toHaveBeenCalled();
    expect(analytics).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
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
