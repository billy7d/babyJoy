import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeCartShareText,
  deriveShareToken,
  getPublicCartShare,
  hashShareToken,
  prepareCartShare,
  saveAdminSellerSettings,
  validateCartSharePrepare,
  validateSellerMessengerUrl,
} from "../workers/cart-share";
import {
  activateCartShareWithRecovery,
  cartShareSubmissionKey,
  cartShareErrorMessage,
  CartShareApiError,
  copyAndOpenSeller,
  getCartShareSubmissionToken,
  invalidateCartShareSubmission,
  prepareCartShareWithRecovery,
  runNativeCartShare,
} from "../app/lib/cart-share";
import { consumeRateLimit } from "../workers/rate-limit";
import { STORE_BRAND } from "../shared/branding";

function migration(name: string) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

class SqliteStatementAdapter {
  private values: unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]) {
    const next = new SqliteStatementAdapter(this.statement);
    next.values = values;
    return next;
  }

  all<T>() {
    return Promise.resolve({ results: this.statement.all(...this.values) as T[] });
  }

  first<T>() {
    return Promise.resolve((this.statement.get(...this.values) as T | undefined) ?? null);
  }

  run() {
    const result = this.statement.run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }
}

class SqliteD1Adapter {
  constructor(readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteStatementAdapter(this.database.prepare(sql));
  }

  async batch(statements: SqliteStatementAdapter[]) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (caught) {
      this.database.exec("ROLLBACK");
      throw caught;
    }
  }
}

function createTestEnv() {
  const database = new DatabaseSync(":memory:");
  database.exec(migration("0001_initial.sql"));
  database.exec(migration("0002_seed.sql"));
  database.exec(migration("0003_messenger_checkout_v1.sql"));
  database.exec(migration("0004_direct_seller_cart_share_v1.sql"));
  database.exec(`
    INSERT INTO app_settings (key, value, updated_at) VALUES
      ('seller_display_name', 'Nguyễn A', CURRENT_TIMESTAMP),
      ('seller_contact_label', 'Người bán BabyJoy', CURRENT_TIMESTAMP),
      ('seller_messenger_url', 'https://m.me/nguyena', CURRENT_TIMESTAMP),
      ('seller_avatar_key', '', CURRENT_TIMESTAMP);
  `);
  const d1 = new SqliteD1Adapter(database);
  const env = {
    DB: d1,
    DIRECT_SELLER_SHARE_ENABLED: "true",
    MESSENGER_CHECKOUT_ENABLED: "false",
    CART_SHARE_SECRET: "test-cart-share-secret-that-is-long-enough-123",
    PRODUCT_IMAGES: { head: async () => ({}) },
  } as unknown as Env;
  return { database, env };
}

function prepareRequest(
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Request("https://metraphuong.com/api/cart/share/prepare", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      submissionToken: "submission-share-1",
      items: [
        { variantId: "variant-gerber-227", quantity: 2, displayedPrice: 125000 },
        { variantId: "variant-rice-50", quantity: 1, displayedPrice: 68000 },
      ],
      acceptCurrentPrices: false,
      ...overrides,
    }),
  });
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function installBrowserStorage() {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  vi.stubGlobal("window", { localStorage, sessionStorage });
  return { localStorage, sessionStorage };
}

function clientSuccess(code: string) {
  return {
    success: true,
    cartRequest: {
      code,
      itemLineCount: 1,
      totalQuantity: 1,
      subtotalVnd: 100000,
      promotionDiscountVnd: 0,
      finalTotalVnd: 100000,
      createdAt: "2026-09-02T00:00:00.000Z",
      checkoutState: "READY_TO_SEND",
      reservationStartedAt: null,
      reservationExpiresAt: null,
      reservationDurationMinutes: null,
    },
    share: {
      title: `Giỏ hàng ${code}`,
      text: `text-${code}`,
      url: `https://metraphuong.com/c/token-${code}`,
      copyText: `copy-${code}`,
      expiresAt: "2026-10-02T00:00:00.000Z",
    },
    seller: {
      displayName: "Nguyễn A",
      label: "Người bán BabyJoy",
      messengerUrl: "https://m.me/nguyena",
      avatarKey: null,
      avatarUrl: null,
    },
    serverNow: "2026-09-02T00:00:00.000Z",
  };
}

