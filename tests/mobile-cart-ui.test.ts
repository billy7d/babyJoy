import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mobile cart Stitch presentation contract", () => {
  const cartPageSource = readFileSync("app/components/public-pages.tsx", "utf8");
  const mobileCss = readFileSync("app/mobile-cart.css", "utf8");

  it("keeps cart, price, promotion and unavailable state authorities", () => {
    expect(cartPageSource).toContain("cart.removeItem(variant.id)");
    expect(cartPageSource).toContain("variantId={variant.id}");
    expect(cartPageSource).toContain("cart-item-unavailable");
    expect(cartPageSource).toContain("evaluated?.priceVnd ?? variant.priceVnd");
    expect(cartPageSource).toContain("evaluated.discountAmountVnd > 0");
    expect(cartPageSource).toContain("promotion.data?.gifts.map");
    expect(cartPageSource).toContain("formatReservationDuration(reservationMinutes)");
  });

  it("uses one existing checkout action inside the mobile dock", () => {
    expect(cartPageSource).toContain("<PublicShell hideMobileNav>");
    expect(cartPageSource.match(/className=\"btn primary direct-prepare\"/g)).toHaveLength(1);
    expect(cartPageSource).toContain("className=\"mobile-cart-checkout-dock\"");
    expect(cartPageSource).not.toContain("mobile-direct-prepare");
  });

  it("keeps the compact footer dynamic and mobile-only", () => {
    expect(cartPageSource).toContain("className=\"mobile-cart-footer\"");
    expect(cartPageSource).toContain("{displayName}");
    expect(mobileCss).toContain(".mobile-cart-footer {\n  display: none;");
    expect(mobileCss).toContain("body:has(.cart-page) .public-footer");
  });

  it("scopes the responsive redesign and reserves safe-area space", () => {
    expect(mobileCss).toContain("@media (max-width: 639px)");
    expect(mobileCss).toContain("grid-template-columns: 80px minmax(0, 1fr)");
    expect(mobileCss).toContain("width: 80px");
    expect(mobileCss).toContain(
      ".cart-item-info .unit-price .price",
    );
    expect(mobileCss).toContain(
      '.quantity-stepper > span[aria-live="polite"]',
    );
    expect(mobileCss).toContain("display: none !important;");
    expect(mobileCss).toContain("position: fixed");
    expect(mobileCss).toContain(".cart-page .cart-layout,");
    expect(mobileCss).toContain(".cart-page .cart-items,");
    expect(mobileCss).toContain(".cart-page .cart-item,");
    expect(mobileCss).toContain(".cart-page .cart-summary {");
    expect(mobileCss).toContain("align-items: stretch;");
    expect(mobileCss).toContain(
      "padding: 12px 16px calc(12px + env(safe-area-inset-bottom));",
    );
    expect(mobileCss).not.toMatch(/(?:^|\n)\s*header\s*\{/);
    expect(mobileCss).not.toMatch(/(?:^|\n)\s*footer\s*\{/);
    expect(mobileCss).not.toMatch(/(?:^|\n)\s*button\s*\{/);
    expect(mobileCss).not.toMatch(/(?:^|\n)\s*\.product-card\s*\{/);
  });
});
