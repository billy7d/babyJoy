import { describe, expect, it } from "vitest";
import { calculateCart, generatePublicCode, statusLabels } from "../workers/services";

describe("tính giỏ hàng VND", () => {
  it("tính đúng tổng số lượng và tạm tính canonical", () => {
    expect(calculateCart([{ priceVnd: 125000, quantity: 2 }, { priceVnd: 68000, quantity: 1 }, { priceVnd: 49000, quantity: 1 }])).toEqual({ totalQuantity: 4, subtotalVnd: 367000 });
  });
});

describe("mã giỏ hàng", () => {
  it("tạo đúng định dạng công khai và không dùng ID tuần tự", () => {
    expect(generatePublicCode(new Date("2026-08-25T00:00:00Z"), new Uint8Array([23, 6, 8, 0]))).toMatch(/^GH-260825-[A-Z2-9]{4}$/);
  });
});

describe("mapping trạng thái", () => {
  it("giữ đúng enum được PRD khóa", () => {
    expect(statusLabels).toEqual({ SUBMITTED: "Mới", CONTACTED: "Đã liên hệ", CONFIRMED: "Đã xác nhận", COMPLETED: "Hoàn thành", CANCELLED: "Đã hủy" });
  });
});
