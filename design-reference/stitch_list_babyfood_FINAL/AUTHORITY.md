# Reference authority for Codex

Use this order of precedence when implementing the app:

1. `babyjoy_nurture/DESIGN.md` — authoritative design tokens and visual system.
2. Each screen's `code.html` — authoritative screen content, sample data, labels, and component structure.
3. `FINAL_REFERENCE.md` — authoritative cross-screen sample cart / cart-request consistency rules.
4. Each screen's `screen.png` — authoritative visual/layout reference. If copy/data in an older screenshot differs from `code.html`, follow `code.html` while preserving the screenshot's layout and styling.

Do not infer removed features (customer profile, wishlist, reviews, payment, subscription, hard-coded shipping promotions) from stale visual remnants. The HTML and final manifest override them.
