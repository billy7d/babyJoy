import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mobile cart remove control", () => {
  const rootSource = readFileSync("app/root.tsx", "utf8");
  const mobileCss = readFileSync("app/mobile-cart.css", "utf8");
  const cartPageSource = readFileSync("app/components/public-pages.tsx", "utf8");
  const cartStateSource = readFileSync("app/lib/cart.tsx", "utf8");

  it("loads the mobile cart override after the base stylesheet", () => {
    const baseIndex = rootSource.indexOf('import "./app.css";');
    const mobileIndex = rootSource.indexOf('import "./mobile-cart.css";');
    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(mobileIndex).toBeGreaterThan(baseIndex);
  });

  it("keeps remove-item wired to the existing persisted cart state", () => {
    expect(cartPageSource).toContain('className="remove-line"');
    expect(cartPageSource).toContain("cart.removeItem(variant.id)");
    expect(cartStateSource).toContain("removeItem(variantId)");
    expect(cartStateSource).toContain(
      "current.filter((item) => item.variantId !== variantId)",
    );
  });

  it("shows a touch-sized remove action on mobile without changing desktop styles", () => {
    expect(mobileCss).toContain("@media (max-width: 639px)");
    expect(mobileCss).toContain(".cart-item .remove-line");
    expect(mobileCss).toMatch(/min-width:\s*44px/);
    expect(mobileCss).toMatch(/min-height:\s*44px/);
    expect(mobileCss).toMatch(/display:\s*inline-flex/);
    expect(mobileCss).toContain("grid-template-columns: 96px minmax(0, 1fr)");
  });

  it("aligns variant and remove action on one stable metadata row", () => {
    expect(mobileCss).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(mobileCss).toContain('"variant remove"');
    expect(mobileCss).toContain("grid-area: variant");
    expect(mobileCss).toContain("grid-area: remove");
    expect(mobileCss).toContain("grid-area: price");
    expect(mobileCss).toContain("align-self: center");
    expect(mobileCss).toContain("justify-self: end");
  });

  it("keeps quantity controls in the mobile card after the layout override", () => {
    expect(mobileCss).toContain(".cart-item .quantity-stepper");
    expect(mobileCss).toContain("grid-column: 2");
    expect(mobileCss).toContain("grid-row: 2");
  });
});
