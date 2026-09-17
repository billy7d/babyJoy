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
  // Bao phủ đúng sáu viewport nghiệm thu, gồm cả hai breakpoint biên của Hero.
  for (const [width, height, screenshotName] of [
    [320, 900, `hero-${selectedBrowserName}-320.png`],
    [375, 844, `hero-${selectedBrowserName}-375.png`],
    [430, 900, `hero-${selectedBrowserName}-430.png`],
    [768, 768, `hero-${selectedBrowserName}-768.png`],
    [1366, 900, `hero-${selectedBrowserName}-1366.png`],
    [1920, 1080, `hero-${selectedBrowserName}-1920.png`],
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
        const imageRect = image?.getBoundingClientRect();
        const ctaRect = ctaGroup?.getBoundingClientRect();
        const imageStyle = image ? getComputedStyle(image) : null;
        const heroStyle = root ? getComputedStyle(root) : null;
        const naturalRatio = image?.naturalHeight
          ? image.naturalWidth / image.naturalHeight
          : 0;
        const renderedRatio = imageRect?.height
          ? imageRect.width / imageRect.height
          : 0;
        return {
          imageLoaded: Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
          source: image?.currentSrc ?? "",
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          heroOverflow: heroStyle?.overflow ?? "",
          heroBackground: heroStyle?.backgroundColor ?? "",
          imageObjectFit: imageStyle?.objectFit ?? "",
          imageBackgroundSize: imageStyle?.backgroundSize ?? "",
          imageRatioError: Math.abs(renderedRatio - naturalRatio),
          imageFitsHero: Boolean(
            heroRect &&
              imageRect &&
              imageRect.left >= heroRect.left - 1 &&
              imageRect.right <= heroRect.right + 1 &&
              imageRect.top >= heroRect.top - 1 &&
              imageRect.bottom <= heroRect.bottom + 1,
          ),
          imageFillsWidth: Boolean(
            heroRect && imageRect && Math.abs(imageRect.width - heroRect.width) <= 1,
          ),
          shadeCount: root?.querySelectorAll(".hero-shade").length ?? 0,
          ctaInsideHero: Boolean(heroRect && ctaRect && ctaRect.left >= heroRect.left && ctaRect.right <= heroRect.right && ctaRect.bottom <= heroRect.bottom),
          ctaWidth: ctaRect?.width ?? 0,
        };
      });
      assert(metrics.imageLoaded, `Hero image chưa tải ở viewport ${width}`);
      const expectedAsset = width <= 639 ? "hero-mobile.jpg" : "hero-desktop.jpg";
      assert(metrics.source.endsWith(expectedAsset), `Hero dùng sai asset ở viewport ${width}: ${metrics.source}`);
      assert(!metrics.overflow, `Hero gây tràn ngang ở viewport ${width}`);
      assert(metrics.shadeCount === 0, `Hero còn lớp phủ màu ở viewport ${width}`);
      assert(metrics.heroOverflow !== "hidden", `Hero dùng overflow hidden ở viewport ${width}`);
      assert(metrics.heroBackground === "rgb(255, 255, 255)", `Hero không có nền trắng dự phòng ở viewport ${width}`);
      assert(metrics.imageObjectFit !== "cover", `Hero vẫn dùng object-fit cover ở viewport ${width}`);
      assert(metrics.imageBackgroundSize !== "cover", `Hero vẫn dùng background-size cover ở viewport ${width}`);
      assert(metrics.imageRatioError < 0.01, `Hero làm sai tỷ lệ ảnh ở viewport ${width}`);
      assert(metrics.imageFitsHero && metrics.imageFillsWidth, `Hero không hiển thị trọn ảnh ở viewport ${width}`);
      assert(metrics.ctaInsideHero && metrics.ctaWidth > 0, `CTA nằm ngoài Hero ở viewport ${width}`);
      await hero.screenshot({ path: fileURLToPath(new URL(screenshotName, outputDir)) });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`HERO_E2E_OK browser=${selectedBrowserName} responsive=320,375,430,768,1366,1920 ctas=2 links=/shop,/categories image-loading=pass full-image=pass screenshots=pass`);
