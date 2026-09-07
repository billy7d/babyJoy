import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/components/admin-pages.tsx", "utf8");

describe("Admin category visibility UI", () => {
  it("hiển thị đúng trạng thái và action hai chiều", () => {
    expect(source).toContain('StatusBadge status={row.isActive ? "ACTIVE" : "HIDDEN"}');
    expect(source).toContain('row.isActive ? "ẨN DANH MỤC" : "KÍCH HOẠT LẠI"');
    expect(source).toContain('editing.isActive ? "ẨN DANH MỤC" : "KÍCH HOẠT LẠI"');
    expect(source).toContain('method: isActive ? "DELETE" : "PUT"');
    expect(source).toContain("isActive: true");
    expect(source).toContain("const refreshedRows = await loadRows();");
  });

  it("có filter category và giữ status sản phẩm trong association manager", () => {
    expect(source).toContain('aria-label="Lọc trạng thái danh mục"');
    expect(source).toContain('["ACTIVE", "Đang hoạt động"]');
    expect(source).toContain('["HIDDEN", "Đã ẩn"]');
    expect(source).toContain('StatusBadge status={product.status}');
    expect(source).toContain("Danh mục đang bị ẩn khỏi storefront nhưng dữ liệu và quan hệ sản phẩm vẫn được giữ lại.");
  });
});
