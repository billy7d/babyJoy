import { describe, expect, it } from "vitest";
import { calculateCart, composeTelegramMessage, generatePublicCode, splitTelegramMessage, statusLabels, validateSubmission } from "../workers/services";

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

describe("validation", () => {
  it("chặn số lượng vượt giới hạn", () => {
    expect(() => validateSubmission({ submissionToken: "token", customerName: "A", customerPhone: "0901", items: [{ variantId: "v1", quantity: 100 }] })).toThrow("VALIDATION_ERROR");
  });

  it("chặn trùng variant trong cùng submission", () => {
    expect(() => validateSubmission({ submissionToken: "token", customerName: "A", customerPhone: "0901", items: [{ variantId: "v1", quantity: 1 }, { variantId: "v1", quantity: 1 }] })).toThrow("VALIDATION_ERROR");
  });
});

describe("Telegram", () => {
  const item = { productId: "p1", variantId: "v1", productName: "Bột ăn dặm", variantName: "227g", sku: "SKU-1", imageKey: null, priceVnd: 125000, quantity: 2, lineTotalVnd: 250000 };
  it("soạn message từ snapshot với mã, khách và tạm tính", () => {
    const message = composeTelegramMessage({ code: "GH-260825-X7K2", createdAt: "25/08/2026 • 15:12", customerName: "Nguyễn Văn A", customerPhone: "0901 234 567", items: [item], totalQuantity: 2, subtotalVnd: 250000 });
    expect(message).toContain("GIỎ HÀNG MỚI");
    expect(message).toContain("GH-260825-X7K2");
    expect(message).toContain("250.000 ₫");
  });

  it("chia message dài thành các phần không vượt giới hạn", () => {
    const chunks = splitTelegramMessage(Array.from({ length: 1000 }, () => "Dòng sản phẩm").join("\n"), 4000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 4000)).toBe(true);
  });
});

describe("mapping trạng thái", () => {
  it("giữ đúng enum được PRD khóa", () => {
    expect(statusLabels).toEqual({ SUBMITTED: "Mới", CONTACTED: "Đã liên hệ", CONFIRMED: "Đã xác nhận", COMPLETED: "Hoàn thành", CANCELLED: "Đã hủy" });
  });
});
