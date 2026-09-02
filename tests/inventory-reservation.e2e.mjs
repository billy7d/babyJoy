import { randomUUID } from "node:crypto";
import { chromium, request } from "playwright";

const baseUrl = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
    : {}),
});
const api = await request.newContext({ extraHTTPHeaders: { accept: "application/json" } });
const customerContexts = [];
let productId = "";
let promotionId = "";
let variantId = "";
let requestACode = "";
let requestBCode = "";
let requestAId = "";
let requestAPrepareRetryId = "";
let requestARetryId = "";
let requestBId = "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonRequest(method, path, data) {
  const response = await api.fetch(baseUrl + path, {
    method,
    headers: data === undefined ? undefined : { "content-type": "application/json" },
    data,
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok())
    throw new Error(
      method + " " + path + " trả HTTP " + response.status() + ": " + JSON.stringify(body),
    );
  return body;
}

async function getAdminProduct() {
  const body = await jsonRequest("GET", "/api/admin/products/" + productId);
  return body.data;
}

async function getRequestByCode(code) {
  const body = await jsonRequest("GET", "/api/admin/cart-requests?scope=all");
  return body.data?.find((item) => item.publicCode === code) ?? null;
}

async function assertInventory(stockOnHand, reservedQuantity, message) {
  const product = await getAdminProduct();
  const variant = product.variants.find((item) => item.id === variantId);
  assert(variant, message + ": không tìm thấy variant");
  assert(
    variant.stockOnHand === stockOnHand &&
      variant.reservedQuantity === reservedQuantity &&
      variant.availableQuantity === stockOnHand - reservedQuantity,
    message +
      ": stock=" +
      variant.stockOnHand +
      ", reserved=" +
      variant.reservedQuantity +
      ", available=" +
      variant.availableQuantity,
  );
}

async function openCustomer(label) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "vi-VN",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  customerContexts.push(context);
  await context.addInitScript((id) => {
    // Chỉ seed một lần; quay lại từ Messenger phải giữ prepared cart của phiên hiện tại.
    if (sessionStorage.getItem("babyjoy.e2e.cartSeeded.v1")) return;
    localStorage.setItem(
      "babyjoy.cart.v1",
      JSON.stringify({ items: [{ variantId: id, quantity: 1 }] }),
    );
    sessionStorage.removeItem("babyjoy.preparedCartShare.v1");
    localStorage.removeItem("babyjoy.cartShareSubmission.v1");
    sessionStorage.setItem("babyjoy.e2e.cartSeeded.v1", "1");
  }, variantId);
  const page = await context.newPage();
  let messengerOpened = 0;
  await page.route("**://m.me/**", async (route) => {
    messengerOpened += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<title>" + label + " Messenger stub</title>",
    });
  });
  await page.goto(baseUrl + "/cart", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("E2E Inventory Reservation") &&
      document.body.innerText.includes("Sản phẩm và ưu đãi chưa được giữ ở bước này."),
  );
  const prepareButton = page.locator("button.direct-prepare");
  await prepareButton.waitFor({ state: "visible" });
  assert(!(await prepareButton.isDisabled()), label + " không thể chốt giỏ");
  await prepareButton.click();
  try {
    await page.waitForURL(/\/cart\/guide\/GH-/, { timeout: 10000 });
  } catch {
    throw new Error(
      label +
        " không chuyển tới hướng dẫn; URL=" +
        page.url() +
        "; body=" +
        (await page.locator("body").innerText()).slice(0, 1200),
    );
  }
  await page.waitForFunction(() =>
    document.body.innerText.includes("Sản phẩm và ưu đãi chưa được giữ ở bước này."),
  );
  return {
    context,
    page,
    get messengerOpened() {
      return messengerOpened;
    },
  };
}

async function activateCustomer(customer, label) {
  const activationResponse = customer.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" &&
      url.pathname === "/api/cart/share/activate"
    );
  });
  const button = customer.page
    .locator(".cart-guide-actions button.btn.primary:visible")
    .first();
  await button.waitFor({ state: "visible" });
  // Đọc body trước khi navigation sang Messenger làm response bị detach.
  const responseWithBody = activationResponse.then(async (response) => ({
    response,
    body: JSON.parse((await response.body()).toString("utf8")),
  }));
  const { response, body } = await Promise.all([responseWithBody, button.click()]).then(
    ([result]) => result,
  );
  assert(response.status() < 500, label + " activation trả lỗi server " + response.status());
  return { response, body };
}

