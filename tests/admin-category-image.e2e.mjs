import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchSelectedBrowser, selectedBrowserName } from "./playwright-browser.mjs";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const baseHost = new URL(baseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(baseHost))
  throw new Error("Category image E2E chỉ được phép chạy trên local server.");

const outputDir = new URL("../screenshots/actual/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const browser = await launchSelectedBrowser();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "vi-VN",
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const e2eKey = String(Date.now());
const categoryName = `[E2E] Category image ${e2eKey}`;
const categorySlug = `e2e-category-image-${e2eKey}`;
const firstImage = fileURLToPath(new URL("../public/images/category-cereal.jpg", import.meta.url));
const replacementImage = fileURLToPath(new URL("../public/images/category-snack.jpg", import.meta.url));
let categoryId = "";

function edgeFixture(width, height, label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#fff"/><rect x="2" y="2" width="${width - 4}" height="${height - 4}" fill="none" stroke="${color}" stroke-width="4"/><text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Arial" font-size="48" font-weight="700" fill="${color}">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const fittingFixtures = [
  edgeFixture(1000, 1000, "SQUARE", "#c0392b"),
  edgeFixture(800, 1200, "PORTRAIT", "#1769aa"),
  edgeFixture(1200, 800, "LANDSCAPE", "#2e8b57"),
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return { text, body: JSON.parse(text) };
  } catch {
    return { text, body: {} };
  }
}

function categoryRow() {
  return page.locator(".taxonomy-card tbody tr").filter({ hasText: categoryName });
}

async function waitForImagePhase(text) {
  await page.waitForFunction(
    (expected) => document.querySelector(".taxonomy-image-status")?.textContent?.includes(expected),
    text,
    { timeout: 15000 },
  );
}

async function openEditor() {
  const row = categoryRow();
  await row.waitFor({ state: "visible" });
  await row.getByRole("button", { name: `Sửa ${categoryName}`, exact: true }).click();
  const editor = page.locator(".taxonomy-editor");
  await editor.getByRole("heading", { name: "Sửa phân loại", exact: true }).waitFor({ state: "visible" });
  return editor;
}

async function uploadFromEditor(editor, filePath) {
  const input = editor.locator('.taxonomy-image-picker input[type="file"]');
  await input.setInputFiles(filePath);
  await waitForImagePhase("Ảnh đã sẵn sàng");
  await editor.locator(".taxonomy-image-preview img").waitFor({ state: "visible" });
}

async function saveEditor(editor) {
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/admin/categories/") &&
      response.request().method() === "PUT",
    ),
    editor.getByRole("button", { name: "LƯU", exact: true }).click(),
  ]);
  await page.waitForFunction(
    (name) => [...document.querySelectorAll(".taxonomy-card tbody tr")].some((row) => row.textContent?.includes(name)),
    categoryName,
  );
}

async function assertCategoryResponsive() {
  for (const width of [320, 360, 375, 390, 412, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
    await page.goto(`${baseUrl}/categories`, { waitUntil: "domcontentloaded" });
    const card = page.locator(".category-overview a").filter({ hasText: categoryName });
    await card.waitFor({ state: "visible" });
    await page.waitForFunction(() => document.fonts.status === "loaded");
    await page.waitForTimeout(200);
    const image = card.locator(".category-card-media > img");
    const persistedSource = await image.getAttribute("src");
    assert(persistedSource?.includes("/media/categories/"), `Storefront không dùng resolver R2 ở ${width}px: ${persistedSource}`);
    if (width === 390 || width === 1440)
      await page.screenshot({ path: fileURLToPath(new URL(`category-storefront-${width}-${selectedBrowserName}.png`, outputDir)), fullPage: true });
    for (const [fixtureIndex, fixture] of fittingFixtures.entries()) {
      await image.evaluate((element, source) => {
        element.removeAttribute("srcset");
        element.removeAttribute("sizes");
        element.src = source;
      }, fixture);
      await image.evaluate((element) => new Promise((resolve) => {
        if (element.complete) {
          resolve();
          return;
        }
        element.addEventListener("load", () => resolve(), { once: true });
        element.addEventListener("error", () => resolve(), { once: true });
      }));
      const metrics = await card.evaluate((categoryCard) => {
        const categoryImage = categoryCard.querySelector(".category-card-media > img");
        const imageStyle = categoryImage ? getComputedStyle(categoryImage) : null;
        const imageRect = categoryImage?.getBoundingClientRect();
        const mediaRect = categoryCard.querySelector(".category-card-media")?.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          objectFit: imageStyle?.objectFit ?? "",
          objectPosition: imageStyle?.objectPosition ?? "",
          padding: Number.parseFloat(imageStyle?.paddingTop ?? "0"),
          imageWidth: imageRect?.width ?? 0,
          imageHeight: imageRect?.height ?? 0,
          mediaWidth: mediaRect?.width ?? 0,
          mediaHeight: mediaRect?.height ?? 0,
        };
      });
      assert(!metrics.overflow, `Categories tràn ngang ở ${width}px fixture ${fixtureIndex + 1}`);
      assert(metrics.objectFit === "contain", `Category image không contain ở ${width}px fixture ${fixtureIndex + 1}`);
      assert(/50% 50%|center/.test(metrics.objectPosition), `Category image không căn giữa ở ${width}px fixture ${fixtureIndex + 1}`);
      assert(metrics.padding > 0, `Category image thiếu safe inset ở ${width}px fixture ${fixtureIndex + 1}`);
      assert(metrics.imageWidth > 0 && metrics.imageHeight > 0, `Ảnh category không có kích thước ở ${width}px fixture ${fixtureIndex + 1}`);
      assert(Math.abs(metrics.imageWidth - metrics.mediaWidth) <= 1 && Math.abs(metrics.imageHeight - metrics.mediaHeight) <= 1, `Media box đổi kích thước ở ${width}px fixture ${fixtureIndex + 1}`);
    }
  }
}

