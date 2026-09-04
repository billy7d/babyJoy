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
  viewport: { width: 1440, height: 1400 },
  locale: "vi-VN",
});
const page = await context.newPage();
const key = String(Date.now());
const slug = `e2e-rich-description-${key}`;
const imageFixture = fileURLToPath(
  new URL("../public/images/logo.png", import.meta.url),
);
const expectedFontPixels = {
  small: "14px",
  normal: "16px",
  large: "20px",
  extraLarge: "24px",
};
let productId = "";
let storefrontGalleryImageCount = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function approximatelyEqual(left, right, tolerance = 2) {
  return Math.abs(left - right) <= tolerance;
}

async function waitForText(text) {
  await page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    text,
  );
}

async function selectWholeParagraph(editor, text) {
  const paragraph = editor.locator("p").filter({ hasText: text }).first();
  await paragraph.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.waitForTimeout(50);
  return paragraph;
}

async function selectImage(imageNode) {
  await imageNode.locator(".product-description-image-preview").click();
  await page.waitForTimeout(80);
  assert(
    (await imageNode.getAttribute("class"))?.includes("is-selected"),
    "Image node không nhận selection",
  );
}

async function editorBlockOrder(editor) {
  return editor.evaluate((node) =>
    Array.from(node.children).map((child) => {
      const image = child.querySelector(".product-description-image-node");
      return image
        ? `image:${image.getAttribute("data-asset-id")}`
        : child.textContent?.trim() || child.tagName.toLowerCase();
    }),
  );
}