function requestSubmissionToken(response) {
  try {
    return JSON.parse(response.request().postData() ?? "{}").submissionToken ?? "";
  } catch {
    return "";
  }
}

async function prepareCancelledCustomer(customer, oldToken, label) {
  const responses = [];
  const onResponse = (response) => {
    const pathname = new URL(response.url()).pathname;
    if (
      response.request().method() === "POST" &&
      pathname === "/api/cart/share/prepare"
    )
      responses.push({ response, bodyPromise: response.json() });
  };
  customer.page.on("response", onResponse);
  const button = customer.page.locator("button.direct-prepare:visible").first();
  try {
    await button.waitFor({ state: "visible", timeout: 10000 });
    assert(!(await button.isDisabled()), label + " nút prepare đang bị disabled");
    await Promise.all([
      customer.page.waitForURL(/\/cart\/guide\/GH-/),
      button.click(),
    ]);
    await customer.page.waitForTimeout(100);
  } finally {
    customer.page.off("response", onResponse);
  }
  const events = await Promise.all(
    responses.map(async ({ response, bodyPromise }) => ({
      response,
      body: await bodyPromise,
      token: requestSubmissionToken(response),
    })),
  );
  const stale = events.find(
    (event) => event.token === oldToken,
  );
  const fresh = events.find(
    (event) => event.token !== oldToken && event.response.status() === 201,
  );
  assert(
    stale?.response.status() === 409 && stale.body.error?.code === "ORDER_CANCELLED",
    label + " không recovery từ prepare CANCELLED: " +
      JSON.stringify(events.map((event) => ({ status: event.response.status(), token: event.token }))),
  );
  assert(fresh, label + " không tạo prepared request mới");
  return {
    response: fresh.response,
    body: fresh.body,
    token: fresh.token,
  };
}