function queuedFetcher(
  queue: Array<{ status: number; body: unknown }>,
  calls: Array<{ path: string; body: Record<string, unknown> }>,
) {
  return async (input: string, init: RequestInit) => {
    calls.push({
      path: input,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const next = queue.shift();
    if (!next) throw new Error("TEST_RESPONSE_QUEUE_EMPTY");
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Direct Seller Cart Share domain", () => {
  it("validate cart và chỉ cho phép URL m.me chính thức", () => {
    expect(
      validateCartSharePrepare({
        submissionToken: "token",
        items: [{ variantId: "variant-1", quantity: 2, displayedPrice: 100 }],
      }),
    ).toMatchObject({ submissionToken: "token", items: [{ quantity: 2 }] });
    expect(validateSellerMessengerUrl("https://m.me/nguyena/")).toBe("https://m.me/nguyena");
    expect(() => validateSellerMessengerUrl("javascript:alert(1)")).toThrow("SELLER_URL_INVALID");
    expect(() => validateSellerMessengerUrl("https://example.com/nguyena")).toThrow("SELLER_URL_INVALID");
  });

  it("dẫn xuất token 256 bit ổn định và hash lưu trữ khác raw token", async () => {
    const raw = await deriveShareToken("a".repeat(32), "request-1", "submission-1");
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(raw).toBe(await deriveShareToken("a".repeat(32), "request-1", "submission-1"));
    expect(await hashShareToken(raw)).not.toBe(raw);
  });

  it("tạo snapshot SHARE, repricing server, hash-at-rest và idempotency", async () => {
    const { database, env } = createTestEnv();
    const first = await prepareCartShare(prepareRequest(), env);
    expect(first.status).toBe(201);
    const body = await first.json() as {
      cartRequest: { code: string; subtotalVnd: number; totalQuantity: number };
      share: { title: string; url: string; copyText: string };
    };
    expect(body.cartRequest).toMatchObject({ subtotalVnd: 318000, totalQuantity: 3 });
    expect(body.share.title).toBe(`Giỏ hàng ${STORE_BRAND} ${body.cartRequest.code}`);
    expect(body.share.copyText).toContain(`🛒 GIỎ HÀNG ${STORE_BRAND}`);
    expect(body.share.copyText).toContain(body.share.url);
    const rawToken = body.share.url.split("/").at(-1) ?? "";
    const stored = database.prepare("SELECT token_hash FROM cart_share_links").get() as { token_hash: string };
    expect(stored.token_hash).toBe(await hashShareToken(rawToken));
    expect(stored.token_hash).not.toBe(rawToken);
    expect(
      database.prepare("SELECT contact_channel, telegram_status, messenger_delivery_status FROM cart_requests WHERE submission_token = 'submission-share-1'").get(),
    ).toEqual({
      contact_channel: "SHARE",
      telegram_status: "NOT_APPLICABLE",
      messenger_delivery_status: "NOT_APPLICABLE",
    });
    const second = await prepareCartShare(prepareRequest(), env);
    expect(second.status).toBe(200);
    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_requests WHERE submission_token = 'submission-share-1'").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_share_links").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_request_items WHERE cart_request_id IN (SELECT id FROM cart_requests WHERE submission_token = 'submission-share-1')").get()).toEqual({ count: 2 });
    database.close();
  });

  it("trả PRICE_CHANGED trước khi ghi và chấp nhận giá server khi được xác nhận", async () => {
    const { database, env } = createTestEnv();
    const changedRequest = prepareRequest({
      submissionToken: "price-change",
      items: [{ variantId: "variant-gerber-227", quantity: 1, displayedPrice: 1 }],
    });
    const changed = await prepareCartShare(changedRequest, env);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({
      error: {
        code: "PRICE_CHANGED",
        items: [{ displayedPrice: 1, currentPrice: 125000 }],
        subtotalVnd: 125000,
      },
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_requests WHERE submission_token = 'price-change'").get()).toEqual({ count: 0 });
    const accepted = await prepareCartShare(
      prepareRequest({
        submissionToken: "price-change",
        acceptCurrentPrices: true,
        items: [{ variantId: "variant-gerber-227", quantity: 1, displayedPrice: 1 }],
      }),
      env,
    );
    expect(accepted.status).toBe(201);
    database.close();
  });

  it("từ chối variant không tồn tại/không sẵn sàng", async () => {
    const { database, env } = createTestEnv();
    const missing = await prepareCartShare(
      prepareRequest({
        submissionToken: "missing",
        items: [{ variantId: "missing", quantity: 1, displayedPrice: 1 }],
      }),
      env,
    );
    expect(missing.status).toBe(404);
    const unavailable = await prepareCartShare(
      prepareRequest({
        submissionToken: "unavailable",
        items: [{ variantId: "variant-heinz-120", quantity: 1, displayedPrice: 89000 }],
      }),
      env,
    );
    expect(unavailable.status).toBe(409);
    database.close();
  });

  it("public DTO chỉ có snapshot, dùng header riêng tư và ẩn invalid/expired/revoked", async () => {
    const { database, env } = createTestEnv();
    const prepared = await prepareCartShare(prepareRequest(), env);
    const preparedBody = await prepared.json() as { share: { url: string } };
    const rawToken = preparedBody.share.url.split("/").at(-1) ?? "";
    const publicResponse = await getPublicCartShare(rawToken, env);
    const publicBody = await publicResponse.json() as Record<string, unknown>;
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(publicResponse.headers.get("x-robots-tag")).toContain("noindex");
    expect(publicBody).not.toHaveProperty("id");
    expect(JSON.stringify(publicBody)).not.toContain("submissionToken");
    expect(JSON.stringify(publicBody)).not.toContain("tokenHash");
    expect(JSON.stringify(publicBody)).not.toContain("customer");
    expect(publicBody.items as Array<Record<string, unknown>>).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productName: "Bột ăn dặm Gerber Organic Yến mạch & Chuối",
          unitPriceVnd: 125000,
          quantity: 2,
        }),
      ]),
    );
    expect((await getPublicCartShare("x".repeat(43), env)).status).toBe(404);
    database.prepare("UPDATE cart_share_links SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await getPublicCartShare(rawToken, env)).status).toBe(404);
    database.prepare("UPDATE cart_share_links SET expires_at = '2099-01-01T00:00:00.000Z', revoked_at = CURRENT_TIMESTAMP").run();
    expect((await getPublicCartShare(rawToken, env)).status).toBe(404);
    database.close();
  });

  it("giới hạn text lớn và vẫn giữ URL bảo mật", () => {
    const text = composeCartShareText({
      code: "GH-260828-LONG",
      items: Array.from({ length: 20 }, (_, index) => ({
        productName: `Sản phẩm ${index} ${"rất dài ".repeat(20)}`,
        variantName: "Hộp 200g",
        quantity: 2,
        lineTotalVnd: 100000,
      })),
      subtotalVnd: 2_000_000,
      url: "https://metraphuong.com/c/opaque",
    });
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(text).toContain("sản phẩm khác");
    expect(text).toContain("https://metraphuong.com/c/opaque");
  });

  it("giới hạn Direct Share theo IP hash trước khi tạo snapshot", async () => {
    const { database, env } = createTestEnv();
    for (let index = 0; index < 10; index += 1) {
      const response = await prepareCartShare(
        prepareRequest(
          { submissionToken: `rate-${index}`, acceptCurrentPrices: true },
          { "cf-connecting-ip": "203.0.113.10" },
        ),
        env,
      );
      expect(response.status).toBe(201);
    }
    const denied = await prepareCartShare(
      prepareRequest(
        { submissionToken: "rate-denied", acceptCurrentPrices: true },
        { "cf-connecting-ip": "203.0.113.10" },
      ),
      env,
    );
    expect(denied.status).toBe(429);
    expect(await denied.json()).toMatchObject({
      success: false,
      error: { code: "RATE_LIMITED" },
    });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM cart_requests WHERE submission_token = 'rate-denied'")
        .get(),
    ).toEqual({ count: 0 });
    const rateRow = database
      .prepare("SELECT scope_key, request_count FROM messenger_rate_limits")
      .get() as { scope_key: string; request_count: number };
    expect(rateRow.request_count).toBe(11);
    expect(rateRow.scope_key).not.toContain("203.0.113.10");
    database.close();
  });

  it("tách cửa sổ rate limit theo IP và scope, không lưu IP thô", async () => {
    const { database, env } = createTestEnv();
    const requestFor = (ip: string) =>
      new Request("https://metraphuong.com/api/test", {
        headers: { "cf-connecting-ip": ip },
      });
    for (let index = 0; index < 10; index += 1)
      await consumeRateLimit(env, requestFor("203.0.113.20"), "scope-a", 10);
    await expect(
      consumeRateLimit(env, requestFor("203.0.113.20"), "scope-a", 10),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(
      consumeRateLimit(env, requestFor("203.0.113.21"), "scope-a", 10),
    ).resolves.toBeUndefined();
    await expect(
      consumeRateLimit(env, requestFor("203.0.113.20"), "scope-b", 10),
    ).resolves.toBeUndefined();
    const rows = database
      .prepare("SELECT scope_key, request_count FROM messenger_rate_limits")
      .all() as Array<{ scope_key: string; request_count: number }>;
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.20");
    expect(JSON.stringify(rows)).not.toContain("203.0.113.21");
    database.close();
  });
});

