import { chromium } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const variantId = "variant-little-120";
const mobileViewports = [
  [320, 568],
  [360, 800],
  [375, 812],
  [390, 844],
  [412, 915],
  [430, 932],
];
const desktopViewports = [
  [768, 900],
  [1024, 900],
  [1280, 900],
  [1440, 900],
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function seedCart(page, quantity = 1) {
  await page.evaluate(
    ({ id, amount }) => {
      localStorage.setItem(
        "babyjoy.cart.v1",
        JSON.stringify({ items: [{ variantId: id, quantity: amount }] }),
      );
      sessionStorage.removeItem("babyjoy.preparedCartShare.v1");
      localStorage.removeItem("babyjoy.cartShareSubmission.v1");
    },
    { id: variantId, amount: quantity },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".cart-item").first().waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".mobile-cart-checkout-dock").waitFor({ state: "attached", timeout: 10000 });
  await page.waitForTimeout(250);
}

async function clearCart(page) {
  await page.goto(`${baseUrl}/cart`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("babyjoy.cart.v1");
    sessionStorage.removeItem("babyjoy.preparedCartShare.v1");
    localStorage.removeItem("babyjoy.cartShareSubmission.v1");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".empty-state").waitFor({ state: "visible", timeout: 10000 });
}

async function inspectCart(page, width) {
  return page.evaluate((viewportWidth) => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const rect = (selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? { width: box.width, height: box.height } : null;
    };
    const dock = document.querySelector(".mobile-cart-checkout-dock");
    const checkoutButton = document.querySelector(".mobile-cart-checkout-dock .btn");
    const mobileSuffix = document.querySelector(".unit-price-suffix");
    const item = document.querySelector(".cart-item");
    const itemBox = item?.getBoundingClientRect();
    return {
      viewportWidth,
      overflow: document.documentElement.scrollWidth > viewportWidth + 1,
      headerHeight: document.querySelector(".public-header")?.getBoundingClientRect().height ?? 0,
      item: itemBox ? { width: itemBox.width, height: itemBox.height } : null,
      image: rect(".cart-item > .storefront-product-media"),
      remove: rect(".cart-item .remove-line"),
      quantity: rect(".cart-item > .quantity-stepper"),
      unitPriceText: document.querySelector(".cart-item .unit-price")?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
      footerVisible: visible(document.querySelector(".mobile-cart-footer")),
      publicFooterVisible: visible(document.querySelector(".public-footer")),
      mobileNavVisible: visible(document.querySelector(".mobile-bottom")),
      dock: dock
        ? {
            visible: visible(dock),
            position: getComputedStyle(dock).position,
            display: getComputedStyle(dock).display,
            bottom: dock.getBoundingClientRect().bottom,
          }
        : null,
      checkoutButtonPosition: checkoutButton ? getComputedStyle(checkoutButton).position : "",
      mobileSuffixDisplay: mobileSuffix ? getComputedStyle(mobileSuffix).display : "",
    };
  }, width);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
    : {}),
});

try {
  for (const [width, height] of mobileViewports) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      locale: "vi-VN",
    });
    const page = await context.newPage();
    try {
      await clearCart(page);
      const emptyText = await page.locator("body").innerText();
      assert(!emptyText.includes("undefined đ"), `Empty cart ${width} có giá undefined`);
      assert(await page.locator(".mobile-cart-checkout-dock").count() === 0, `Empty cart ${width} vẫn có CTA dock`);

      await seedCart(page);
      const metrics = await inspectCart(page, width);
      assert(!metrics.overflow, `Cart ${width} gây horizontal overflow`);
      assert(metrics.headerHeight === 58, `Header cart ${width} không cao 58px`);
      assert(metrics.image?.width === 80 && metrics.image.height === 80, `Ảnh cart ${width} không là 80x80`);
      assert((metrics.remove?.width ?? 0) >= 44 && (metrics.remove?.height ?? 0) >= 44, `Nút Xóa cart ${width} nhỏ`);
      assert((metrics.quantity?.width ?? 0) >= 108 && (metrics.quantity?.height ?? 0) >= 44, `Stepper cart ${width} nhỏ`);
      assert(metrics.unitPriceText.includes("Đơn giá") && metrics.unitPriceText.includes("/ sản phẩm"), `Cart ${width} thiếu đơn giá`);
      assert(metrics.footerVisible, `Cart ${width} thiếu compact footer`);
      assert(!metrics.publicFooterVisible && !metrics.mobileNavVisible, `Cart ${width} lộ footer/nav không mong muốn`);
      assert(metrics.dock?.visible && metrics.dock.position === "fixed", `CTA cart ${width} không fixed`);
      assert(metrics.checkoutButtonPosition === "static", `CTA cart ${width} còn position cũ`);

      await page.locator(".mobile-cart-footer").scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 10000));
      const bottomMetrics = await page.evaluate(() => {
        const dock = document.querySelector(".mobile-cart-checkout-dock")?.getBoundingClientRect();
        const footer = document.querySelector(".mobile-cart-footer")?.getBoundingClientRect();
        return { dockTop: dock?.top ?? 0, footerBottom: footer?.bottom ?? 0 };
      });
      assert(bottomMetrics.footerBottom <= bottomMetrics.dockTop, `Footer cart ${width} bị CTA che khi cuộn cuối trang`);
      await page.locator(".cart-item").scrollIntoViewIfNeeded();

      await page.getByRole("button", { name: "Tăng số lượng" }).click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("babyjoy.cart.v1") ?? "{}").items?.[0]?.quantity === 2);
      assert((await page.locator(".quantity-stepper > span[aria-live=polite]").innerText()) === "2", `Tăng quantity lỗi ở ${width}`);
      await page.getByRole("button", { name: "Giảm số lượng" }).click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("babyjoy.cart.v1") ?? "{}").items?.[0]?.quantity === 1);
      await page.getByRole("button", { name: /Xóa .* khỏi giỏ hàng/ }).click();
      await page.locator(".empty-state").waitFor({ state: "visible", timeout: 10000 });
      assert(await page.locator(".mobile-cart-checkout-dock").count() === 0, `Remove cuối ở ${width} vẫn giữ CTA`);
    } finally {
      await context.close();
    }
  }

  for (const [width, height] of desktopViewports) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      locale: "vi-VN",
    });
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/cart`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => localStorage.removeItem("babyjoy.cart.v1"));
      await seedCart(page);
      const metrics = await inspectCart(page, width);
      assert(!metrics.overflow, `Desktop cart ${width} gây horizontal overflow`);
      assert(!metrics.footerVisible && metrics.publicFooterVisible && !metrics.mobileNavVisible, `Desktop cart ${width} đổi footer/nav`);
      assert(metrics.dock?.display === "contents", `Desktop cart ${width} không giữ wrapper presentation-only`);
      assert(metrics.checkoutButtonPosition === "static", `Desktop CTA ${width} bị fixed`);
      assert(metrics.mobileSuffixDisplay === "none", `Desktop cart ${width} lộ suffix mobile`);
    } finally {
      await context.close();
    }
  }

  console.log("MOBILE_CART_E2E_OK mobile=320,360,375,390,412,430 desktop=768,1024,1280,1440 empty=pass quantity=pass remove=pass scoped=pass");
} finally {
  await browser.close();
}