async function activateCancelledCustomer(customer, oldToken, label) {
  const responses = [];
  const onResponse = (response) => {
    const pathname = new URL(response.url()).pathname;
    if (
      response.request().method() === "POST" &&
      (pathname === "/api/cart/share/prepare" || pathname === "/api/cart/share/activate")
    )
      responses.push({ response, bodyPromise: response.json() });
  };
  customer.page.on("response", onResponse);
  const button = customer.page
    .locator(".cart-guide-actions button.btn.primary:visible")
    .first();
  try {
    await button.waitFor({ state: "visible", timeout: 5000 });
  } catch {
    throw new Error(
      label +
        " không hiển thị nút recovery; URL=" +
        customer.page.url() +
        "; body=" +
        (await customer.page.locator("body").innerText()).slice(-1600) +
        "; storage=" +
        JSON.stringify(
          await customer.page.evaluate(() => ({
            cart: localStorage.getItem("babyjoy.cart.v1"),
            prepared: sessionStorage.getItem("babyjoy.preparedCartShare.v1"),
            token: localStorage.getItem("babyjoy.cartShareSubmission.v1"),
          })),
        ),
    );
  }
  assert(!(await button.isDisabled()), label + " nút recovery đang bị disabled");
  try {
    await Promise.all([
      customer.page.waitForURL(/m\.me\//),
      button.click(),
    ]);
    await customer.page.waitForTimeout(100);
  } finally {
    customer.page.off("response", onResponse);
  }
  const events = await Promise.all(
    responses.map(async ({ response, bodyPromise }) => ({
      response,
      body: await bodyPromise,
      token: requestSubmissionToken(response),
      path: new URL(response.url()).pathname,
    })),
  );
  const first = events.find((event) => event.path === "/api/cart/share/activate" && event.token === oldToken);
  const prepared = events.find((event) => event.path === "/api/cart/share/prepare" && event.token !== oldToken);
  const activation = events.find((event) => event.path === "/api/cart/share/activate" && event.token !== oldToken);
  assert(first?.response.status() === 409 && first.body.error?.code === "ORDER_CANCELLED", label + " không chạm đúng stale CANCELLED attempt: " + JSON.stringify(events.map((event) => ({ path: event.path, status: event.response.status(), token: event.token }))));
  assert(prepared?.response.status() === 201, label + " recovery không tạo prepared request mới");
  assert(activation?.response.status() === 200 && activation.body.cartRequest?.checkoutState === "WAITING_SELLER_CONFIRM", label + " recovery không activate request mới");
  return { firstResponse: first.response, firstBody: first.body, prepareResponse: prepared.response, preparedBody: prepared.body, activationResponse: activation.response, activationBody: activation.body };
}

try {
  await jsonRequest("PUT", "/api/admin/settings/seller", {
    displayName: "E2E BabyJoy",
    label: "Người bán E2E",
    messengerUrl: "https://m.me/babyjoy-e2e",
    avatarKey: "",
  });
  const suffix = String(Date.now()) + "-" + randomUUID().slice(0, 8);
  const productBody = {
    name: "E2E Inventory Reservation",
    slug: "e2e-inventory-reservation-" + suffix,
    status: "AVAILABLE",
    featured: false,
    sortOrder: -999,
    categoryIds: [],
    tagIds: [],
    images: [],
    variants: [
      {
        clientId: "e2e-variant-" + suffix,
        name: "1 món",
        sku: "E2E-INVENTORY-" + suffix,
        priceVnd: 100000,
        compareAtPriceVnd: null,
        availability: "AVAILABLE",
        trackInventory: true,
        stockOnHand: 1,
        sortOrder: 0,
      },
    ],
  };
  const productBodyResponse = await jsonRequest("POST", "/api/admin/products", productBody);
  productId = productBodyResponse.id;
  variantId = productBodyResponse.product.variants[0].id;
  const promotionBody = await jsonRequest("POST", "/api/admin/promotions", {
    name: "E2E Reservation Promotion",
    description: "Promotion dùng để kiểm tra reservation.",
    type: "ORDER_FIXED_DISCOUNT",
    status: "ACTIVE",
    priority: 100,
    stackable: false,
    usageLimitTotal: 1,
    config: {
      type: "ORDER_FIXED_DISCOUNT",
      minimumSubtotal: 1,
      discountAmount: 30000,
    },
  });
  promotionId = promotionBody.id;

  const customerA = await openCustomer("A");
  const customerB = await openCustomer("B");
  requestACode = new URL(customerA.page.url()).pathname.split("/").at(-1);
  requestBCode = new URL(customerB.page.url()).pathname.split("/").at(-1);
  assert(requestACode !== requestBCode, "Hai khách không tạo hai submission token độc lập");
  await assertInventory(1, 0, "Chốt giỏ không được giữ hàng");
  const promotionBeforeActivation = await jsonRequest(
    "GET",
    "/api/admin/promotions/" + promotionId,
  );
  assert(
    promotionBeforeActivation.data.usageCountTotal === 0,
    "Chốt giỏ không được consume promotion",
  );

  const originalSubmissionTokenA = await customerA.page.evaluate(
    () => JSON.parse(localStorage.getItem("babyjoy.cartShareSubmission.v1") ?? "{}").token,
  );
  const originalShareUrlA = await customerA.page.evaluate(
    () => JSON.parse(sessionStorage.getItem("babyjoy.preparedCartShare.v1") ?? "{}").share?.url,
  );

  const activationA = await activateCustomer(customerA, "A");
  assert(
    activationA.response.status() === 200 &&
      activationA.body.cartRequest.checkoutState === "WAITING_SELLER_CONFIRM",
    "A không chuyển sang WAITING_SELLER_CONFIRM: " +
      JSON.stringify(activationA.body),
  );
  const requestARow = await getRequestByCode(requestACode);
  assert(requestARow, "Seller queue không thấy order A");
  requestAId = requestARow.id;
  assert(
    customerA.messengerOpened === 1,
      "A không mở Messenger sau activation thành công; URL=" +
      customerA.page.url() +
      "; body=" +
      (await customerA.page.locator("body").innerText()).slice(-1200) +
      "; storage=" +
      JSON.stringify(
        await customerA.page.evaluate(() => ({
          cart: localStorage.getItem("babyjoy.cart.v1"),
          prepared: sessionStorage.getItem("babyjoy.preparedCartShare.v1"),
        })),
      ),
  );
  await assertInventory(1, 1, "A activation không reserve stock");
  const detailA = await jsonRequest("GET", "/api/admin/cart-requests/" + requestAId);
  assert(
    detailA.data.checkoutState === "WAITING_SELLER_CONFIRM" &&
      detailA.data.reservations?.some((item) => item.status === "ACTIVE") &&
      detailA.data.promotionReservations?.some((item) => item.status === "ACTIVE"),
    "A chưa có đủ inventory/promotion reservation ACTIVE",
  );
  const sellerQueueAfterA = await jsonRequest(
    "GET",
    "/api/admin/cart-requests?scope=queue",
  );
  assert(
    sellerQueueAfterA.data?.some((item) => item.publicCode === requestACode) &&
      !sellerQueueAfterA.data?.some((item) => item.publicCode === requestBCode),
    "Seller queue không lọc đúng READY_TO_SEND",
  );

  const activationBFailure = await activateCustomer(customerB, "B");
  assert(
    activationBFailure.response.status() === 409 &&
      activationBFailure.body.error?.code === "INSUFFICIENT_STOCK",
    "B phải nhận 409 INSUFFICIENT_STOCK",
  );
  assert(customerB.messengerOpened === 0, "B không được mở Messenger khi reserve thất bại");
  await customerB.page.waitForFunction(() =>
    document.body.innerText.includes("Một số sản phẩm vừa hết hàng"),
  );
  await assertInventory(1, 1, "B thất bại làm thay đổi stock/reserved");

  await jsonRequest("POST", "/api/admin/cart-requests/" + requestAId + "/cancel");
  await assertInventory(1, 0, "Seller cancel không release stock");
  const promotionAfterCancel = await jsonRequest(
    "GET",
    "/api/admin/promotions/" + promotionId,
  );
  assert(
    promotionAfterCancel.data.usageCountTotal === 0,
    "Seller cancel không được consume promotion",
  );

  await customerA.page.goBack({ waitUntil: "domcontentloaded" });
  await customerA.page.waitForURL(/\/cart\/guide\/GH-/);
  assert(typeof originalSubmissionTokenA === "string" && originalSubmissionTokenA.length > 0, "Không đọc được submission token A trước khi mở Messenger");
  await customerA.page.evaluate(
    () => sessionStorage.removeItem("babyjoy.preparedCartShare.v1"),
  );
  await customerA.page.goto(baseUrl + "/cart", { waitUntil: "domcontentloaded" });
  await customerA.page.waitForFunction(() =>
    document.body.innerText.includes("Sản phẩm và ưu đãi chưa được giữ ở bước này."),
  );
  const preparedRetryA = await prepareCancelledCustomer(
    customerA,
    originalSubmissionTokenA,
    "A prepare retry",
  );
  const preparedRetryCodeA = preparedRetryA.body.cartRequest.code;
  assert(preparedRetryCodeA !== requestACode, "A prepare retry vẫn dùng public code cũ");
  assert(
    preparedRetryA.body.cartRequest.checkoutState === "READY_TO_SEND" &&
      preparedRetryA.body.share.url !== undefined &&
      preparedRetryA.body.share.url !== originalShareUrlA,
    "A prepare retry không tạo request/link mới hoàn chỉnh",
  );
  assert(customerA.messengerOpened === 1, "Prepare retry không được tự mở Messenger");
  await assertInventory(1, 0, "Prepare retry không được reserve stock");

  const activatedRetryA = await activateCustomer(customerA, "A retry prepared");
  assert(
    activatedRetryA.response.status() === 200 &&
      activatedRetryA.body.cartRequest.checkoutState === "WAITING_SELLER_CONFIRM",
    "A prepared retry không activate được",
  );
  const activatedRetryRowA = await getRequestByCode(preparedRetryCodeA);
  assert(activatedRetryRowA && activatedRetryRowA.id !== requestAId, "A prepared retry không tạo request mới");
  requestAPrepareRetryId = activatedRetryRowA.id;
  const preparedRetryTokenA = preparedRetryA.token;
  await assertInventory(1, 1, "A prepared retry không reserve stock");
  await jsonRequest("POST", "/api/admin/cart-requests/" + requestAPrepareRetryId + "/cancel");
  await assertInventory(1, 0, "Cancel prepared retry của A không release stock");

  await customerA.page.goBack({ waitUntil: "domcontentloaded" });
  await customerA.page.waitForURL(/\/cart\/guide\/GH-/);
  const recoveryA = await activateCancelledCustomer(
    customerA,
    preparedRetryTokenA,
    "A activate race retry",
  );
  const recoveredCodeA = recoveryA.activationBody.cartRequest.code;
  assert(
    recoveredCodeA !== requestACode && recoveredCodeA !== preparedRetryCodeA,
    "A activate race retry vẫn dùng public code cũ",
  );
  const recoveredRowA = await getRequestByCode(recoveredCodeA);
  assert(recoveredRowA, "Seller queue không thấy request mới của A");
  requestARetryId = recoveredRowA.id;
  assert(
    recoveredRowA.id !== requestAId &&
      recoveredRowA.id !== requestAPrepareRetryId &&
      recoveredRowA.checkoutState === "WAITING_SELLER_CONFIRM" &&
      recoveryA.preparedBody.cartRequest.code === recoveredCodeA &&
      recoveryA.preparedBody.share.url !== undefined &&
      recoveryA.preparedBody.share.url !== preparedRetryA.body.share.url,
    "A activate race retry không thay thế bằng request/link mới hoàn chỉnh",
  );
  const recoveredDetailA = await jsonRequest("GET", "/api/admin/cart-requests/" + requestARetryId);
  assert(
    recoveredDetailA.data.reservations?.some((item) => item.status === "ACTIVE") &&
      recoveredDetailA.data.promotionReservations?.some((item) => item.status === "ACTIVE"),
    "A activate race retry chưa có reservation mới ACTIVE",
  );
  assert(customerA.messengerOpened === 3, "Mỗi lần activate thành công phải mở Messenger đúng một lần");
  await assertInventory(1, 1, "A activate race retry không reserve lại stock đúng một lần");
  await jsonRequest("POST", "/api/admin/cart-requests/" + requestARetryId + "/cancel");
  await assertInventory(1, 0, "Cancel request mới của A không release stock");

  const activationB = await activateCustomer(customerB, "B retry");
  assert(
    activationB.response.status() === 200 &&
      activationB.body.cartRequest.checkoutState === "WAITING_SELLER_CONFIRM",
    "B retry không reserve được sau khi A release",
  );
  const requestBRow = await getRequestByCode(requestBCode);
  assert(requestBRow, "Seller queue không thấy order B sau retry");
  requestBId = requestBRow.id;
  assert(
    customerB.messengerOpened === 1,
    "B retry không mở Messenger; URL=" +
      customerB.page.url() +
      "; body=" +
      (await customerB.page.locator("body").innerText()).slice(-1200),
  );
  await assertInventory(1, 1, "B retry không reserve stock");
  const confirmed = await jsonRequest(
    "POST",
    "/api/admin/cart-requests/" + requestBId + "/confirm",
  );
  assert(
    confirmed.checkoutState === "CONFIRMED",
    "Seller confirm không chuyển order B sang CONFIRMED",
  );
  await assertInventory(0, 0, "Seller confirm không consume stock đúng một lần");
  const confirmedAgain = await jsonRequest(
    "POST",
    "/api/admin/cart-requests/" + requestBId + "/confirm",
  );
  assert(
    confirmedAgain.idempotent === true && confirmedAgain.checkoutState === "CONFIRMED",
    "Seller confirm lặp lại không idempotent",
  );
  const promotionAfterConfirm = await jsonRequest(
    "GET",
    "/api/admin/promotions/" + promotionId,
  );
  assert(
    promotionAfterConfirm.data.usageCountTotal === 1,
    "Seller confirm chưa consume promotion đúng một lần",
  );
  const finalDetail = await jsonRequest(
    "GET",
    "/api/admin/cart-requests/" + requestBId,
  );
  assert(
    finalDetail.data.checkoutState === "CONFIRMED" &&
      finalDetail.data.reservations?.every((item) => item.status === "CONSUMED") &&
      finalDetail.data.promotionReservations?.every((item) => item.status === "CONSUMED"),
    "Seller detail không phản ánh resource đã consume",
  );
  console.log(
    "INVENTORY_RESERVATION_E2E_OK stock-race=pass prepare-no-reserve=pass seller-cancel=pass seller-confirm=pass promotion=pass",
  );
} finally {
  for (const customerContext of customerContexts)
    await customerContext.close().catch(() => undefined);
  if (requestAId && !requestBId)
    await jsonRequest("POST", "/api/admin/cart-requests/" + requestAId + "/cancel").catch(() => undefined);
  if (requestAPrepareRetryId)
    await jsonRequest("POST", "/api/admin/cart-requests/" + requestAPrepareRetryId + "/cancel").catch(() => undefined);
  if (requestARetryId)
    await jsonRequest("POST", "/api/admin/cart-requests/" + requestARetryId + "/cancel").catch(() => undefined);
  if (requestBId)
    await jsonRequest("POST", "/api/admin/cart-requests/" + requestBId + "/cancel").catch(() => undefined);
  if (promotionId)
    await jsonRequest("DELETE", "/api/admin/promotions/" + promotionId).catch(() => undefined);
  if (productId)
    await jsonRequest("DELETE", "/api/admin/products/" + productId).catch(() => undefined);
  await api.dispose();
  await browser.close();
}
