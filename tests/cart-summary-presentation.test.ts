import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("cart summary presentation", () => {
  const root = readFileSync("app/root.tsx", "utf8");
  const summaryCss = readFileSync("app/cart-summary.css", "utf8");
  const cartSource = readFileSync("app/components/public-pages.tsx", "utf8");

  it("loads cart-summary styles after the mobile cart overrides", () => {
    expect(root.indexOf('import "./cart-summary.css"')).toBeGreaterThan(
      root.indexOf('import "./mobile-cart.css"'),
    );
  });

  it("keeps authoritative subtotal, discount and final-total sources", () => {
    expect(cartSource).toContain(
      "const subtotalVnd = promotion?.subtotalVnd ?? cart.subtotalVnd",
    );
    expect(cartSource).toContain(
      "const finalTotalVnd = promotion?.finalTotalVnd ?? subtotalVnd",
    );
    expect(cartSource).toContain("promotion.discountTotalVnd");
    expect(cartSource).toContain("appliedPromotions.map");
    expect(cartSource).toContain("promotion.freeShipping");
    expect(cartSource).toContain("FREE_SHIPPING_LABEL");
  });

  it("enforces Total > Subtotal > Promotion amount hierarchy", () => {
    expect(summaryCss).toContain(".subtotal .price");
    expect(summaryCss).toContain("font-size: 24px");
    expect(summaryCss).toContain(".promotion-total-row > b");
    expect(summaryCss).toContain("font-size: 16px");
    expect(summaryCss).toContain(".cart-final-total .price");
    expect(summaryCss).toContain("font-size: 30px");
  });

  it("moves applied promotion names into the promotion row without duplicate amounts", () => {
    expect(summaryCss).toContain(
      ".cart-summary:has(> .promotion-total-row)",
    );
    expect(summaryCss).toContain("grid-auto-flow: row dense");
    expect(summaryCss).toContain(
      "> .promotion-breakdown > b {\n  display: none;",
    );
    expect(summaryCss).toContain(
      "> .promotion-breakdown > p > strong {\n  display: none;",
    );
    expect(summaryCss).toContain("grid-column: 2");
    expect(summaryCss).toContain("promotion-free-shipping-value");
    expect(summaryCss).toContain("white-space: normal");
  });

  it("keeps the responsive hierarchy on mobile", () => {
    const mobileStart = summaryCss.indexOf("@media (max-width: 639px)");
    const mobileCss = summaryCss.slice(mobileStart);
    expect(mobileCss).toContain("font-size: 20px");
    expect(mobileCss).toContain("font-size: 14px");
    expect(mobileCss).toContain("font-size: 24px");
  });
});
