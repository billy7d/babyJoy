import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isFreeShippingPromotion } from "../app/lib/promotions";

describe("mobile cart Stitch presentation contract", () => {
  const cartPageSource = readFileSync("app/components/public-pages.tsx", "utf8");
  // Chuẩn hóa line ending để contract test ổn định trên checkout Windows CRLF.
  const mobileCss = readFileSync("app/mobile-cart.css", "utf8").replaceAll("\r\n", "\n");

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
    expect(mobileCss).toContain("Tên sản phẩm được phép tự tăng chiều cao");
    expect(mobileCss).toContain(".cart-item-info h2");
    expect(mobileCss).not.toContain("-webkit-line-clamp: 2");
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

  it("gom progress vào một container và giới hạn row theo responsive disclosure", () => {
    const promotionCss = readFileSync("app/cart-promotions.css", "utf8");
    expect(cartPageSource).toContain("<PromotionProgressGroup progress={promotion.progress} />");
    expect(cartPageSource).toContain("className=\"promotion-progress-toggle\"");
    expect(cartPageSource).toContain("aria-expanded={expanded}");
    expect(cartPageSource).not.toContain('className="promotion-total-row"');
    expect(cartPageSource.indexOf('className="promotion-breakdown"')).toBeLessThan(cartPageSource.indexOf('className="cart-final-total"'));
    expect(cartPageSource.indexOf('className="cart-final-total"')).toBeLessThan(cartPageSource.indexOf("<PromotionProgressGroup"));
    expect(cartPageSource).not.toContain("promotion.progress.slice(0, 2)");
    expect(promotionCss).toContain("grid-template-columns: auto minmax(0, 1fr)");
    expect(promotionCss).toContain(".cart-final-total .price");
    expect(promotionCss).toContain("font-size: 30px");
    expect(promotionCss).toContain("font-weight: 800");
    expect(promotionCss).toContain("@media (max-width: 430px)");
    expect(promotionCss).toContain("nth-child(n + 3)");
    expect(promotionCss).toContain("nth-child(n + 4)");
    expect(promotionCss).not.toContain("overflow-y: auto");
    expect(promotionCss).not.toContain("text-overflow: ellipsis");
  });

  it("đưa FREE SHIPPING vào cột value bằng type, không dựa vào promotion name", () => {
    expect(isFreeShippingPromotion({ type: "FREE_SHIPPING" })).toBe(true);
    expect(isFreeShippingPromotion({ type: "ORDER_FIXED_DISCOUNT" })).toBe(false);
    expect(cartPageSource).toContain("isFreeShippingPromotion(item)");
    expect(cartPageSource).toContain("Miễn phí vận chuyển");
    expect(cartPageSource).toContain("className=\"promotion-breakdown-benefit\"");
    expect(cartPageSource).not.toContain('item.promotionName === "FREE SHIPPING"');
  });
});
