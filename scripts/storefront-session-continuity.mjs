import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE_URL = "https://metraphuong.com";
export const COOKIE_FILE_NAME = "babyjoy-storefront-session-continuity.cookie";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getFetch(fetchImpl) {
  const candidate = fetchImpl ?? globalThis.fetch;
  if (typeof candidate !== "function") throw new Error("Fetch is unavailable.");
  return candidate;
}

export function defaultCookieFile() {
  return path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), COOKIE_FILE_NAME);
}

export function cookieDigestFile(cookieFile = defaultCookieFile()) {
  return `${cookieFile}.sha256`;
}

/** Chỉ nhận đúng access link thử nghiệm trên domain production, không log giá trị bí mật. */
export function validateAccessUrl(value) {
  if (typeof value !== "string" || value.length === 0)
    throw new Error("STOREFRONT_SESSION_CONTINUITY_ACCESS_URL is required.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Storefront continuity access URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "metraphuong.com" ||
    !/^\/access\/[^/]+$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Storefront continuity access URL must be an https metraphuong.com access path.",
    );
  return url;
}

function cookiePairs(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : (response.headers.get("set-cookie") ?? "").split(
          /,(?=\s*[^;,=]+=[^;,]+)/,
        );
  return values
    .map((value) => value.split(";", 1)[0].trim())
    .filter((value) => value.includes("="));
}

function validateCookieHeader(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !normalized ||
    /[\r\n]/.test(normalized) ||
    !normalized.split(";").every((part) => /^[^=;\s]+=[^;]*$/.test(part.trim()))
  )
    throw new Error(
      "Storefront continuity cookie fixture is invalid or empty.",
    );
  return normalized;
}

