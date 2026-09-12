import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const screenshotDir = new URL("../screenshots/actual/", import.meta.url);
const variantId = "e2e-promotion-variant";
const productName = "Bánh ăn dặm Heinz Farley's Rusks Original dành cho bé từ 6 tháng 120g";
const mobileViewports = [320, 360, 375, 390, 414, 430];
const desktopViewports = [768, 1024, 1280, 1440];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function evaluationPayload() {
  return {
    success: true,
    subtotalVnd: 89000,
    discountTotalVnd: 50000,
    finalTotalVnd: 39000,
    totalQuantity: 1,
    items: [{
      productId: "e2e-promotion-product",
      variantId,
      productName,
      variantName: "Hộp 120g",
      sku: "E2E-PROMO-120",
      imageKey: null,
      priceVnd: 89000,
      quantity: 1,
      originalLineTotalVnd: 89000,
      discountAmountVnd: 50000,
      lineTotalVnd: 39000,
    }],
    gifts: [],
    appliedPromotions: [
      {
        promotionId: "free-shipping",
        promotionName: "Ưu đãi giao hàng cho mẹ",
        type: "FREE_SHIPPING",
        discountAmountVnd: 0,
        giftUnavailable: false,
      },
      {
        promotionId: "percentage-discount",
        promotionName: "MUA 5 GIẢM 10%",
        type: "ORDER_PERCENTAGE_DISCOUNT",
        discountAmountVnd: 50000,
        giftUnavailable: false,
      },
    ],
    progress: [
      {
        promotionId: "progress-product",
        promotionName: "Đủ số lượng sản phẩm",
        type: "QUANTITY_DISCOUNT",
        priority: 50,
        remainingQuantity: 2,
        nextReward: "Miễn phí vận chuyển",
        message: `Bạn cần mua thêm 2 sản phẩm ${productName} để áp dụng ưu đãi Miễn phí vận chuyển.`,
      },
      {
        promotionId: "progress-category",
        promotionName: "Đủ số lượng danh mục",
        type: "QUANTITY_DISCOUNT",
        priority: 40,
        remainingQuantity: 5,
        nextReward: "Miễn phí vận chuyển",
        message: "Bạn cần mua thêm 5 sản phẩm Bột ăn dặm để áp dụng ưu đãi Miễn phí vận chuyển.",
      },
      ...Array.from({ length: 3 }, (_, index) => ({
        promotionId: `progress-extra-${index}`,
        promotionName: `Ưu đãi ${index + 3}`,
        type: "ORDER_FIXED_DISCOUNT",
        priority: 30 - index,
        remainingAmountVnd: 100000 + index * 10000,
        nextReward: "giảm 20.000 ₫",
        message: `Bạn cần mua thêm ${index + 3} sản phẩm để áp dụng ưu đãi ${index + 3}.`,
      })),
    ],
  };
}

async function createPage(width) {
  const context = await browser.newContext({
    viewport: { width, height: width <= 430 ? 900 : 1000 },
    deviceScaleFactor: 1,
    locale: "vi-VN",
  });
  const page = await context.newPage();
  let evaluationCalls = 0;
  const catalogProduct = {
    id: "e2e-promotion-product",
    slug: "e2e-promotion-product",
    name: productName,
    brand: "Heinz",
    shortDescription: "",
    description: "",
    status: "AVAILABLE",
    featured: false,
    categorySlugs: [],
    categoryIds: [],
    tagNames: [],
    tagSlugs: [],
    variants: [{
      id: variantId,
      name: "Hộp 120g",
      sku: "E2E-PROMO-120",
      priceVnd: 89000,
      availability: "AVAILABLE",
    }],
    images: [],
  };
  await page.route("**/api/products*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [catalogProduct] }) }),
  );
  await page.route("**/api/categories", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
  );
  await page.route("**/api/brands", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
  );
  await page.route("**/api/tags", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [], tagGroupsSupported: false }) }),
  );
  await page.route("**/api/store-settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { displayName: "BabyJoy", contactEmail: "hello@babyjoy.vn", contactPhone: "1900 123 456" } }),
    }),
  );
  await page.route("**/api/checkout-config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mode: "DIRECT_SELLER_SHARE", enabled: false, seller: null, reservationMinutes: 15, messengerCheckoutEnabled: false }),
    }),
  );
  await page.route("**/api/cart/evaluate", async (route) => {
    evaluationCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(evaluationPayload()) });
  });
  await page.addInitScript((id) => {
    localStorage.setItem("babyjoy.cart.v1", JSON.stringify({ items: [{ variantId: id, quantity: 1 }] }));
    sessionStorage.clear();
  }, variantId);
  await page.goto(`${baseUrl}/cart`, { waitUntil: "domcontentloaded" });
  await page.locator(".promotion-progress-item").first().waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".promotion-breakdown-row").first().waitFor({ state: "visible", timeout: 10000 });
  return { context, page, getEvaluationCalls: () => evaluationCalls };
}

