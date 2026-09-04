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
const supportPages = [
  ["shipping-policy", "Chính sách vận chuyển"],
  ["buying-guide", "Hướng dẫn mua hàng"],
  ["returns-refunds", "Đổi trả & Hoàn tiền"],
];
let originalPage;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(response, message) {
  assert(response && response.ok(), message);
  return response.json();
}

async function restoreOriginalPage() {
  if (!originalPage) return;
  const currentResponse = await page.request.get(
    `${baseUrl}/api/admin/content-pages/shipping-policy`,
  );
  if (!currentResponse.ok()) return;
  const currentBody = await currentResponse.json();
  const currentUpdatedAt = currentBody.page?.updatedAt;
  if (typeof currentUpdatedAt !== "string") return;
  await page.request.put(`${baseUrl}/api/admin/content-pages/shipping-policy`, {
    data: {
      title: originalPage.title,
      status: originalPage.status,
      content: originalPage.content,
      updatedAt: currentUpdatedAt,
    },
  });
}

try {
  const originalResponse = await page.request.get(
    `${baseUrl}/api/admin/content-pages/shipping-policy`,
  );
  const originalBody = await readJson(originalResponse, "Không đọc được content page gốc");
  originalPage = originalBody.page;

  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.locator(".public-footer").scrollIntoViewIfNeeded();
  await page.getByRole("link", { name: "Chính sách vận chuyển" }).click();
  await page.waitForURL(/\/shipping-policy$/);
  await page.getByRole("heading", { name: originalPage.title }).waitFor();
  assert(
    await page.locator(".public-header").count() === 1 &&
      await page.locator(".public-footer").count() === 1,
    "Trang support không dùng storefront shell hiện tại",
  );
  assert(
    (await page.locator(".product-rich-description").innerText()).includes(
      "Nội dung",
    ),
    "Content page không hiển thị nội dung rich text",
  );
  assert(
    (await page.title()).includes(originalPage.title),
    "Title support page không dùng title từ backend",
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: originalPage.title }).waitFor();
  await page.goBack({ waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/$/);
  await page.goForward({ waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/shipping-policy$/);

  for (const [slug, label] of supportPages) {
    await page.goto(`${baseUrl}/${slug}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: label }).waitFor();
    assert(
      await page.locator(".public-footer").getByRole("link", { name: label }).count() === 1,
      `${slug} thiếu link footer canonical`,
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: label }).waitFor();
  }

  await page.goto(`${baseUrl}/admin/content-pages`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Trang nội dung", level: 1 }).waitFor();
  const shippingRow = page.getByRole("row").filter({ hasText: "Chính sách vận chuyển" });
  await shippingRow.getByRole("link", { name: "Chỉnh sửa" }).click();
  await page.waitForURL(/\/admin\/content-pages\/shipping-policy\/edit$/);
  const editor = page.locator(".product-description-content .ProseMirror");
  await editor.waitFor();
  const marker = `E2E Content Page ${Date.now()}`;
  const titleInput = page.locator('.admin-content-page-card input:not([readonly])').first();
  await titleInput.fill(`${originalPage.title} E2E`);
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(marker);
  await page.keyboard.press("Shift+Home");
  const colorControl = page.getByRole("button", { name: "Màu chữ" });
  await colorControl.click();
  await page.getByRole("dialog", { name: "Màu chữ" }).waitFor();
  const colorHexInput = page.getByRole("textbox", { name: "Mã màu HEX" });
  await colorHexInput.fill("A45B3D");
  await colorHexInput.press("Enter");
  await page.waitForTimeout(120);
  assert(
    (await editor.locator('[data-color="#A45B3D"]').filter({ hasText: marker }).count()) === 1,
    "CMS editor không apply được HEX custom cho selection",
  );
  const markerParagraph = editor.locator("p").filter({ hasText: marker }).first();
  await markerParagraph.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  page.once("dialog", (dialog) => dialog.accept("https://example.com"));
  await page.getByRole("button", { name: "Thêm liên kết" }).click();
  assert(
    await editor.locator('a[href="https://example.com"]').count() === 1,
    "Admin editor không áp dụng được liên kết an toàn",
  );
  await page.waitForTimeout(120);
  await page.getByRole("button", { name: "LƯU THAY ĐỔI" }).click();
  await page.getByRole("status").filter({ hasText: "Đã lưu thay đổi" }).waitFor();

  await page.goto(`${baseUrl}/admin/content-pages/shipping-policy/edit`, { waitUntil: "domcontentloaded" });
  await page.locator(".product-description-content .ProseMirror").waitFor();
  assert(
    (await page.locator('.product-description-content [data-color="#A45B3D"]').filter({ hasText: marker }).count()) === 1,
    "CMS editor reload mất HEX custom",
  );

  await page.goto(`${baseUrl}/shipping-policy`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: `${originalPage.title} E2E` }).waitFor();
  assert(
    (await page.locator(".product-rich-description").innerText()).includes(marker),
    "Storefront không đọc content mới sau Admin save",
  );
  const publicLink = page.locator('.product-rich-description a[href="https://example.com"]');
  assert(await publicLink.count() === 1, "Storefront không render liên kết rich text");
  assert(await publicLink.getAttribute("target") === "_blank", "Liên kết ngoài thiếu target an toàn");
  assert(
    await publicLink.getAttribute("rel") === "noopener noreferrer",
    "Liên kết ngoài thiếu rel an toàn",
  );
  const publicColor = page.locator('.product-rich-description [data-color="#A45B3D"]').filter({ hasText: marker });
  assert(await publicColor.count() === 1, "CMS storefront mất HEX custom");
  assert(await publicColor.evaluate((node) => getComputedStyle(node).color) === "rgb(164, 91, 61)", "CMS storefront render sai HEX custom");
  await page.reload({ waitUntil: "domcontentloaded" });
  assert(
    (await page.locator(".product-rich-description").innerText()).includes(marker),
    "Content mới không persist sau refresh storefront",
  );

  for (const width of [320, 375, 390, 430]) {
    const mobileContext = await browser.newContext({
      viewport: { width, height: 844 },
      locale: "vi-VN",
    });
    const mobilePage = await mobileContext.newPage();
    try {
      await mobilePage.goto(`${baseUrl}/shipping-policy`, { waitUntil: "domcontentloaded" });
      await mobilePage.getByRole("heading", { name: `${originalPage.title} E2E` }).waitFor();
      const dimensions = await mobilePage.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      assert(
        dimensions.scrollWidth <= dimensions.innerWidth,
        `Trang support bị tràn ngang ở viewport ${width}px`,
      );
      await mobilePage.locator(".public-footer").scrollIntoViewIfNeeded();
      const footerLink = mobilePage
        .locator(".public-footer")
        .getByRole("link", { name: "Chính sách vận chuyển" });
      const footerBox = await footerLink.boundingBox();
      assert(
        footerBox && footerBox.height >= 44,
        `Footer link không đủ vùng chạm ở viewport ${width}px`,
      );
      assert(
        await mobilePage.locator(".mobile-bottom").count() === 1,
        `Thiếu mobile bottom navigation ở viewport ${width}px`,
      );
    } finally {
      await mobileContext.close();
    }
  }
} finally {
  await restoreOriginalPage();
  await context.close();
  await browser.close();
}

console.log("CONTENT_PAGES_E2E_OK footer=pass routes=3 direct-refresh-back-forward=pass admin-save-refresh=pass");
