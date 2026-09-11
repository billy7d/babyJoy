import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchSelectedBrowser } from "./playwright-browser.mjs";
import { semanticUrlState } from "./e2e-url-state.mjs";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
await import("./content-pages.e2e.mjs");
await import("./store-settings.e2e.mjs");
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
  // Smoke catalog rỗng phải chạy trước fixture category vì fixture có product ẩn trong Admin.
  await import("./empty-catalog.e2e.mjs");
}
const outputDir = new URL("../screenshots/actual/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const browser = await launchSelectedBrowser();

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

// Kiểm tra surface filter thực tế, gồm query state, accessibility và kích thước responsive.
async function assertFilterSurface(page, selector, viewportWidth, mobile = false) {
  const root = page.locator(`${selector} .filters-inner`);
  // Bỏ tên icon aria-hidden để so sánh đúng nhãn heading hiển thị theo Stitch.
  const headings = await root.locator("h3").evaluateAll((items) =>
    items.map((item) => item.querySelector("span:last-child")?.textContent?.trim() ?? ""),
  );
  if (!headings.includes("Độ tuổi cho bé")) throw new Error(`Thiếu filter Độ tuổi ở ${selector}`);
  if (!headings.includes("Đặc tính")) throw new Error(`Thiếu filter Đặc điểm ở ${selector}`);
  if (headings.some((heading) => !["Độ tuổi cho bé", "Đặc tính"].includes(heading)))
    throw new Error(`Storefront còn filter ngoài phạm vi ở ${selector}: ${headings.join(", ")}`);
  if (await root.locator(".category-filter-section, .brand-filter-section, .availability-filter-section").count())
    throw new Error(`Storefront còn wrapper filter cũ ở ${selector}`);
  const filterText = await root.innerText();
  if (["Danh mục", "Thương hiệu", "Tình trạng", "Best seller"].some((label) => filterText.includes(label)))
    throw new Error(`Storefront còn text filter cũ ở ${selector}`);
  const buttons = root.locator(".filter-tags button");
  if (await buttons.count() === 0) throw new Error(`Storefront không có filter option ở ${selector}`);
  const ariaValues = await buttons.evaluateAll((items) => items.map((item) => item.getAttribute("aria-pressed")));
  if (ariaValues.some((value) => value !== "true" && value !== "false"))
    throw new Error(`Filter button thiếu aria-pressed ở ${selector}`);
  const metrics = await page.evaluate(({ selector, viewportWidth, mobile }) => {
    const root = document.querySelector(`${selector} .filters-inner`);
    const ageOptions = root?.querySelector(".age-filter-options");
    const ageSection = root?.querySelector(".age-filter-section");
    const characteristicSection = root?.querySelector(".characteristic-filter-section");
    const filterButtons = [...(root?.querySelectorAll(".filter-tags button") ?? [])];
    const buttonHeights = filterButtons.map((button) => button.getBoundingClientRect().height);
    const ageStyle = ageOptions ? getComputedStyle(ageOptions) : null;
    const ageRect = ageSection?.getBoundingClientRect();
    const characteristicRect = characteristicSection?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > viewportWidth + 1,
      flexWrap: ageStyle?.flexWrap ?? "",
      gap: Number.parseFloat(ageStyle?.columnGap ?? "0"),
      verticalGap: ageRect && characteristicRect ? characteristicRect.top - ageRect.bottom : 0,
      minButtonHeight: Math.min(...buttonHeights),
      mobile,
    };
  }, { selector, viewportWidth, mobile });
  if (metrics.overflow) throw new Error(`Filter gây tràn ngang ở viewport ${viewportWidth}`);
  if (metrics.flexWrap !== "wrap") throw new Error(`Age chip không wrap ở viewport ${viewportWidth}`);
  // Stitch dùng spacing xs = 4px cho chip desktop; mobile vẫn có gap riêng.
  if (metrics.gap < 4) throw new Error(`Khoảng cách chip quá nhỏ ở viewport ${viewportWidth}`);
  if (metrics.verticalGap < 16) throw new Error(`Khoảng cách giữa hai section quá nhỏ ở viewport ${viewportWidth}`);
  if (mobile && metrics.minButtonHeight < 44)
    throw new Error(`Touch target filter mobile nhỏ hơn 44px ở viewport ${viewportWidth}`);
}