async function inspect(page, width) {
  return page.evaluate((viewportWidth) => {
    const group = document.querySelector(".promotion-progress-group");
    const allItems = [...(group?.querySelectorAll(".promotion-progress-item") ?? [])];
    const visibleItems = allItems.filter((item) => getComputedStyle(item).display !== "none");
    const firstItem = visibleItems[0];
    const icon = firstItem?.querySelector(".material-symbols-outlined")?.getBoundingClientRect();
    const text = firstItem?.querySelector("p")?.getBoundingClientRect();
    const freeRow = document.querySelector(".promotion-breakdown-row");
    return {
      overflow: document.documentElement.scrollWidth > viewportWidth + 1,
      allItems: allItems.length,
      visibleItems: visibleItems.length,
      groupWidth: group?.getBoundingClientRect().width ?? 0,
      freeName: freeRow?.querySelector(".promotion-breakdown-name")?.textContent?.trim() ?? "",
      freeValue: freeRow?.querySelector(".promotion-breakdown-value")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      firstMessage: firstItem?.querySelector("p")?.textContent ?? "",
      iconTop: icon?.top ?? 0,
      textTop: text?.top ?? 0,
      whiteSpace: firstItem ? getComputedStyle(firstItem.querySelector("p")).whiteSpace : "",
      textOverflow: firstItem ? getComputedStyle(firstItem.querySelector("p")).textOverflow : "",
      summary: document.querySelector(".cart-summary")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  }, width);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}),
});
await mkdir(screenshotDir, { recursive: true });

try {
  for (const width of [...mobileViewports, ...desktopViewports]) {
    const { context, page, getEvaluationCalls } = await createPage(width);
    try {
      const metrics = await inspect(page, width);
      const mobile = width <= 430;
      const expectedVisible = mobile ? 2 : 3;
      assert(!metrics.overflow, `Cart promotion ${width} gây horizontal overflow`);
      assert(metrics.allItems === 5, `Cart promotion ${width} mất progress từ API`);
      assert(metrics.visibleItems === expectedVisible, `Cart promotion ${width} hiển thị ${metrics.visibleItems}, cần ${expectedVisible}`);
      assert(metrics.groupWidth <= width, `Promotion group ${width} rộng hơn viewport`);
      assert(metrics.firstMessage.includes(productName), `Cart promotion ${width} truncate product name`);
      assert(metrics.whiteSpace !== "nowrap" && metrics.textOverflow !== "ellipsis", `Cart promotion ${width} ép text truncate`);
      assert(metrics.iconTop <= metrics.textTop + 4, `Icon promotion ${width} không căn theo dòng đầu`);
      assert(metrics.freeName === "Ưu đãi giao hàng cho mẹ", `FREE SHIPPING ${width} duplicate benefit ở cột trái`);
      assert(metrics.freeValue.includes("Miễn phí vận chuyển") && metrics.freeValue.includes("- Free Shipping"), `FREE SHIPPING ${width} thiếu benefit ở cột phải`);
      assert(metrics.summary.includes("39.000"), `Cart promotion ${width} đổi total ngoài promotion response`);

      const toggle = page.locator(".promotion-progress-toggle");
      assert(await toggle.count() === 1, `Cart promotion ${width} thiếu toggle`);
      const captureVisual = [320, 430, 1440].includes(width);
      if (captureVisual)
        await page.screenshot({
          path: fileURLToPath(new URL(`cart-promotions-${width}-collapsed.png`, screenshotDir)),
          fullPage: true,
        });
      const initialCalls = getEvaluationCalls();
      await toggle.click();
      assert(getEvaluationCalls() === initialCalls, `Expand promotion ${width} gọi lại API`);
      assert(await page.locator(".promotion-progress-item:visible").count() === 5, `Expand promotion ${width} không hiện đủ row`);
      assert((await toggle.innerText()).includes("Thu gọn"), `Expand promotion ${width} chưa đổi label`);
      assert(await toggle.getAttribute("aria-expanded") === "true", `Expand promotion ${width} thiếu aria-expanded=true`);
      if (captureVisual)
        await page.screenshot({
          path: fileURLToPath(new URL(`cart-promotions-${width}-expanded.png`, screenshotDir)),
          fullPage: true,
        });
      await toggle.click();
      assert(getEvaluationCalls() === initialCalls, `Collapse promotion ${width} gọi lại API`);
      assert(await page.locator(".promotion-progress-item:visible").count() === expectedVisible, `Collapse promotion ${width} sai số row`);
      assert(await toggle.getAttribute("aria-expanded") === "false", `Collapse promotion ${width} thiếu aria-expanded=false`);
    } finally {
      await context.close();
    }
  }
  console.log("CART_PROMOTIONS_E2E_OK viewports=320,360,375,390,414,430,768,1024,1280,1440 grouped=pass toggle=pass no-api-on-toggle=pass free-shipping-columns=pass overflow=pass");
} finally {
  await browser.close();
}
