import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mediaStyles = readFileSync("app/storefront-product-media.css", "utf8");
const appStyles = readFileSync("app/app.css", "utf8");
const productImageSource = readFileSync("app/components/product-image.tsx", "utf8");
const productCardSource = readFileSync("app/components/ui.tsx", "utf8");
const publicPagesSource = readFileSync("app/components/public-pages.tsx", "utf8");

describe("storefront product image fit contract", () => {
  it("opt-in contain contract giữ full image và safe inset", () => {
    expect(mediaStyles).toMatch(
      /\.storefront-product-media\s*\{[\s\S]*object-fit:\s*contain;[\s\S]*object-position:\s*center;/,
    );
    expect(mediaStyles).toContain("padding: clamp(3px, 3.6%, 10px)");
    expect(mediaStyles).toContain("background: var(--surface-lowest)");
    expect(mediaStyles).toContain(".product-image > .storefront-product-media");
    expect(mediaStyles).toContain(".cart-item > .storefront-product-media");
    expect(mediaStyles).toContain(".public-share-items .storefront-product-media");
    expect(mediaStyles).toContain(".summary-lines .storefront-product-media");
    expect(mediaStyles).not.toMatch(
      /\.storefront-product-media[^}]*object-fit:\s*cover/,
    );
    expect(appStyles).toContain(".product-image>img{width:100%;height:100%;object-fit:contain;object-position:center;transition:none}");
    expect(appStyles).not.toContain(".product-card:hover .product-image>img{transform:scale(");
    expect(appStyles).toContain(".cart-item>img{width:150px;height:150px;border-radius:14px;object-fit:contain;object-position:center}");
    expect(appStyles).toContain(".summary-lines img{width:54px;height:54px;border-radius:8px;object-fit:contain;object-position:center");
    expect(appStyles).toContain(".public-share-items img{width:72px;height:72px;border-radius:12px;object-fit:contain;object-position:center");
  });

  it("ProductImage không biến fit thành behavior global", () => {
    expect(productImageSource).not.toContain("objectFit");
    expect(productImageSource).not.toContain("object-fit");
    expect(productCardSource).toContain('className="storefront-product-media"');
    expect(publicPagesSource).toContain('className="storefront-product-media"');
    expect(publicPagesSource).toContain(
      '<img className="storefront-product-media" src={item.imageUrl} alt="" />',
    );
  });

  it("hover không zoom lại ảnh và placeholder vẫn có contract riêng", () => {
    expect(mediaStyles).toContain(
      ".product-card:hover .product-image > .storefront-product-media",
    );
    expect(mediaStyles).toContain("transform: none");
    expect(mediaStyles).not.toContain("scale(");
    expect(mediaStyles).toContain(".storefront-product-media.product-image-placeholder");
    expect(mediaStyles).toContain("padding: 16%");
  });
});