async function waitForFilterOptions(page, selector) {
  await page.waitForFunction((surface) => {
    const root = document.querySelector(`${surface} .filters-inner`);
    return Boolean(root?.querySelector(".age-filter-options button") && root?.querySelector(".characteristic-filter-options button"));
  }, selector, { timeout: 10000 });
}

async function assertMobileFilterSheet(page, viewportWidth) {
  const sheet = page.locator("#mobile-filter-sheet");
  if (await sheet.count() !== 1) throw new Error("Mobile filter sheet không render đúng role dialog");
  if (await sheet.getAttribute("aria-modal") !== "true") throw new Error("Mobile filter sheet thiếu aria-modal");
  if (await sheet.getByRole("heading", { name: "Độ tuổi cho bé" }).count() !== 1)
    throw new Error("Mobile sheet thiếu section Độ tuổi cho bé");
  if (await sheet.getByRole("heading", { name: "Đặc tính & Dinh dưỡng" }).count() !== 1)
    throw new Error("Mobile sheet thiếu section Đặc tính & Dinh dưỡng");
  const metrics = await page.evaluate((width) => {
    const panel = document.querySelector("#mobile-filter-sheet");
    const body = panel?.querySelector(".mobile-filter-body");
    const buttons = [...(panel?.querySelectorAll(".mobile-filter-chip") ?? [])];
    return {
      bodyLocked: document.body.style.overflow === "hidden",
      overflow: document.documentElement.scrollWidth > width + 1,
      panelWidth: panel?.getBoundingClientRect().width ?? 0,
      viewportWidth: window.innerWidth,
      minButtonHeight: Math.min(...buttons.map((button) => button.getBoundingClientRect().height)),
      bodyScroll: body ? body.scrollHeight >= body.clientHeight : false,
    };
  }, viewportWidth);
  if (!metrics.bodyLocked) throw new Error("Mở sheet nhưng background vẫn scroll được");
  if (metrics.overflow) throw new Error(`Mobile sheet gây tràn ngang ở viewport ${viewportWidth}`);
  if (metrics.panelWidth !== metrics.viewportWidth) throw new Error("Sheet không phủ đủ chiều rộng viewport");
  if (metrics.minButtonHeight < 44) throw new Error("Chip mobile nhỏ hơn touch target 44px");
}

async function closeSheetWithEscape(page, expectedUrl, width) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  if (await page.locator("#mobile-filter-sheet").count() !== 0)
    throw new Error("Escape không đóng mobile filter sheet");
  assertSemanticUrlUnchanged(
    page.url(),
    expectedUrl,
    `Escape tự ý Apply draft ở viewport ${width}`,
  );
}

function assertSemanticUrlUnchanged(actualUrl, expectedUrl, message) {
  const actualState = semanticUrlState(actualUrl);
  const expectedState = semanticUrlState(expectedUrl);
  if (
    actualState.pathname !== expectedState.pathname ||
    JSON.stringify(actualState.search) !== JSON.stringify(expectedState.search)
  )
    throw new Error(
      `${message}: trước=${expectedUrl} sau=${actualUrl}`,
    );
}

