import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getVariantAvailableQuantity,
  isVariantPurchasable,
  type Variant,
} from "../app/lib/catalog";

const detailSource = readFileSync("app/components/public-pages.tsx", "utf8");
const detailStyles = readFileSync("app/product-detail.css", "utf8");

describe("Product Detail Stitch UI", () => {
  it("giữ binding gallery, variant, description và cart thật", () => {
    expect(detailSource).toContain("buildVariantGallery(product)");
    expect(detailSource).toContain("addItem(currentVariant.id, quantity, product)");
    expect(detailSource).toContain("product.descriptionContent");
    expect(detailSource).toContain("aria-pressed={variantId === item.id}");
    expect(detailSource).not.toContain("Bột ăn dặm Heinz</h2>");
    expect(detailSource).not.toContain("const maxQty = 99");
  });

  it("giữ giới hạn tồn kho và trạng thái không bán được", () => {
    const trackedVariant: Variant = {
      id: "tracked",
      name: "Gói",
      sku: "TRACKED",
      priceVnd: 160000,
      availability: "AVAILABLE",
      status: "SELLING",
      trackInventory: true,
      stockOnHand: 5,
      reservedQuantity: 2,
      availableQuantity: 3,
    };
    expect(getVariantAvailableQuantity(trackedVariant)).toBe(3);
    expect(isVariantPurchasable(trackedVariant)).toBe(true);
    expect(
      isVariantPurchasable({
        ...trackedVariant,
        availableQuantity: 0,
      }),
    ).toBe(false);
    expect(
      getVariantAvailableQuantity({
        ...trackedVariant,
        trackInventory: false,
      }),
    ).toBeNull();
  });

  it("giữ purchase dock và responsive contract đã duyệt", () => {
    expect(detailStyles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(detailStyles).toContain("width: 112px");
    expect(detailStyles).toContain("height: 52px");
    expect(detailStyles).toContain("border-radius: 999px");
    expect(detailStyles).toContain(
      "padding: 12px 16px calc(24px + env(safe-area-inset-bottom))",
    );
    expect(detailStyles).not.toContain("max-width: 430px");
  });
});
