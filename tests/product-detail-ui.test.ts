import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getVariantAvailableQuantity,
  isVariantPurchasable,
  type Variant,
} from "../app/lib/catalog";

const detailSource = readFileSync("app/components/public-pages.tsx", "utf8");
const detailStyles = readFileSync("app/product-detail.css", "utf8");
const appStyles = readFileSync("app/app.css", "utf8");

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

  it("giữ trọn ảnh trong preview và căn giữa toàn bộ dots", () => {
    expect(appStyles).toMatch(
      /\.detail-main-image\{[^}]*object-fit:contain;[^}]*object-position:center/,
    );
    expect(detailStyles).toMatch(
      /\.public-shell-product-detail \.detail-main-image-wrap \{[^}]*padding: 10px;[^}]*\}/s,
    );
    expect(detailStyles).toMatch(
      /\.public-shell-product-detail \.detail-main-image \{[^}]*object-fit: contain;[^}]*object-position: center;[^}]*\}/s,
    );
    expect(detailStyles).toMatch(
      /\.public-shell-product-detail \.detail-thumbs \{[^}]*justify-content: center;[^}]*\}/s,
    );
    expect(detailStyles).not.toContain("justify-content: flex-start");
    expect(detailStyles).toContain("width: min(280px, 100%)");
    expect(detailStyles).toContain("aspect-ratio: 1");
    expect(detailStyles).toContain("border-radius: 16px");
    expect(detailStyles).toContain("box-shadow: 0 2px 8px rgba(45, 37, 34, 0.06)");
  });
});
