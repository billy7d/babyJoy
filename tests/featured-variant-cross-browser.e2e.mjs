import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { launchSelectedBrowser, selectedBrowserName } from "./playwright-browser.mjs";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const outputDir = new URL("../screenshots/actual/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const browser = await launchSelectedBrowser();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "vi-VN",
});
const page = await context.newPage();
const e2eKey = String(Date.now());
const slug = `e2e-featured-cross-browser-${e2eKey}`;
const sourceImage = readFileSync(
  fileURLToPath(new URL("../public/images/product-heinz.jpg", import.meta.url)),
);
const sourceSize = Math.max(3 * 1024 * 1024, sourceImage.length + 1);
const uploadFile = {
  name: `featured-cross-browser-${e2eKey}.jpg`,
  mimeType: "image/jpeg",
  buffer: Buffer.concat([sourceImage, Buffer.alloc(sourceSize - sourceImage.length)]),
};
const storedLimitBytes = Math.floor(1.5 * 1024 * 1024);
let productId = "";
const browserErrors = [];
page.on("pageerror", (error) => {
  // React Router dev HMR may reject its manifest request in WebKit; it is not
  // an application error and does not occur in the production bundle.
  if (!error.message.includes("__manifest") && !error.message.includes("access control checks"))
    browserErrors.push(error.message);
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForCatalogCard() {
  await page.locator(".listing-grid .product-card").first().waitFor({ state: "visible" });
}

async function assertResponsiveFeaturedLayout() {
  for (const width of [320, 375, 390, 430, 768, 1440]) {
    const responsiveContext = await browser.newContext({
      viewport: { width, height: width < 640 ? 844 : 1000 },
      locale: "vi-VN",
    });
    const responsivePage = await responsiveContext.newPage();
    try {
      await responsivePage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
      await responsivePage.locator(".featured:not(.must-try-section) .section-heading > a").waitFor({ state: "visible" });
      await responsivePage.locator(".must-try-section .section-heading > a").waitFor({ state: "visible" });
      const metrics = await responsivePage.evaluate(() => {
        const sections = [...document.querySelectorAll(".featured")];
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          headings: sections.map((section) => {
            const copy = section.querySelector(".section-heading > div")?.getBoundingClientRect();
            const link = section.querySelector(".section-heading > a")?.getBoundingClientRect();
            return copy && link
              ? { sameRow: Math.abs(copy.top - link.top) <= 2, noOverlap: link.left >= copy.right - 1 }
              : null;
          }),
        };
      });
      assert(!metrics.overflow, `Homepage featured layout tràn ngang ở ${width}px`);
      assert(metrics.headings.length === 2 && metrics.headings.every((item) => item?.sameRow && item.noOverlap), `CTA featured không cùng hàng ở ${width}px`);
    } finally {
      await responsiveContext.close();
    }
  }
}

async function assertResponsiveVariantBadges(productSlug) {
  for (const width of [320, 375, 390, 430, 768, 1440]) {
    const responsiveContext = await browser.newContext({
      viewport: { width, height: width < 640 ? 844 : 1000 },
      locale: "vi-VN",
    });
    const responsivePage = await responsiveContext.newPage();
    try {
      await responsivePage.goto(`${baseUrl}/product/${productSlug}`, { waitUntil: "domcontentloaded" });
      await responsivePage.locator(".variant-badge-cluster").first().waitFor({ state: "visible" });
      const metrics = await responsivePage.evaluate(() => {
        const withinViewport = (element) => {
          const box = element.getBoundingClientRect();
          return box.left >= -1 && box.right <= window.innerWidth + 1;
        };
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          optionsWithin: [...document.querySelectorAll(".variant-option")].every(withinViewport),
          buttonsWithin: [...document.querySelectorAll(".variant-option button")].every(withinViewport),
          badgesWithin: [...document.querySelectorAll(".variant-badge-cluster")].every(withinViewport),
          bothBadgeCount: document.querySelectorAll(".variant-option.has-multiple-variant-badges .variant-badge").length,
        };
      });
      assert(!metrics.overflow, `PDP badges tràn ngang ở ${width}px`);
      assert(metrics.optionsWithin && metrics.buttonsWithin && metrics.badgesWithin, `PDP badge/option vượt viewport ở ${width}px`);
      assert(metrics.bothBadgeCount === 2, `PDP mất cụm hai badge ở ${width}px`);
    } finally {
      await responsiveContext.close();
    }
  }
}

