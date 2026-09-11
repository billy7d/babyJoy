import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, request } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const outputDir = new URL("../screenshots/actual/", import.meta.url);
const fixtureName = "E2E Cart Summary Promotion";
const fixtureDescription = "E2E cart summary visual fixture.";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const api = await request.newContext({ extraHTTPHeaders: { accept: "application/json" } });

async function jsonRequest(method, path, data) {
  const response = await api.fetch(baseUrl + path, {
    method,
    headers: data === undefined ? undefined : { "content-type": "application/json" },
    data,
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok()) {
    throw new Error(
      `${method} ${path} trả HTTP ${response.status()}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function cleanupStalePromotions() {
  const result = await jsonRequest(
    "GET",
    `/api/admin/promotions?status=ACTIVE&q=${encodeURIComponent(fixtureName)}`,
  );
  for (const promotion of result.data ?? []) {
    if (
      promotion.name === fixtureName &&
      promotion.description === fixtureDescription
    ) {
      await jsonRequest("DELETE", `/api/admin/promotions/${promotion.id}`);
    }
  }
}

async function inspectSummary(page) {
  return page.evaluate(() => {
    const numericFontSize = (selector) => {
      const element = document.querySelector(selector);
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0;
    };
    const valueDigits = (selector) =>
      document.querySelector(selector)?.textContent?.replace(/\D/g, "") ?? "";
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        centerY: rect.top + rect.height / 2,
      };
    };
    const display = (selector) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).display : "missing";
    };
    return {
      subtotalSize: numericFontSize(".cart-summary .subtotal .price"),
      promotionSize: numericFontSize(".cart-summary .promotion-total-row > b"),
      totalSize: numericFontSize(".cart-summary .cart-final-total .price"),
      subtotalDigits: valueDigits(".cart-summary .subtotal .price"),
      promotionDigits: valueDigits(".cart-summary .promotion-total-row > b"),
      totalDigits: valueDigits(".cart-summary .cart-final-total .price"),
      rowDisplay: display(".cart-summary .promotion-total-row"),
      breakdownHeadingDisplay: display(".cart-summary .promotion-breakdown > b"),
      breakdownAmountDisplay: display(".cart-summary .promotion-breakdown p > strong"),
      label: box(".cart-summary .promotion-total-row > span"),
      promotionName: box(".cart-summary .promotion-breakdown p > span"),
      amount: box(".cart-summary .promotion-total-row > b"),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      text: document.querySelector(".cart-summary")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  });
}

await mkdir(outputDir, { recursive: true });
await cleanupStalePromotions();

const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const productBody = await jsonRequest("POST", "/api/admin/products", {
  name: "Bánh ăn dặm E2E Cart Summary",
  slug: `e2e-cart-summary-${suffix}`,
  status: "AVAILABLE",
  featured: false,
  sortOrder: -998,
  categoryIds: [],
  tagIds: [],
  images: [],
  variants: [
    {
      clientId: `e2e-cart-summary-variant-${suffix}`,
      name: "6M_Dâu chuối",
      sku: `E2E-CART-SUMMARY-${suffix}`,
      priceVnd: 55000,
      compareAtPriceVnd: null,
      availability: "AVAILABLE",
      trackInventory: true,
      stockOnHand: 99,
      sortOrder: 0,
    },
  ],
});
const productId = productBody.id;
const variantId = productBody.product.variants[0].id;

const promotionBody = await jsonRequest("POST", "/api/admin/promotions", {
  name: fixtureName,
  description: fixtureDescription,
  type: "ORDER_FIXED_DISCOUNT",
  status: "ACTIVE",
  priority: 9999,
  stackable: false,
  config: {
    type: "ORDER_FIXED_DISCOUNT",
    minimumSubtotal: 1,
    discountAmount: 55000,
  },
});
const promotionId = promotionBody.id;

await jsonRequest("PUT", "/api/admin/settings/seller", {
  displayName: "Đồ ăn dặm UK 🍼Trà Phương🍼",
  label: "Shop",
  messengerUrl: "https://m.me/babyjoy-e2e",
  avatarKey: "",
});

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
    : {}),
});

try {
  for (const viewport of [
    { width: 1536, height: 1024, file: "cart-summary-review-1536.png" },
    { width: 390, height: 844, file: "cart-summary-review-390.png" },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      locale: "vi-VN",
    });
    await context.addInitScript(
      ({ id }) => {
        localStorage.setItem(
          "babyjoy.cart.v1",
          JSON.stringify({ items: [{ variantId: id, quantity: 10 }] }),
        );
        sessionStorage.removeItem("babyjoy.preparedCartShare.v1");
        localStorage.removeItem("babyjoy.cartShareSubmission.v1");
      },
      { id: variantId },
    );
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/cart`, { waitUntil: "domcontentloaded" });
      await page.locator(".cart-item").first().waitFor({ state: "visible", timeout: 10000 });
      await page.locator(".promotion-total-row").waitFor({ state: "attached", timeout: 10000 });
      await page.waitForFunction(
        (name) => document.querySelector(".promotion-breakdown")?.textContent?.includes(name),
        fixtureName,
        { timeout: 10000 },
      );
      await page.evaluate(() => document.fonts.ready).catch(() => undefined);
      await page.waitForTimeout(250);

      const metrics = await inspectSummary(page);
      await page.screenshot({
        path: fileURLToPath(new URL(viewport.file, outputDir)),
        fullPage: true,
      });

      assert(!metrics.overflow, `Cart summary ${viewport.width}px bị tràn ngang`);
      assert(
        metrics.totalSize > metrics.subtotalSize &&
          metrics.subtotalSize > metrics.promotionSize,
        `Sai hierarchy font ${viewport.width}px: total=${metrics.totalSize}, subtotal=${metrics.subtotalSize}, promotion=${metrics.promotionSize}`,
      );
      assert(metrics.rowDisplay === "contents", `Promotion row ${viewport.width}px chưa hợp nhất bằng grid`);
      assert(metrics.breakdownHeadingDisplay === "none", `Còn label Ưu đãi đang áp dụng ở ${viewport.width}px`);
      assert(metrics.breakdownAmountDisplay === "none", `Còn amount promotion lặp ở breakdown ${viewport.width}px`);
      assert(metrics.label && metrics.promotionName && metrics.amount, `Thiếu phần tử promotion row ở ${viewport.width}px`);
      assert(
        metrics.promotionName.left >= metrics.label.right - 1 &&
          metrics.promotionName.right <= metrics.amount.left + 1,
        `Tên promotion chưa nằm giữa label và amount ở ${viewport.width}px`,
      );
      assert(
        Math.abs(metrics.promotionName.centerY - metrics.label.centerY) < 24 &&
          Math.abs(metrics.amount.centerY - metrics.label.centerY) < 24,
        `Promotion chưa cùng hàng trực quan ở ${viewport.width}px`,
      );
      assert(metrics.subtotalDigits === "550000", `Sai tạm tính ở ${viewport.width}px: ${metrics.subtotalDigits}`);
      assert(metrics.promotionDigits === "55000", `Sai khuyến mãi ở ${viewport.width}px: ${metrics.promotionDigits}`);
      assert(metrics.totalDigits === "495000", `Sai tổng ở ${viewport.width}px: ${metrics.totalDigits}`);
      assert(metrics.text.includes(fixtureName), `Thiếu tên promotion ở ${viewport.width}px`);
    } finally {
      await context.close();
    }
  }

  console.log(
    `CART_SUMMARY_E2E_OK product=${productId} promotion=${promotionId} desktop=1536 mobile=390 hierarchy=pass merged-row=pass`,
  );
} finally {
  await browser.close();
  await api.dispose();
}