try {
  await page.goto(`${baseUrl}/admin/products/new`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  await page.locator('input[name="name"]').fill(`E2E Rich Product ${key}`);
  await page.locator('input[name="slug"]').fill(slug);
  const variant = page.locator(".variant-row").first();
  await variant.locator("input").nth(0).fill("Hộp rich");
  await variant.locator("input").nth(1).fill(`E2E-RICH-${key}`);
  await variant.locator("input").nth(2).fill("125000");
  await variant.locator("select").selectOption("AVAILABLE");

  const editor = page.locator(".product-description-content .ProseMirror");
  const fontSizeInput = page.locator('input[aria-label="Kích thước chữ"]');
  const fontSizeSelect = page.locator('select[aria-label="Chọn kích thước chữ"]');
  await editor.click();
  await page.locator('select[aria-label="Kiểu đoạn"]').selectOption("1");
  assert((await fontSizeInput.inputValue()) === "28", "H1 không hiển thị point mặc định 28");
  await page.keyboard.type("E2E Rich Heading One");
  await page.keyboard.press("Enter");
  await page.locator('select[aria-label="Kiểu đoạn"]').selectOption("2");
  assert((await fontSizeInput.inputValue()) === "24", "H2 không hiển thị point mặc định 24");
  await page.keyboard.type("E2E Rich Heading");
  await page.keyboard.press("Enter");
  await page.locator('select[aria-label="Kiểu đoạn"]').selectOption("paragraph");
  await page.keyboard.type("E2E Rich Intro ");
  await page.keyboard.press("Control+b");
  await page.keyboard.type("Bold");
  await page.keyboard.press("Control+b");
  await page.keyboard.press("Control+i");
  await page.keyboard.type(" Italic");
  await page.keyboard.press("Control+i");
  await page.keyboard.press("Control+u");
  await page.keyboard.type(" Underline");
  await page.keyboard.press("Control+u");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Image anchor A");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Image anchor B");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Image anchor C");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Partial formatting sample");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Comma format sample");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Custom 27.5 format sample");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Color and size retention");
  await page.keyboard.press("Enter");
  for (const text of [
    "Font token small",
    "Font token normal",
    "Font token large",
    "Font token extraLarge",
    "Mixed small",
    "Mixed large",
    "Multi A ABCDEFGHI",
    "Multi B JKLMNOP",
    "Caret base",
    "Align left sample",
    "Align center sample",
    "Align right sample",
    "Align justify sample",
    "Heading three sample",
    "Heading four sample",
    "Undo format sample",
    "Trailing paragraph",
  ]) {
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  }

  const trailingParagraph = editor.locator("p").filter({ hasText: "Trailing paragraph" }).first();
  await trailingParagraph.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Danh sách dấu đầu dòng" }).click();
  await page.keyboard.type("Bullet list one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Bullet list two");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Danh sách dấu đầu dòng" }).click();
  await page.getByRole("button", { name: "Danh sách đánh số" }).click();
  await page.keyboard.type("Ordered list one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Ordered list two");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Danh sách đánh số" }).click();

  const paragraphA = editor.locator("p").filter({ hasText: "Image anchor A" }).first();
  await paragraphA.click();
  await page.keyboard.press("Home");
  await page.locator('input[aria-label="Thêm ảnh vào mô tả"]').setInputFiles(imageFixture);
  await waitForText("Đã tải ảnh lên.");

  const paragraphB = editor.locator("p").filter({ hasText: "Image anchor B" }).first();
  await paragraphB.click();
  await page.keyboard.press("Home");
  await page.locator('input[aria-label="Thêm ảnh vào mô tả"]').setInputFiles(imageFixture);
  await waitForText("Đã tải ảnh lên.");

  const paragraphC = editor.locator("p").filter({ hasText: "Image anchor C" }).first();
  await paragraphC.click();
  await page.keyboard.press("Home");
  await page.locator('input[aria-label="Thêm ảnh vào mô tả"]').setInputFiles(imageFixture);
  await waitForText("Đã tải ảnh lên.");

  const imageNodes = editor.locator(".product-description-image-node");
  assert((await imageNodes.count()) === 3, "Editor không tạo đủ ba image node");
  const beforeFailedUploadCount = await imageNodes.count();
  await page.locator('input[aria-label="Thêm ảnh vào mô tả"]').setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not-an-image"),
  });
  await waitForText("Chỉ hỗ trợ ảnh JPEG, PNG và WebP.");
  assert(
    (await imageNodes.count()) === beforeFailedUploadCount,
    "Upload lỗi đã làm thay đổi document",
  );

  const imageA = imageNodes.nth(0);
  await selectImage(imageA);
  assert(
    (await page.locator(".product-description-image-controls:visible").count()) === 1,
    "Image A không mở đúng một controls panel",
  );
  await imageA.getByRole("button", { name: "Kích thước ảnh small" }).click();
  await page.waitForTimeout(80);
  const alignmentBoxes = {};
  for (const alignment of ["left", "center", "right"]) {
    await imageA
      .getByRole("button", { name: `Căn ảnh ${alignment === "left" ? "trái" : alignment === "center" ? "giữa" : "phải"}` })
      .click();
    await page.waitForTimeout(80);
    alignmentBoxes[alignment] = await imageA
      .locator(".product-description-image-preview")
      .boundingBox();
  }
  const imageNodeBox = await imageA.boundingBox();
  assert(imageNodeBox && alignmentBoxes.left && alignmentBoxes.center && alignmentBoxes.right, "Không đo được geometry alignment ảnh");
  assert(approximatelyEqual(alignmentBoxes.left.x, imageNodeBox.x), "Căn trái không bám mép trái vùng editor");
  assert(
    approximatelyEqual(
      alignmentBoxes.center.x,
      imageNodeBox.x + (imageNodeBox.width - alignmentBoxes.center.width) / 2,
    ),
    "Căn giữa không dùng margin auto đúng geometry",
  );
  assert(
    approximatelyEqual(alignmentBoxes.right.x + alignmentBoxes.right.width, imageNodeBox.x + imageNodeBox.width),
    "Căn phải không bám mép phải vùng editor",
  );

  const sizeBoxes = {};
  for (const size of ["small", "medium", "large", "full"]) {
    await imageA.getByRole("button", { name: `Kích thước ảnh ${size}` }).click();
    await page.waitForTimeout(80);
    sizeBoxes[size] = await imageA
      .locator(".product-description-image-preview")
      .boundingBox();
  }
  assert(sizeBoxes.small.width < sizeBoxes.medium.width, "Size small không nhỏ hơn medium");
  assert(sizeBoxes.medium.width < sizeBoxes.large.width, "Size medium không nhỏ hơn large");
  assert(approximatelyEqual(sizeBoxes.full.width, sizeBoxes.large.width), "Size full không chiếm toàn vùng editor sau khi large đã chạm giới hạn");
  for (const alignment of ["trái", "giữa", "phải"]) {
    const button = imageA.getByRole("button", { name: `Căn ảnh ${alignment}` });
    assert(await button.isDisabled(), `Nút căn ảnh ${alignment} chưa disabled ở full`);
    assert((await button.getAttribute("aria-disabled")) === "true", `Nút căn ảnh ${alignment} thiếu aria-disabled ở full`);
    assert((await button.getAttribute("title"))?.includes("toàn chiều rộng"), `Nút căn ảnh ${alignment} thiếu tooltip ở full`);
  }
  assert((await imageA.getAttribute("data-align")) === "right", "Full size làm mất alignment đã chọn");
  await imageA.getByRole("button", { name: "Kích thước ảnh medium" }).click();
  assert((await imageA.getAttribute("data-align")) === "right", "Đổi full về medium làm mất alignment đã chọn");
  await imageA.getByRole("textbox", { name: "Alt text" }).fill("User authored alt A");

  const oldAssetId = await imageA.getAttribute("data-asset-id");
  await imageA.locator('input[aria-label="Thay ảnh mô tả"]').setInputFiles(imageFixture);
  await waitForText("Đã tải ảnh lên.");
  await page.waitForFunction(
    (oldId) => document.querySelector(".product-description-image-node")?.getAttribute("data-asset-id") !== oldId,
    oldAssetId,
  );
  assert((await imageA.getAttribute("data-align")) === "right" && (await imageA.getAttribute("data-size")) === "medium", "Thay ảnh làm mất size/alignment");
  assert((await imageA.getByRole("textbox", { name: "Alt text" }).inputValue()) === "User authored alt A", "Thay ảnh làm mất alt text người dùng");
  const replacedAssetId = await imageA.getAttribute("data-asset-id");
  assert(replacedAssetId && replacedAssetId !== oldAssetId, "Thay ảnh không đổi assetId");

  const imageB = imageNodes.nth(1);
  await selectImage(imageB);
  assert((await page.locator(".product-description-image-controls:visible").count()) === 1, "Click image B không đóng controls của image A");
  assert((await imageA.locator(".product-description-image-controls").count()) === 0, "Image A vẫn còn controls sau khi chọn image B");
  await imageB.getByRole("button", { name: "Căn ảnh giữa" }).click();
  await imageB.getByRole("button", { name: "Kích thước ảnh medium" }).click();
  const imageBId = await imageB.getAttribute("data-asset-id");
  const orderBeforeMove = await editorBlockOrder(editor);
  await imageB.getByRole("button", { name: "Đưa ảnh xuống" }).click();
  await page.waitForTimeout(150);
  const orderAfterMove = await editorBlockOrder(editor);
  assert(orderAfterMove.indexOf(`image:${imageBId}`) > orderBeforeMove.indexOf(`image:${imageBId}`), "Reorder ảnh không đổi vị trí block");
  const imageBAfterMove = editor.locator(`.product-description-image-node[data-asset-id="${imageBId}"]`);
  await selectImage(imageBAfterMove);
  await imageBAfterMove.getByRole("button", { name: "Đưa ảnh lên" }).click();
  await page.waitForTimeout(150);
  const orderAfterRestore = await editorBlockOrder(editor);
  assert(orderAfterRestore.indexOf(`image:${imageBId}`) === orderBeforeMove.indexOf(`image:${imageBId}`), "Move lên không khôi phục vị trí image B");
  const imageC = imageNodes.nth(2);
  await selectImage(imageC);
  await imageC.getByRole("button", { name: "Căn ảnh phải" }).click();
  await imageC.getByRole("button", { name: "Kích thước ảnh large" }).click();
  const imageCId = await imageC.getAttribute("data-asset-id");
  assert((await imageC.getAttribute("data-align")) === "right" && (await imageC.getAttribute("data-size")) === "large", "Image C không giữ size/alignment");

  await selectImage(imageA);
  const imageControlsBox = await imageA.locator(".product-description-image-controls").boundingBox();
  const paragraphAfterImageBox = await editor.locator("p").filter({ hasText: "Image anchor B" }).first().boundingBox();
  assert(imageControlsBox && paragraphAfterImageBox, "Không đo được geometry controls/paragraph");
  const imageControlsBottom = imageControlsBox.y + imageControlsBox.height;
  assert(imageControlsBottom <= paragraphAfterImageBox.y + 1, `Controls ảnh đang chồng lên paragraph kế tiếp: controlsBottom=${imageControlsBottom} paragraphTop=${paragraphAfterImageBox.y}`);

  const headingThreeParagraph = editor.locator("p").filter({ hasText: "Heading three sample" }).first();
  await headingThreeParagraph.click();
  await page.waitForTimeout(80);
  await page.locator('select[aria-label="Kiểu đoạn"]').selectOption("3");
  await page.waitForTimeout(120);
  const headingFourParagraph = editor.locator("p").filter({ hasText: "Heading four sample" }).first();
  await headingFourParagraph.click();
  await page.waitForTimeout(80);
  await page.locator('select[aria-label="Kiểu đoạn"]').selectOption("4");
  await page.waitForTimeout(120);
  const headingThree = editor.locator("h3").filter({ hasText: "Heading three sample" }).first();
  const headingFour = editor.locator("h4").filter({ hasText: "Heading four sample" }).first();
  await headingThree.click();
  await page.getByRole("button", { name: "Căn giữa" }).click();
  await headingFour.click();
  await page.getByRole("button", { name: "Căn phải" }).click();
  assert(await headingThree.evaluate((node) => getComputedStyle(node).textAlign) === "center", "Heading H3 không giữ text-align center");
  assert(await headingFour.evaluate((node) => getComputedStyle(node).textAlign) === "right", "Heading H4 không giữ text-align right");

  for (const [text, alignment, label] of [
    ["Align left sample", "left", "trái"],
    ["Align center sample", "center", "giữa"],
    ["Align right sample", "right", "phải"],
    ["Align justify sample", "justify", "đều"],
  ]) {
    const paragraph = editor.locator("p").filter({ hasText: text }).first();
    await paragraph.click();
    await page.getByRole("button", { name: `Căn ${label}` }).click();
    assert(await paragraph.evaluate((node) => getComputedStyle(node).textAlign) === alignment, `Paragraph ${alignment} không có computed text-align đúng`);
  }

  const partialParagraph = await selectWholeParagraph(editor, "Partial formatting sample");
  await partialParagraph.click();
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  for (let index = 0; index < "Partial".length; index += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  const partialBrowserSelection = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  assert(partialBrowserSelection === "Partial", `Browser selection partial sai: ${JSON.stringify(partialBrowserSelection)}`);
  await fontSizeInput.fill("17.5");
  await fontSizeInput.press("Enter");
  await page.waitForTimeout(120);
  assert((await partialParagraph.locator('[data-font-size="17.5pt"]').innerText()) === "Partial", `Font size không chỉ áp dụng cho selected range: html=${await partialParagraph.innerHTML()}`);
  assert((await partialParagraph.locator('[data-font-size="17.5pt"]').count()) === 1, "Partial font size tạo mark không ổn định");
  assert((await fontSizeInput.inputValue()) === "17.5", "Input không chuẩn hóa custom point");
  await fontSizeInput.fill("15.3");
  await fontSizeInput.press("Enter");
  assert((await fontSizeInput.getAttribute("aria-invalid")) === "true", "Input invalid thiếu aria-invalid");
  assert((await partialParagraph.locator('[data-font-size="17.5pt"]').count()) === 1, "Input invalid đã thay đổi document");
  await fontSizeInput.fill("27.5");
  await fontSizeInput.press("Escape");
  assert((await fontSizeInput.inputValue()) === "17.5", "Escape không khôi phục point đã áp dụng");
  assert((await partialParagraph.locator('[data-font-size="17.5pt"]').count()) === 1, "Escape đã thay đổi document");
  const commaParagraph = await selectWholeParagraph(editor, "Comma format sample");
  await fontSizeInput.fill("13,5");
  await fontSizeInput.press("Enter");
  assert((await fontSizeInput.inputValue()) === "13.5", "Input không chuẩn hóa dấu phẩy thành dấu chấm");
  assert((await commaParagraph.locator('[data-font-size="13.5pt"]').count()) === 1, "Input dấu phẩy không lưu point chính xác");
  const customPointParagraph = await selectWholeParagraph(editor, "Custom 27.5 format sample");
  await fontSizeInput.fill("27.5");
  await fontSizeInput.press("Enter");
  assert((await customPointParagraph.locator('[data-font-size="27.5pt"]').count()) === 1, "Input 27.5 không lưu point chính xác");
  for (const invalidPoint of ["7.5", "72.5"]) {
    await fontSizeInput.fill(invalidPoint);
    await fontSizeInput.press("Enter");
    assert((await fontSizeInput.getAttribute("aria-invalid")) === "true", `Point ngoài miền ${invalidPoint} chưa bị từ chối`);
    assert((await customPointParagraph.locator('[data-font-size="27.5pt"]').count()) === 1, `Point ngoài miền ${invalidPoint} đã thay đổi document`);
  }

  const coloredParagraph = await selectWholeParagraph(editor, "Color and size retention");
  await page.getByRole("button", { name: "Màu accent" }).click();
  await selectWholeParagraph(editor, "Color and size retention");
  await fontSizeSelect.selectOption("24pt");
  await page.waitForTimeout(120);
  const coloredMark = coloredParagraph.locator('[data-color="accent"]');
  assert((await coloredMark.count()) === 1, "Không giữ được color mark khi thêm font size");
  assert((await coloredMark.evaluate((node) => getComputedStyle(node).fontSize)) === "32px", "Dropdown 24pt không áp dụng đúng point");
  await selectWholeParagraph(editor, "Color and size retention");
  await fontSizeSelect.selectOption("normal");
  await page.waitForTimeout(120);
  assert((await coloredMark.count()) === 1, "Normal làm mất color mark");
  assert((await coloredMark.getAttribute("data-font-size")) === null, "Normal chưa gỡ fontSize override");
  assert((await coloredMark.evaluate((node) => getComputedStyle(node).fontSize)) === expectedFontPixels.normal, "Normal không trả computed style về 1rem");
  assert((await coloredMark.evaluate((node) => getComputedStyle(node).color)) === "rgb(210, 124, 72)", "Normal làm mất màu accent");

  for (const [size, text] of Object.entries({
    small: "Font token small",
    normal: "Font token normal",
    large: "Font token large",
    extraLarge: "Font token extraLarge",
  })) {
    const paragraph = await selectWholeParagraph(editor, text);
    await fontSizeSelect.selectOption(size);
    await page.waitForTimeout(100);
    const styledNode = paragraph.locator(`[data-font-size="${size}"]`).first();
    const styledCount = await styledNode.count();
    const computedSize = styledCount
      ? await styledNode.evaluate((node) => getComputedStyle(node).fontSize)
      : await paragraph.evaluate((node) => getComputedStyle(node).fontSize);
    assert(computedSize === expectedFontPixels[size], `Computed font size ${size} sai: ${computedSize}`);
    assert((await fontSizeSelect.inputValue()) === size, `Toolbar không phản ánh font size ${size}`);
  }

  const undoParagraph = await selectWholeParagraph(editor, "Undo format sample");
  await fontSizeSelect.selectOption("large");
  await page.waitForTimeout(800);
  assert((await undoParagraph.locator('[data-font-size="large"]').count()) === 1, "Undo test không tạo format large");
  assert(await page.evaluate(() => document.activeElement?.classList.contains("ProseMirror")), "Sau khi chọn font focus không quay về editor");
  const undoButton = page.getByRole("button", { name: "Hoàn tác" });
  const redoButton = page.getByRole("button", { name: "Làm lại" });
  assert(await undoButton.isEnabled(), "Undo button không sẵn sàng sau format");
  await undoButton.click();
  await page.waitForTimeout(80);
  assert((await undoParagraph.locator('[data-font-size="large"]').count()) === 0, `Undo không khôi phục font trước đó: html=${await undoParagraph.innerHTML()}`);
  assert(await redoButton.isEnabled(), "Redo button không sẵn sàng sau undo");
  await redoButton.click();
  await page.waitForTimeout(80);
  assert((await undoParagraph.locator('[data-font-size="large"]').count()) === 1, "Redo không khôi phục font large");

  await selectWholeParagraph(editor, "Mixed small");
  await fontSizeSelect.selectOption("small");
  await selectWholeParagraph(editor, "Mixed large");
  await fontSizeSelect.selectOption("large");
  const mixedSmall = editor.locator("p").filter({ hasText: "Mixed small" }).first();
  await mixedSmall.click();
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.up("Shift");
  await page.waitForTimeout(120);
  assert((await fontSizeSelect.inputValue()) === "mixed", "Toolbar không hiển thị trạng thái nhiều kích thước");

  const multiParagraphA = editor.locator("p").filter({ hasText: "Multi A ABCDEFGHI" }).first();
  const multiParagraphB = editor.locator("p").filter({ hasText: "Multi B JKLMNOP" }).first();
  await multiParagraphA.click();
  await page.keyboard.press("Home");
  for (let index = 0; index < "Multi A ABCDE".length; index += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  for (let index = 0; index < "Multi B JKLM".length; index += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await fontSizeSelect.selectOption("large");
  await page.waitForTimeout(120);
  assert((await multiParagraphA.locator('[data-font-size="large"]').innerText()) === "FGHI", `Multi-paragraph selection sai phần cuối block A: html=${await multiParagraphA.innerHTML()}`);
  const multiMarkedB = multiParagraphB.locator('[data-font-size="large"]');
  const multiMarkedBText = await multiMarkedB.innerText();
  assert(multiMarkedBText.startsWith("Multi B J") && multiMarkedBText.length < "Multi B JKLMNOP".length, `Multi-paragraph selection sai phần đầu block B: html=${await multiParagraphB.innerHTML()}`);
  assert((await multiParagraphA.locator('[data-font-size="large"]').count()) === 1 && (await multiParagraphB.locator('[data-font-size="large"]').count()) === 1, "Multi-paragraph selection format không tách đúng node");

  const caretParagraph = editor.locator("p").filter({ hasText: "Caret base" }).first();
  await caretParagraph.click();
  await page.keyboard.press("End");
  await fontSizeSelect.selectOption("large");
  await page.waitForTimeout(100);
  await page.keyboard.type("WORLD");
  const caretLargeMark = caretParagraph.locator('[data-font-size="large"]');
  assert((await caretLargeMark.count()) === 1 && (await caretLargeMark.innerText()) === "WORLD", `Caret font large không áp dụng cho text gõ tiếp: html=${await caretParagraph.innerHTML()}`);
  assert((await fontSizeSelect.inputValue()) === "large", "Toolbar caret không phản ánh large");
  await fontSizeSelect.selectOption("normal");
  await page.waitForTimeout(100);
  await page.keyboard.type("TEST");
  assert((await caretParagraph.locator('[data-font-size="large"]').innerText()) === "WORLD", "Normal caret làm mất format WORLD");
  assert((await caretParagraph.locator('[data-font-size="normal"]').count()) === 0, "Normal caret tạo redundant fontSize normal");
  assert((await caretParagraph.innerText()).endsWith("WORLDTEST"), "Caret typing không giữ thứ tự text");

  await page.getByRole("button", { name: "LƯU SẢN PHẨM" }).click();
  await page.waitForURL(/\/admin\/products\/[^/]+\/edit$/);
  productId = new URL(page.url()).pathname.split("/").at(-2) ?? "";
  await page.waitForTimeout(900);
  const persisted = await page.request.get(`${baseUrl}/api/admin/products/${productId}`);
  assert(persisted.ok(), "Rich product admin API không đọc được sau Save");
  const persistedBody = await persisted.json();
  const persistedContent = persistedBody.data?.descriptionContent;
  assert(persistedContent?.content, "Save không lưu descriptionContent");
  assert(persistedContent.content.some((node) => node.type === "heading" && node.attrs?.level === 1), "Heading H1 rich không được lưu");
  assert(persistedContent.content.some((node) => node.type === "heading" && node.attrs?.level === 2), "Heading rich không được lưu");
  assert(persistedContent.content.some((node) => node.type === "heading" && node.attrs?.level === 3), "Heading H3 rich không được lưu");
  assert(persistedContent.content.some((node) => node.type === "heading" && node.attrs?.level === 4), "Heading H4 rich không được lưu");
  assert(persistedContent.content.some((node) => node.type === "bulletList"), "Bullet list rich không được lưu");
  assert(persistedContent.content.some((node) => node.type === "orderedList"), "Ordered list rich không được lưu");
  const persistedAlignment = persistedContent.content.filter((node) => node.type === "paragraph" && node.attrs?.textAlign);
  assert(persistedAlignment.some((node) => node.attrs.textAlign === "left") && persistedAlignment.some((node) => node.attrs.textAlign === "center") && persistedAlignment.some((node) => node.attrs.textAlign === "right") && persistedAlignment.some((node) => node.attrs.textAlign === "justify"), "Text alignment rich không được lưu đủ");
  const persistedImageNodes = persistedContent.content.filter((node) => node.type === "productDescriptionImage");
  assert(persistedImageNodes.length === 3, "Save không giữ đủ ba description image");
  const persistedImage = persistedImageNodes.find((node) => node.attrs.assetId === replacedAssetId);
  assert(persistedImage, "Ảnh sau replace không được lưu");
  assert(persistedImage.attrs.alignment === "right" && persistedImage.attrs.size === "medium" && persistedImage.attrs.alt === "User authored alt A", "Persisted image không giữ size/alignment/alt sau replace");
  const persistedImageB = persistedImageNodes.find((node) => node.attrs.assetId === imageBId);
  const persistedImageC = persistedImageNodes.find((node) => node.attrs.assetId === imageCId);
  assert(persistedImageB?.attrs.alignment === "center" && persistedImageB.attrs.size === "medium", "Persisted image B mất attrs");
  assert(persistedImageC?.attrs.alignment === "right" && persistedImageC.attrs.size === "large", "Persisted image C mất attrs");
  const persistedTexts = [];
  const visit = (node) => {
    if (node.type === "text") persistedTexts.push(node);
    for (const child of node.content ?? []) visit(child);
  };
  for (const node of persistedContent.content) visit(node);
  const introMarks = persistedTexts.find((node) => node.text === "Bold");
  assert(introMarks?.marks?.some((mark) => mark.type === "bold") && persistedTexts.find((node) => node.text === " Italic")?.marks?.some((mark) => mark.type === "italic") && persistedTexts.find((node) => node.text === " Underline")?.marks?.some((mark) => mark.type === "underline"), "Bold/italic/underline rich marks không được lưu");
  const persistedPartial = persistedTexts.find((node) => node.text === "Partial");
  assert(persistedPartial?.marks?.some((mark) => mark.type === "textStyle" && mark.attrs?.fontSize === "17.5pt"), "Persisted custom partial font size không đúng");
  const persistedComma = persistedTexts.find((node) => node.text === "Comma format sample");
  assert(persistedComma?.marks?.some((mark) => mark.type === "textStyle" && mark.attrs?.fontSize === "13.5pt"), "Persisted comma point font size không đúng");
  const persistedCustomPoint = persistedTexts.find((node) => node.text === "Custom 27.5 format sample");
  assert(persistedCustomPoint?.marks?.some((mark) => mark.type === "textStyle" && mark.attrs?.fontSize === "27.5pt"), "Persisted 27.5 point font size không đúng");
  const persistedMultiA = persistedTexts.find((node) => node.text === "FGHI");
  const persistedMultiB = persistedTexts.find((node) => typeof node.text === "string" && node.text.startsWith("Multi B J") && node.marks?.some((mark) => mark.type === "textStyle" && mark.attrs?.fontSize === "large"));
  assert(persistedMultiA?.marks?.some((mark) => mark.type === "textStyle" && mark.attrs?.fontSize === "large") && persistedMultiB, "Persisted multi-paragraph font size không đúng");
  const persistedCaretWorld = persistedTexts.find((node) => node.text === "WORLD");
  const persistedCaretTest = persistedTexts.find((node) => node.text === "TEST");
  assert(persistedCaretWorld?.marks?.some((mark) => mark.type === "textStyle" && mark.attrs?.fontSize === "large") && !persistedCaretTest?.marks?.some((mark) => mark.type === "textStyle" && mark.attrs?.fontSize), "Persisted caret font size không đúng");
  const persistedColor = persistedTexts.find((node) => node.text === "Color and size retention");
  assert(persistedColor?.marks?.some((mark) => mark.type === "textStyle" && mark.attrs?.color === "accent" && !mark.attrs?.fontSize), "Normal không gỡ fontSize mà vẫn giữ color trong JSON");
  for (const [size, text] of Object.entries({
    small: "Font token small",
    normal: "Font token normal",
    large: "Font token large",
    extraLarge: "Font token extraLarge",
  })) {
    const node = persistedTexts.find((candidate) => candidate.text === text);
    const mark = node?.marks?.find((candidate) => candidate.type === "textStyle");
    if (size === "normal") assert(!mark?.attrs?.fontSize, "Normal bị lưu fontSize override");
    else assert(mark?.attrs?.fontSize === size, `JSON font size ${size} sai`);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const reloadedEditor = page.locator(".product-description-content .ProseMirror");
  assert((await reloadedEditor.locator(".product-description-image-node").count()) === 3, "Reload admin mất description image");
  assert((await reloadedEditor.locator("h1").filter({ hasText: "E2E Rich Heading One" }).count()) === 1, "Reload admin mất H1 rich");
  assert((await reloadedEditor.locator("h2").filter({ hasText: "E2E Rich Heading" }).count()) === 1, "Reload admin mất heading rich");
  assert((await reloadedEditor.locator("h3").filter({ hasText: "Heading three sample" }).count()) === 1, "Reload admin mất H3 rich");
  assert((await reloadedEditor.locator("h4").filter({ hasText: "Heading four sample" }).count()) === 1, "Reload admin mất H4 rich");
  assert((await reloadedEditor.locator("ol").filter({ hasText: "Ordered list two" }).count()) === 1, "Reload admin mất ordered list rich");
  const reloadedImage = reloadedEditor.locator(`.product-description-image-node[data-asset-id="${replacedAssetId}"]`);
  assert((await reloadedImage.count()) === 1, "Reload admin mất ảnh đã replace");
  await selectImage(reloadedImage);
  assert((await page.locator(".product-description-image-controls:visible").count()) === 1, "Reload không mở controls ảnh đúng cách");
  assert((await reloadedImage.getByRole("textbox", { name: "Alt text" }).inputValue()) === "User authored alt A", "Reload mất alt text");
  assert((await reloadedImage.getAttribute("data-align")) === "right" && (await reloadedImage.getAttribute("data-size")) === "medium", "Reload mất image alignment/size");
  for (const [assetId, alignment, size] of [
    [replacedAssetId, "right", "medium"],
    [imageBId, "center", "medium"],
    [imageCId, "right", "large"],
  ]) {
    const image = reloadedEditor.locator(`.product-description-image-node[data-asset-id="${assetId}"]`);
    assert((await image.getAttribute("data-align")) === alignment && (await image.getAttribute("data-size")) === size, `Reload mất attrs image ${assetId}`);
  }
  for (const [size, text] of Object.entries({
    small: "Font token small",
    normal: "Font token normal",
    large: "Font token large",
    extraLarge: "Font token extraLarge",
  })) {
    const paragraph = reloadedEditor.locator("p").filter({ hasText: text }).first();
    const styledNode = paragraph.locator(`[data-font-size="${size}"]`).first();
    const computedSize = (await styledNode.count())
      ? await styledNode.evaluate((node) => getComputedStyle(node).fontSize)
      : await paragraph.evaluate((node) => getComputedStyle(node).fontSize);
    assert(computedSize === expectedFontPixels[size], `Reload admin computed font ${size} sai: ${computedSize}`);
  }

  for (const viewport of [
    { width: 1440, height: 1400 },
    { width: 1024, height: 1000 },
    { width: 768, height: 1000 },
    { width: 390, height: 844 },
    { width: 375, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(160);
    const responsiveMetrics = await page.evaluate(() => {
      const controls = document.querySelector(".product-description-image-controls");
      const preview = document.querySelector(".product-description-image-preview");
      const editorNode = document.querySelector(".product-description-content .ProseMirror");
      const rect = (element) => {
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
      };
      return {
        documentScrollWidth: document.documentElement.scrollWidth,
        controls: rect(controls),
        preview: rect(preview),
        editor: rect(editorNode),
      };
    });
    assert(responsiveMetrics.documentScrollWidth <= viewport.width + 1, `Admin rich description overflow ở ${viewport.width}px: ${responsiveMetrics.documentScrollWidth}px`);
    assert(responsiveMetrics.controls && responsiveMetrics.controls.right <= viewport.width + 1, `Controls vượt viewport ở ${viewport.width}px`);
    assert(responsiveMetrics.preview && responsiveMetrics.editor && responsiveMetrics.preview.right <= responsiveMetrics.editor.right + 1, `Preview vượt vùng editor ở ${viewport.width}px`);
  }

  await page.goto(`${baseUrl}/product/${slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(850);
  const richDescription = page.locator(".product-rich-description");
  assert((await richDescription.count()) === 1, "Storefront không render rich description");
  const storefrontText = await page.locator("body").innerText();
  assert(storefrontText.includes("E2E Rich Heading") && storefrontText.includes("Bullet list two"), "Storefront thiếu rich content");
  assert(!storefrontText.includes("Cà rốt & Táo – vị ngọt tự nhiên cho bé"), "Storefront vẫn render hardcode demo content");
  assert((await richDescription.locator("h2").filter({ hasText: "E2E Rich Heading" }).count()) === 1, "Storefront mất H2");
  assert((await richDescription.locator("h1").filter({ hasText: "E2E Rich Heading One" }).count()) === 1, "Storefront mất H1");
  assert((await richDescription.locator("h3").filter({ hasText: "Heading three sample" }).count()) === 1, "Storefront mất H3");
  assert((await richDescription.locator("h4").filter({ hasText: "Heading four sample" }).count()) === 1, "Storefront mất H4");
  assert((await richDescription.locator("ul").filter({ hasText: "Bullet list two" }).count()) === 1, "Storefront mất bullet list");
  assert((await richDescription.locator("ol").filter({ hasText: "Ordered list two" }).count()) === 1, "Storefront mất ordered list");
  const storefrontImage = richDescription.locator(".product-rich-image").filter({ has: page.locator(`img[alt="User authored alt A"]`) }).first();
  assert((await richDescription.locator(".product-rich-image").count()) === 3, "Storefront thiếu multiple description image");
  assert((await storefrontImage.count()) === 1, "Storefront mất ảnh đã replace");
  assert((await storefrontImage.getAttribute("data-align")) === "right", "Storefront mất image alignment");
  assert((await storefrontImage.getAttribute("data-size")) === "medium", "Storefront mất image size");
  assert((await storefrontImage.locator('img[alt="User authored alt A"]').count()) === 1, "Storefront mất alt text");
  for (const [assetId, alignment, size] of [
    [replacedAssetId, "right", "medium"],
    [imageBId, "center", "medium"],
    [imageCId, "right", "large"],
  ]) {
    const image = richDescription.locator(`.product-rich-image[data-asset-id="${assetId}"]`);
    assert((await image.count()) === 1 && (await image.getAttribute("data-align")) === alignment && (await image.getAttribute("data-size")) === size, `Storefront mất attrs image ${assetId}`);
  }
  for (const [text, alignment] of [
    ["Align left sample", "left"],
    ["Align center sample", "center"],
    ["Align right sample", "right"],
    ["Align justify sample", "justify"],
  ]) {
    const paragraph = richDescription.locator("p").filter({ hasText: text }).first();
    assert(await paragraph.evaluate((node) => getComputedStyle(node).textAlign) === alignment, `Storefront paragraph ${alignment} text-align sai`);
  }
  assert(await richDescription.locator("h3").filter({ hasText: "Heading three sample" }).first().evaluate((node) => getComputedStyle(node).textAlign) === "center", "Storefront H3 text-align sai");
  assert(await richDescription.locator("h4").filter({ hasText: "Heading four sample" }).first().evaluate((node) => getComputedStyle(node).textAlign) === "right", "Storefront H4 text-align sai");
  const storefrontFigureBox = await storefrontImage.boundingBox();
  const storefrontImageBox = await storefrontImage.locator("img").boundingBox();
  assert(storefrontFigureBox && storefrontImageBox, "Không đo được storefront image geometry");
  assert(approximatelyEqual(storefrontImageBox.x + storefrontImageBox.width, storefrontFigureBox.x + storefrontFigureBox.width), "Storefront căn phải ảnh không đúng geometry");
  for (const [size, text] of Object.entries({
    small: "Font token small",
    normal: "Font token normal",
    large: "Font token large",
    extraLarge: "Font token extraLarge",
  })) {
    const paragraph = richDescription.locator("p").filter({ hasText: text }).first();
    const styledNode = paragraph.locator(`.product-rich-font-${size}`).first();
    const styledCount = await styledNode.count();
    const computedSize = styledCount
      ? await styledNode.evaluate((node) => getComputedStyle(node).fontSize)
      : await paragraph.evaluate((node) => getComputedStyle(node).fontSize);
    assert(computedSize === expectedFontPixels[size], `Storefront computed font ${size} sai: ${computedSize}`);
  }
  assert((await richDescription.locator("p").filter({ hasText: "Multi A ABCDEFGHI" }).locator(".product-rich-font-large").innerText()) === "FGHI", "Storefront mất multi-paragraph font ở block A");
  const storefrontMultiB = richDescription.locator("p").filter({ hasText: "Multi B JKLMNOP" }).locator(".product-rich-font-large");
  const storefrontMultiBText = await storefrontMultiB.innerText();
  assert(storefrontMultiBText.startsWith("Multi B J") && storefrontMultiBText.length < "Multi B JKLMNOP".length, "Storefront mất multi-paragraph font ở block B");
  assert((await richDescription.locator("p").filter({ hasText: "Caret base" }).locator(".product-rich-font-large").innerText()) === "WORLD", "Storefront mất caret font large");
  assert((await richDescription.locator("p").filter({ hasText: "Caret base" }).locator(".product-rich-font-large").count()) === 1, "Storefront caret font bị gộp sai");
  const storefrontColor = richDescription.locator('[data-color="accent"]').filter({ hasText: "Color and size retention" }).first();
  assert((await storefrontColor.evaluate((node) => getComputedStyle(node).color)) === "rgb(210, 124, 72)", "Storefront mất color accent");
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 900 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
    { width: 375, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(140);
    const metrics = await page.evaluate(() => {
      const image = document.querySelector(".product-rich-image img");
      const rect = image?.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        imageRight: rect?.right ?? 0,
        imageWidth: rect?.width ?? 0,
      };
    });
    assert(metrics.scrollWidth <= viewport.width + 1, `Storefront rich overflow ở ${viewport.width}px: ${metrics.scrollWidth}px`);
    assert(metrics.imageRight <= viewport.width + 1, `Storefront image vượt viewport ở ${viewport.width}px`);
    assert(metrics.imageWidth <= viewport.width + 1, `Storefront image quá rộng ở ${viewport.width}px`);
  }

  storefrontGalleryImageCount = await page.locator(".detail-gallery img").count();
  await page.goto(`${baseUrl}/admin/products/${productId}/edit`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const deleteEditor = page.locator(".product-description-content .ProseMirror");
  const deleteImage = deleteEditor.locator(`.product-description-image-node[data-asset-id="${imageCId}"]`);
  await selectImage(deleteImage);
  await deleteImage.getByRole("button", { name: "Xóa ảnh" }).click();
  await page.waitForTimeout(120);
  assert((await deleteEditor.locator(".product-description-image-node").count()) === 2, "Xóa image C không làm node biến mất");
  await page.getByRole("button", { name: "LƯU SẢN PHẨM" }).click();
  await page.waitForURL(/\/admin\/products\/[^/]+\/edit$/);
  await page.waitForTimeout(800);
  const afterDeleteEditor = page.locator(".product-description-content .ProseMirror");
  assert((await afterDeleteEditor.locator(".product-description-image-node").count()) === 2, "Reload sau delete vẫn còn image C");
  assert((await afterDeleteEditor.locator(`.product-description-image-node[data-asset-id="${imageCId}"]`).count()) === 0, "Image C vẫn xuất hiện sau save/reload");
  await page.goto(`${baseUrl}/product/${slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  assert((await page.locator(".product-rich-image").count()) === 2, "Storefront vẫn render image đã delete");
  assert((await page.locator(`.product-rich-image[data-asset-id="${imageCId}"]`).count()) === 0, "Storefront còn image C sau delete");
  assert((await page.locator(".detail-gallery img").count()) === storefrontGalleryImageCount, "Xóa description image làm thay đổi product gallery");
} finally {
  if (productId)
    await page.request.delete(`${baseUrl}/api/admin/products/${productId}`).catch(() => undefined);
  await context.close();
  await browser.close();
}

console.log("PRODUCT_RICH_DESCRIPTION_E2E_OK editor=pass image-geometry=pass font-tokens=pass persistence=pass responsive=pass storefront=pass accessibility=pass");
