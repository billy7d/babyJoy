import { chromium } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
    : {}),
});

const bootstrapContext = await browser.newContext({ locale: "vi-VN" });
const originalResponse = await bootstrapContext.request.get(
  `${baseUrl}/api/admin/settings/store`,
);
if (!originalResponse.ok()) {
  await bootstrapContext.close();
  await browser.close();
  throw new Error(`Không đọc được store settings ban đầu: ${originalResponse.status()}`);
}
const originalBody = await originalResponse.json();
const originalSettings = originalBody.data;
if (
  !originalSettings ||
  typeof originalSettings.displayName !== "string" ||
  typeof originalSettings.contactEmail !== "string" ||
  typeof originalSettings.contactPhone !== "string"
) {
  await bootstrapContext.close();
  await browser.close();
  throw new Error("Store settings ban đầu không hợp lệ.");
}
await bootstrapContext.close();

const displayName = `BabyJoy E2E 🍼 ${Date.now()}`;
const settings = {
  displayName,
  contactEmail: "store-e2e@example.com",
  contactPhone: "0816 950 666",
};

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  if (
    metrics.bodyWidth > metrics.viewportWidth + 1 ||
    metrics.documentWidth > metrics.viewportWidth + 1
  )
    throw new Error(`${label} bị horizontal overflow: ${JSON.stringify(metrics)}`);
}

let desktopContext;
let mobileContext;
try {
  desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "vi-VN",
  });
  const page = await desktopContext.newPage();
  await page.goto(`${baseUrl}/admin/settings`, { waitUntil: "domcontentloaded" });
  const displayInput = page.locator('input[name="displayName"]');
  const emailInput = page.locator('input[name="contactEmail"]');
  const phoneInput = page.locator('input[name="contactPhone"]');
  await displayInput.waitFor({ state: "visible" });
  if ((await displayInput.inputValue()) !== originalSettings.displayName)
    throw new Error("Admin không load đúng tên cửa hàng ban đầu.");

  await displayInput.fill(settings.displayName);
  await emailInput.fill(settings.contactEmail);
  await phoneInput.fill(settings.contactPhone);
  const saveButton = page.getByRole("button", { name: "LƯU CÀI ĐẶT" });
  let saveRequestCount = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      new URL(request.url()).pathname === "/api/admin/settings/store"
    )
      saveRequestCount += 1;
  });
  const saveRequest = page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      new URL(request.url()).pathname === "/api/admin/settings/store",
  );
  await page.evaluate(() => {
    const button = document.querySelector('form button[type="submit"]');
    if (!button) throw new Error("Không tìm thấy nút lưu store settings.");
    button.click();
    button.click();
  });
  const request = await saveRequest;
  if (saveRequestCount !== 1)
    throw new Error(`Double-click tạo ${saveRequestCount} PUT request.`);
  if (JSON.parse(request.postData() ?? "{}")?.displayName !== settings.displayName)
    throw new Error("Admin PUT không gửi payload canonical từ form.");
  await page.getByText("Đã lưu thông tin cửa hàng.", { exact: true }).waitFor();

  await page.reload({ waitUntil: "domcontentloaded" });
  await displayInput.waitFor({ state: "visible" });
  await page.waitForFunction(
    ({ displayName, contactEmail, contactPhone }) =>
      document.querySelector('input[name="displayName"]')?.value === displayName &&
      document.querySelector('input[name="contactEmail"]')?.value === contactEmail &&
      document.querySelector('input[name="contactPhone"]')?.value === contactPhone,
    settings,
  );
  for (const [input, expected] of [
    [displayInput, settings.displayName],
    [emailInput, settings.contactEmail],
    [phoneInput, settings.contactPhone],
  ]) {
    if (await input.inputValue() !== expected)
      throw new Error("Admin reload không giữ đúng store settings.");
  }
  await assertNoHorizontalOverflow(page, "Admin desktop");

  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    settings.displayName,
  );
  const headerName = await page.locator(".public-header .brand span").first().textContent();
  const footer = page.locator(".public-footer");
  const footerText = await footer.innerText();
  if (headerName?.trim() !== settings.displayName)
    throw new Error("Header storefront chưa dùng displayName mới.");
  if (
    !footerText.includes(settings.displayName) ||
    !footerText.includes(settings.contactEmail) ||
    !footerText.includes(settings.contactPhone)
  )
    throw new Error("Footer storefront chưa dùng store settings mới.");
  await assertNoHorizontalOverflow(page, "Storefront desktop");

  const publicResponse = await page.request.get(`${baseUrl}/api/store-settings`);
  const publicBody = await publicResponse.json();
  if (JSON.stringify(publicBody.data) !== JSON.stringify(settings))
    throw new Error("Public settings API chưa trả dữ liệu mới.");

  mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "vi-VN",
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await mobilePage.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    settings.displayName,
  );
  await assertNoHorizontalOverflow(mobilePage, "Storefront mobile");

  console.log(
    `STORE_SETTINGS_E2E_OK displayName=${settings.displayName} email=${settings.contactEmail} phone=${settings.contactPhone}`,
  );
} finally {
  // Restore the exact public values captured before the test so local D1 is not
  // left with E2E data, even if a browser assertion fails midway.
  const restoreContext = await browser.newContext({ locale: "vi-VN" });
  try {
    const restore = await restoreContext.request.put(
      `${baseUrl}/api/admin/settings/store`,
      {
        headers: { "content-type": "application/json" },
        data: originalSettings,
      },
    );
    if (!restore.ok())
      console.error(`Không khôi phục được store settings: ${restore.status()}`);
  } finally {
    await restoreContext.close();
    await desktopContext?.close();
    await mobileContext?.close();
    await browser.close();
  }
}
