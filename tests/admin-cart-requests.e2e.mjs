import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const configuredBaseUrl = process.env.BABYJOY_BASE_URL ?? "";
let baseUrl = configuredBaseUrl || "http://127.0.0.1:5174";
let base = new URL(baseUrl);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
let wranglerConfig = process.env.BABYJOY_WRANGLER_CONFIG ?? "";
let wranglerEnv = process.env.BABYJOY_WRANGLER_ENV ?? "";
let wranglerPersistTo = process.env.BABYJOY_WRANGLER_PERSIST_TO ?? "";
let ownedServer = null;
let ownedServerPersistTo = "";
let ownedServerOutput = "";
const fixtureIds = Array.from(
  { length: 47 },
  (_, index) => `e2e-admin-cart-${String(index + 1).padStart(3, "0")}`,
);

function sqlString(value) {
  return value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
}

function wranglerCommand(args) {
  // Windows không chạy ổn file .cmd qua execFileSync khi truyền argv trực tiếp.
  const script = process.platform === "win32"
    ? `${repoRoot}node_modules\\wrangler\\bin\\wrangler.js`
    : `${repoRoot}node_modules/.bin/wrangler`;
  if (!existsSync(script)) throw new Error(`Không tìm thấy Wrangler tại ${script}`);
  const binary = process.platform === "win32" ? process.execPath : script;
  const wranglerOptions = [];
  // Cho phép E2E dùng đúng config/persistence của worker đang chạy trong môi trường cô lập.
  if (wranglerConfig) wranglerOptions.push("--config", wranglerConfig);
  if (wranglerEnv) wranglerOptions.push("--env", wranglerEnv);
  if (wranglerPersistTo) wranglerOptions.push("--persist-to", wranglerPersistTo);
  const fullArgs = [...wranglerOptions, ...args];
  const commandArgs = process.platform === "win32" ? [script, ...fullArgs] : fullArgs;
  execFileSync(binary, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: true,
  });
}

function wranglerInvocation(args) {
  const script = process.platform === "win32"
    ? join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js")
    : join(repoRoot, "node_modules", ".bin", "wrangler");
  if (!existsSync(script)) throw new Error(`Không tìm thấy Wrangler tại ${script}`);
  return {
    binary: process.platform === "win32" ? process.execPath : script,
    args: process.platform === "win32" ? [script, ...args] : args,
  };
}

