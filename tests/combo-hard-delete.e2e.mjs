import { randomUUID } from "node:crypto";
import { chromium, request } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const baseHost = new URL(baseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(baseHost))
  throw new Error("Combo E2E chỉ được phép chạy trên local server.");

const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const componentName = `E2E Combo Component ${suffix}`;
const componentSlug = `e2e-combo-component-${suffix}`;
const comboName = `E2E Combo Browser ${suffix}`;
const comboSlug = `e2e-combo-browser-${suffix}`;
const componentSku = `E2E-COMBO-${suffix}`;
let componentProductId = "";
let componentVariantId = "";
let comboProductId = "";

const api = await request.newContext({
  extraHTTPHeaders: { accept: "application/json" },
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
    : {}),
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function createFixtures() {
  const componentResponse = await api.post(`${baseUrl}/api/admin/products`, {
    data: {
      name: componentName,
      slug: componentSlug,
      status: "AVAILABLE",
      featured: false,
      sortOrder: -2147483646,
      categoryIds: [],
      tagIds: [],
      images: [],
      variants: [{
        clientId: `component-${suffix}`,
        name: "Hũ 120g",
        sku: componentSku,
        priceVnd: 125000,
        compareAtPriceVnd: null,
        availability: "AVAILABLE",
        trackInventory: true,
        stockOnHand: 10,
        sortOrder: 0,
      }],
    },
  });
  const componentBody = await readJson(componentResponse);
  assert(
    componentResponse.ok() && componentBody.id,
    `Không tạo được component: HTTP ${componentResponse.status()}`,
  );
  componentProductId = componentBody.id;
  componentVariantId = componentBody.product?.variants?.[0]?.id ?? "";
  assert(componentVariantId, "Component không có Variant thật.");

  const groupId = `combo-group-${suffix}`;
  const itemId = `combo-item-${suffix}`;
  const comboResponse = await api.post(`${baseUrl}/api/admin/combos`, {
    data: {
      name: comboName,
      slug: comboSlug,
      basePriceVnd: 130000,
      status: "AVAILABLE",
      sortOrder: -2147483647,
      categoryIds: [],
      tagIds: [],
      images: [],
      comboConfig: {
        groupMode: "ALL_GROUPS",
        groups: [{
          id: groupId,
          name: "Món chính",
          description: "Chọn một món",
          selectionType: "CHOOSE",
          minSelect: 1,
          maxSelect: 1,
          items: [{
            id: itemId,
            variantId: componentVariantId,
            fixedQuantity: 0,
            minQuantity: 1,
            maxQuantity: 1,
            priceAdjustment: 5000,
          }],
        }],
      },
    },
  });
  const comboBody = await readJson(comboResponse);
  assert(
    comboResponse.ok() && comboBody.id,
    `Không tạo được Combo: HTTP ${comboResponse.status()}`,
  );
  comboProductId = comboBody.id;
}

async function assertNoHorizontalOverflow(page, viewportWidth) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert(metrics.innerWidth === viewportWidth, `Viewport thực tế sai: ${JSON.stringify(metrics)}`);
  assert(metrics.scrollWidth <= viewportWidth + 1, `Combo gây tràn ngang: ${JSON.stringify(metrics)}`);
}

