import { chromium } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
    : {}),
});

const checks = [
  ["/", ["Chưa có sản phẩm"]],
  ["/shop", ["Chưa có sản phẩm"]],
  ["/category/trai-cay-nghien", ["Chưa có sản phẩm"]],
  [`/shop?tag=${encodeURIComponent("Hữu cơ")}`, ["Chưa có sản phẩm"]],
  ["/product/missing-product", ["Chưa có sản phẩm"]],
  ["/categories", ["Danh mục dinh dưỡng", "Trái cây nghiền"]],
  ["/admin/products", ["Chưa có sản phẩm"]],
  ["/admin/categories", ["Danh mục", "Trái cây nghiền"]],
  ["/admin/tags", ["Tags", "Hữu cơ"]],
];

async function verifyEmptyCatalogPage(path, expectedText) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "vi-VN",
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    // Bỏ qua lỗi tải resource bên ngoài; vẫn bắt lỗi JavaScript của ứng dụng.
    if (
      message.type() === "error" &&
      !message.text().includes("Failed to load resource")
    )
      pageErrors.push(message.text());
  });

  try {
    const response = await page.goto(`${baseUrl}${path}`, {
      waitUntil: "domcontentloaded",
    });
    // Chờ hydration và các request catalog/admin hoàn tất trước khi kiểm tra.
    await page
      .waitForFunction(
        (texts) => texts.every((text) => document.body.innerText.includes(text)),
        expectedText,
        { timeout: 5000 },
      )
      .catch(() => undefined);
    const body = await page.locator("body").innerText();
    if (!response || response.status() >= 500)
      throw new Error(
        `${path} trả HTTP ${response?.status() ?? "không có response"}`,
      );
    if (!expectedText.every((text) => body.includes(text)))
      throw new Error(
        `${path} thiếu nội dung mong đợi: ${expectedText.join(", ")}`,
      );
    if (/Oops|unexpected error|Đã có lỗi máy chủ/.test(body))
      throw new Error(`${path} hiển thị lỗi ứng dụng`);
    if (pageErrors.length)
      throw new Error(`${path} có browser error: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

try {
  for (const [path, expectedText] of checks)
    await verifyEmptyCatalogPage(path, expectedText);
} finally {
  await browser.close();
}

console.log(`EMPTY_CATALOG_E2E_OK pages=${checks.length} products=0 taxonomy=retained`);
