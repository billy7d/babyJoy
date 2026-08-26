# BabyJoy Web App

Web app catalogue và gửi giỏ hàng cho BabyJoy, xây dựng theo PRD v1.0 và bộ Stitch canonical. Stack: React Router 8 SSR, React 19, Cloudflare Workers, D1 và R2.

## Chạy local

Yêu cầu Node.js 22+.

```powershell
npm install
npm run db:migrate:local
npm run dev
```

Ứng dụng chạy tại `http://127.0.0.1:5173`. Dữ liệu local được seed từ `migrations/0002_seed.sql`.

## Kiểm tra

```powershell
npm test
npm run typecheck
npm run build
npm run test:e2e
```

`test:e2e` cần Google Chrome tại đường dẫn Windows mặc định và tạo ảnh nghiệm thu trong `screenshots/actual/`.

## Cấu hình Cloudflare

1. Tạo D1 database `babyjoy-db` và R2 bucket `babyjoy-product-images`.
2. Thay `REPLACE_WITH_PRODUCTION_D1_ID` trong `wrangler.jsonc` bằng D1 ID thật.
3. Khai báo Telegram bằng secret, tuyệt đối không đưa token vào source:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN --env production
npx wrangler secret put TELEGRAM_CHAT_ID --env production
npm run db:migrate:remote
npm run deploy -- --env production
```

Admin production yêu cầu header xác thực của Cloudflare Access. Cần tạo Access Application cho `/admin/*` và `/api/admin/*`; API sẽ trả 401 nếu thiếu `cf-access-authenticated-user-email` trong production.

## Quy tắc nghiệp vụ quan trọng

- D1 là nguồn giá có thẩm quyền khi gửi giỏ hàng; giá từ trình duyệt chỉ dùng để phát hiện thay đổi.
- `submissionToken` là idempotency key, tránh tạo bản ghi trùng khi người dùng gửi lại.
- Bản ghi yêu cầu và snapshot mặt hàng được commit trước khi gửi Telegram. Telegram thất bại không làm mất yêu cầu và admin có thể thử lại.
- Giỏ hàng local dùng key `babyjoy.cart.v1` và tồn tại qua refresh.
- Ảnh upload chỉ nhận JPEG/PNG/WebP tối đa 5 MB, lưu trong R2 và phân phối qua `/media/*`.

Tài liệu Stitch đã giải nén trong `design-reference/` chỉ dùng làm tham chiếu, không được import vào production source.
