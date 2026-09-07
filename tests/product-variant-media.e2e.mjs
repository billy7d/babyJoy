import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const outputDir = new URL("../screenshots/actual/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "vi-VN",
});
const page = await context.newPage();
const e2eKey = String(Date.now());
const slug = `e2e-variant-media-${e2eKey}`;
const skus = {
  apple: `E2E-APPLE-${e2eKey}`,
  banana: `E2E-BANANA-${e2eKey}`,
  vegetable: `E2E-VEGETABLE-${e2eKey}`,
};
let productId = "";

const cards = page.locator(".variant-card");
const openEditor = async (index) => {
  const card = cards.nth(index);
  if (await card.locator(".variant-row").count() === 0)
    await card.getByRole("button", { name: "Sửa" }).click();
  return card.locator(".variant-row");
};

const fillVariant = async (index, { name, packageSize, sku, price, compareAtPrice, status }) => {
  const editor = await openEditor(index);
  const inputs = editor.locator("input");
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(packageSize);
  await inputs.nth(2).fill(sku);
  await inputs.nth(3).fill(String(price));
  await inputs.nth(4).fill(compareAtPrice ? String(compareAtPrice) : "");
  await editor.locator("select").selectOption(status);
  await editor.getByLabel("Tồn kho thực tế").fill("10");
};

const uploadImage = async (index, relativePath) => {
  const editor = await openEditor(index);
  const input = editor.locator(".variant-image-add input");
  await input.setInputFiles(
    fileURLToPath(new URL(relativePath, import.meta.url)),
  );
  await editor.locator(".variant-image-tile").first().waitFor({ state: "visible" });
  await input.waitFor({ state: "attached" });
  await page.waitForFunction(
    (selector) => !document.querySelector(selector)?.disabled,
    `.variant-card:nth-child(${index + 1}) .variant-image-add input`,
  );
};

