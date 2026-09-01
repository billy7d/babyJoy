import type { CronHealthStatus } from "../../shared/cron-health";

export const CRON_HEALTH_LABELS: Record<CronHealthStatus, string> = {
  HEALTHY: "Hoạt động",
  DEGRADED: "Có lỗi một phần",
  ERROR: "Đang lỗi",
  STALE: "Không chạy đúng lịch",
  UNKNOWN: "Chưa có dữ liệu",
};

export function getCronHealthWarning(status: CronHealthStatus) {
  if (status === "STALE")
    return "Tác vụ giải phóng hàng giữ tạm đã không chạy trong hơn 5 phút. Tồn kho khả dụng có thể bị giữ lâu hơn dự kiến.";
  if (status === "ERROR")
    return "Tác vụ giải phóng hàng giữ tạm đang gặp lỗi.";
  if (status === "DEGRADED")
    return "Tác vụ giải phóng hàng giữ tạm có một số bản ghi xử lý thất bại.";
  return null;
}

export function formatCronHealthTimestamp(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Chưa có dữ liệu";
  return new Date(value).toLocaleString("vi-VN");
}
