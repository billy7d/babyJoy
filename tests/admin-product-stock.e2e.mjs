import { randomUUID } from "node:crypto";
import { chromium, request } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const trackedName = `E2E Admin Stock Tracked ${suffix}`;
const untrackedName = `E2E Admin Stock Untracked ${suffix}`;
const api = await request.newContext({
  extraHTTPHeaders: { accept: "application/json" },
});
const browser = await chromium.launch({ headless: true });
const productIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createProduct(name, sku, variants) {
  const response = await api.post(`${baseUrl}/api/admin/products`, {
    data: {
      name,
      slug: `${name.toLowerCase().replaceAll(" ", "-")}-${suffix}`,
      status: "AVAILABLE",
      featured: false,
      sortOrder: -1000,
      categoryIds: [],
      tagIds: [],
      images: [],
      variants: variants.map((variant, index) => ({
        clientId: `${sku}-${index}`,
        compareAtPriceVnd: null,
        sortOrder: index,
        ...variant,
      })),
    },
  });
  const body = await response.json();
  assert(response.ok(), `Không tạo được fixture ${name}: ${JSON.stringify(body)}`);
  productIds.push(body.id);
  return body;
}

async function waitForRow(page, name) {
  await page.waitForFunction(
    (expectedName) =>
      Array.from(document.querySelectorAll(".admin-products-table tbody tr")).some(
        (row) => row.textContent?.includes(expectedName),
      ),
    name,
    { timeout: 5000 },
  );
}

try {
  // Fixture tạm mô phỏng cả product mixed và product hoàn toàn không theo dõi tồn kho.
  const tracked = await createProduct(trackedName, `E2E-ADMIN-STOCK-${suffix}`, [
    {
      name: "9 món",
      sku: `E2E-ADMIN-STOCK-9-${suffix}`,
      priceVnd: 90000,
      availability: "AVAILABLE",
      trackInventory: true,
      stockOnHand: 9,
    },
    {
      name: "8 món",
      sku: `E2E-ADMIN-STOCK-8-${suffix}`,
      priceVnd: 80000,
      availability: "AVAILABLE",
      trackInventory: true,
      stockOnHand: 8,
    },
    {
      name: "Không theo dõi",
      sku: `E2E-ADMIN-STOCK-UNTRACKED-${suffix}`,
      priceVnd: 70000,
      availability: "AVAILABLE",
      trackInventory: false,
      stockOnHand: 99,
    },
  ]);
  await createProduct(untrackedName, `E2E-ADMIN-UNTRACKED-${suffix}`, [
    {
      name: "Không theo dõi",
      sku: `E2E-ADMIN-UNTRACKED-VARIANT-${suffix}`,
      priceVnd: 60000,
      availability: "AVAILABLE",
      trackInventory: false,
      stockOnHand: 99,
    },
  ]);

  assert(
    tracked.product.variants.filter((variant) => variant.trackInventory).reduce(
      (total, variant) => total + variant.stockOnHand,
      0,
    ) === 17,
    "Fixture tracked không có tổng stockOnHand 17",
  );

  for (const viewport of [
    { width: 320, height: 844 },
    { width: 375, height: 844 },
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 430, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 900 },
  ]) {
    const context = await browser.newContext({ viewport, locale: "vi-VN" });
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/admin/products`, { waitUntil: "domcontentloaded" });
      await waitForRow(page, trackedName);
      await waitForRow(page, untrackedName);

      const headers = (await page.locator(".admin-products-table thead th").allTextContents())
        .map((text) => text.trim().toLocaleUpperCase("vi-VN"));
      assert(
        headers.slice(2, 6).join("|") === "DANH MỤC|PHÂN LOẠI|TỒN KHO|GIÁ",
        `Sai thứ tự cột: ${headers.join("|")}`,
      );

      const trackedRow = page.locator(".admin-products-table tbody tr").filter({ hasText: trackedName }).first();
      const trackedCells = await trackedRow.locator("td").allTextContents();
      assert(trackedCells[4]?.trim() === "17", `Hiển thị stock tracked sai: ${trackedCells[4]}`);

      const untrackedRow = page.locator(".admin-products-table tbody tr").filter({ hasText: untrackedName }).first();
      const untrackedStockCell = untrackedRow.locator("td").nth(4);
      assert((await untrackedStockCell.textContent())?.trim() === "—", "Variant không theo dõi bị hiển thị thành số 0");
      assert((await untrackedStockCell.getAttribute("title")) === "Không theo dõi tồn kho", "Thiếu title cho trạng thái không theo dõi");
      assert((await untrackedStockCell.getAttribute("aria-label")) === "Không theo dõi tồn kho", "Thiếu aria-label cho trạng thái không theo dõi");
      assert(await trackedRow.getByRole("link", { name: "Sửa" }).count() === 1, "Thiếu icon sửa sản phẩm");
      if (viewport.width === 390 || viewport.width === 1440)
        await page.screenshot({
          path: `screenshots/actual/admin-products-stock-${viewport.width}.png`,
          fullPage: true,
        });

      const search = page.getByPlaceholder("Tìm kiếm sản phẩm...");
      await search.fill(trackedName);
      await waitForRow(page, trackedName);
      assert(await page.locator(".admin-products-table tbody tr").filter({ hasText: untrackedName }).count() === 0, "Search không lọc đúng product");
      await search.fill("");
      await page.getByRole("button", { name: "Đang bán" }).click();
      await waitForRow(page, trackedName);

      const metrics = await page.evaluate(() => {
        const scroll = document.querySelector(".admin-products-table")?.parentElement;
        return {
          bodyScrollWidth: document.body.scrollWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          tableScrollWidth: scroll?.scrollWidth ?? 0,
          tableClientWidth: scroll?.clientWidth ?? 0,
        };
      });
      assert(
        metrics.bodyScrollWidth <= metrics.viewportWidth &&
          metrics.documentScrollWidth <= metrics.viewportWidth,
        `Horizontal overflow ngoài table: ${JSON.stringify(metrics)}`,
      );
      if (viewport.width <= 430) {
        assert(
          metrics.tableScrollWidth > metrics.tableClientWidth,
          "Bảng không có horizontal scroll nội bộ ở mobile",
        );
      }
    } finally {
      await context.close();
    }
  }
} finally {
  for (const productId of productIds)
    await api.delete(`${baseUrl}/api/admin/products/${productId}`).catch(() => undefined);
  await api.dispose();
  await browser.close();
}

console.log("ADMIN_PRODUCT_STOCK_E2E_OK desktop=1440 mobile=390 stock=17 untracked=dash search=pass filter=pass");
