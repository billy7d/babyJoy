import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STORE_BRAND } from "../shared/branding";
import { DEFAULT_STORE_SETTINGS } from "../shared/store-settings";

const publicPages = readFileSync("app/components/public-pages.tsx", "utf8");
const ui = readFileSync("app/components/ui.tsx", "utf8");
const site = readFileSync("app/routes/site.tsx", "utf8");
const home = readFileSync("app/routes/home.tsx", "utf8");
const access = readFileSync("app/components/access-required.tsx", "utf8");
const css = readFileSync("app/app.css", "utf8");
const cartShare = readFileSync("workers/cart-share.ts", "utf8");
const messenger = readFileSync("workers/messenger.ts", "utf8");
const storeSettings = readFileSync("app/lib/store-settings.tsx", "utf8");
const guideStart = publicPages.indexOf("function MessengerGuideIllustration");
const guideEnd = publicPages.indexOf("export function SuccessPage");
const guide = publicPages.slice(guideStart, guideEnd);

describe("storefront brand", () => {
  it("giữ đúng tên brand được yêu cầu và dùng chung cho public surfaces", () => {
    expect(STORE_BRAND).toBe("Đồ ăn dặm UK 🍼Trà Phương🍼");
    expect(DEFAULT_STORE_SETTINGS.displayName).toBe(STORE_BRAND);
    expect(publicPages).toContain("useStoreSettings");
    expect(ui).toContain("useStoreSettings");
    expect(access).toContain("useStoreSettings");
    expect(storeSettings).toContain("StoreSettingsProvider");
    expect(site).toContain("DEFAULT_STORE_SETTINGS");
    expect(home).toContain("DEFAULT_STORE_SETTINGS");
    expect(ui).not.toContain("hello@babyjoy.vn");
    expect(ui).not.toContain("1900 123 456");
    expect(publicPages).not.toContain("STORE_BRAND");
  });

  it("giữ nguyên các định danh kỹ thuật BabyJoy không phải copy cho khách", () => {
    expect(messenger).toContain('payload === "BABYJOY_GET_STARTED"');
    expect(messenger).toContain("BABYJOY_CONFIRM_CART:");
    expect(cartShare).toContain("babyjoy-share-v1:");
    expect(cartShare).toContain("storeDisplayName");
    expect(messenger).toContain("storeDisplayName");
  });
});

describe("animated Messenger guide", () => {
  it("khai báo đủ các bước tương tác trong phần minh họa hiện hữu", () => {
    expect(guide).toContain('data-animation="finger-touch-long-press-paste-send"');
    for (const step of [
      "finger-touch-long-press",
      "paste-menu",
      "paste-ping",
      "input",
      "touch-pulse",
      "send",
    ])
      expect(guide).toContain(`data-animation-step="${step}"`);
    expect(guide).toContain("messenger-input-copy-populated");
    expect(guide).toContain("🛒 Chi tiết giỏ hàng của bạn...");
    expect(guide).not.toContain("setTimeout");
  });

  it("có keyframes cho loop, check bounce mobile và reduced motion", () => {
    for (const animation of [
      "messenger-finger-sequence",
      "messenger-touch-pulse",
      "messenger-paste-menu",
      "messenger-paste-ping",
      "messenger-input-populated",
      "messenger-send-state",
      "messenger-sent-bubble",
      "messenger-success-check-bounce",
    ])
      expect(css).toContain(`@keyframes ${animation}`);
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
    expect(css).toContain(".cart-guide-check.copied");
    expect(css).toContain(".messenger-paste-tip{opacity:1;transform:translateX(-50%)}");
  });
});