try {
  const createResponse = await page.request.post(`${baseUrl}/api/admin/products`, {
    data: {
      name: "E2E Featured Cross Browser",
      slug,
      shortDescription: "Featured collection cross-browser fixture",
      status: "AVAILABLE",
      variants: [
        {
          name: "Socola",
          packageSize: "60g",
          sku: `E2E-FEATURED-BEST-${e2eKey}`,
          priceVnd: 80000,
          status: "SELLING",
          trackInventory: false,
          tagIds: ["tag-best-seller"],
        },
        {
          name: "Táo",
          packageSize: "60g",
          sku: `E2E-FEATURED-MUST-${e2eKey}`,
          priceVnd: 82000,
          status: "SELLING",
          trackInventory: false,
          tagIds: ["tag-must-try"],
        },
        {
          name: "Chuối",
          packageSize: "60g",
          sku: `E2E-FEATURED-NORMAL-${e2eKey}`,
          priceVnd: 84000,
          status: "SELLING",
          trackInventory: false,
          tagIds: [],
        },
        {
          name: "Dâu chuối",
          packageSize: "60g",
          sku: `E2E-FEATURED-BOTH-${e2eKey}`,
          priceVnd: 86000,
          status: "SELLING",
          trackInventory: false,
          tagIds: ["tag-best-seller", "tag-must-try"],
        },
      ],
    },
  });
  assert(createResponse.ok(), `Không tạo được fixture featured: ${createResponse.status()}`);
  const created = await createResponse.json();
  productId = created.id ?? "";
  const createdVariants = created.product?.variants ?? [];
  const bestVariantId = createdVariants.find((variant) => variant.name === "Socola")?.id;
  const mustVariantId = createdVariants.find((variant) => variant.name === "Táo")?.id;
  const bothVariantId = createdVariants.find((variant) => variant.name === "Dâu chuối")?.id;
  assert(productId && bestVariantId && mustVariantId && bothVariantId, "Fixture thiếu variant ID");

  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  const bestCta = page.locator(".featured:not(.must-try-section) .section-heading > a");
  const mustCta = page.locator(".must-try-section .section-heading > a");
  await bestCta.waitFor({ state: "visible" });
  await mustCta.waitFor({ state: "visible" });
  assert(
    (await bestCta.getAttribute("href")) === "/shop?featured=best-seller",
    "Best Seller CTA không dùng canonical URL",
  );
  assert(
    (await mustCta.getAttribute("href")) === "/shop?featured=must-try",
    "Must Try CTA không dùng canonical URL",
  );
  await assertResponsiveFeaturedLayout();

  await bestCta.click();
  await page.waitForURL((url) => url.searchParams.get("featured") === "best-seller");
  await waitForCatalogCard();
  assert(
    (await page.locator(".listing-title h1").innerText()) === "Best Seller",
    "Listing không hiển thị heading Best Seller",
  );
  assert(await page.locator(".listing-grid .product-card").count() === 1, "Best Seller listing có dữ liệu ngoài collection");
  assert(
    (await page.locator(".listing-grid .product-card a").first().getAttribute("href"))?.includes(`variant=${bestVariantId}`),
    "Best Seller card không giữ matched variant",
  );

  await page.goto(`${baseUrl}/shop?featured=must-try`, { waitUntil: "domcontentloaded" });
  await waitForCatalogCard();
  assert(
    (await page.locator(".listing-title h1").innerText()) === "Must Try",
    "Listing không hiển thị heading Must Try",
  );
  assert(await page.locator(".listing-grid .product-card").count() === 1, "Must Try listing có dữ liệu ngoài collection");
  assert(
    (await page.locator(".listing-grid .product-card a").first().getAttribute("href"))?.includes(`variant=${mustVariantId}`),
    "Must Try card không giữ matched variant",
  );

  await page.goto(`${baseUrl}/product/${slug}?variant=${bestVariantId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".variant-badge-cluster").first().waitFor({ state: "visible" });
  assert(await page.locator(".variant-option").count() === 4, "PDP thiếu variant fixture");
  assert(await page.locator(".variant-badge-best-seller").count() === 2, "PDP thiếu badge Best Seller trên variant");
  assert(await page.locator(".variant-badge-must-try").count() === 2, "PDP thiếu badge Must Try trên variant");
  const bestButton = page.getByRole("button", { name: "Socola · 60g, BEST SELLER", exact: true });
  const mustButton = page.getByRole("button", { name: "Táo · 60g, MUST TRY", exact: true });
  const normalButton = page.getByRole("button", { name: "Chuối · 60g", exact: true });
  const bothButton = page.getByRole("button", { name: "Dâu chuối · 60g, BEST SELLER, MUST TRY", exact: true });
  assert(await bestButton.count() === 1, "Variant Best Seller không có accessible label đúng");
  assert(await mustButton.count() === 1, "Variant Must Try không có accessible label đúng");
  assert(await normalButton.count() === 1, "Variant bình thường bị thay đổi label");
  assert(await bothButton.count() === 1, "Variant both không có đủ status trong accessible label");
  await assertResponsiveVariantBadges(slug);
  assert(await bestButton.getAttribute("aria-pressed") === "true", "Deep-link không active đúng variant");
  const badgeBox = await page.locator(".variant-badge-cluster").first().boundingBox();
  if (badgeBox) await page.mouse.click(badgeBox.x + badgeBox.width / 2, badgeBox.y + badgeBox.height / 2);
  assert(await bestButton.getAttribute("aria-pressed") === "true", "Click vùng badge làm mất selected variant");
  await mustButton.click();
  assert(await mustButton.getAttribute("aria-pressed") === "true", "Không đổi được variant sau khi badge render");
  assert(await page.locator(".variant-badge-cluster").count() === 3, "Badge cluster không độc lập với active state");
  await page.goto(`${baseUrl}/product/${slug}?variant=${mustVariantId}`, { waitUntil: "domcontentloaded" });
  const deepLinkedMustButton = page.getByRole("button", { name: "Táo · 60g, MUST TRY", exact: true });
  await deepLinkedMustButton.waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".variant-buttons button")].some(
      (button) =>
        button.getAttribute("aria-label") === "Táo · 60g, MUST TRY" &&
        button.getAttribute("aria-pressed") === "true",
    ),
  );
  assert(
    await deepLinkedMustButton.getAttribute("aria-pressed") === "true",
    "Deep-link không active đúng Must Try variant",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const refreshedMustButton = page.getByRole("button", { name: "Táo · 60g, MUST TRY", exact: true });
  await refreshedMustButton.waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".variant-buttons button")].some(
      (button) =>
        button.getAttribute("aria-label") === "Táo · 60g, MUST TRY" &&
        button.getAttribute("aria-pressed") === "true",
    ),
  );
  assert(
    await refreshedMustButton.getAttribute("aria-pressed") === "true",
    "Refresh PDP không giữ selected variant",
  );

  await page.goto(`${baseUrl}/admin/products/${productId}/edit`, { waitUntil: "domcontentloaded" });
  await page.locator(".variant-card").first().getByRole("button", { name: "Sửa" }).click();
  const uploadRequests = [];
  const uploadResponses = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/admin/images"))
      uploadRequests.push(request);
  });
  page.on("response", (response) => {
    if (response.request().method() === "POST" && response.url().endsWith("/api/admin/images"))
      uploadResponses.push(response);
  });
  const uploadInput = page.locator(".variant-card").first().locator(".variant-image-add input");
  await uploadInput.setInputFiles(uploadFile);
  await page.locator(".variant-card").first().locator(".variant-image-tile").first().waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".variant-image-add input")?.disabled);
  assert(uploadRequests.length === 1, "Variant upload không tạo đúng một request");
  assert(uploadResponses.length === 1 && uploadResponses[0].status() === 201, "Variant upload không trả 201");
  const uploadedBytes = uploadRequests[0].postDataBuffer()?.length ?? 0;
  if (uploadedBytes > 0)
    assert(uploadedBytes <= storedLimitBytes, `Upload gửi blob vượt hard cap: ${uploadedBytes}`);
  const updateResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "PUT" && response.url().endsWith(`/api/admin/products/${productId}`),
  );
  await page.getByRole("button", { name: "LƯU SẢN PHẨM" }).click();
  const updateResponse = await updateResponsePromise;
  assert(updateResponse.ok(), "Không lưu được ảnh variant sau cross-browser upload");
  const savedResponse = await page.request.get(`${baseUrl}/api/admin/products/${productId}`);
  const saved = await savedResponse.json();
  const savedBest = saved.data?.variants?.find((variant) => variant.id === bestVariantId);
  assert(savedBest?.images?.length === 1, "Ảnh variant không persist sau upload");

  await page.screenshot({
    path: fileURLToPath(new URL(`featured-cross-browser-${selectedBrowserName}.png`, outputDir)),
    fullPage: true,
  });
  assert(browserErrors.length === 0, `Browser error mới: ${browserErrors.join(" | ")}`);
  console.log(`FEATURED_CROSS_BROWSER_E2E_OK browser=${selectedBrowserName} cta=pass listing=pass badges=pass upload=pass`);
} finally {
  if (productId)
    await page.request.delete(`${baseUrl}/api/admin/products/${productId}`).catch(() => undefined);
  await context.close();
  await browser.close();
}
