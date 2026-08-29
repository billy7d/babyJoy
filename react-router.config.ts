import type { Config } from "@react-router/dev/config";

export default {
  // Giữ SSR để HTML công khai có nội dung ngay từ phản hồi đầu tiên.
  ssr: true,
} satisfies Config;