function cookieFixtureDigest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function writeCookieDigest(cookieFile, cookieFixture) {
  const digestFile = cookieDigestFile(cookieFile);
  await fs.writeFile(digestFile, `${cookieFixtureDigest(cookieFixture)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(digestFile, 0o600);
}

async function assertCookieFixtureUnchanged(cookieFile, cookieFixture) {
  let expectedDigest;
  try {
    expectedDigest = (await fs.readFile(cookieDigestFile(cookieFile), "utf8"))
      .trim()
      .toLowerCase();
  } catch {
    throw new Error(
      "Storefront continuity cookie fixture digest is missing before after-deploy verification.",
    );
  }
  if (!/^[a-f0-9]{64}$/.test(expectedDigest))
    throw new Error(
      "Storefront continuity cookie fixture digest is invalid before after-deploy verification.",
    );
  if (cookieFixtureDigest(cookieFixture) !== expectedDigest)
    throw new Error(
      "Storefront continuity cookie fixture changed before after-deploy verification.",
    );
}

async function request(fetchImpl, url, init, label) {
  try {
    return await getFetch(fetchImpl)(url, init);
  } catch {
    throw new Error(`Storefront continuity ${label} request failed.`);
  }
}

async function readJson(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(
      `Storefront continuity ${label} response was not valid JSON.`,
    );
  }
}

async function readText(response, label) {
  try {
    return await response.text();
  } catch {
    throw new Error(
      `Storefront continuity ${label} response could not be read.`,
    );
  }
}

function assertExpectedStatus(response, expected, label) {
  if (response.status !== expected)
    throw new Error(
      `Storefront continuity ${label} returned HTTP ${response.status}.`,
    );
}

function assertNoSetCookie(response, label) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie");
  const rotated = Array.isArray(values)
    ? values.length > 0
    : typeof values === "string" && values.trim().length > 0;
  if (rotated)
    throw new Error(
      `Storefront continuity ${label} attempted to rotate the session cookie.`,
    );
}

function assertNoErrorMarker(body, label) {
  if (
    body.includes("STOREFRONT_SESSION_REQUIRED") ||
    body.includes("STOREFRONT_ACCESS_NOT_CONFIGURED") ||
    body.includes("Access session is required.")
  )
    throw new Error(
      `Storefront continuity ${label} returned an access error body.`,
    );
}

/** Gọi endpoint không có cookie để phân biệt gate đang bật với lần bật gate đầu tiên. */
export async function probeStorefrontGate({
  baseUrl = BASE_URL,
  fetchImpl,
} = {}) {
  const response = await request(
    fetchImpl,
    `${baseUrl}/api/storefront/session`,
    { redirect: "manual", headers: { accept: "application/json" } },
    "gate preflight",
  );
  if (response.status === 401) {
    const body = await readJson(response, "gate preflight");
    if (!isRecord(body) || body.error !== "STOREFRONT_SESSION_REQUIRED")
      throw new Error(
        "Storefront gate preflight returned an unexpected unauthorized response.",
      );
    return { gateEnabled: true };
  }
  if (response.status === 503)
    throw new Error(
      "Storefront gate preflight reported a missing production secret.",
    );
  assertExpectedStatus(response, 200, "gate preflight");
  const body = await readJson(response, "gate preflight");
  if (
    !isRecord(body) ||
    body.authenticated !== true ||
    body.gateEnabled !== false
  )
    throw new Error(
      "Storefront gate preflight returned an unexpected disabled-gate response.",
    );
  return { gateEnabled: false };
}

/** Validate trước deploy và không mở access link khi gate đang được bật lần đầu. */
export async function validateContinuity({
  accessUrl,
  baseUrl = BASE_URL,
  required = false,
  fetchImpl,
} = {}) {
  const gate = await probeStorefrontGate({ baseUrl, fetchImpl });
  if (!gate.gateEnabled) {
    if (required)
      throw new Error(
        "Storefront session continuity requires the gate to be enabled before rollout.",
      );
    return { applicable: false, gateEnabledBefore: false };
  }
  validateAccessUrl(accessUrl);
  return { applicable: true, gateEnabledBefore: true };
}

async function assertAuthorizedStorefront({
  baseUrl = BASE_URL,
  cookie,
  fetchImpl,
  rejectSetCookie = false,
} = {}) {
  const cookieHeader = validateCookieHeader(cookie);
  const sessionResponse = await request(
    fetchImpl,
    `${baseUrl}/api/storefront/session`,
    {
      redirect: "manual",
      headers: { accept: "application/json", cookie: cookieHeader },
    },
    "session",
  );
  assertExpectedStatus(sessionResponse, 200, "session");
  if (rejectSetCookie) assertNoSetCookie(sessionResponse, "session");
  const session = await readJson(sessionResponse, "session");
  if (
    !isRecord(session) ||
    session.authenticated !== true ||
    session.gateEnabled !== true
  )
    throw new Error(
      "Storefront continuity session is not authenticated while the gate is enabled.",
    );

  const productsResponse = await request(
    fetchImpl,
    `${baseUrl}/api/products`,
    {
      redirect: "manual",
      headers: { accept: "application/json", cookie: cookieHeader },
    },
    "products",
  );
  assertExpectedStatus(productsResponse, 200, "products");
  if (rejectSetCookie) assertNoSetCookie(productsResponse, "products");
  const products = await readJson(productsResponse, "products");
  if (
    !isRecord(products) ||
    !Array.isArray(products.data) ||
    !isRecord(products.pagination) ||
    Object.prototype.hasOwnProperty.call(products, "error")
  )
    throw new Error(
      "Storefront continuity products response was not a valid catalog payload.",
    );

  const homeResponse = await request(
    fetchImpl,
    `${baseUrl}/`,
    {
      redirect: "manual",
      headers: { accept: "text/html", cookie: cookieHeader },
    },
    "homepage",
  );
  assertExpectedStatus(homeResponse, 200, "homepage");
  if (rejectSetCookie) assertNoSetCookie(homeResponse, "homepage");
  const home = await readText(homeResponse, "homepage");
  if (!home.trim() || !/<html[\s>]/i.test(home))
    throw new Error("Storefront continuity homepage response was not HTML.");
  assertNoErrorMarker(home, "homepage");
}

/** Tạo đúng một session từ access link rồi dùng cookie đó cho toàn bộ kiểm tra trước deploy. */
export async function runBefore({
  accessUrl,
  cookieFile = defaultCookieFile(),
  baseUrl = BASE_URL,
  fetchImpl,
} = {}) {
  const url = validateAccessUrl(accessUrl);
  const response = await request(
    fetchImpl,
    url.toString(),
    { redirect: "manual", headers: { accept: "text/html" } },
    "access link",
  );
  assertExpectedStatus(response, 303, "access link");
  const cookie = cookiePairs(response).join("; ");
  validateCookieHeader(cookie);
  const cookieFixture = `${cookie}\n`;
  await fs.writeFile(cookieFile, cookieFixture, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(cookieFile, 0o600);
  await assertAuthorizedStorefront({ baseUrl, cookie, fetchImpl });
  await writeCookieDigest(cookieFile, cookieFixture);
  return { cookieFile };
}

/** Đọc nguyên cookie cũ; bước after không có đường gọi access link hay tạo session mới. */
export async function runAfter({
  cookieFile = defaultCookieFile(),
  baseUrl = BASE_URL,
  fetchImpl,
} = {}) {
  let cookie;
  try {
    cookie = await fs.readFile(cookieFile, "utf8");
  } catch {
    throw new Error(
      "Storefront continuity cookie fixture is missing before after-deploy verification.",
    );
  }
  await assertCookieFixtureUnchanged(cookieFile, cookie);
  await assertAuthorizedStorefront({
    baseUrl,
    cookie,
    fetchImpl,
    rejectSetCookie: true,
  });
  return { cookieFile };
}

export async function cleanupCookieFile(cookieFile = defaultCookieFile()) {
  await Promise.all([
    fs.rm(cookieFile, { force: true }),
    fs.rm(cookieDigestFile(cookieFile), { force: true }),
  ]);
}

async function writeGitHubOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const content = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  await fs.appendFile(process.env.GITHUB_OUTPUT, `${content}\n`, "utf8");
}

async function main() {
  const operation = process.argv[2];
  const cookieFile =
    process.env.STOREFRONT_SESSION_CONTINUITY_COOKIE_FILE ||
    defaultCookieFile();
  if (operation === "validate") {
    const result = await validateContinuity({
      accessUrl: process.env.STOREFRONT_SESSION_CONTINUITY_ACCESS_URL,
      required: process.argv.includes("--required"),
    });
    await writeGitHubOutput({
      applicable: String(result.applicable),
      gate_enabled_before: String(result.gateEnabledBefore),
    });
    console.log(
      result.applicable
        ? "Storefront session continuity preflight: applicable."
        : "Storefront session continuity: NOT_APPLICABLE because the gate was disabled before rollout.",
    );
    return;
  }
  if (operation === "before") {
    await runBefore({
      accessUrl: process.env.STOREFRONT_SESSION_CONTINUITY_ACCESS_URL,
      cookieFile,
    });
    console.log("Storefront session continuity before-deploy check: PASS.");
    return;
  }
  if (operation === "after") {
    await runAfter({ cookieFile });
    console.log("Storefront session continuity after-deploy check: PASS.");
    return;
  }
  if (operation === "cleanup") {
    await cleanupCookieFile(cookieFile);
    return;
  }
  throw new Error(
    "Usage: storefront-session-continuity.mjs <validate|before|after|cleanup> [--required].",
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((caught) => {
    console.error(caught instanceof Error ? caught.message : String(caught));
    process.exitCode = 1;
  });
}
