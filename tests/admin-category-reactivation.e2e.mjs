import { chromium } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const baseHost = new URL(baseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(baseHost))
  throw new Error("Category reactivation E2E chỉ được phép chạy trên local server.");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "vi-VN",
});
const page = await context.newPage();
const key = String(Date.now());
const categoryName = `[E2E] Category reactivation ${key}`;
const categorySlug = `e2e-category-reactivation-${key}`;
const productName = `[E2E] Hidden product ${key}`;
const productSlug = `e2e-hidden-product-${key}`;
let categoryId = "";
let productId = "";

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

async function readJsonResponse(response) {
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

async function clickAndConfirm(button, expectedText) {
  const dialogPromise = page.waitForEvent("dialog");
  const clickPromise = button.click();
  const dialog = await dialogPromise;
  assert(dialog.message().includes(expectedText), `Confirm text không đúng: ${dialog.message()}`);
  await dialog.accept();
  await clickPromise;
}

try {
  let response = await api("/api/admin/categories", {
    method: "POST",
    body: JSON.stringify({
      name: categoryName,
      slug: categorySlug,
      description: "Category dùng cho regression lifecycle.",
      imageKey: null,
      sortOrder: -999,
      isActive: true,
    }),
  });
  const categoryResult = await readJsonResponse(response);
  assert(response.ok, `Không tạo được category E2E: ${categoryResult.text}`);
  categoryId = categoryResult.body.id;
  assert(categoryId, "API không trả category id.");

  response = await api("/api/admin/products", {
    method: "POST",
    body: JSON.stringify({
      name: productName,
      slug: productSlug,
      brandId: "brand-heinz",
      minAgeMonths: 6,
      isBestSeller: false,
      bestSellerRank: null,
      shortDescription: "Sản phẩm ẩn để kiểm tra category độc lập product status.",
      description: "Không được xuất hiện trên public catalog.",
      status: "HIDDEN",
      featured: false,
      sortOrder: -999,
      categoryIds: [categoryId],
      tagIds: [],
      variants: [
        {
          name: "Nội bộ",
          packageSize: "100g",
          sku: `E2E-CATEGORY-HIDDEN-${key}`,
          priceVnd: 99000,
          availability: "HIDDEN",
          status: "HIDDEN",
          trackInventory: false,
          stockOnHand: 0,
        },
      ],
    }),
  });
  const productResult = await readJsonResponse(response);
  assert(response.ok, `Không tạo được hidden product E2E: ${productResult.text}`);
  productId = productResult.body.id;
  assert(productId, "API không trả product id.");

  await page.goto(`${baseUrl}/admin/categories`, { waitUntil: "domcontentloaded" });
  const initialRow = categoryRow();
  await initialRow.waitFor({ state: "visible" });
  assert((await initialRow.getByText("Đang hoạt động", { exact: true }).count()) === 1, "Category mới không active trên UI");
  assert((await initialRow.getByRole("button", { name: "ẨN DANH MỤC", exact: true }).count()) === 1, "Thiếu action Ẩn danh mục");
  assert((await initialRow.getByRole("button", { name: "KÍCH HOẠT LẠI", exact: true }).count()) === 0, "Category active vẫn có action restore");

  await clickAndConfirm(
    initialRow.getByRole("button", { name: "ẨN DANH MỤC", exact: true }),
    `Ẩn danh mục "${categoryName}"?`,
  );
  let row = categoryRow();
  await row.getByText("Đã ẩn", { exact: true }).waitFor({ state: "visible" });
  assert((await row.getByRole("button", { name: "KÍCH HOẠT LẠI", exact: true }).count()) === 1, "Thiếu action Kích hoạt lại sau khi hide");
  assert((await row.getByRole("button", { name: "ẨN DANH MỤC", exact: true }).count()) === 0, "Category hidden vẫn có action Hide");

  await page.getByRole("button", { name: "Đang hoạt động", exact: true }).click();
  assert((await categoryRow().count()) === 0, "Filter active vẫn hiển thị category hidden");
  await page.getByRole("button", { name: "Đã ẩn", exact: true }).click();
  row = categoryRow();
  await row.waitFor({ state: "visible" });

  await row.getByRole("button", { name: `Sửa ${categoryName}`, exact: true }).click();
  const editor = page.locator(".taxonomy-editor");
  await editor.getByRole("heading", { name: "Sửa phân loại", exact: true }).waitFor({ state: "visible" });
  const productChoice = editor.locator(".category-product-choice").filter({ hasText: productName });
  await productChoice.waitFor({ state: "visible" });
  assert((await productChoice.getByText("Đã ẩn", { exact: true }).count()) === 1, "Product HIDDEN không có status trong category manager");
  assert((await editor.getByRole("button", { name: "KÍCH HOẠT LẠI", exact: true }).count()) === 1, "Editor hidden thiếu action restore");
  assert((await editor.getByRole("button", { name: "ẨN DANH MỤC", exact: true }).count()) === 0, "Editor hidden vẫn có action Hide");

  await clickAndConfirm(
    editor.getByRole("button", { name: "KÍCH HOẠT LẠI", exact: true }),
    `Kích hoạt lại danh mục "${categoryName}"?`,
  );
  await page.getByRole("button", { name: "Tất cả", exact: true }).click();
  row = categoryRow();
  await row.getByText("Đang hoạt động", { exact: true }).waitFor({ state: "visible" });
  assert((await row.getByRole("button", { name: "ẨN DANH MỤC", exact: true }).count()) === 1, "Action không đổi về Hide sau restore");
  assert((await row.getByRole("button", { name: "KÍCH HOẠT LẠI", exact: true }).count()) === 0, "Action restore vẫn còn sau khi active");
  assert((await editor.getByRole("button", { name: "ẨN DANH MỤC", exact: true }).count()) === 1, "Editor không phản ánh trạng thái active sau restore");

  await page.reload({ waitUntil: "domcontentloaded" });
  row = categoryRow();
  await row.getByText("Đang hoạt động", { exact: true }).waitFor({ state: "visible" });
  await row.getByRole("button", { name: `Sửa ${categoryName}`, exact: true }).click();
  const reloadedEditor = page.locator(".taxonomy-editor");
  const reloadedProduct = reloadedEditor.locator(".category-product-choice").filter({ hasText: productName });
  await reloadedProduct.waitFor({ state: "visible" });
  assert((await reloadedProduct.getByText("Đã ẩn", { exact: true }).count()) === 1, "Refresh làm mất product association/status");

  const relationResponse = await api(`/api/admin/categories/${categoryId}/products`);
  const relationBody = await relationResponse.json();
  const relation = relationBody.data?.find((item) => item.id === productId);
  assert(relation?.selected === 1 && relation?.status === "HIDDEN", "Association hoặc product status không được giữ nguyên");

  const publicCategoriesResponse = await api("/api/categories");
  const publicCategories = await publicCategoriesResponse.json();
  assert(publicCategories.data?.some((item) => item.id === categoryId), "Category restored không trở lại public taxonomy");
  const publicProductsResponse = await api(`/api/products?category=${encodeURIComponent(categorySlug)}`);
  const publicProducts = await publicProductsResponse.json();
  assert(!publicProducts.data?.some((item) => item.id === productId), "Product HIDDEN bị expose sau khi restore category");

  console.log("ADMIN_CATEGORY_REACTIVATION_E2E_OK hide=pass restore=pass refresh=pass relation=pass hidden-product=pass local-only=pass");
} finally {
  if (productId)
    await api(`/api/admin/products/${productId}`, { method: "DELETE" }).catch(() => undefined);
  if (categoryId)
    await api(`/api/admin/categories/${categoryId}/permanent`, { method: "DELETE" }).catch(() => undefined);
  await context.close();
  await browser.close();
}