async function inspectStorefront(viewport) {
  const context = await browser.newContext({ viewport, locale: "vi-VN" });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/shop?q=${encodeURIComponent(comboName)}`, { waitUntil: "domcontentloaded" });
    const card = page.locator(".product-card").filter({ hasText: comboName }).first();
    await card.waitFor({ state: "visible", timeout: 10000 });
    assert((await card.innerText()).includes("COMBO"), `Card Combo thiếu nhãn ở ${viewport.width}px`);
    const comboCta = card.getByRole("link", { name: "Xem Combo" });
    assert(
      await comboCta.count() === 1,
      `Card Combo thiếu CTA ở ${viewport.width}px`,
    );
    const comboCtaLayout = await comboCta.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        display: style.display,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        textAlign: style.textAlign,
      };
    });
    assert(
      ["flex", "inline-flex"].includes(comboCtaLayout.display) &&
        comboCtaLayout.alignItems === "center" &&
        comboCtaLayout.justifyContent === "center" &&
        comboCtaLayout.textAlign === "center",
      `CTA Xem Combo chưa căn giữa ở ${viewport.width}px: ${JSON.stringify(comboCtaLayout)}`,
    );
    await assertNoHorizontalOverflow(page, viewport.width);

    await page.goto(`${baseUrl}/product/${comboSlug}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: comboName }).waitFor({ state: "visible", timeout: 10000 });
    const builder = page.getByLabel("Tùy chọn Combo");
    await builder.waitFor({ state: "visible", timeout: 10000 });
    assert(await builder.getByText("Món chính").count() >= 1, `Combo detail thiếu Group ở ${viewport.width}px`);
    assert(
      (await builder.locator(".field-heading small").first().innerText()) ===
        "Chọn tối thiểu 1 sp / tối đa 1 sp",
      `Rule Group chưa rõ nghĩa ở ${viewport.width}px: ${await builder.innerText()}`,
    );
    const comboErrors = builder.locator(".combo-errors li");
    assert(
      (await comboErrors.count()) === 1 &&
        (await comboErrors.first().innerText()) === "Hãy chọn 1 sản phẩm trong Món chính",
      `Alert Combo chưa đúng một dòng/Group ở ${viewport.width}px: ${await builder.innerText()}`,
    );
    const pickerButtons = builder.locator('.combo-item-stepper button[aria-label="Tăng số lượng"]');
    assert(
      await pickerButtons.count() === 1,
      `Combo detail thiếu picker ở ${viewport.width}px: ${await builder.innerText()}`,
    );

    if (viewport.width <= 639) {
      const mobilePurchaseLayout = await page.evaluate(() => {
        const error = document.querySelector(".combo-builder .combo-errors");
        const quantity = document.querySelector(".combo-builder .detail-quantity");
        const add = document.querySelector(".combo-builder .add-cart");
        const oldCartBar = document.querySelector(".mobile-add-bar");
        const fixedData = (element) => {
          if (!(element instanceof HTMLElement)) return null;
          const rect = element.getBoundingClientRect();
          return {
            position: getComputedStyle(element).position,
            bottomGap: Math.round(window.innerHeight - rect.bottom),
            visible: rect.width > 0 && rect.height > 0,
          };
        };
        return {
          error: fixedData(error),
          quantity: fixedData(quantity),
          add: fixedData(add),
          oldCartBarDisplay: oldCartBar ? getComputedStyle(oldCartBar).display : "missing",
        };
      });
      assert(
        mobilePurchaseLayout.error?.position === "fixed" &&
          mobilePurchaseLayout.quantity?.position === "fixed" &&
          mobilePurchaseLayout.add?.position === "fixed",
        `Cụm mua Combo mobile chưa được ghim đáy: ${JSON.stringify(mobilePurchaseLayout)}`,
      );
      assert(
        mobilePurchaseLayout.error.visible &&
          mobilePurchaseLayout.quantity.visible &&
          mobilePurchaseLayout.add.visible,
        `Cụm mua Combo mobile không hiển thị đầy đủ: ${JSON.stringify(mobilePurchaseLayout)}`,
      );
      assert(
        mobilePurchaseLayout.oldCartBarDisplay === "none",
        `CTA Xem giỏ hàng cũ vẫn còn trên Combo mobile: ${JSON.stringify(mobilePurchaseLayout)}`,
      );

      const beforeScroll = mobilePurchaseLayout;
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(80);
      const afterScroll = await page.evaluate(() => {
        const readBottomGap = (selector) => {
          const element = document.querySelector(selector);
          if (!(element instanceof HTMLElement)) return null;
          return Math.round(window.innerHeight - element.getBoundingClientRect().bottom);
        };
        return {
          errorBottomGap: readBottomGap(".combo-builder .combo-errors"),
          quantityBottomGap: readBottomGap(".combo-builder .detail-quantity"),
          addBottomGap: readBottomGap(".combo-builder .add-cart"),
        };
      });
      assert(
        Math.abs((afterScroll.errorBottomGap ?? 0) - (beforeScroll.error?.bottomGap ?? 0)) <= 2 &&
          Math.abs((afterScroll.quantityBottomGap ?? 0) - (beforeScroll.quantity?.bottomGap ?? 0)) <= 2 &&
          Math.abs((afterScroll.addBottomGap ?? 0) - (beforeScroll.add?.bottomGap ?? 0)) <= 2,
        `Cụm mua Combo không bám viewport khi cuộn: ${JSON.stringify({ beforeScroll, afterScroll })}`,
      );
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    await assertNoHorizontalOverflow(page, viewport.width);
    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
}

