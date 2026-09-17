import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchSelectedBrowser, selectedBrowserName } from "./playwright-browser.mjs";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const outputDir = new URL("../screenshots/actual/", import.meta.url);
await mkdir(outputDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await launchSelectedBrowser();
try {
  for (const [width, height, screenshotName] of [
    [320, 900, `hero-${selectedBrowserName}-320.png`],
    [390, 844, `hero-${selectedBrowserName}-mobile.png`],
    [768, 768, `hero-${selectedBrowserName}-tablet.png`],
    [1440, 900, `hero-${selectedBrowserName}-desktop.png`],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "vi-VN" });
    const page = await context.newPage();
    try {
      const response = await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      assert(response && response.status() < 500, `Home trả về HTTP lỗi ở viewport ${width}`);
      const hero = page.locator(".hero");
      assert(await hero.count() === 1, "Home không render đúng Hero");
      assert(await hero.locator(".tag, h1, .hero-desktop-copy, .hero-mobile-copy").count() === 0, "Hero còn phần tử nội dung đã yêu cầu xoá");
      const ctas = hero.locator(".hero-ctas a");
      assert(await ctas.count() === 2, "Hero phải chỉ có hai CTA");
      const hrefs = await ctas.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      assert(JSON.stringify(hrefs) === JSON.stringify(["/shop", "/categories"]), `Hero CTA đổi đường dẫn: ${hrefs.join(", ")}`);
      const metrics = await page.evaluate(() => {
        const root = document.querySelector(".hero");
        const image = root?.querySelector("img");
        const ctaGroup = root?.querySelector(".hero-ctas");
        const heroRect = root?.getBoundingClientRect();
        const ctaRect = ctaGroup?.getBoundingClientRect();
        return {
          imageLoaded: Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
          source: image?.currentSrc ?? "",
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          ctaInsideHero: Boolean(heroRect && ctaRect && ctaRect.left >= heroRect.left && ctaRect.right <= heroRect.right && ctaRect.bottom <= heroRect.bottom),
          ctaWidth: ctaRect?.width ?? 0,
        };
      });
      assert(metrics.imageLoaded, `Hero image chưa tải ở viewport ${width}`);
      const expectedAsset = width <= 639 ? "hero-mobile.jpg" : "hero-desktop.jpg";
      assert(metrics.source.endsWith(expectedAsset), `Hero dùng sai asset ở viewport ${width}: ${metrics.source}`);
      assert(!metrics.overflow, `Hero gây tràn ngang ở viewport ${width}`);
      assert(metrics.ctaInsideHero && metrics.ctaWidth > 0, `CTA nằm ngoài Hero ở viewport ${width}`);
      await hero.screenshot({ path: fileURLToPath(new URL(screenshotName, outputDir)) });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`HERO_E2E_OK browser=${selectedBrowserName} responsive=320,390,768,1440 ctas=2 links=/shop,/categories image-loading=pass screenshots=pass`);
