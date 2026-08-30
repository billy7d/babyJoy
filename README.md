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

`test:e2e` dùng Chromium do package Playwright quản lý và tạo ảnh nghiệm thu trong `screenshots/actual/`.

## Cấu hình Cloudflare

1. Tạo D1 database `babyjoy-db` và R2 bucket `babyjoy-product-images`.
2. Thay `REPLACE_WITH_PRODUCTION_D1_ID` trong `wrangler.jsonc` bằng D1 ID thật.
3. Secret tuyệt đối không đưa vào source:

```powershell
npx wrangler secret put META_PAGE_ACCESS_TOKEN --env production
npx wrangler secret put META_APP_SECRET --env production
npx wrangler secret put META_WEBHOOK_VERIFY_TOKEN --env production
npx wrangler secret put STOREFRONT_ACCESS_SECRET --env production
npm run db:migrate:remote
npm run deploy -- --env production
```

Storefront access gate:

- STOREFRONT_ACCESS_GATE_ENABLED is the rollout flag. Keep it false while
  deploying the migration and secret, then enable it after smoke tests.
- STOREFRONT_ACCESS_SECRET is required in production. Never put this secret,
  a raw access credential, or a raw session token in source or logs.
- The `production-enable-smoke.yml` workflow also requires the same value as
  the masked `STOREFRONT_ACCESS_SECRET` secret in the GitHub `production`
  environment; the smoke workflow reads it only to sign a temporary link and
  never overwrites the Worker secret.

Các biến không phải secret trong `wrangler.jsonc`:

- `META_PAGE_ID`: ID Facebook Page gửi message.
- `MESSENGER_PAGE_USERNAME`: username dùng cho URL `m.me`.
- `META_GRAPH_API_VERSION`: phiên bản Graph API đã kiểm thử.
- `MESSENGER_CHECKOUT_ENABLED`: để `false` khi deploy hạ tầng và role smoke
  test; chỉ đổi `true` sau khi có phê duyệt cutover.

Webhook public là `/api/meta/messenger/webhook`. Trên Meta App cần subscribe
Page vào `messages`, `messaging_postbacks`, `messaging_referrals`; cấu hình Get
Started payload `BABYJOY_GET_STARTED`; cấp `pages_messaging` và
`pages_manage_metadata` khi cần subscribe Page. Standard Access chỉ dùng cho
Admin/Developer/Tester. Trước public cutover phải có Advanced Access và smoke
test một tài khoản thật không có App role.

Không đưa PSID, raw referral/status token hoặc Meta credential vào log. Referral
và status token chỉ được lưu dạng SHA-256 trong D1; PSID chỉ tồn tại trong D1
private và không được trả về public API/Admin UI.

Admin production yêu cầu Cloudflare Access Application bảo vệ `/admin/*` và `/api/admin/*`. `ACCESS_TEAM_DOMAIN` nhận hostname dạng `<team>.cloudflareaccess.com` (hoặc URL HTTPS tương đương) và được chuẩn hóa thành issuer HTTPS trước khi tạo JWKS URL; `ACCESS_AUD` phải khớp Access Application. Worker chỉ đọc email từ payload sau khi đã xác minh chữ ký JWT, issuer, audience và thời hạn; cấu hình trống hoặc môi trường không phải `development` sẽ fail-closed.

## Quy tắc nghiệp vụ quan trọng

- D1 là nguồn giá có thẩm quyền khi gửi giỏ hàng; giá từ trình duyệt chỉ dùng để phát hiện thay đổi.
- `submissionToken` là idempotency key, tránh tạo bản ghi trùng khi người dùng gửi lại.
- Bản ghi yêu cầu và snapshot mặt hàng được commit trước khi trao đổi với người bán; snapshot là dữ liệu lịch sử bất biến.
- Messenger checkout chỉ hoàn tất khi `messenger_delivery_status = SENT`; browser
  không xóa cart trước trạng thái này và không xóa nếu cart hiện tại đã khác
  snapshot được gửi.
- Kênh gửi hiện tại là Direct Seller Share (clipboard-first, Web Share phụ trợ) và
  Messenger checkout có feature flag riêng. Các cột kênh cũ trong D1 chỉ giữ để
  đọc lịch sử, không còn đường gửi lại.
- Giỏ hàng local dùng key `babyjoy.cart.v1` và tồn tại qua refresh.
- Ảnh upload chỉ nhận JPEG/PNG/WebP tối đa 5 MB, tạo key immutable mới trong R2 và lưu duy nhất `r2_key` vào D1.
- Ảnh production được phân phối trực tiếp qua `https://images.metraphuong.com/<r2_key>`. Route `/media/*` chỉ còn tương thích legacy và đã được đánh dấu deprecated.
- Gỡ ảnh khỏi sản phẩm chỉ xóa association D1; không tự động xóa object R2 để bảo toàn snapshot giỏ hàng lịch sử.

Tài liệu Stitch đã giải nén trong `design-reference/` chỉ dùng làm tham chiếu, không được import vào production source.