try {
  await createFixtures();

  const mobilePage = await inspectStorefront({ width: 390, height: 844 });
  try {
    const builder = mobilePage.getByLabel("Tùy chọn Combo");
    await builder.locator('.combo-item-stepper button[aria-label="Tăng số lượng"]').click();
    await mobilePage.waitForFunction(() => !document.querySelector(".combo-builder .combo-errors"));
    assert(
      await builder.locator(".combo-errors").count() === 0,
      `Alert vẫn hiện sau khi hoàn thành điều kiện Combo: ${await builder.innerText()}`,
    );
    const addButton = builder.getByRole("button", { name: "THÊM COMBO VÀO GIỎ" });
    const quantityControl = builder.locator(".detail-quantity");
    await addButton.waitFor({ state: "visible" });
    assert(
      await quantityControl.isVisible() && await addButton.isVisible(),
      "Sau khi Combo hợp lệ, cụm sticky phải còn số lượng và nút thêm giỏ.",
    );
    assert(await addButton.isEnabled(), "Combo hợp lệ nhưng nút thêm vẫn bị khóa.");
    await addButton.click();
    await mobilePage.waitForFunction(() => {
      const line = JSON.parse(localStorage.getItem("babyjoy.cart.v1") ?? "{}").items?.[0];
      return line?.lineType === "COMBO";
    }, undefined, { timeout: 5000 });
    const successMessage = mobilePage.locator('[role="status"]').filter({ hasText: "Đã thêm Combo vào giỏ hàng" });
    assert(await successMessage.count() === 1, `Combo add không hiển thị thông báo: ${await mobilePage.locator("body").innerText()}`);
    const storedLine = await mobilePage.evaluate(() =>
      JSON.parse(localStorage.getItem("babyjoy.cart.v1") ?? "{}").items?.[0],
    );
    assert(
      storedLine?.lineType === "COMBO" && storedLine?.comboProductId === comboProductId,
      `Local cart không lưu một dòng Combo: ${JSON.stringify(storedLine)}`,
    );

    await mobilePage.goto(`${baseUrl}/cart`, { waitUntil: "domcontentloaded" });
    const cartItem = mobilePage.locator(".cart-item").filter({ hasText: comboName }).first();
    await cartItem.waitFor({ state: "visible", timeout: 10000 });
    await mobilePage.waitForFunction(
      () => document.querySelector(".cart-item")?.textContent?.includes("Hũ 120g"),
      undefined,
      { timeout: 10000 },
    );
    const cartText = await cartItem.innerText();
    assert(cartText.includes("COMBO"), "Cart không hiển thị nhãn COMBO.");
    assert(cartText.includes("Hũ 120g"), `Cart không hiển thị lựa chọn component: ${cartText}`);
    await assertNoHorizontalOverflow(mobilePage, 390);
  } finally {
    await mobilePage.evaluate(() => localStorage.removeItem("babyjoy.cart.v1")).catch(() => undefined);
    await mobilePage.context().close();
  }

  const desktopPage = await inspectStorefront({ width: 1024, height: 900 });
  await desktopPage.context().close();

  const adminContext = await browser.newContext({ viewport: { width: 1024, height: 900 }, locale: "vi-VN" });
  const adminPage = await adminContext.newPage();
  const dialogMessages = [];
  adminPage.on("dialog", async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });
  try {
    await adminPage.goto(`${baseUrl}/admin/products`, { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("button", { name: "Combo", exact: true }).click();
    const comboRow = adminPage.locator(".admin-products-table tbody tr").filter({ hasText: comboName }).first();
    await comboRow.waitFor({ state: "visible", timeout: 10000 });
    assert((await comboRow.innerText()).includes("COMBO"), "Admin filter Combo không hiển thị đúng loại.");

    await adminPage.goto(`${baseUrl}/admin/combos/${comboProductId}/edit`, { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("heading", { name: "Sửa Combo" }).waitFor({ state: "visible", timeout: 10000 });
    const richEditor = adminPage.locator(".product-description-editor");
    await richEditor.waitFor({ state: "visible", timeout: 10000 });
    assert(
      await richEditor.getByLabel("Thanh công cụ mô tả chi tiết").count() === 1,
      "Combo Admin chưa dùng Rich Editor của Product thường.",
    );
    const variantSearch = adminPage.getByPlaceholder("Tìm kiếm...");
    await variantSearch.fill(componentSku);
    const variantOption = adminPage.locator(".combo-variant-options > button").filter({ hasText: componentName }).first();
    await variantOption.waitFor({ state: "visible", timeout: 10000 });
    const optionLayout = await variantOption.evaluate((element) => {
      const name = element.querySelector("b");
      const nameStyle = name ? getComputedStyle(name) : null;
      return {
        optionWidth: element.getBoundingClientRect().width,
        nameWidth: name?.getBoundingClientRect().width ?? 0,
        overflowWrap: nameStyle?.overflowWrap ?? "",
        wordBreak: nameStyle?.wordBreak ?? "",
      };
    });
    assert(
      optionLayout.nameWidth >= 140 &&
        optionLayout.overflowWrap !== "anywhere" &&
        optionLayout.wordBreak !== "break-all",
      `Variant Picker desktop vẫn bó chữ theo cột: ${JSON.stringify(optionLayout)}`,
    );
    await assertNoHorizontalOverflow(adminPage, 1024);
    const deleteButton = adminPage.getByRole("button", { name: /XÓA VĨNH VIỄN/ });
    await deleteButton.waitFor({ state: "visible", timeout: 10000 });
    await deleteButton.click();
    await adminPage.waitForURL((url) => url.pathname === "/admin/products", { timeout: 10000 });
    assert(
      dialogMessages.some((message) => message.includes("XÓA VĨNH VIỄN") && message.includes(comboName)),
      "Thiếu dialog hard-delete có tên Combo.",
    );

    const deletedCombo = await api.get(`${baseUrl}/api/admin/products/${comboProductId}`);
    assert(deletedCombo.status() === 404, `Combo vẫn còn sau hard-delete: HTTP ${deletedCombo.status()}`);
    const retainedComponent = await api.get(`${baseUrl}/api/admin/products/${componentProductId}`);
    assert(retainedComponent.ok(), "Hard-delete Combo đã xóa nhầm Product component.");
  } finally {
    await adminContext.close();
  }

  console.log(
    "COMBO_HARD_DELETE_E2E_OK mobile=390 sticky=purchase-controls alert=conditional desktop=1024 storefront=pass cart=line admin=filter+confirm delete=pass component=retained",
  );
} finally {
  const cleanupIds = [comboProductId, componentProductId].filter(Boolean);
  for (const productId of cleanupIds) {
    const response = await api.get(`${baseUrl}/api/admin/products/${productId}`).catch(() => null);
    if (response?.ok())
      await api
        .delete(`${baseUrl}/api/admin/products/${productId}`, { data: { confirmation: "DELETE" } })
        .catch(() => undefined);
  }
  await api.dispose();
  await browser.close();
}
