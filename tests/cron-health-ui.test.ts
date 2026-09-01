import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CRON_HEALTH_LABELS,
  formatCronHealthTimestamp,
  getCronHealthWarning,
} from "../app/lib/cron-health-ui";

const uiSource = readFileSync(
  new URL("../app/components/ui.tsx", import.meta.url),
  "utf8",
);
const settingsSource = readFileSync(
  new URL("../app/components/admin-pages.tsx", import.meta.url),
  "utf8",
);

describe("admin cron health UI", () => {
  it("hiển thị đúng nhãn cho mọi health status", () => {
    expect(CRON_HEALTH_LABELS).toEqual({
      HEALTHY: "Hoạt động",
      DEGRADED: "Có lỗi một phần",
      ERROR: "Đang lỗi",
      STALE: "Không chạy đúng lịch",
      UNKNOWN: "Chưa có dữ liệu",
    });
  });

  it("chỉ cảnh báo global cho stale/error/degraded, unknown không đỏ", () => {
    expect(getCronHealthWarning("HEALTHY")).toBeNull();
    expect(getCronHealthWarning("UNKNOWN")).toBeNull();
    expect(getCronHealthWarning("STALE")).toBe(
      "Tác vụ giải phóng hàng giữ tạm đã không chạy trong hơn 5 phút. Tồn kho khả dụng có thể bị giữ lâu hơn dự kiến.",
    );
    expect(getCronHealthWarning("ERROR")).toBe(
      "Tác vụ giải phóng hàng giữ tạm đang gặp lỗi.",
    );
    expect(getCronHealthWarning("DEGRADED")).toBe(
      "Tác vụ giải phóng hàng giữ tạm có một số bản ghi xử lý thất bại.",
    );
  });

  it("format timestamp theo local Vietnamese time và fallback an toàn", () => {
    expect(formatCronHealthTimestamp(null)).toBe("Chưa có dữ liệu");
    expect(formatCronHealthTimestamp("not-a-date")).toBe("Chưa có dữ liệu");
    expect(formatCronHealthTimestamp("2026-09-01T00:00:00.000Z")).toBe(
      new Date("2026-09-01T00:00:00.000Z").toLocaleString("vi-VN"),
    );
  });

  it("poll GET khi AdminShell mount và dọn interval khi unmount", () => {
    expect(uiSource).toContain('fetch("/api/admin/cron-health", {');
    expect(uiSource).toContain('method: "GET"');
    expect(uiSource).toContain('cache: "no-store"');
    expect(uiSource).toContain("window.setInterval(() => void load(), 60_000)");
    expect(uiSource).toContain("window.clearInterval(interval)");
    expect(uiSource).toContain('role="alert"');
    expect(uiSource).toContain('aria-label="Ẩn cảnh báo"');
  });

  it("settings có card metrics và refresh chỉ đọc, không thêm cleanup mutation", () => {
    expect(settingsSource).toContain("Tình trạng tác vụ giữ hàng");
    expect(settingsSource).toContain("Lần chạy gần nhất");
    expect(settingsSource).toContain("Lần thành công gần nhất");
    expect(settingsSource).toContain("Bản ghi kiểm tra");
    expect(settingsSource).toContain("Bản ghi lỗi");
    expect(settingsSource).toContain("Thời gian xử lý");
    expect(settingsSource).toContain("Lịch chạy");
    expect(settingsSource).toContain("Làm mới trạng thái");
    expect(settingsSource).not.toContain('fetch("/api/admin/cron-health", { method: "POST"');
    expect(settingsSource).not.toContain('fetch("/api/admin/cron-health", { method: "PUT"');
  });
});