async function startOwnedServer() {
  if (configuredBaseUrl) return;
  const configPath = join(repoRoot, "build", "server", "wrangler.json");
  const entryPath = join(repoRoot, "build", "server", "index.js");
  if (!existsSync(configPath) || !existsSync(entryPath))
    throw new Error("Chưa có production build; hãy chạy npm run build trước E2E Cart Requests.");

  ownedServerPersistTo = await mkdtemp(join(tmpdir(), "babyjoy-cart-requests-e2e-"));
  wranglerConfig = configPath;
  wranglerEnv = "";
  wranglerPersistTo = ownedServerPersistTo;
  // Migrate trước khi khởi động worker để test luôn có đủ schema trong persistence riêng.
  wranglerCommand(["d1", "migrations", "apply", "babyjoy-db", "--local"]);

  const port = Number(process.env.BABYJOY_CART_REQUESTS_E2E_PORT ?? 5174);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("BABYJOY_CART_REQUESTS_E2E_PORT không hợp lệ.");
  baseUrl = `http://127.0.0.1:${port}`;
  base = new URL(baseUrl);
  const invocation = wranglerInvocation([
    "dev",
    "--config",
    configPath,
    "--local",
    "--persist-to",
    ownedServerPersistTo,
    "--port",
    String(port),
    "--var",
    "ENVIRONMENT:development",
    "--var",
    "STOREFRONT_ACCESS_GATE_ENABLED:false",
  ]);
  ownedServer = spawn(invocation.binary, invocation.args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const capture = (chunk) => {
    ownedServerOutput = `${ownedServerOutput}${String(chunk)}`.slice(-12000);
  };
  ownedServer.stdout?.on("data", capture);
  ownedServer.stderr?.on("data", capture);
  const deadline = Date.now() + 30000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (ownedServer.exitCode !== null)
      throw new Error(`Worker E2E dừng sớm.\n${ownedServerOutput}`);
    try {
      const response = await fetch(`${baseUrl}/admin/cart-requests`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (caught) {
      lastError = caught instanceof Error ? caught.message : String(caught);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Worker E2E không sẵn sàng (${lastError}).\n${ownedServerOutput}`);
}

async function stopOwnedServer() {
  const child = ownedServer;
  ownedServer = null;
  if (child && child.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.kill();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }
  if (ownedServerPersistTo) {
    const persistPath = ownedServerPersistTo;
    ownedServerPersistTo = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await rm(persistPath, { recursive: true, force: true }).catch(() => undefined);
      if (!existsSync(persistPath)) break;
      // Miniflare có thể đóng WAL chậm hơn process Wrangler trên Windows.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

function seedLocalFixture() {
  if (!["localhost", "127.0.0.1"].includes(base.hostname))
    throw new Error("E2E Cart Requests chỉ seed D1 khi chạy trên localhost.");
  const ids = fixtureIds.map(sqlString).join(", ");
  const values = fixtureIds.map((id, index) => {
    const number = index + 1;
    const channel = number % 3 === 0 ? "MESSENGER" : number % 3 === 1 ? "SHARE" : "LEGACY";
    const delivery = channel === "MESSENGER" ? (number % 2 ? "PENDING" : "SENT") : "NOT_APPLICABLE";
    const status = number % 5 === 0 ? "CONFIRMED" : "SUBMITTED";
    const day = String(Math.min(number, 28)).padStart(2, "0");
    const createdAt = `2026-08-${day}T${String(number % 24).padStart(2, "0")}:00:00.000Z`;
    return `(${sqlString(id)}, ${sqlString(`GH-E2E-${String(number).padStart(3, "0")}`)}, ${sqlString(`e2e-admin-cart-token-${number}`)}, ${number === 47 ? "NULL" : sqlString(number === 1 ? "Alice" : `Customer ${String(number).padStart(2, "0")}`)}, ${sqlString(number === 1 ? "0988 123 456" : `0988 000 ${String(number).padStart(3, "0")}`)}, ${number === 1 ? 2 : (number % 5) + 1}, ${number === 1 ? 7 : (number % 5) + 6}, ${number === 1 ? 110000 : 100000 + number * 10000}, ${sqlString(status)}, 'NOT_APPLICABLE', ${sqlString(channel)}, ${sqlString(delivery)}, 'WAITING_SELLER_CONFIRM', '2026-08-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z', 15, ${sqlString(createdAt)}, ${sqlString(createdAt)})`;
  });
  const sql = [
    `DELETE FROM messenger_checkout_sessions WHERE cart_request_id IN (${ids});`,
    `DELETE FROM cart_requests WHERE id IN (${ids});`,
    `INSERT INTO cart_requests (id, public_code, submission_token, customer_name, customer_phone, item_line_count, total_quantity, subtotal_vnd, status, telegram_status, contact_channel, messenger_delivery_status, checkout_state, reservation_started_at, reservation_expires_at, reservation_duration_minutes, created_at, updated_at) VALUES ${values.join(",\n")};`,
    "INSERT INTO messenger_checkout_sessions (id, cart_request_id, ref_hash, status_token_hash, status, expires_at, created_at, updated_at) VALUES ('e2e-admin-session-3', 'e2e-admin-cart-003', 'e2e-admin-ref-hash', 'e2e-admin-status-hash', 'IDENTIFIED', '2026-12-31T00:00:00.000Z', '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z');",
  ].join("\n");
  // Fixture chỉ dùng D1 local và luôn có danh sách ID cố định để dọn chính xác.
  wranglerCommand(["d1", "execute", "babyjoy-db", "--local", "--command", sql]);
}

function cleanLocalFixture() {
  if (!["localhost", "127.0.0.1"].includes(base.hostname)) return;
  const ids = fixtureIds.map(sqlString).join(", ");
  const sql = `DELETE FROM messenger_checkout_sessions WHERE cart_request_id IN (${ids}); DELETE FROM cart_requests WHERE id IN (${ids});`;
  wranglerCommand(["d1", "execute", "babyjoy-db", "--local", "--command", sql]);
}

function apiPath(url) {
  return new URL(url).pathname;
}

async function waitForListResponse(page, action) {
  const responsePromise = page.waitForResponse(
    (response) => apiPath(response.url()) === "/api/admin/cart-requests",
  );
  await action();
  const response = await responsePromise;
  // Chờ React commit dữ liệu sau response trước khi đọc hàng đầu tiên.
  await page.waitForFunction(
    () => !document.querySelector(".request-table.is-loading"),
  );
  return response;
}

let browser = null;
let context = null;
let fixtureSeeded = false;
try {
  await startOwnedServer();
  seedLocalFixture();
  fixtureSeeded = true;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
      : {}),
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "vi-VN",
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/admin/cart-requests`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("GH-E2E-047"));
  if (await page.getByRole("button", { name: "Trang 2" }).count() !== 1)
    throw new Error("Cart Requests không render pagination 47/20.");

  const search = page.getByLabel("Tìm kiếm giỏ hàng");
  await waitForListResponse(page, () => search.fill("GH-E2E-001"));
  await page.waitForFunction(() => document.querySelectorAll(".request-code").length === 1);
  if (!(await page.locator(".request-code").first().innerText()).includes("GH-E2E-001"))
    throw new Error("Search mã GH không lọc đúng.");
  await waitForListResponse(page, () => search.fill(""));

  const sort = page.getByLabel("Sắp xếp giỏ hàng");
  await waitForListResponse(page, () => sort.selectOption("createdAt:asc"));
  if (!(await page.locator(".request-code").first().innerText()).includes("GH-E2E-001"))
    throw new Error("Sort cũ nhất không đúng.");
  await waitForListResponse(page, () => sort.selectOption("subtotal:desc"));
  if (!(await page.locator(".request-code").first().innerText()).includes("GH-E2E-047"))
    throw new Error("Sort giá trị cao xuống thấp không đúng.");

  await page.getByRole("button", { name: /Lọc nâng cao/ }).click();
  const panel = page.getByRole("dialog", { name: "Lọc nâng cao" });
  await panel.locator(".request-filter-date-grid input[type=date]").nth(0).fill("2026-08-01");
  await panel.locator(".request-filter-date-grid input[type=date]").nth(1).fill("2026-09-30");
  await panel.locator("fieldset").filter({ hasText: "Trạng thái legacy" }).getByLabel("Mới gửi").check();
  await waitForListResponse(page, () => panel.getByRole("button", { name: "Áp dụng bộ lọc" }).click());
  await page.waitForFunction(() => document.body.innerText.includes("Khoảng ngày tùy chỉnh") && document.body.innerText.includes("Mới gửi"));
  if (!new URL(page.url()).searchParams.has("dateFrom") || !new URL(page.url()).searchParams.has("status"))
    throw new Error("Advanced filter không ghi URL state.");

  await waitForListResponse(page, () => page.getByRole("button", { name: /Xóa bộ lọc Mới gửi/ }).click());
  if (new URL(page.url()).searchParams.has("status")) throw new Error("Xóa chip status làm mất sai state URL.");

  await waitForListResponse(page, () => page.getByRole("button", { name: "Trang 2" }).click());
  if (new URL(page.url()).searchParams.get("page") !== "2") throw new Error("Pagination không cập nhật page=2.");

  await page.getByRole("button", { name: /Lọc nâng cao/ }).click();
  const secondPanel = page.getByRole("dialog", { name: "Lọc nâng cao" });
  await secondPanel.locator("fieldset").filter({ hasText: "Trạng thái legacy" }).getByLabel("Đã xác nhận").check();
  await waitForListResponse(page, () => secondPanel.getByRole("button", { name: "Áp dụng bộ lọc" }).click());
  const finalUrl = new URL(page.url());
  if (finalUrl.searchParams.has("page") && finalUrl.searchParams.get("page") !== "1")
    throw new Error("Apply filter từ page>1 không reset page=1.");
  if (await page.getByRole("button", { name: "Trang 2" }).count() !== 0)
    throw new Error("Pagination vẫn hiển thị page 2 sau khi filter còn một page.");

  await waitForListResponse(page, () => page.getByRole("button", { name: "Chia sẻ thủ công" }).click());
  if (new URL(page.url()).searchParams.get("scope") !== "share") throw new Error("Tab share không lưu scope URL.");
  if (await page.locator(".request-code").count() === 0) throw new Error("Tab share không có dữ liệu fixture.");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Đã xác nhận"));
  if (new URL(page.url()).searchParams.get("scope") !== "share") throw new Error("Refresh không restore URL state.");
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (fixtureSeeded) cleanLocalFixture();
  await stopOwnedServer();
}

console.log("ADMIN_CART_REQUESTS_E2E_OK search=pass sort=pass filters=pass chips=pass scope=pass pagination=pass url=pass");