try {
  const created = await api("/api/admin/categories", {
    method: "POST",
    body: JSON.stringify({
      name: categoryName,
      slug: categorySlug,
      description: "Category image end-to-end fixture.",
      imageKey: null,
      sortOrder: -999,
      isActive: true,
    }),
  });
  const createdResult = await readJson(created);
  assert(created.ok, `Không tạo fixture category: ${createdResult.text}`);
  categoryId = createdResult.body.id ?? "";
  assert(categoryId, "Fixture không có category id.");

  await page.goto(`${baseUrl}/admin/categories`, { waitUntil: "domcontentloaded" });
  const editor = await openEditor();
  await uploadFromEditor(editor, firstImage);
  await page.screenshot({ path: fileURLToPath(new URL(`category-admin-with-image-${selectedBrowserName}.png`, outputDir)), fullPage: true });
  await saveEditor(editor);

  await page.reload({ waitUntil: "domcontentloaded" });
  const reloadedEditor = await openEditor();
  const reloadedSource = await reloadedEditor.locator(".taxonomy-image-preview img").getAttribute("src");
  assert(reloadedSource?.includes("/media/categories/"), `Reload không giữ URL ảnh category: ${reloadedSource}`);

  await uploadFromEditor(reloadedEditor, replacementImage);
  await page.screenshot({ path: fileURLToPath(new URL(`category-admin-replace-${selectedBrowserName}.png`, outputDir)), fullPage: true });
  await saveEditor(reloadedEditor);

  await page.reload({ waitUntil: "domcontentloaded" });
  const persistedEditor = await openEditor();
  const persistedSource = await persistedEditor.locator(".taxonomy-image-preview img").getAttribute("src");
  assert(persistedSource?.includes("/media/categories/"), `Replace không persist ảnh category: ${persistedSource}`);

  await assertCategoryResponsive();

  await page.goto(`${baseUrl}/admin/categories`, { waitUntil: "domcontentloaded" });
  const deleteEditor = await openEditor();
  await deleteEditor.getByRole("button", { name: "XÓA ẢNH", exact: true }).click();
  await deleteEditor.locator(".taxonomy-image-empty").waitFor({ state: "visible" });
  await page.screenshot({ path: fileURLToPath(new URL(`category-admin-no-image-${selectedBrowserName}.png`, outputDir)), fullPage: true });

  await page.goto(`${baseUrl}/categories`, { waitUntil: "domcontentloaded" });
  const fallbackImage = page.locator(".category-overview a").filter({ hasText: categoryName }).locator(".category-card-media img");
  await fallbackImage.waitFor({ state: "visible" });
  const fallbackSource = await fallbackImage.getAttribute("src");
  assert(fallbackSource === "/images/logo.png", `Category no-image không dùng placeholder: ${fallbackSource}`);
  console.log(`ADMIN_CATEGORY_IMAGE_E2E_OK browser=${selectedBrowserName} upload=pass reload=pass replace=pass responsive=320,360,375,390,412,430,768,1024,1440 delete=pass fallback=pass screenshots=pass`);
} finally {
  if (categoryId)
    await api(`/api/admin/categories/${categoryId}/permanent`, { method: "DELETE" }).catch(() => undefined);
  await context.close();
  await browser.close();
}
