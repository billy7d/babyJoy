import { chromium } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const viewports = [
  ["desktop", { width: 1440, height: 1000 }],
  ["tablet", { width: 768, height: 1024 }],
  ["mobile", { width: 390, height: 844 }],
];

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
    : {}),
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function selectorMetrics(page, selector = ".promotion-selector") {
  return page.evaluate((scopeSelector) => {
    const scope = document.querySelector(scopeSelector);
    const search = scope?.querySelector(".promotion-selector-search");
    const input = search?.querySelector("input");
    const list = scope?.querySelector(".promotion-option-list");
    const firstRow = list?.querySelector(":scope > button");
    const firstText = firstRow?.children[0];
    const box = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width };
    };
    const searchStyle = search ? getComputedStyle(search) : null;
    return {
      searchTag: search?.tagName ?? null,
      searchDisplay: searchStyle?.display ?? null,
      searchDirection: searchStyle?.flexDirection ?? null,
      search: box(search),
      input: box(input),
      list: box(list),
      firstRow: box(firstRow),
      firstText: box(firstText),
    };
  }, selector);
}

function assertSelectorLayout(metrics, label) {
  assert(metrics.searchTag === "DIV", `${label}: search wrapper không còn là DIV độc lập`);
  assert(metrics.searchDisplay === "flex", `${label}: search wrapper không dùng flex`);
  assert(metrics.searchDirection === "row", `${label}: search wrapper bị đổi thành flex-column`);
  assert(metrics.search && metrics.input, `${label}: thiếu search wrapper hoặc input`);
  assert(
    metrics.input.bottom <= metrics.search.bottom + 1,
    `${label}: input tràn khỏi search wrapper (${metrics.input.bottom} > ${metrics.search.bottom})`,
  );
  if (metrics.firstRow) {
    assert(
      metrics.firstRow.top >= metrics.input.bottom - 1,
      `${label}: row đầu chồng lên input (${metrics.firstRow.top} < ${metrics.input.bottom})`,
    );
  }
  if (metrics.firstText) {
    assert(metrics.firstText.width > 42, `${label}: text category vẫn bị khóa trong cột 42px`);
  }
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  assert(
    dimensions.documentWidth <= dimensions.viewportWidth + 1,
    `${label}: phát hiện horizontal overflow ${dimensions.documentWidth} > ${dimensions.viewportWidth}`,
  );
}

async function waitForCategoryRows(page) {
  const rows = page.locator(".category-option-list > button");
  await rows.first().waitFor({ state: "visible", timeout: 5000 });
  return rows;
}

async function selectPromotionType(page, value) {
  // Native select đầu tiên là loại promotion; locator theo thứ tự ổn định hơn accessible name trong runtime SSR này.
  await page.locator("select").first().selectOption(value);
  await page.waitForTimeout(150);
}

async function readSelectedCount(page) {
  return page.locator(".promotion-selection-count").innerText();
}

