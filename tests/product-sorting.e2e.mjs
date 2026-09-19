import { launchSelectedBrowser } from "./playwright-browser.mjs";
import { request } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const suffix = `${Date.now()}`;
const prefix = `E2E Product Sorting ${suffix}`;
const fixtures = [
  { label: "Sort 3", sortOrder: 3, priceVnd: 300000 },
  { label: "Sort 1", sortOrder: 1, priceVnd: 100000 },
  { label: "Sort 2", sortOrder: 2, priceVnd: 200000 },
  { label: "Sort 0", sortOrder: 0, priceVnd: 400000 },
];
const createdIds = [];
const api = await request.newContext({ extraHTTPHeaders: { accept: "application/json" } });
const browser = await launchSelectedBrowser();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonRequest(method, path, data) {
  const response = await api.fetch(baseUrl + path, {
    method,
    headers: data === undefined ? undefined : { "content-type": "application/json" },
    data,
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok(), `${method} ${path} trả HTTP ${response.status()}: ${JSON.stringify(body)}`);
  return body;
}

try {
  for (const [index, fixture] of fixtures.entries()) {
    const body = await jsonRequest("POST", "/api/admin/products", {
      name: `${prefix} ${fixture.label}`,
      slug: `e2e-product-sorting-${suffix}-${index}`,
      shortDescription: "Fixture kiểm tra thứ tự sản phẩm.",
      status: "AVAILABLE",
      featured: false,
      sortOrder: fixture.sortOrder,
      categoryIds: [],
      tagIds: [],
      images: [],
      variants: [{
        clientId: `e2e-sorting-variant-${suffix}-${index}`,
        name: "Gói test",
        sku: `E2E-SORTING-${suffix}-${index}`,
        priceVnd: fixture.priceVnd,
        compareAtPriceVnd: null,
        availability: "AVAILABLE",
        trackInventory: false,
        stockOnHand: 0,
        sortOrder: 0,
      }],
    });
    assert(body.id && body.product?.sortOrder === fixture.sortOrder, `API không trả sortOrder ${fixture.sortOrder}`);
    createdIds.push(body.id);
  }

  const apiRows = await jsonRequest("GET", `/api/admin/products?q=${encodeURIComponent(prefix)}&limit=24&page=1`);
  assert(
    apiRows.data.map((product) => [product.name, product.sortOrder]).map(([, sortOrder]) => sortOrder).join(",") === "1,2,3,0",
    `Admin API không sắp xếp đúng: ${JSON.stringify(apiRows.data)}`,
  );

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "vi-VN" });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/admin/products`, { waitUntil: "domcontentloaded" });
    const search = page.getByPlaceholder("Tìm kiếm sản phẩm...");
    await search.fill(prefix);
    const rows = page.locator(".admin-products-table tbody tr");
    await rows.nth(3).waitFor({ state: "visible", timeout: 10000 });
    const adminNames = await rows.locator("td:nth-child(2) b").allTextContents();
    assert(adminNames.join("|") === fixtures.map((fixture) => `${prefix} ${fixture.label}`).slice(1, 3).concat(`${prefix} Sort 3`, `${prefix} Sort 0`).join("|"), `Admin browser không sắp xếp đúng: ${adminNames.join("|")}`);

    await rows.nth(0).locator('a[aria-label="Sửa"]').click();
    await page.waitForURL(/\/admin\/products\/[^/]+\/edit$/);
    await page.locator('input[name="sortOrder"]').waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector('input[name="sortOrder"]')?.value === "1");
    assert(await page.locator('input[name="sortOrder"]').inputValue() === "1", "Editor không hydrate sortOrder từ backend");

    await page.goto(`${baseUrl}/shop?q=${encodeURIComponent(prefix)}`, { waitUntil: "domcontentloaded" });
    const cards = page.locator(".product-card");
    await cards.nth(3).waitFor({ state: "visible", timeout: 10000 });
    const storefrontNames = await cards.locator("h3").allTextContents();
    assert(storefrontNames.join("|") === adminNames.join("|"), `Storefront không khớp admin: ${storefrontNames.join("|")}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await cards.nth(3).waitFor({ state: "visible", timeout: 10000 });
    const reloadedNames = await cards.locator("h3").allTextContents();
    assert(reloadedNames.join("|") === adminNames.join("|"), "Reload làm mất thứ tự storefront");

    await page.goto(`${baseUrl}/shop?q=${encodeURIComponent(prefix)}&sort=price_desc`, { waitUntil: "domcontentloaded" });
    await page.locator(".product-card").nth(3).waitFor({ state: "visible", timeout: 10000 });
    const priceNames = await page.locator(".product-card h3").allTextContents();
    assert(priceNames.join("|") === ["Sort 0", "Sort 3", "Sort 2", "Sort 1"].map((label) => `${prefix} ${label}`).join("|"), "Sort giá bị ảnh hưởng bởi sort_order");
  } finally {
    await context.close();
  }
  console.log(`PRODUCT_SORTING_E2E_OK browser=${process.env.BABYJOY_BROWSER ?? "chromium"} api=pass admin=pass storefront=pass reload=pass other-sort=pass`);
} finally {
  for (const id of createdIds) {
    await jsonRequest("DELETE", `/api/admin/products/${id}`, { confirmation: "DELETE" }).catch(() => undefined);
  }
  await browser.close();
  await api.dispose();
}