try {
  await page.goto(`${baseUrl}/admin/products/new`, { waitUntil: "domcontentloaded" });
  // Chờ effect tải taxonomy hoàn tất để draft đầu tiên không bị thay lại giữa lúc nhập.
  await page.waitForTimeout(500);
  await page.locator('input[name="name"]').fill("E2E Bột Heinz nhiều phân loại");
  await page.locator('input[name="slug"]').fill(slug);
  await fillVariant(0, {
    name: "Táo",
    packageSize: "120g",
    sku: skus.apple,
    price: 89000,
    compareAtPrice: 99000,
    status: "SELLING",
  });
  await page.getByRole("button", { name: "+ Thêm phân loại" }).click();
  await fillVariant(1, {
    name: "Chuối",
    packageSize: "120g",
    sku: skus.banana,
    price: 92000,
    status: "OUT_OF_STOCK",
  });
  await page.getByRole("button", { name: "+ Thêm phân loại" }).click();
  await fillVariant(2, {
    name: "Rau củ",
    packageSize: "120g",
    sku: skus.vegetable,
    price: 95000,
    status: "HIDDEN",
  });

  await uploadImage(0, "../public/images/product-heinz.jpg");
  await uploadImage(1, "../public/images/product-gerber.jpg");
  await uploadImage(2, "../public/images/product-hipp.jpg");
  await page.screenshot({
    path: fileURLToPath(new URL("variant-editor-desktop.png", outputDir)),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: fileURLToPath(new URL("variant-editor-mobile.png", outputDir)),
    fullPage: true,
  });
  const adminHasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  if (adminHasHorizontalOverflow) throw new Error("Product Editor mobile bị tràn ngang");
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole("button", { name: "LƯU SẢN PHẨM" }).click();
  await page.waitForURL(/\/admin\/products\/[^/]+\/edit$/);
  productId = new URL(page.url()).pathname.split("/").at(-2) ?? "";
  await page.waitForTimeout(500);
  if (await cards.count() !== 3) throw new Error("Admin reload không giữ đủ 3 phân loại");

  const adminResponse = await page.request.get(`${baseUrl}/api/admin/products/${productId}`);
  const adminBody = await adminResponse.json();
  const adminVariants = adminBody.data?.variants ?? [];
  if (adminVariants.length !== 3 || adminVariants.some((variant) => variant.images?.length !== 1))
    throw new Error("Admin API không persist đủ ảnh phân loại");
  if (adminVariants.find((variant) => variant.sku === skus.apple)?.packageSize !== "120g")
    throw new Error("Admin API không persist quy cách");

  await page.goto(`${baseUrl}/product/${slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const appleButton = page.getByRole("button", { name: /Táo · 120g/ });
  const bananaButton = page.getByRole("button", { name: /Chuối · 120g/ });
  if (await appleButton.count() !== 1 || await bananaButton.count() !== 1)
    throw new Error("Storefront thiếu phân loại SELLING hoặc OUT_OF_STOCK");
  if (await page.getByRole("button", { name: /Rau củ · 120g/ }).count() !== 0)
    throw new Error("Storefront vẫn hiển thị phân loại HIDDEN");
  if (await page.getByRole("button", { name: /Xem ảnh .* của phân loại/ }).count() !== 2)
    throw new Error("Gallery không lọc ảnh của phân loại HIDDEN");

  await bananaButton.click();
  if (!(await page.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().isDisabled()))
    throw new Error("Phân loại OUT_OF_STOCK vẫn cho mua");
  await page.getByRole("button", { name: /Xem ảnh 2 của phân loại/ }).click();
  if (await appleButton.getAttribute("aria-pressed") !== "true")
    throw new Error("Chọn ảnh không đồng bộ ngược về phân loại Táo");
  await bananaButton.click();
  if (await page.locator(".detail-thumbs button.active").getAttribute("aria-label") !== "Xem ảnh 3 của phân loại")
    throw new Error("Chọn phân loại không nhảy tới ảnh đại diện tương ứng");

  // Admin bật lại Chuối và storefront phải dùng trạng thái mới sau refresh.
  await page.goto(`${baseUrl}/admin/products/${productId}/edit`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const bananaEditor = await openEditor(1);
  await bananaEditor.locator("select").selectOption("SELLING");
  const updateResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "PUT" && response.url().endsWith(`/api/admin/products/${productId}`),
  );
  await page.getByRole("button", { name: "LƯU SẢN PHẨM" }).click();
  const updateResponse = await updateResponsePromise;
  if (!updateResponse.ok()) throw new Error("Admin không bật lại được phân loại Chuối");

  await page.goto(`${baseUrl}/product/${slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  const refreshedBananaButton = page.getByRole("button", { name: /Chuối · 120g/ });
  await refreshedBananaButton.click();
  if (await page.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().isDisabled())
    throw new Error("Chuối vẫn không mua được sau khi đổi sang SELLING");
  await page.evaluate(() => localStorage.removeItem("babyjoy.cart.v1"));
  await page.getByRole("button", { name: "THÊM VÀO GIỎ" }).first().click();
  const storedCart = await page.evaluate(() => JSON.parse(localStorage.getItem("babyjoy.cart.v1") || "{}"));
  const banana = adminVariants.find((variant) => variant.sku === skus.banana);
  if (
    storedCart.items?.[0]?.variantId !== banana?.id ||
    storedCart.items?.[0]?.variantName !== "Chuối · 120g" ||
    storedCart.items?.[0]?.priceVnd !== 92000 ||
    storedCart.items?.[0]?.imageKey !== banana?.images?.[0]?.r2Key
  ) throw new Error("Cart snapshot không giữ đúng id/tên/giá/ảnh của Chuối");

  // Chốt giỏ tạo draft và Seller đọc đúng snapshot của phân loại đã chọn.
  await page.request.put(`${baseUrl}/api/admin/settings/seller`, {
    data: {
      displayName: "BabyJoy E2E",
      label: "Người bán E2E",
      messengerUrl: "https://m.me/babyjoy-e2e",
      avatarKey: "",
    },
  });
  await page.goto(`${baseUrl}/cart`, { waitUntil: "domcontentloaded" });
  const prepareButton = page.locator("button.direct-prepare");
  await prepareButton.waitFor({ state: "visible" });
  if (await prepareButton.isDisabled()) throw new Error("Không thể chốt giỏ Chuối");
  await Promise.all([
    page.waitForURL(/\/cart\/guide\/GH-/),
    prepareButton.click(),
  ]);
  const publicCode = new URL(page.url()).pathname.split("/").at(-1);
  await page.route("**://m.me/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Messenger E2E</title>" }),
  );
  const activationResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/cart/share/activate",
  );
  await page.locator(".cart-guide-actions button.btn.primary:visible").first().click();
  const activationResponse = await activationResponsePromise;
  if (!activationResponse.ok()) throw new Error("Không thể chuyển draft sang hàng chờ Seller");
  const sellerList = await (
    await page.request.get(
      `${baseUrl}/api/admin/cart-requests?scope=all&q=${encodeURIComponent(publicCode)}&limit=100`,
    )
  ).json();
  const draft = sellerList.data?.find((item) => item.publicCode === publicCode);
  if (!draft) throw new Error("Seller không thấy draft vừa chốt");
  const sellerDetail = await (await page.request.get(`${baseUrl}/api/admin/cart-requests/${draft.id}`)).json();
  const sellerItem = sellerDetail.data?.items?.[0];
  if (
    sellerItem?.variantId !== banana?.id ||
    sellerItem?.variantName !== "Chuối · 120g" ||
    sellerItem?.priceVnd !== 92000 ||
    sellerItem?.imageKey !== banana?.images?.[0]?.r2Key
  ) throw new Error("Draft/Seller snapshot sai id/tên/giá/ảnh của Chuối");
  await page.goto(`${baseUrl}/admin/cart-requests/${draft.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.body.innerText.includes("Đang tải dữ liệu giỏ hàng..."));
  const sellerText = await page.locator("body").innerText();
  if (!sellerText.includes("Chuối · 120g") || !sellerText.includes("92.000"))
    throw new Error(`Seller View không hiển thị đúng Chuối và giá snapshot: ${sellerText.slice(0, 1200)}`);

  await page.screenshot({
    path: fileURLToPath(new URL("variant-product-desktop.png", outputDir)),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: fileURLToPath(new URL("variant-product-mobile.png", outputDir)),
    fullPage: true,
  });

  console.log("PRODUCT_VARIANT_MEDIA_E2E_OK admin-persist=pass statuses=pass gallery-sync=pass cart-snapshot=pass draft-seller=pass viewports=390,1440");
} finally {
  if (productId)
    await page.request.delete(`${baseUrl}/api/admin/products/${productId}`).catch(() => undefined);
  await context.close();
  await browser.close();
}
