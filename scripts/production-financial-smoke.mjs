import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://metraphuong.com";
const REQUIRED_CASES = ["noPromo", "realized", "giftOnly", "freeShipping"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0)
    throw new Error(`${field} must be a non-negative safe integer.`);
  return normalized;
}

/** Chỉ chấp nhận access URL production; không in credential ra log. */
export function validateAccessUrl(value) {
  if (typeof value !== "string" || value.length === 0)
    throw new Error("STOREFRONT_FINANCIAL_SMOKE_ACCESS_URL is required.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Financial smoke access URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "metraphuong.com" ||
    !/^\/access\/[^/]+$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error("Financial smoke access URL must be an https metraphuong.com access path.");
  return url;
}

function validateItems(value, caseName) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    throw new Error(`${caseName} smoke case must contain 1 to 50 items.`);
  const seen = new Set();
  return value.map((item) => {
    if (!isRecord(item) || typeof item.variantId !== "string" || !item.variantId.trim())
      throw new Error(`${caseName} smoke case contains an invalid variant identifier.`);
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99)
      throw new Error(`${caseName} smoke case contains an invalid quantity.`);
    if (seen.has(item.variantId))
      throw new Error(`${caseName} smoke case contains a duplicate variant.`);
    seen.add(item.variantId);
    return { variantId: item.variantId.trim(), quantity };
  });
}

/** Parse fixture secret mà không nhận giá, discount hoặc tổng từ fixture. */
export function parseSmokeCases(value) {
  let parsed;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("SHIPPING_FINANCIAL_SMOKE_CASES_JSON is invalid JSON.");
  }
  if (!isRecord(parsed))
    throw new Error("Financial smoke cases must be a JSON object.");
  const cases = {};
  REQUIRED_CASES.forEach((caseName) => {
    cases[caseName] = validateItems(parsed[caseName], caseName);
  });
  return cases;
}

function cookiePairs(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ?? "").split(/,(?=\s*[^;,=]+=[^;,]+)/);
  return values
    .map((value) => value.split(";", 1)[0].trim())
    .filter((value) => value.includes("="));
}

async function issueSmokeSession(accessUrl) {
  const response = await fetch(accessUrl, {
    redirect: "manual",
    headers: { accept: "text/html" },
  });
  if (response.status !== 303)
    throw new Error(`Financial smoke access link returned HTTP ${response.status}.`);
  const cookies = cookiePairs(response);
  if (!cookies.length)
    throw new Error("Financial smoke access link did not issue a session cookie.");
  return cookies.join("; ");
}

async function authorizedFetch(path, cookie, init = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.headers ?? {}),
      cookie,
    },
  });
}

function realizedFromResponse(body) {
  const promotions = Array.isArray(body.appliedPromotions)
    ? body.appliedPromotions
    : [];
  const gifts = Array.isArray(body.gifts) ? body.gifts : [];
  return promotions.some(
    (promotion) =>
      Number(promotion?.discountAmountVnd) > 0 || promotion?.freeShipping === true,
  ) || gifts.length > 0;
}

/** Kiểm tra total authoritative và từng loại financial fixture bắt buộc. */
export function assertSmokeResult(caseName, body) {
  if (!isRecord(body)) throw new Error(`${caseName} smoke response is not an object.`);
  const subtotal = safeInteger(body.subtotalVnd, `${caseName}.subtotalVnd`);
  const discount = safeInteger(body.discountTotalVnd, `${caseName}.discountTotalVnd`);
  const shipping = safeInteger(body.shippingFeeVnd, `${caseName}.shippingFeeVnd`);
  const finalTotal = safeInteger(body.finalTotalVnd, `${caseName}.finalTotalVnd`);
  if (shipping !== 0 && shipping !== 15_000)
    throw new Error(`${caseName} returned an invalid shipping amount.`);
  if (finalTotal !== Math.max(0, subtotal - discount) + shipping)
    throw new Error(`${caseName} returned an inconsistent authoritative total.`);
  const realized = realizedFromResponse(body);
  if (body.hasRealizedPromotion !== realized)
    throw new Error(`${caseName} realized-promotion flag is inconsistent.`);
  if (caseName === "noPromo" && (realized || shipping !== 15_000))
    throw new Error("noPromo smoke case did not receive the standard shipping fee.");
  if (caseName === "realized" && (!realized || shipping !== 0))
    throw new Error("realized smoke case did not waive shipping from a real benefit.");
  if (
    caseName === "giftOnly" &&
    (!Array.isArray(body.gifts) || body.gifts.length === 0 || discount !== 0 || shipping !== 0)
  )
    throw new Error("giftOnly smoke case did not produce a gift-only shipping waiver.");
  if (
    caseName === "freeShipping" &&
    (body.freeShipping !== true || discount !== 0 || shipping !== 0)
  )
    throw new Error("freeShipping smoke case did not produce direct Free Shipping.");
  return { subtotal, discount, shipping, finalTotal };
}

export async function runProductionFinancialSmoke({ accessUrl, cases }) {
  const url = validateAccessUrl(accessUrl);
  const parsedCases = parseSmokeCases(cases);
  const cookie = await issueSmokeSession(url.toString());
  const sessionResponse = await authorizedFetch("/api/storefront/session", cookie);
  if (!sessionResponse.ok) throw new Error("Financial smoke session verification failed.");
  const session = await sessionResponse.json();
  if (session.authenticated !== true || session.gateEnabled !== true)
    throw new Error("Financial smoke did not verify an authenticated gated storefront.");
  const results = {};
  for (const caseName of REQUIRED_CASES) {
    const response = await authorizedFetch("/api/cart/evaluate", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: parsedCases[caseName] }),
    });
    if (!response.ok)
      throw new Error(`${caseName} financial smoke returned HTTP ${response.status}.`);
    results[caseName] = assertSmokeResult(caseName, await response.json());
  }
  return results;
}

if (process.argv.includes("--validate")) {
  validateAccessUrl(process.env.STOREFRONT_FINANCIAL_SMOKE_ACCESS_URL);
  parseSmokeCases(process.env.SHIPPING_FINANCIAL_SMOKE_CASES_JSON);
  console.log("Production financial smoke fixture validated without contacting production.");
} else if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runProductionFinancialSmoke({
    accessUrl: process.env.STOREFRONT_FINANCIAL_SMOKE_ACCESS_URL,
    cases: process.env.SHIPPING_FINANCIAL_SMOKE_CASES_JSON,
  }).then((results) => {
    for (const caseName of REQUIRED_CASES) {
      const result = results[caseName];
      console.log(
        `Production financial smoke ${caseName}: subtotal=${result.subtotal}, discount=${result.discount}, shipping=${result.shipping}, final=${result.finalTotal}`,
      );
    }
  }).catch((caught) => {
    console.error(caught instanceof Error ? caught.message : String(caught));
    process.exitCode = 1;
  });
}
