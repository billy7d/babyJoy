import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("cart summary presentation", () => {
  const root = readFileSync("app/root.tsx", "utf8");
  const promotionCss = readFileSync("app/cart-promotions.css", "utf8");
  const cartSource = readFileSync("app/components/public-pages.tsx", "utf8");

  it("loads summary styles after the mobile cart overrides", () => {
    expect(root.indexOf('import "./cart-summary.css"')).toBeGreaterThan(
      root.indexOf('import "./mobile-cart.css"'),
    );
    expect(root.indexOf('import "./cart-promotions.css"')).toBeGreaterThan(
      root.indexOf('import "./cart-summary.css"'),
    );
  });

  it("keeps authoritative subtotal, discount and final-total sources", () => {
    expect(cartSource).toContain(
      "const subtotalVnd = promotion?.subtotalVnd ?? cart.subtotalVnd",
    );
    expect(cartSource).toContain(
      "const finalTotalVnd = promotion?.finalTotalVnd ?? subtotalVnd",
    );
    expect(cartSource).toContain("appliedPromotions.map");
    expect(cartSource).toContain("hasAppliedPromotion");
    expect(cartSource).toContain("item.freeShipping === true");
  });

  it("enforces Total > Subtotal > Promotion amount hierarchy", () => {
    expect(promotionCss).toContain(".subtotal .price");
    expect(promotionCss).toContain("font-size: 22px");
    expect(promotionCss).toContain(".promotion-breakdown-value strong");
    expect(promotionCss).toContain(".cart-final-total .price");
    expect(promotionCss).toContain("font-size: 30px");
    expect(promotionCss).toContain("font-weight: 800");
  });

  it("keeps applied promotions between subtotal and total without aggregate row", () => {
    expect(cartSource).not.toContain('className="promotion-total-row"');
    expect(cartSource).toContain('className="promotion-breakdown"');
    expect(cartSource).toContain('className="promotion-breakdown-row"');
    expect(cartSource).toContain('className="promotion-breakdown-value"');
    expect(cartSource.indexOf('className="promotion-breakdown"')).toBeLessThan(
      cartSource.indexOf('className="cart-final-total"'),
    );
    expect(cartSource.indexOf('className="cart-final-total"')).toBeLessThan(
      cartSource.indexOf("<PromotionProgressGroup"),
    );
    expect(promotionCss).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 46%)");
    expect(promotionCss).toContain("overflow-wrap: anywhere");
  });

  it("keeps the responsive hierarchy on mobile", () => {
    const mobileStart = promotionCss.indexOf("@media (max-width: 430px)");
    const mobileCss = promotionCss.slice(mobileStart);
    expect(mobileCss).toContain("font-size: 18px");
    expect(mobileCss).toContain("font-size: 26px");
    expect(mobileCss).toContain("font-weight: 800");
  });
});
