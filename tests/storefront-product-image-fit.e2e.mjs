import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const outputDir = new URL("../screenshots/actual/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
    : {}),
});
const context = await browser.newContext({ locale: "vi-VN", deviceScaleFactor: 1 });
const page = await context.newPage();

function edgeFixture(width, height, label, color) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="#ffffff"/>
      <rect x="2" y="2" width="${width - 4}" height="${height - 4}" fill="none" stroke="${color}" stroke-width="4"/>
      <text x="${width / 2}" y="${Math.max(36, height * 0.2)}" text-anchor="middle" font-family="Arial" font-size="${Math.max(24, Math.min(width, height) * 0.08)}" font-weight="700" fill="${color}">TOP EDGE</text>
      <text x="${width / 2}" y="${height / 2 + 12}" text-anchor="middle" font-family="Arial" font-size="${Math.max(24, Math.min(width, height) * 0.08)}" font-weight="700" fill="#333333">${label}</text>
      <text x="${width / 2}" y="${height - Math.max(24, height * 0.12)}" text-anchor="middle" font-family="Arial" font-size="${Math.max(24, Math.min(width, height) * 0.08)}" font-weight="700" fill="${color}">BOTTOM EDGE</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const fixtures = [
  edgeFixture(1000, 1000, "SQUARE", "#c0392b"),
  edgeFixture(800, 1200, "PORTRAIT", "#1769aa"),
  edgeFixture(1200, 800, "LANDSCAPE", "#2e8b57"),
];

async function waitForImages(selector) {
  await page.waitForFunction(
    (target) =>
      [...document.querySelectorAll(target)].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    selector,
  );
}

async function useFixtures(selector) {
  await page.evaluate(
    ({ target, sources }) => {
      [...document.querySelectorAll(target)].forEach((image, index) => {
        image.removeAttribute("srcset");
        image.removeAttribute("sizes");
        image.classList.remove("product-image-placeholder");
        image.src = sources[index % sources.length];
      });
    },
    { target: selector, sources: fixtures },
  );
  await waitForImages(selector);
}

async function useFixture(selector, source) {
  await page.locator(selector).first().evaluate((image, fixture) => {
    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    image.classList.remove("product-image-placeholder");
    image.src = fixture;
  }, source);
  await waitForImages(selector);
}

async function assertContainContract(selector, surface, expectedSize = null) {
  const metrics = await page.locator(selector).first().evaluate((image) => {
    const style = getComputedStyle(image);
    const parent = image.parentElement?.classList.contains("product-image")
      ? image.parentElement.getBoundingClientRect()
      : null;
    const rect = image.getBoundingClientRect();
    return {
      objectFit: style.objectFit,
      objectPosition: style.objectPosition,
      paddingTop: Number.parseFloat(style.paddingTop),
      paddingRight: Number.parseFloat(style.paddingRight),
      paddingBottom: Number.parseFloat(style.paddingBottom),
      paddingLeft: Number.parseFloat(style.paddingLeft),
      transform: style.transform,
      width: rect.width,
      height: rect.height,
      parentWidth: parent?.width ?? 0,
      parentHeight: parent?.height ?? 0,
    };
  });
  if (metrics.objectFit !== "contain")
    throw new Error(`${surface} không dùng object-fit contain`);
  if (!/50% 50%|center/.test(metrics.objectPosition))
    throw new Error(`${surface} không căn giữa: ${metrics.objectPosition}`);
  if (![metrics.paddingTop, metrics.paddingRight, metrics.paddingBottom, metrics.paddingLeft].every((value) => value > 0))
    throw new Error(`${surface} thiếu safe inset`);
  if (metrics.transform !== "none")
    throw new Error(`${surface} vẫn bị transform khi hover: ${metrics.transform}`);
  if (expectedSize !== null && (Math.abs(metrics.width - expectedSize) > 1 || Math.abs(metrics.height - expectedSize) > 1))
    throw new Error(`${surface} sai kích thước thumbnail: ${JSON.stringify(metrics)}`);
  if (metrics.parentWidth > 0 && (Math.abs(metrics.width - metrics.parentWidth) > 1 || Math.abs(metrics.height - metrics.parentHeight) > 1))
    throw new Error(`${surface} làm đổi kích thước media box: ${JSON.stringify(metrics)}`);
}

async function open(path, selector) {
  const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  if (!response || response.status() >= 500) throw new Error(`Không mở được ${path}`);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.locator(selector).first().waitFor({ state: "visible" });
  await page.waitForTimeout(250);
}

