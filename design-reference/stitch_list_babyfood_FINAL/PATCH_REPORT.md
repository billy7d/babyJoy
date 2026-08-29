# Final Patch Report

All requested final content/data patches have been applied.

1. Product Detail Desktop + Mobile use the approved templates from the older ZIP.
2. Canonical sample cart is synchronized in HTML across Cart Desktop/Mobile, Send Cart Desktop and Admin Cart Detail; Send Cart Mobile uses the same item/quantity totals and subtotal.
3. `GH-260825-X7K2` is synchronized between Admin List and Detail: Nguyễn Văn A, 0901 234 567, 25/08/2026 • 15:12, 367.000 ₫, Telegram failed.
4. Public customer Profile/person avatar remnants removed from HTML.
5. Hard-coded Freeship/500k promotion removed.
6. Public badge labels localized to Vietnamese.
7. `Tổng dự kiến` removed from Send Cart screens.
8. Send Cart wording updated from order-processing language to seller cart confirmation language.
9. `user-scalable=no` and `maximum-scale=1` removed from mobile HTML.
10. Success Mobile black/pattern edge artifact patched in `screen.png`.

## Canonical sample cart
- Bột ăn dặm Gerber Organic Yến mạch & Chuối — 227g — 125.000 ₫ × 2 = 250.000 ₫
- Bánh gạo ăn dặm vị Táo — 50g — 68.000 ₫ × 1 = 68.000 ₫
- Rau củ quả nghiền hữu cơ — 120g — 49.000 ₫ × 1 = 49.000 ₫
- 3 mặt hàng — tổng số lượng 4 — tạm tính 367.000 ₫

See `AUTHORITY.md` for implementation precedence.