async function runCategoryInteractionRegression(page) {
  await selectPromotionType(page, "CATEGORY_DISCOUNT");
  const rows = await waitForCategoryRows(page);
  assert((await rows.count()) >= 2, "Category selector cần ít nhất hai category để kiểm tra multi-select");
  assertSelectorLayout(await selectorMetrics(page), "CATEGORY_DISCOUNT");

  await rows.nth(0).click();
  await rows.nth(1).click();
  assert((await page.locator('.category-option-list > button[aria-pressed="true"]').count()) === 2, "Không giữ đúng hai category đã chọn");
  assert((await readSelectedCount(page)) === "2 danh mục đã chọn", "Summary không hiển thị đúng số category đã chọn");
  assert((await page.locator(".promotion-selection-chip").count()) === 2, "Thiếu chip cho category đã chọn");
  assert((await page.locator(".promotion-preview-copy").innerText()).includes("2 danh mục"), "Preview không phản ánh hai category đã chọn");

  const search = page.getByLabel("Tìm danh mục");
  await search.fill("pudding");
  assert((await page.locator(".category-option-list > button").count()) === 1, "Search category không lọc theo tên/slug");
  assert((await page.locator(".promotion-selection-chip").count()) === 2, "Search làm mất summary selection");
  await page.getByRole("button", { name: "Xóa tìm danh mục" }).click();
  assert((await search.inputValue()) === "", "Nút xóa search category không reset input");
  assert((await readSelectedCount(page)) === "2 danh mục đã chọn", "Clear search làm mất selection");

  await search.fill("category-does-not-exist-e2e");
  assert(
    (await page.locator(".promotion-selector-empty").innerText()) === "Không tìm thấy danh mục phù hợp.",
    "Empty state không phân biệt không có dữ liệu và không có kết quả search",
  );
  await page.getByRole("button", { name: "Xóa tìm danh mục" }).click();

  await page.locator(".promotion-selection-chip").first().click();
  assert((await readSelectedCount(page)) === "1 danh mục đã chọn", "Không bỏ chọn được category bằng chip");
  await page.locator(".category-option-list > button").nth(1).click();
  assert((await readSelectedCount(page)) === "0 danh mục đã chọn", "Không bỏ chọn được category bằng row");
  assert((await page.locator(".promotion-selection-chip").count()) === 0, "Chip vẫn còn sau khi bỏ chọn hết");

  await selectPromotionType(page, "QUANTITY_DISCOUNT");
  await page.locator("label").filter({ hasText: "Phạm vi" }).locator("select").selectOption("SELECTED_CATEGORIES");
  const quantityRows = await waitForCategoryRows(page);
  assertSelectorLayout(await selectorMetrics(page), "QUANTITY_DISCOUNT/SELECTED_CATEGORIES");
  await quantityRows.first().click();
  assert((await readSelectedCount(page)) === "1 danh mục đã chọn", "Quantity discount không dùng được category selector");
  assert((await page.locator(".promotion-preview-copy").innerText()).includes("phạm vi đã chọn"), "Quantity discount preview không phản ánh scope đã chọn");
}

async function runProductSearchRegression(page) {
  await selectPromotionType(page, "PRODUCT_DISCOUNT");
  const picker = page.locator(".promotion-selector").first();
  const search = picker.getByLabel("Tìm sản phẩm");
  await search.waitFor({ state: "visible" });
  assertSelectorLayout(await selectorMetrics(page), "PRODUCT_DISCOUNT");

  await search.fill("product-selector-regression");
  await picker.getByRole("button", { name: "Xóa tìm sản phẩm" }).click();
  assert((await search.inputValue()) === "", "Nút xóa search product không reset input");

  const productRows = picker.locator(".promotion-option-list > button");
  if (await productRows.count()) {
    await productRows.first().click();
    assert((await productRows.first().getAttribute("aria-pressed")) === "true", "ProductPicker không giữ selection");
  }
}

try {
  for (const [name, viewport] of viewports) {
    const context = await browser.newContext({ viewport, locale: "vi-VN" });
    const page = await context.newPage();
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      // Bỏ qua lỗi resource bên ngoài; vẫn bắt lỗi JavaScript của ứng dụng.
      if (message.type() === "error" && !message.text().includes("Failed to load resource")) browserErrors.push(message.text());
    });
    try {
      const response = await page.goto(`${baseUrl}/admin/promotions/new`, { waitUntil: "domcontentloaded" });
      await page.locator("select").first().waitFor({ state: "visible", timeout: 5000 });
      // Chờ hydration gắn handler React trước khi thao tác native select.
      await page.waitForTimeout(600);
      if (!response || response.status() >= 500) throw new Error(`${name}: admin promotion editor trả HTTP lỗi`);
      await selectPromotionType(page, "CATEGORY_DISCOUNT");
      await waitForCategoryRows(page);
      assertSelectorLayout(await selectorMetrics(page), `${name}/CATEGORY_DISCOUNT`);
      await assertNoHorizontalOverflow(page, name);
      await runCategoryInteractionRegression(page);
      await runProductSearchRegression(page);
      if (browserErrors.length) throw new Error(`${name}: browser error: ${browserErrors.join(" | ")}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log("PROMOTION_SELECTOR_E2E_OK viewports=desktop,tablet,mobile category=multi-select quantity=selected-categories product-search=checked");
