import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
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
const slug = `e2e-rich-description-${key}`;
let productId = "";

try {
  await page.goto(`${baseUrl}/admin/products/new`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.locator('input[name="name"]').fill(`E2E Rich Product ${key}`);
  await page.locator('input[name="slug"]').fill(slug);
  const variant = page.locator(".variant-row").first();
  await variant.locator("input").nth(0).fill("Hộp rich");
  await variant.locator("input").nth(1).fill(`E2E-RICH-${key}`);
  await variant.locator("input").nth(2).fill("125000");
  await variant.locator("select").selectOption("AVAILABLE");

  const editor = page.locator(".product-description-content .ProseMirror");
  await editor.click();
  await page.locator('select[aria-label="Kiểu đoạn"]').selectOption("2");
  await page.keyboard.type("E2E Rich Heading");
  await page.keyboard.press("Enter");
  await page.locator('select[aria-label="Kiểu đoạn"]').selectOption("paragraph");
  await page.keyboard.type("E2E Rich Paragraph A");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+b");
  await page.keyboard.type("E2E Rich Paragraph B");
  await page.keyboard.press("Control+b");
  await page.getByRole("button", { name: "Căn giữa" }).click();

  const secondParagraph = editor.locator("p").last();
  await secondParagraph.click();
  await page.keyboard.press("Home");
  await page.locator('input[aria-label="Thêm ảnh vào mô tả"]').setInputFiles(
    fileURLToPath(new URL("../public/images/logo.png", import.meta.url)),
  );
  await page.getByText("Đã tải ảnh lên.", { exact: false }).waitFor();
  const imageNode = editor.locator(".product-description-image-node");
  await imageNode.click();
  await page.getByRole("button", { name: "Căn ảnh giữa" }).click();
  await page.getByRole("button", { name: "Kích thước ảnh medium" }).click();
  await imageNode.getByRole("textbox", { name: "Alt text" }).fill("E2E rich image alt");
  await page.getByRole("button", { name: "Đưa ảnh xuống" }).click();

  await page.getByRole("button", { name: "LƯU SẢN PHẨM" }).click();
  await page.waitForURL(/\/admin\/products\/[^/]+\/edit$/);
  productId = new URL(page.url()).pathname.split("/").at(-2) ?? "";
  await page.waitForTimeout(700);
  const persisted = await page.request.get(`${baseUrl}/api/admin/products/${productId}`);
  if (!persisted.ok()) throw new Error("Rich product admin API không đọc được sau Save");
  const persistedBody = await persisted.json();
  const persistedContent = persistedBody.data?.descriptionContent;
  if (persistedContent?.content?.at(-1)?.type !== "productDescriptionImage")
    throw new Error("Reorder ảnh rich không được lưu ở cuối document");
  if (!persistedContent.content.some((node) => node.type === "heading" && node.attrs?.level === 2))
    throw new Error("Heading rich không được lưu");
  if (!persistedContent.content.some((node) => node.type === "paragraph" && node.content?.some((text) => text.text === "E2E Rich Paragraph B")))
    throw new Error("Paragraph rich không được lưu");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  if (await editor.locator("h2").filter({ hasText: "E2E Rich Heading" }).count() !== 1)
    throw new Error("Reload admin mất heading rich");
  if (await editor.locator(".product-description-image-node").count() !== 1)
    throw new Error("Reload admin mất ảnh rich");

  await page.goto(`${baseUrl}/product/${slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  if (await page.locator(".product-rich-description").count() !== 1)
    throw new Error("Storefront không render rich description");
  const storefrontText = await page.locator("body").innerText();
  if (!storefrontText.includes("E2E Rich Heading") || !storefrontText.includes("E2E Rich Paragraph B"))
    throw new Error("Storefront thiếu rich content");
  if (storefrontText.includes("Cà rốt & Táo – vị ngọt tự nhiên cho bé"))
    throw new Error("Storefront vẫn render hardcode demo content");
  if (await page.locator('.product-rich-description > *[data-asset-id]').count() !== 1)
    throw new Error("Storefront thiếu description image hoặc đưa ảnh vào gallery");
  const blockOrder = await page.locator(".product-rich-description > *").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-asset-id") ? "image" : node.textContent?.trim() || node.tagName.toLowerCase()),
  );
  if (blockOrder.at(-1) !== "image") throw new Error("Storefront sai thứ tự block sau reorder");
  if (await page.locator('.product-rich-description img[alt="E2E rich image alt"]').count() !== 1)
    throw new Error("Storefront không giữ alt text ảnh rich");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const mobileScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  if (mobileScrollWidth > 390) throw new Error(`Product Detail rich bị overflow mobile: ${mobileScrollWidth}px`);
  const imageBox = await page.locator(".product-rich-description img").boundingBox();
  if (imageBox && imageBox.width > 390) throw new Error("Description image vượt viewport mobile");
} finally {
  if (productId)
    await page.request.delete(`${baseUrl}/api/admin/products/${productId}`).catch(() => undefined);
  await context.close();
  await browser.close();
}

console.log("PRODUCT_RICH_DESCRIPTION_E2E_OK editor=pass image=pass reorder=pass storefront=pass mobile=pass");
