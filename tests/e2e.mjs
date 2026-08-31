import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
let catalogIsEmpty = false;
try {
  const catalogProbe = await fetch(`${baseUrl}/api/products?limit=1`);
  const catalogBody = await catalogProbe.json();
  catalogIsEmpty =
    catalogProbe.ok &&
    Array.isArray(catalogBody.data) &&
    catalogBody.data.length === 0;
} catch {
  // Để browser E2E báo lỗi kết nối nếu dev server chưa sẵn sàng.
}
if (catalogIsEmpty) {
  // Sau cleanup, dùng smoke chuyên biệt thay vì tạo lại seed/test product.
  await import("./empty-catalog.e2e.mjs");
  await import("./inventory-reservation.e2e.mjs");
  process.exit(0);
}
const outputDir = new URL("../screenshots/actual/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
    : {}),
});

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

async function assertAdminHardNavigation(path) {
  const assertPage = async (page, label, navigate) => {
    const publicCatalogRequests = [];
    const onRequest = (request) => {
      const pathname = new URL(request.url()).pathname;
      if (/^\/api\/(products|categories|brands)(?:\/|$)/.test(pathname))
        publicCatalogRequests.push(pathname);
    };
    page.on("request", onRequest);
    const response = await navigate();
    await page.waitForTimeout(600);
    const body = await page.locator("body").innerText();
    if (!response || response.status() >= 500)
      throw new Error(`Admin ${path} ${label} trả về HTTP lỗi`);
    if (body.includes("Đã có lỗi xảy ra") || body.includes("Ứng dụng chưa thể tải nội dung này."))
      throw new Error(`Admin ${path} ${label} rơi vào root ErrorBoundary`);
    if (await page.locator(".admin-shell").count() !== 1)
      throw new Error(`Admin ${path} ${label} không render AdminShell`);
    if (publicCatalogRequests.length)
      throw new Error(`Admin ${path} ${label} gọi public catalog API: ${publicCatalogRequests.join(", ")}`);
    page.off("request", onRequest);
  };

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "vi-VN" });
  const page = await context.newPage();
  try {
    await assertPage(page, "direct", () => page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" }));
    await assertPage(page, "reload", () => page.reload({ waitUntil: "domcontentloaded" }));
  } finally {
    await context.close();
  }

  const freshContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "vi-VN" });
  const freshPage = await freshContext.newPage();
  try {
    await assertPage(freshPage, "new-context", () => freshPage.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" }));
  } finally {
    await freshContext.close();
  }
}