describe("Direct seller client actions", () => {
  it("copy thành công trước khi ghi attempt và điều hướng đúng seller", async () => {
    const calls: string[] = [];
    await copyAndOpenSeller({
      copyText: "cart text",
      messengerUrl: "https://m.me/nguyena",
      code: "GH-1",
      clipboard: { writeText: async (value) => { calls.push(`copy:${value}`); } },
      onCopied: () => calls.push("feedback"),
      record: () => calls.push("record"),
      navigate: (url) => calls.push(`navigate:${url}`),
    });
    expect(calls).toEqual([
      "copy:cart text",
      "feedback",
      "record",
      "navigate:https://m.me/nguyena",
    ]);
  });

  it("clipboard bị từ chối thì không điều hướng", async () => {
    let navigated = false;
    await expect(
      copyAndOpenSeller({
        copyText: "cart",
        messengerUrl: "https://m.me/nguyena",
        code: "GH-1",
        clipboard: { writeText: async () => { throw new DOMException("denied", "NotAllowedError"); } },
        navigate: () => { navigated = true; },
      }),
    ).rejects.toThrow();
    expect(navigated).toBe(false);
  });

  it("Web Share phân biệt success, hủy và lỗi mà không gắn SENT", async () => {
    expect(await runNativeCartShare({ title: "T", text: "X", url: "https://example.com", share: async () => undefined })).toBe("SHARED");
    expect(await runNativeCartShare({ title: "T", text: "X", url: "https://example.com", share: async () => { throw new DOMException("cancel", "AbortError"); } })).toBe("CANCELLED");
    expect(await runNativeCartShare({ title: "T", text: "X", url: "https://example.com", share: async () => { throw new TypeError("failed"); } })).toBe("FAILED");
  });
});

