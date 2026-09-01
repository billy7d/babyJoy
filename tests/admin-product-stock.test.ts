import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Product, Variant } from "../app/lib/catalog";
import { getAdminProductStockOnHand } from "../app/lib/admin-product-stock";

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: "variant-test",
    name: "100g",
    sku: "TEST-100",
    priceVnd: 100000,
    availability: "AVAILABLE",
    ...overrides,
  };
}

function makeProduct(variants: Variant[]): Product {
  return {
    id: "product-test",
    slug: "product-test",
    name: "Sản phẩm test",
    brand: "BabyJoy",
    shortDescription: "",
    description: "",
    image: "/images/placeholder.svg",
    category: "test",
    age: "6+ tháng",
    tags: [],
    variants,
  };
}

describe("tồn kho sản phẩm trong Admin", () => {
  it("lấy stockOnHand của một variant đang theo dõi", () => {
    expect(
      getAdminProductStockOnHand(
        makeProduct([makeVariant({ trackInventory: true, stockOnHand: 15 })]),
      ),
    ).toBe(15);
  });

  it("cộng stockOnHand của nhiều variant đang theo dõi", () => {
    expect(
      getAdminProductStockOnHand(
        makeProduct([
          makeVariant({ id: "variant-1", trackInventory: true, stockOnHand: 5 }),
          makeVariant({ id: "variant-2", trackInventory: true, stockOnHand: 8 }),
        ]),
      ),
    ).toBe(13);
  });

  it("không trừ reservedQuantity hoặc dùng availableQuantity", () => {
    expect(
      getAdminProductStockOnHand(
        makeProduct([
          makeVariant({
            trackInventory: true,
            stockOnHand: 10,
            reservedQuantity: 4,
            availableQuantity: 6,
          }),
        ]),
      ),
    ).toBe(10);
  });

  it("giữ giá trị 0 của variant đang theo dõi", () => {
    expect(
      getAdminProductStockOnHand(
        makeProduct([makeVariant({ trackInventory: true, stockOnHand: 0 })]),
      ),
    ).toBe(0);
  });

  it("trả null thay vì biến variant không theo dõi thành tồn kho 0", () => {
    expect(
      getAdminProductStockOnHand(
        makeProduct([makeVariant({ trackInventory: false, stockOnHand: 99 })]),
      ),
    ).toBeNull();
  });

  it("chỉ cộng variant được theo dõi trong dữ liệu mixed", () => {
    expect(
      getAdminProductStockOnHand(
        makeProduct([
          makeVariant({ id: "variant-tracked-1", trackInventory: true, stockOnHand: 8 }),
          makeVariant({ id: "variant-untracked", trackInventory: false, stockOnHand: 100 }),
          makeVariant({ id: "variant-tracked-2", trackInventory: true, stockOnHand: 12 }),
        ]),
      ),
    ).toBe(20);
  });

  it("không crash và xem stockOnHand legacy bị thiếu là 0", () => {
    expect(
      getAdminProductStockOnHand(
        makeProduct([makeVariant({ trackInventory: true, stockOnHand: undefined })]),
      ),
    ).toBe(0);
  });
});

describe("row tồn kho của Admin Product List", () => {
  const source = readFileSync(
    new URL("../app/components/admin-pages.tsx", import.meta.url),
    "utf8",
  );
  const cssSource = readFileSync(
    new URL("../app/app.css", import.meta.url),
    "utf8",
  );

  it("đặt TỒN KHO giữa PHÂN LOẠI và GIÁ và cập nhật empty state", () => {
    const variantHeader = source.indexOf("<th>Phân loại</th>");
    const stockHeader = source.indexOf('className="admin-stock-header"');
    const priceHeader = source.indexOf("<th>Giá</th>");

    expect(variantHeader).toBeGreaterThanOrEqual(0);
    expect(stockHeader).toBeGreaterThan(variantHeader);
    expect(priceHeader).toBeGreaterThan(stockHeader);
    expect(source).toContain("<td colSpan={8}>");
  });

  it("render đúng semantics stockOnHand và giữ table scroll nội bộ", () => {
    const stockCellStart = source.indexOf('className="admin-stock-cell"');
    const stockCellEnd = source.indexOf("</td>", stockCellStart);
    const stockCell = source.slice(stockCellStart, stockCellEnd);

    expect(source).toContain("getAdminProductStockOnHand(product)");
    expect(stockCell).toContain("stockOnHand");
    expect(stockCell).not.toContain("availableQuantity");
    expect(stockCell).toContain("Không theo dõi tồn kho");
    expect(cssSource).toContain(".admin-products-table{min-width:840px}");
    expect(cssSource).toContain("white-space:nowrap;text-align:center");
    expect(cssSource).toContain("font-variant-numeric:tabular-nums");
  });

  it("không bỏ pagination, search và status filter hiện tại", () => {
    expect(source).toContain("buildAdminProductsUrl(page, query, statusFilter)");
    expect(source).toContain('setPage(1);');
    expect(source).toContain('["AVAILABLE", "Đang bán"]');
    expect(source).toContain('["OUT_OF_STOCK", "Hết hàng"]');
    expect(source).toContain('["HIDDEN", "Đã ẩn"]');
    expect(source).toContain("<TableFooter");
  });
});