const visualRoutes = [
  ["/", "home"], ["/shop", "shop"], ["/product/little-sprouts-ca-rot-tao-huu-co", "product"],
  ["/cart", "cart"], ["/cart/success/GH-260825-X7K2", "success"],
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
for (const path of ["/admin", "/admin/products", "/admin/access-links", "/admin/settings"])
  await assertAdminHardNavigation(path);

const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "vi-VN" });
const page = await context.newPage();
await page.goto(`${baseUrl}/product/little-sprouts-ca-rot-tao-huu-co`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
await page.getByRole("button", { name: /THÊM VÀO GIỎ/ }).last().click();
await page.waitForFunction(() => localStorage.getItem("babyjoy.cart.v1")?.includes("variant-little-120"));
await page.goto(`${baseUrl}/cart`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.innerText.includes("89.000"));
const cartText = await page.locator("body").innerText();
if (!cartText.includes("89.000")) throw new Error("Cart không hiển thị tạm tính sau add");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(100);
if (!(await page.locator("body").innerText()).includes("Little Sprouts")) throw new Error("Cart không tồn tại sau refresh");
await page.goto(`${baseUrl}/shop?category=bot-an-dam&sort=price_asc`, { waitUntil: "domcontentloaded" });
if (!(await page.locator("body").innerText()).includes("Bột ăn dặm")) throw new Error("URL filter không hoạt động");
await context.close();

// E2E xuyên suốt Admin → public → cart cho một product có nhiều phân loại.
const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "vi-VN" });
const adminPage = await adminContext.newPage();
let createdProductId = "";
const e2eKey = String(Date.now());
const e2eSlug = `e2e-multi-variant-${e2eKey}`;
const e2eSkus = {
  fifty: `E2E-RICE-50-${e2eKey}`,
  oneHundred: `E2E-RICE-100-${e2eKey}`,
  twoHundred: `E2E-RICE-200-${e2eKey}`,
  fiveHundred: `E2E-RICE-500-${e2eKey}`,
};
try {
  await adminPage.goto(`${baseUrl}/admin/products/new`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(400);
  await adminPage.locator('input[name="name"]').fill("E2E Baby Rice multi variant");
  await adminPage.locator('input[name="slug"]').fill(e2eSlug);
  await adminPage.locator('input[name="sortOrder"]').fill("-999");
  const adminRows = adminPage.locator(".variant-row");
  const addVariant = adminPage.getByRole("button", { name: "+ Thêm phân loại" });
  const fillVariant = async (index, name, sku, price, availability) => {
    const row = adminRows.nth(index);
    await row.locator("input").nth(0).fill(name);
    await row.locator("input").nth(1).fill(sku);
    await row.locator("input").nth(2).fill(String(price));
    await row.locator("select").selectOption(availability);
    await row.getByLabel("Tồn kho thực tế").fill("10");
  };
  await fillVariant(0, "50g", e2eSkus.fifty, 150000, "OUT_OF_STOCK");
  await addVariant.click();
  await addVariant.click();
  await fillVariant(1, "100g", e2eSkus.oneHundred, 270000, "AVAILABLE");
  await fillVariant(2, "200g", e2eSkus.twoHundred, 490000, "OUT_OF_STOCK");
  await adminPage.getByRole("button", { name: "LƯU SẢN PHẨM" }).click();
  await adminPage.waitForURL(/\/admin\/products\/[^/]+\/edit$/);
  createdProductId = new URL(adminPage.url()).pathname.split("/").at(-2) ?? "";
  await adminPage.waitForTimeout(500);
  if (await adminRows.count() !== 3) throw new Error("Admin reload không đủ 3 variants");
  if (await adminRows.nth(1).locator("input").nth(1).inputValue() !== e2eSkus.oneHundred) throw new Error("Admin không giữ SKU row 2");
  const firstAdminRead = await adminPage.request.get(`${baseUrl}/api/admin/products/${createdProductId}`);
  const firstAdminBody = await firstAdminRead.json();
  const initialVariants = firstAdminBody.data?.variants ?? [];
  const initialBySku = new Map(initialVariants.map((variant) => [variant.sku, variant]));
  const deletedVariantId = initialBySku.get(e2eSkus.oneHundred)?.id;
  const retainedFiftyId = initialBySku.get(e2eSkus.fifty)?.id;
  const retainedTwoHundredId = initialBySku.get(e2eSkus.twoHundred)?.id;
  if (!deletedVariantId || !retainedFiftyId || !retainedTwoHundredId) throw new Error("Admin không trả đủ persisted variant ID");

  // Availability phải độc lập theo từng variant: 50g bị chặn còn 100g vẫn mua được.
  await adminPage.goto(`${baseUrl}/product/${e2eSlug}`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(500);
  await adminPage.getByRole("button", { name: "50g" }).click();
  if (!(await adminPage.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().isDisabled())) throw new Error("Variant 50g OUT_OF_STOCK vẫn cho thêm vào giỏ");
  await adminPage.getByRole("button", { name: "100g" }).click();
  if (await adminPage.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().isDisabled()) throw new Error("Variant 100g AVAILABLE bị chặn mua độc lập");
  await adminPage.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().click();
  await adminPage.evaluate(() => localStorage.removeItem("babyjoy.cart.v1"));
  await adminPage.goto(`${baseUrl}/admin/products/${createdProductId}/edit`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(500);

  await adminRows.nth(0).locator("input").nth(2).fill("160000");
  await adminRows.nth(0).locator("select").selectOption("AVAILABLE");
  await adminRows.nth(1).getByRole("button", { name: /Xóa phân loại 100g/ }).click();
  await addVariant.click();
  await fillVariant(2, "500g", e2eSkus.fiveHundred, 900000, "AVAILABLE");
  const updateRequestPromise = adminPage.waitForRequest((request) =>
    request.method() === "PUT" && request.url().endsWith(`/api/admin/products/${createdProductId}`),
  );
  await adminPage.getByRole("button", { name: "LƯU SẢN PHẨM" }).click();
  const updateRequest = await updateRequestPromise;
  const updatePayload = JSON.parse(updateRequest.postData() ?? "{}");
  if (!updatePayload.deletedVariantIds?.includes(deletedVariantId)) throw new Error("Save không gửi deletedVariantIds của 100g");
  await adminPage.waitForTimeout(700);
  if (await adminRows.count() !== 3) throw new Error("Admin sau edit không còn đúng 3 variants");
  const expectedRows = [[e2eSkus.fifty, "160000"], [e2eSkus.twoHundred, "490000"], [e2eSkus.fiveHundred, "900000"]];
  for (let index = 0; index < expectedRows.length; index++) {
    const row = adminRows.nth(index);
    if (await row.locator("input").nth(1).inputValue() !== expectedRows[index][0]) throw new Error("SKU sau edit không đúng");
    if (await row.locator("input").nth(2).inputValue() !== expectedRows[index][1]) throw new Error("Giá sau edit không đúng");
  }
  const afterAdminRead = await adminPage.request.get(`${baseUrl}/api/admin/products/${createdProductId}`);
  const afterAdminBody = await afterAdminRead.json();
  const afterVariants = afterAdminBody.data?.variants ?? [];
  if (afterVariants.length !== 3 || afterVariants.some((variant) => variant.sku === e2eSkus.oneHundred)) throw new Error("Persisted delete 100g không đúng");
  if (afterVariants.find((variant) => variant.sku === e2eSkus.fifty)?.id !== retainedFiftyId || afterVariants.find((variant) => variant.sku === e2eSkus.twoHundred)?.id !== retainedTwoHundredId) throw new Error("Persisted variant ID bị đổi sau delete");

  await adminPage.evaluate(() => localStorage.removeItem("babyjoy.cart.v1"));
  await adminPage.goto(`${baseUrl}/product/${e2eSlug}`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(700);
  if (!(await adminPage.locator("body").innerText()).includes("E2E Baby Rice multi variant")) throw new Error("Public không đọc product E2E");
  if (await adminPage.getByRole("button", { name: "500g" }).count() !== 1) throw new Error("Public thiếu variant 500g");
  const publicResponse = await adminPage.request.get(`${baseUrl}/api/products/${e2eSlug}`);
  const publicBody = await publicResponse.json();
  const publicVariants = publicBody.data?.variants ?? [];
  if (publicVariants.length !== 3 || publicVariants.some((variant) => variant.sku === e2eSkus.oneHundred)) throw new Error("Public variants sau edit không đúng");
  const publicBySku = new Map(publicVariants.map((variant) => [variant.sku, variant]));
  await adminPage.getByRole("button", { name: "200g" }).click();
  if (!(await adminPage.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().isDisabled())) throw new Error("Variant OUT_OF_STOCK vẫn cho thêm vào giỏ");
  await adminPage.getByRole("button", { name: "50g" }).click();
  await adminPage.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().click();
  await adminPage.getByRole("button", { name: "500g" }).click();
  await adminPage.locator(".detail-quantity").getByRole("button", { name: "Tăng số lượng" }).click();
  await adminPage.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().click();
  await adminPage.goto(`${baseUrl}/cart`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(250);
  const cartSnapshot = await adminPage.evaluate(() => JSON.parse(localStorage.getItem("babyjoy.cart.v1") || "{}"));
  if (cartSnapshot.items?.length !== 2 || cartSnapshot.items.reduce((sum, item) => sum + item.quantity, 0) !== 3) throw new Error("Cart E2E không tách variant hoặc sai badge");
  if (cartSnapshot.items.find((item) => item.variantId === publicBySku.get(e2eSkus.fifty)?.id)?.quantity !== 1 || cartSnapshot.items.find((item) => item.variantId === publicBySku.get(e2eSkus.fiveHundred)?.id)?.quantity !== 2) throw new Error("Cart E2E sai variantId/quantity");

  // Legacy cart chỉ có variantId + quantity vẫn phải giữ dòng unavailable để người dùng tự xóa.
  const legacyVariantId = `deleted-e2e-${e2eKey}`;
  await adminPage.evaluate((variantId) => {
    localStorage.setItem("babyjoy.cart.v1", JSON.stringify({ items: [{ variantId, quantity: 2 }] }));
    sessionStorage.removeItem("babyjoy.preparedCartShare.v1");
  }, legacyVariantId);
  await adminPage.goto(`${baseUrl}/cart`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(400);
  const legacyCartText = await adminPage.locator("body").innerText();
  if (!legacyCartText.includes("không còn khả dụng")) throw new Error("Legacy cart không đánh dấu variant unavailable");
  if (await adminPage.locator(".direct-prepare:not([disabled]), .messenger-checkout button:not([disabled])").count() !== 0) throw new Error("Checkout vẫn mở cho legacy variant unavailable");
  await adminPage.getByRole("button", { name: "Xóa" }).click();
  await adminPage.waitForFunction(() => JSON.parse(localStorage.getItem("babyjoy.cart.v1") || "{}").items?.length === 0);

  const legacyGuideCode = `GH-P0-${e2eKey}`;
  await adminPage.evaluate(({ variantId, code }) => {
    localStorage.setItem("babyjoy.cart.v1", JSON.stringify({ items: [{ variantId, quantity: 1 }] }));
    sessionStorage.setItem("babyjoy.preparedCartShare.v1", JSON.stringify({
      fingerprint: `${variantId}:1`,
      cartRequest: { code, itemLineCount: 1, totalQuantity: 1, subtotalVnd: 270000, createdAt: new Date().toISOString() },
      share: { title: "P0", text: "P0", url: "https://example.com/c/p0", copyText: "P0", expiresAt: new Date(Date.now() + 86400000).toISOString() },
      seller: { displayName: "BabyJoy", label: "Shop", messengerUrl: "https://m.me/babyjoy", avatarKey: null, avatarUrl: null },
    }));
  }, { variantId: legacyVariantId, code: legacyGuideCode });
  await adminPage.goto(`${baseUrl}/cart/guide/${legacyGuideCode}`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(500);
  if (!(await adminPage.locator("body").innerText()).includes("Phân loại trong giỏ không còn khả dụng")) throw new Error("Prepared guide không chặn variant đã xóa");
  if (await adminPage.getByRole("button", { name: /Nhắn shop trên Messenger/ }).count() !== 0) throw new Error("Prepared guide vẫn có CTA Messenger stale");

  // Product chỉ có một variant vẫn giữ add, +/- và badge như trước.
  await adminPage.evaluate(() => { localStorage.removeItem("babyjoy.cart.v1"); sessionStorage.clear(); });
  await adminPage.goto(`${baseUrl}/product/bot-an-dam-gerber-organic-yen-mach-chuoi`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(500);
  if (await adminPage.getByRole("button", { name: "227g" }).count() !== 1) throw new Error("Single variant không render đúng selector");
  await adminPage.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().click();
  await adminPage.goto(`${baseUrl}/cart`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(300);
  const singleLine = adminPage.locator(".cart-item").first();
  if (await adminPage.locator(".cart-item").count() !== 1) throw new Error("Single variant không tạo đúng một cart line");
  await singleLine.getByRole("button", { name: "Tăng số lượng" }).click();
  let singleSnapshot = await adminPage.evaluate(() => JSON.parse(localStorage.getItem("babyjoy.cart.v1") || "{}"));
  if (singleSnapshot.items?.[0]?.quantity !== 2) throw new Error("Single variant increment sai");
  if (await adminPage.getByRole("link", { name: /Giỏ hàng, 2 sản phẩm/ }).count() !== 1) throw new Error("Single variant badge sai");
  await singleLine.getByRole("button", { name: "Giảm số lượng" }).click();
  singleSnapshot = await adminPage.evaluate(() => JSON.parse(localStorage.getItem("babyjoy.cart.v1") || "{}"));
  if (singleSnapshot.items?.[0]?.quantity !== 1) throw new Error("Single variant decrement sai");
} finally {
  if (createdProductId) await adminPage.request.delete(`${baseUrl}/api/admin/products/${createdProductId}`).catch(() => undefined);
  await adminContext.close();
}

await import("./inventory-reservation.e2e.mjs");
await browser.close();
console.log(`E2E_OK routes=${visualRoutes.length * 2 + 6} viewports=390,768,1024,1440 cart-persistence=pass filter-url=pass admin-hard-navigation=pass multi-variant-admin-cart=pass`);