describe("Cancelled checkout recovery client", () => {
  const items = [{ variantId: "variant-1", quantity: 1, displayedPrice: 100000 }];
  const cancelled = {
    success: false,
    error: {
      code: "ORDER_CANCELLED",
      message: "Đơn hàng trước đã bị hủy. Hệ thống sẽ tạo lượt chốt giỏ hàng mới.",
    },
  };

  it("giữ token cùng fingerprint và sinh token mới sau invalidate", () => {
    installBrowserStorage();
    const tokenA = getCartShareSubmissionToken("A");
    expect(getCartShareSubmissionToken("A")).toBe(tokenA);
    expect(invalidateCartShareSubmission("A", tokenA)).toBe(true);
    const tokenB = getCartShareSubmissionToken("A");
    expect(tokenB).not.toBe(tokenA);
  });

  it("prepare tự recovery đúng một lần khi token cũ đã CANCELLED", async () => {
    const { localStorage, sessionStorage } = installBrowserStorage();
    const tokenA = getCartShareSubmissionToken("A");
    sessionStorage.setItem("babyjoy.preparedCartShare.v1", JSON.stringify({ stale: true }));
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    let recoveryStarted = 0;
    const result = await prepareCartShareWithRecovery({
      fingerprint: "A",
      items,
      fetcher: queuedFetcher([
        { status: 409, body: cancelled },
        { status: 201, body: clientSuccess("GH-B") },
      ], calls),
      onRecoveryStarted: () => { recoveryStarted += 1; },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].path).toBe("/api/cart/share/prepare");
    expect(calls[0].body.submissionToken).toBe(tokenA);
    expect(calls[1].body.submissionToken).not.toBe(tokenA);
    expect(result).toMatchObject({ recovered: true, submissionToken: calls[1].body.submissionToken });
    expect(recoveryStarted).toBe(1);
    expect(sessionStorage.getItem("babyjoy.preparedCartShare.v1")).toBeNull();
    expect(JSON.parse(localStorage.getItem(cartShareSubmissionKey) ?? "{}").token).toBe(calls[1].body.submissionToken);
  });

  it("activate tự tạo attempt mới rồi prepare và activate lại khi có race CANCELLED", async () => {
    installBrowserStorage();
    const tokenA = getCartShareSubmissionToken("A");
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const recoveredCodes: string[] = [];
    const result = await activateCartShareWithRecovery({
      fingerprint: "A",
      submissionToken: tokenA,
      items,
      fetcher: queuedFetcher([
        { status: 409, body: cancelled },
        { status: 201, body: clientSuccess("GH-B") },
        { status: 200, body: { ...clientSuccess("GH-B"), cartRequest: { ...clientSuccess("GH-B").cartRequest, checkoutState: "WAITING_SELLER_CONFIRM", reservationExpiresAt: "2026-09-02T00:15:00.000Z" } } },
      ], calls),
      onRecoveredPrepare: (response) => { recoveredCodes.push(response.cartRequest.code); },
    });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/cart/share/activate",
      "/api/cart/share/prepare",
      "/api/cart/share/activate",
    ]);
    expect(calls[0].body.submissionToken).toBe(tokenA);
    expect(calls[1].body.submissionToken).not.toBe(tokenA);
    expect(calls[2].body.submissionToken).toBe(calls[1].body.submissionToken);
    expect(result).toMatchObject({ recovered: true, submissionToken: calls[1].body.submissionToken });
    expect(result.response.cartRequest.code).toBe("GH-B");
    expect(recoveredCodes).toEqual(["GH-B"]);
  });

  it("không loop khi attempt mới vẫn trả ORDER_CANCELLED", async () => {
    installBrowserStorage();
    const tokenA = getCartShareSubmissionToken("A");
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    let caught: unknown;
    try {
      await activateCartShareWithRecovery({
        fingerprint: "A",
        submissionToken: tokenA,
        items,
        fetcher: queuedFetcher([
          { status: 409, body: cancelled },
          { status: 409, body: cancelled },
        ], calls),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ issue: { code: "ORDER_CANCELLED" } });
    expect(calls).toHaveLength(2);
    expect(calls[1].path).toBe("/api/cart/share/prepare");
  });

  it("ẩn lỗi kỹ thuật và giữ thông báo nghiệp vụ an toàn", () => {
    const fallback = "Chưa thể giữ hàng. Vui lòng thử lại.";
    expect(
      cartShareErrorMessage(
        new CartShareApiError(
          { code: "INVALID_ORDER_TRANSITION", message: "INVALID_ORDER_TRANSITION" },
          409,
          fallback,
        ),
        fallback,
      ),
    ).toBe(fallback);
    expect(cartShareErrorMessage(new TypeError("Failed to fetch"), fallback)).toBe(fallback);
    expect(
      cartShareErrorMessage(
        new CartShareApiError({ code: "UNKNOWN", message: "Vui lòng thử lại." }, 500, fallback),
        fallback,
      ),
    ).toBe("Vui lòng thử lại.");
  });
});

describe("Seller Admin validation", () => {
  it("server từ chối URL tùy ý khi lưu", async () => {
    const { database, env } = createTestEnv();
    const response = await saveAdminSellerSettings(
      new Request("https://metraphuong.com/api/admin/settings/seller", {
        method: "PUT",
        body: JSON.stringify({
          displayName: "Nguyễn A",
          label: "Người bán BabyJoy",
          messengerUrl: "https://evil.example/seller",
        }),
      }),
      env,
    );
    expect(response.status).toBe(422);
    database.close();
  });
});
