import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "file:///C:/Users/billy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const baseUrl = "http://127.0.0.1:5173";
const outputDir = new URL("../screenshots/actual/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });

async function openPage(path, viewport, fileName) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "vi-VN" });
  const page = await context.newPage();
  const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  // Chờ catalog/admin API hoàn tất trước khi chụp ảnh nghiệm thu.
  await page.waitForTimeout(600);
  await page.screenshot({ path: fileURLToPath(new URL(fileName, outputDir)), fullPage: true });
  const body = await page.locator("body").innerText();
  if (!response || response.status() >= 500 || body.trim().length < 20 || /Oops|unexpected error|Đã có lỗi máy chủ/.test(body)) throw new Error(`Trang ${path} hiển thị lỗi hoặc trống`);
  await context.close();
}

const visualRoutes = [
  ["/", "home"], ["/shop", "shop"], ["/product/little-sprouts-ca-rot-tao-huu-co", "product"],
  ["/cart", "cart"], ["/cart/submit", "submit"], ["/cart/success/GH-260825-X7K2", "success"],
];

for (const [path, name] of visualRoutes) {
  await openPage(path, { width: 1440, height: 1000 }, `${name}-desktop.png`);
  await openPage(path, { width: 390, height: 844 }, `${name}-mobile.png`);
}

await openPage("/", { width: 768, height: 1024 }, "home-tablet.png");
await openPage("/shop", { width: 1024, height: 768 }, "shop-1024.png");
await openPage("/admin/products", { width: 1440, height: 1000 }, "admin-products.png");
await openPage("/admin/products/new", { width: 1440, height: 1000 }, "admin-product-new.png");
await openPage("/admin/cart-requests", { width: 1440, height: 1000 }, "admin-cart-requests.png");
await openPage("/admin/cart-requests/request-canonical", { width: 1440, height: 1000 }, "admin-cart-request-detail.png");

const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "vi-VN" });
const page = await context.newPage();
await page.goto(`${baseUrl}/product/little-sprouts-ca-rot-tao-huu-co`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle");
await page.getByRole("button", { name: /THÊM VÀO GIỎ/ }).last().click();
await page.waitForFunction(() => localStorage.getItem("babyjoy.cart.v1")?.includes("variant-little-120"));
await page.goto(`${baseUrl}/cart`, { waitUntil: "domcontentloaded" });
const cartText = await page.locator("body").innerText();
if (!cartText.includes("367.000") && !cartText.includes("456.000")) throw new Error("Cart không hiển thị tạm tính sau add");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(100);
if (!(await page.locator("body").innerText()).includes("Little Sprouts")) throw new Error("Cart không tồn tại sau refresh");
await page.goto(`${baseUrl}/shop?category=bot-an-dam&sort=price_asc`, { waitUntil: "domcontentloaded" });
if (!(await page.locator("body").innerText()).includes("Bột ăn dặm")) throw new Error("URL filter không hoạt động");
await context.close();

await browser.close();
console.log(`E2E_OK routes=${visualRoutes.length * 2 + 6} viewports=390,768,1024,1440 cart-persistence=pass filter-url=pass`);