async function selectAgeAndCharacteristic(page, selector) {
  const ageButton = page.locator(`${selector} .age-filter-options button`).first();
  const characteristicButton = page.locator(`${selector} .characteristic-filter-options button`).first();
  await ageButton.focus();
  if (await ageButton.getAttribute("aria-pressed") !== "false")
    throw new Error(`Age filter không khởi tạo ở trạng thái chưa chọn: ${selector}`);
  await ageButton.click();
  await page.waitForFunction(() => (new URL(location.href).searchParams.get("tagIds") ?? "").split(",").filter(Boolean).length === 1);
  await page.waitForFunction((surface) => document.querySelector(`${surface} .age-filter-options button`)?.getAttribute("aria-pressed") === "true", selector);
  if (await ageButton.getAttribute("aria-pressed") !== "true")
    throw new Error(`Age filter không giữ trạng thái selected: ${selector}`);
  await characteristicButton.click();
  await page.waitForFunction(() => (new URL(location.href).searchParams.get("tagIds") ?? "").split(",").filter(Boolean).length === 2);
  await page.waitForFunction((surface) => document.querySelector(`${surface} .characteristic-filter-options button`)?.getAttribute("aria-pressed") === "true", selector);
  if (await characteristicButton.getAttribute("aria-pressed") !== "true")
    throw new Error(`Characteristic filter không giữ trạng thái selected: ${selector}`);
}