async function captureLegacyAndCurrent(selector, beforeName, afterName) {
  const legacyStyle = await page.addStyleTag({
    content: `${selector}.storefront-product-media { padding: 0 !important; object-fit: cover !important; }`,
  });
  await page.screenshot({ path: fileURLToPath(new URL(beforeName, outputDir)), fullPage: true });
  await legacyStyle.evaluate((node) => node.remove());
  await page.waitForTimeout(100);
  await page.screenshot({ path: fileURLToPath(new URL(afterName, outputDir)), fullPage: true });
}

try {
  const cardWidths = [320, 360, 375, 390, 414, 430, 768, 1023, 1024, 1280, 1440];
  let detailHref = "";
  for (const width of cardWidths) {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
    await open("/shop", ".product-card");
    const firstLink = page.locator(".product-card a.product-image").first();
    detailHref = detailHref || (await firstLink.getAttribute("href")) || "";
    const cardOverflowBefore = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await useFixtures(".product-image > img");
    await assertContainContract(".product-image > img.storefront-product-media", `ProductCard ${width}px`);
    await page.locator(".product-card").first().hover();
    await assertContainContract(".product-image > img.storefront-product-media", `ProductCard hover ${width}px`);
    const cardOverflowAfter = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (cardOverflowAfter !== cardOverflowBefore) throw new Error(`ProductCard thay đổi overflow ở ${width}px`);
    if (width === 390 || width === 1440) {
      await captureLegacyAndCurrent(
        ".product-image > img",
        `storefront-product-card-before-${width}.png`,
        `storefront-product-card-after-${width}.png`,
      );
    }
  }

  if (!detailHref) throw new Error("Không tìm thấy link Product Detail từ ProductCard");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(detailHref, ".detail-main-image");
  const detailFit = await page.locator(".detail-main-image").evaluate((image) => {
    const style = getComputedStyle(image);
    return { objectFit: style.objectFit, objectPosition: style.objectPosition };
  });
  if (detailFit.objectFit !== "contain" || !/50% 50%|center/.test(detailFit.objectPosition))
    throw new Error("Product Detail reference behavior đã thay đổi");
  await page.screenshot({
    path: fileURLToPath(new URL("storefront-product-detail-after-1440.png", outputDir)),
    fullPage: true,
  });

  // Thêm một line qua UI thật để kiểm tra Cart không đổi identity hoặc business flow.
  await page.evaluate(() => localStorage.removeItem("babyjoy.cart.v1"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open("/shop", ".product-card");
  await page.evaluate(() => localStorage.removeItem("babyjoy.cart.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".product-card").first().waitFor({ state: "visible" });
  const addButton = page.locator(".product-card .inline-cart-add:not([disabled])").first();
  if (await addButton.count() !== 1) throw new Error("Không có variant khả dụng để kiểm tra Cart");
  await addButton.click();

  const cartWidths = [320, 360, 375, 390, 414, 430, 768, 1023, 1024, 1280, 1440];
  for (const width of cartWidths) {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
    await open("/cart", ".cart-item");
    const cartOverflowBefore = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await useFixtures(".cart-item > img");
    const expectedCartSize = width <= 639 ? 96 : width <= 1023 ? 100 : 150;
    // Một cart line lần lượt nhận đủ ba tỷ lệ để kiểm tra cả contain thực tế, không chỉ CSS string.
    for (const [fixtureIndex, fixture] of fixtures.entries()) {
      await useFixture(".cart-item > img", fixture);
      await assertContainContract(
        ".cart-item > img.storefront-product-media",
        `Cart ${width}px fixture ${fixtureIndex + 1}`,
        expectedCartSize,
      );
    }
    const cartOverflowAfter = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (cartOverflowAfter !== cartOverflowBefore) throw new Error(`Cart thay đổi overflow ở ${width}px`);
    if (width === 390 || width === 1440) {
      await captureLegacyAndCurrent(
        ".cart-item > img",
        `storefront-cart-before-${width}.png`,
        `storefront-cart-after-${width}.png`,
      );
    }
  }

  console.log("STOREFRONT_PRODUCT_IMAGE_FIT_E2E_OK card+cart=square,portrait,landscape viewports=320,360,375,390,414,430,768,1023,1024,1280,1440 screenshots=390,1440");
} finally {
  await page.evaluate(() => localStorage.removeItem("babyjoy.cart.v1")).catch(() => undefined);
  await context.close();
  await browser.close();
}