async function assertStorefrontFilters() {
  // Desktop và tablet phải loại state cũ sau khi catalog metadata đã hydrate.
  for (const [viewport, label] of [
    [{ width: 1440, height: 1000 }, "desktop"],
    [{ width: 1024, height: 768 }, "tablet"],
  ]) {
    const context = await browser.newContext({ viewport, locale: "vi-VN" });
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/shop?brand=heinz&available=1&bestSeller=1&q=Gerber&sort=price_asc`, { waitUntil: "domcontentloaded" });
      await waitForFilterOptions(page, ".filter-sidebar");
      await page.waitForFunction(() => {
        const search = new URL(location.href).searchParams;
        return !search.has("brand") && !search.has("available") && !search.has("bestSeller");
      }, undefined, { timeout: 10000 });
      await page.waitForTimeout(200);
      await assertFilterSurface(page, ".filter-sidebar", viewport.width, false);
      if (await page.locator(".mobile-category-chips").count() !== 0)
        throw new Error(`Mobile category chips vẫn tồn tại trong DOM ở ${label}`);
      await selectAgeAndCharacteristic(page, ".filter-sidebar");
      const combinedUrl = new URL(page.url());
      if (combinedUrl.searchParams.get("q") !== "Gerber" || combinedUrl.searchParams.get("sort") !== "price_asc")
        throw new Error(`Age/Đặc điểm làm mất search hoặc sort ở ${label}`);
      await page.locator(".filter-sidebar .clear-filter").click();
      await page.waitForFunction(() => !(new URL(location.href).searchParams.get("tagIds")));
    } finally {
      await context.close();
    }
  }

  // Bottom sheet mobile giữ draft local cho tới Apply và đạt touch target tối thiểu.
  for (const width of [390, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: "vi-VN" });
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/shop?category=bot-an-dam&q=Gerber&sort=price_asc&page=1`, { waitUntil: "domcontentloaded" });
      await waitForFilterOptions(page, ".filter-sidebar");
      await page.waitForFunction(() => {
        const search = new URL(location.href).searchParams;
        return search.get("category") === "bot-an-dam" && search.get("q") === "Gerber" && search.get("sort") === "price_asc";
      }, undefined, { timeout: 10000 });
      await page.waitForTimeout(200);
      if (await page.locator(".mobile-bottom button").count() !== 0)
        throw new Error("Bottom nav mobile vẫn còn button Search cũ");
      if (await page.getByText("Tìm kiếm", { exact: true }).count() !== 0)
        throw new Error("Bottom nav mobile vẫn còn label Tìm kiếm");
      await page.getByRole("button", { name: "Lọc độ tuổi", exact: true }).click();
      await page.locator("#mobile-filter-sheet").waitFor({ state: "visible" });
      await page.waitForTimeout(350);
      await assertMobileFilterSheet(page, width);
      await page.screenshot({ path: fileURLToPath(new URL(`shop-filter-sheet-${width}.png`, outputDir)), fullPage: true });

      const initialUrl = page.url();
      const ageOptions = page.locator("#mobile-filter-sheet .age-filter-options .mobile-filter-chip");
      const firstAge = ageOptions.nth(1);
      const secondAge = ageOptions.nth(2);
      await firstAge.click();
      assertSemanticUrlUnchanged(
        page.url(),
        initialUrl,
        `Chạm chip age làm đổi functional state trước Apply ở viewport ${width}`,
      );
      await secondAge.click();
      const characteristic = page.locator("#mobile-filter-sheet .characteristic-filter-options .mobile-filter-chip").first();
      await characteristic.click();
      assertSemanticUrlUnchanged(
        page.url(),
        initialUrl,
        `Chạm chip characteristic làm đổi functional state trước Apply ở viewport ${width}`,
      );
      await page.locator("#mobile-filter-sheet .mobile-filter-close").click();
      await page.waitForTimeout(350);
      if (await page.locator("#mobile-filter-sheet").count() !== 0) throw new Error("Nút X không đóng sheet");
      assertSemanticUrlUnchanged(
        page.url(),
        initialUrl,
        `Đóng sheet tự ý Apply draft ở viewport ${width}`,
      );

      await page.getByRole("button", { name: "Lọc độ tuổi", exact: true }).click();
      await page.locator("#mobile-filter-sheet").waitFor({ state: "visible" });
      if (await page.locator("#mobile-filter-sheet .mobile-filter-chip.selected").count() !== 1)
        throw new Error("Mở lại sheet không restore active state từ URL");
      await closeSheetWithEscape(page, initialUrl, width);

      await page.getByRole("button", { name: "Lọc độ tuổi", exact: true }).click();
      await page.locator("#mobile-filter-sheet").waitFor({ state: "visible" });
      const backdropUrl = page.url();
      await page.locator(".mobile-filter-backdrop").click({ position: { x: 6, y: 6 } });
      await page.waitForTimeout(350);
      if (await page.locator("#mobile-filter-sheet").count() !== 0) throw new Error("Backdrop không đóng sheet");
      assertSemanticUrlUnchanged(
        page.url(),
        backdropUrl,
        `Backdrop tự ý Apply draft ở viewport ${width}`,
      );

      await page.getByRole("button", { name: "Lọc độ tuổi", exact: true }).click();
      await page.locator("#mobile-filter-sheet").waitFor({ state: "visible" });
      await page.locator("#mobile-filter-sheet .age-filter-options .mobile-filter-chip").nth(1).click();
      await page.locator("#mobile-filter-sheet .characteristic-filter-options .mobile-filter-chip").first().click();
      await page.locator("#mobile-filter-sheet .mobile-filter-apply").click();
      await page.waitForFunction(() => {
        const search = new URL(location.href).searchParams;
        return Boolean(search.get("tagIds")) && search.get("page") === "1" && search.get("category") === "bot-an-dam" && search.get("q") === "Gerber" && search.get("sort") === "price_asc";
      }, undefined, { timeout: 10000 });
      await page.screenshot({ path: fileURLToPath(new URL(`shop-filter-selected-${width}.png`, outputDir)), fullPage: true });

      await page.getByRole("button", { name: "Lọc độ tuổi", exact: true }).click();
      await page.locator("#mobile-filter-sheet").waitFor({ state: "visible" });
      const activeTagIdsUrl = page.url();
      await page.locator("#mobile-filter-sheet .mobile-filter-clear").click();
      await page.locator("#mobile-filter-sheet .mobile-filter-close").click();
      await page.waitForTimeout(350);
      if (await page.locator("#mobile-filter-sheet").count() !== 0)
        throw new Error("Nút X không đóng sheet sau khi có tagIds active");
      assertSemanticUrlUnchanged(
        page.url(),
        activeTagIdsUrl,
        `Đóng sheet làm mất tagIds active ở viewport ${width}`,
      );

      await page.getByRole("button", { name: "Lọc độ tuổi", exact: true }).click();
      await page.locator("#mobile-filter-sheet").waitFor({ state: "visible" });
      const clearUrl = page.url();
      await page.locator("#mobile-filter-sheet .mobile-filter-clear").click();
      assertSemanticUrlUnchanged(
        page.url(),
        clearUrl,
        `Xóa bộ lọc làm đổi functional state trước Apply ở viewport ${width}`,
      );
      await page.locator("#mobile-filter-sheet .mobile-filter-apply").click();
      await page.waitForFunction(() => {
        const search = new URL(location.href).searchParams;
        return !search.get("tagIds") && search.get("page") === "1" && search.get("category") === "bot-an-dam" && search.get("q") === "Gerber" && search.get("sort") === "price_asc";
      }, undefined, { timeout: 10000 });
    } finally {
      await context.close();
    }
  }

  // Category navigation phải còn hoạt động dù category không còn là filter sidebar.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "vi-VN" });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/shop`, { waitUntil: "domcontentloaded" });
    await page.locator(".mobile-bottom a").filter({ hasText: "Danh mục" }).click();
    await page.waitForURL(/\/categories$/);
    if (!(await page.locator("body").innerText()).includes("Danh mục dinh dưỡng"))
      throw new Error("Bottom nav Danh mục không mở CategoriesPage");
    await page.getByRole("link", { name: /Bột ăn dặm/ }).first().click();
    await page.waitForURL(/\/category\/bot-an-dam/);
    await page.waitForTimeout(600);
    if (!(await page.locator("body").innerText()).includes("Bột ăn dặm"))
      throw new Error("Category navigation không mở đúng listing");
  } finally {
    await context.close();
  }
}

if (catalogIsEmpty) {
  // Catalog local rỗng vẫn phải kiểm chứng filter metadata và drawer responsive.
  await assertStorefrontFilters();
  await browser.close();
  await import("./admin-category-reactivation.e2e.mjs");
  // Sau cleanup, dùng các smoke chuyên biệt thay vì tạo lại seed/test product.
  await import("./admin-product-stock.e2e.mjs");
  await import("./inventory-reservation.e2e.mjs");
  await import("./product-rich-description.e2e.mjs");
  process.exit(0);
}

await import("./admin-category-reactivation.e2e.mjs");

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

await assertStorefrontFilters();

for (const [path, name] of visualRoutes) {
  await openPage(path, { width: 1440, height: 1000 }, `${name}-desktop.png`);
  await openPage(path, { width: 390, height: 844 }, `${name}-mobile.png`);
}

await openPage("/", { width: 768, height: 1024 }, "home-tablet.png");
await openPage("/shop", { width: 1024, height: 768 }, "shop-1024.png");
await openPage("/shop", { width: 375, height: 844 }, "shop-375.png");
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
await page.waitForFunction(() => document.body.innerText.includes("Bột ăn dặm"), undefined, { timeout: 10000 });
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
  hidden: `E2E-RICE-HIDDEN-${e2eKey}`,
};
try {
  await adminPage.goto(`${baseUrl}/admin/products/new`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(400);
  await adminPage.locator('input[name="name"]').fill("E2E Baby Rice multi variant");
  await adminPage.locator('input[name="slug"]').fill(e2eSlug);
  await adminPage.locator('input[name="sortOrder"]').fill("-999");
  const adminCards = adminPage.locator(".variant-card");
  const addVariant = adminPage.getByRole("button", { name: "+ Thêm phân loại" });
  const openVariantEditor = async (index) => {
    const card = adminCards.nth(index);
    if (await card.locator(".variant-row").count() === 0)
      await card.getByRole("button", { name: "Sửa" }).click();
    return card.locator(".variant-row");
  };
  const fillVariant = async (index, name, packageSize, sku, price, status) => {
    const row = await openVariantEditor(index);
    await row.locator("input").nth(0).fill(name);
    await row.locator("input").nth(1).fill(packageSize);
    await row.locator("input").nth(2).fill(sku);
    await row.locator("input").nth(3).fill(String(price));
    await row.locator('select[aria-invalid]').selectOption(status);
    await row.getByLabel("Tồn kho thực tế").fill("10");
  };
  const uploadVariantImage = async (index, relativePath) => {
    const row = await openVariantEditor(index);
    await row.locator(".variant-image-add input").setInputFiles(
      fileURLToPath(new URL(relativePath, import.meta.url)),
    );
    await row.locator(".variant-image-tile").first().waitFor({ state: "visible" });
  };
  await fillVariant(0, "Táo", "50g", e2eSkus.fifty, 150000, "OUT_OF_STOCK");
  await addVariant.click();
  await addVariant.click();
  await addVariant.click();
  await fillVariant(1, "Chuối", "100g", e2eSkus.oneHundred, 270000, "SELLING");
  await fillVariant(2, "Rau củ", "200g", e2eSkus.twoHundred, 490000, "OUT_OF_STOCK");
  await fillVariant(3, "Nội bộ", "750g", e2eSkus.hidden, 990000, "HIDDEN");
  await uploadVariantImage(0, "../public/images/product-heinz.jpg");
  await uploadVariantImage(1, "../public/images/product-gerber.jpg");
  await uploadVariantImage(2, "../public/images/product-hipp.jpg");
  await adminPage.getByRole("button", { name: "LƯU SẢN PHẨM" }).click();
  await adminPage.waitForURL(/\/admin\/products\/[^/]+\/edit$/);
  createdProductId = new URL(adminPage.url()).pathname.split("/").at(-2) ?? "";
  await adminPage.waitForTimeout(500);
  if (await adminCards.count() !== 4) throw new Error("Admin reload không đủ 4 variants");
  if (await (await openVariantEditor(1)).locator("input").nth(2).inputValue() !== e2eSkus.oneHundred) throw new Error("Admin không giữ SKU row 2");
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
  await adminPage.getByRole("button", { name: /Táo · 50g/ }).click();
  if (!(await adminPage.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().isDisabled())) throw new Error("Variant 50g OUT_OF_STOCK vẫn cho thêm vào giỏ");
  await adminPage.getByRole("button", { name: /Chuối · 100g/ }).click();
  if (await adminPage.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().isDisabled()) throw new Error("Variant 100g AVAILABLE bị chặn mua độc lập");
  if (await adminPage.getByRole("button", { name: /Nội bộ · 750g/ }).count() !== 0) throw new Error("Variant HIDDEN vẫn xuất hiện trên storefront");
  const variantThumbs = adminPage.getByRole("button", { name: /Xem ảnh .* của phân loại/ });
  if (await variantThumbs.count() !== 3) throw new Error("Gallery không hiển thị đúng ảnh của 3 phân loại public");
  await variantThumbs.nth(1).click();
  if (!(await adminPage.getByRole("button", { name: /Chuối · 100g/ }).getAttribute("aria-pressed") === "true")) throw new Error("Chọn ảnh phân loại không đồng bộ selector");
  await adminPage.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().click();
  await adminPage.evaluate(() => localStorage.removeItem("babyjoy.cart.v1"));
  await adminPage.goto(`${baseUrl}/admin/products/${createdProductId}/edit`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(500);

  const firstEditor = await openVariantEditor(0);
  await firstEditor.locator("input").nth(3).fill("160000");
  await firstEditor.locator('select[aria-invalid]').selectOption("SELLING");
  adminPage.once("dialog", (dialog) => dialog.accept());
  await adminCards.nth(1).getByRole("button", { name: /Xóa phân loại Chuối/ }).click();
  await addVariant.click();
  await fillVariant(3, "Gia đình", "500g", e2eSkus.fiveHundred, 900000, "SELLING");
  const updateRequestPromise = adminPage.waitForRequest((request) =>
    request.method() === "PUT" && request.url().endsWith(`/api/admin/products/${createdProductId}`),
  );
  await adminPage.getByRole("button", { name: "LƯU SẢN PHẨM" }).click();
  const updateRequest = await updateRequestPromise;
  const updatePayload = JSON.parse(updateRequest.postData() ?? "{}");
  if (!updatePayload.deletedVariantIds?.includes(deletedVariantId)) throw new Error("Save không gửi deletedVariantIds của 100g");
  await adminPage.waitForTimeout(700);
  if (await adminCards.count() !== 4) throw new Error("Admin sau edit không còn đúng 4 variants");
  const expectedRows = [[e2eSkus.fifty, "160000"], [e2eSkus.twoHundred, "490000"], [e2eSkus.hidden, "990000"], [e2eSkus.fiveHundred, "900000"]];
  for (let index = 0; index < expectedRows.length; index++) {
    const row = await openVariantEditor(index);
    if (await row.locator("input").nth(2).inputValue() !== expectedRows[index][0]) throw new Error("SKU sau edit không đúng");
    if (await row.locator("input").nth(3).inputValue() !== expectedRows[index][1]) throw new Error("Giá sau edit không đúng");
  }
  const afterAdminRead = await adminPage.request.get(`${baseUrl}/api/admin/products/${createdProductId}`);
  const afterAdminBody = await afterAdminRead.json();
  const afterVariants = afterAdminBody.data?.variants ?? [];
  if (afterVariants.length !== 4 || afterVariants.some((variant) => variant.sku === e2eSkus.oneHundred)) throw new Error("Persisted delete 100g không đúng");
  if (afterVariants.find((variant) => variant.sku === e2eSkus.fifty)?.id !== retainedFiftyId || afterVariants.find((variant) => variant.sku === e2eSkus.twoHundred)?.id !== retainedTwoHundredId) throw new Error("Persisted variant ID bị đổi sau delete");

  await adminPage.evaluate(() => localStorage.removeItem("babyjoy.cart.v1"));
  await adminPage.goto(`${baseUrl}/product/${e2eSlug}`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(700);
  if (!(await adminPage.locator("body").innerText()).includes("E2E Baby Rice multi variant")) throw new Error("Public không đọc product E2E");
  if (await adminPage.getByRole("button", { name: /Gia đình · 500g/ }).count() !== 1) throw new Error("Public thiếu variant 500g");
  const publicResponse = await adminPage.request.get(`${baseUrl}/api/products/${e2eSlug}`);
  const publicBody = await publicResponse.json();
  const publicVariants = publicBody.data?.variants ?? [];
  if (publicVariants.length !== 3 || publicVariants.some((variant) => variant.sku === e2eSkus.oneHundred || variant.sku === e2eSkus.hidden)) throw new Error("Public variants sau edit không đúng");
  const publicBySku = new Map(publicVariants.map((variant) => [variant.sku, variant]));
  await adminPage.getByRole("button", { name: /Rau củ · 200g/ }).click();
  if (!(await adminPage.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().isDisabled())) throw new Error("Variant OUT_OF_STOCK vẫn cho thêm vào giỏ");
  await adminPage.getByRole("button", { name: /Táo · 50g/ }).click();
  await adminPage.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().click();
  await adminPage.getByRole("button", { name: /Gia đình · 500g/ }).click();
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

await import("./admin-product-stock.e2e.mjs");
await import("./inventory-reservation.e2e.mjs");
await import("./product-rich-description.e2e.mjs");
await browser.close();
console.log(`E2E_OK routes=${visualRoutes.length * 2 + 7} viewports=375,390,768,1024,1440 storefront-filters=pass cart-persistence=pass filter-url=pass admin-hard-navigation=pass multi-variant-admin-cart=pass`);
