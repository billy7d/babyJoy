import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeMessengerCartSummary,
  generateOpaqueToken,
  messengerEventKey,
  parseMessengerWebhook,
  publicMessengerStatus,
  sendMessengerMessage,
  validateMessengerStart,
  verifyMetaSignature,
} from "../workers/messenger";
import { cartFingerprint } from "../app/lib/messenger-checkout";

describe("Messenger checkout input", () => {
  it("chỉ nhận variant và quantity, không tin giá từ browser", () => {
    expect(
      validateMessengerStart({
        submissionToken: "submission-1",
        items: [{ variantId: "variant-1", quantity: 2, priceVnd: 1 }],
      }),
    ).toEqual({
      submissionToken: "submission-1",
      items: [{ variantId: "variant-1", quantity: 2 }],
    });
  });

  it("chặn cart trống, quantity sai và variant trùng", () => {
    expect(() =>
      validateMessengerStart({ submissionToken: "token", items: [] }),
    ).toThrow("Giỏ hàng đang trống");
    expect(() =>
      validateMessengerStart({
        submissionToken: "token",
        items: [{ variantId: "v1", quantity: 0 }],
      }),
    ).toThrow("Thông tin gửi chưa hợp lệ");
    expect(() =>
      validateMessengerStart({
        submissionToken: "token",
        items: [
          { variantId: "v1", quantity: 1 },
          { variantId: "v1", quantity: 1 },
        ],
      }),
    ).toThrow("Thông tin gửi chưa hợp lệ");
  });

  it("token opaque có tối thiểu 128 bit entropy", () => {
    const token = generateOpaqueToken(new Uint8Array(16).fill(7));
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(22);
    expect(() => generateOpaqueToken(new Uint8Array(15))).toThrow(
      "TOKEN_ENTROPY_TOO_LOW",
    );
  });
});

describe("Meta webhook security và parser", () => {
  it("xác thực đúng X-Hub-Signature-256 trên raw body", async () => {
    const secret = "test-app-secret";
    const raw = new TextEncoder().encode('{"object":"page"}');
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(
      await verifyMetaSignature(raw.buffer, signature, secret),
    ).toBe(true);
    const invalid = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    expect(await verifyMetaSignature(raw.buffer, invalid, secret)).toBe(false);
    expect(await verifyMetaSignature(raw.buffer, null, secret)).toBe(false);
  });

  it("parse referral, Get Started có referral và confirmation postback", () => {
    const events = parseMessengerWebhook({
      entry: [
        {
          id: "page-1",
          messaging: [
            {
              sender: { id: "psid-1" },
              timestamp: 1,
              referral: { ref: "raw-ref-1" },
            },
            {
              sender: { id: "psid-1" },
              timestamp: 2,
              postback: {
                payload: "BABYJOY_GET_STARTED",
                referral: { ref: "raw-ref-1" },
              },
            },
            {
              sender: { id: "psid-1" },
              timestamp: 3,
              postback: { payload: "BABYJOY_CONFIRM_CART:session-1" },
            },
          ],
        },
      ],
    });
    expect(events.map((event) => event.type)).toEqual([
      "REFERRAL",
      "GET_STARTED",
      "CONFIRM_CART",
    ]);
    expect(events[1].referralToken).toBe("raw-ref-1");
    expect(events[2].sessionId).toBe("session-1");
  });

  it("event key ổn định cho webhook delivery bị lặp", async () => {
    const [event] = parseMessengerWebhook({
      entry: [
        {
          id: "page-1",
          messaging: [
            {
              sender: { id: "psid-1" },
              timestamp: 100,
              message: { mid: "mid.123", text: "hello" },
            },
          ],
        },
      ],
    });
    expect(await messengerEventKey(event)).toBe("mid:mid.123");
    expect(await messengerEventKey(event)).toBe(await messengerEventKey(event));
  });
});

describe("Messenger Send API client", () => {
  afterEach(() => vi.restoreAllMocks());

  function testEnv() {
    const env = {} as Env;
    Object.assign(env, {
      META_PAGE_ID: "page-123",
      MESSENGER_PAGE_USERNAME: "babyjoy",
      META_GRAPH_API_VERSION: "v26.0",
      MESSENGER_CHECKOUT_ENABLED: "false",
      META_APP_SECRET: "app-secret",
      META_PAGE_ACCESS_TOKEN: "page-token",
      META_WEBHOOK_VERIFY_TOKEN: "verify-token",
    });
    return env;
  }

  it("gửi đúng Page endpoint, PSID recipient và RESPONSE", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message_id: "mid.1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      sendMessengerMessage(testEnv(), "private-psid", { text: "hello" }),
    ).resolves.toBe("mid.1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v26.0/page-123/messages");
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      recipient: { id: "private-psid" },
      messaging_type: "RESPONSE",
      message: { text: "hello" },
    });
  });

  it.each([400, 503])("fail-closed khi Meta trả HTTP %s", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: status, message: "Meta unavailable" } }),
        { status },
      ),
    );
    await expect(
      sendMessengerMessage(testEnv(), "private-psid", { text: "hello" }),
    ).rejects.toThrow("Meta unavailable");
  });

  it("không coi delivery là chắc chắn nếu Meta success nhưng thiếu message ID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ recipient_id: "private-psid" }), {
        status: 200,
      }),
    );
    await expect(
      sendMessengerMessage(testEnv(), "private-psid", { text: "hello" }),
    ).rejects.toThrow("thiếu message ID");
  });
});

describe("Messenger message và public status", () => {
  it("format summary chỉ từ snapshot và đúng tạm tính", () => {
    const text = composeMessengerCartSummary({
      code: "GH-260827-ABCD",
      subtotalVnd: 250000,
      items: [
        {
          productId: "p1",
          variantId: "v1",
          productName: "Bột ăn dặm Gerber Organic",
          variantName: "227g",
          sku: "SKU-1",
          imageKey: "products/old.webp",
          priceVnd: 125000,
          quantity: 2,
          lineTotalVnd: 250000,
        },
      ],
    });
    expect(text).toContain("🛒 GIỎ HÀNG BABYJOY");
    expect(text).toContain("227g × 2");
    expect(text).toContain("250.000 ₫");
    expect(text).not.toContain("psid");
  });

  it("chỉ SENT mới là hoàn tất delivery", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(publicMessengerStatus("CREATED", "PENDING", future)).toBe(
      "AWAITING_USER",
    );
    expect(publicMessengerStatus("IDENTIFIED", "PENDING", future)).toBe(
      "IDENTIFIED",
    );
    expect(publicMessengerStatus("CONFIRMED", "SENDING", future)).toBe(
      "SENDING",
    );
    expect(publicMessengerStatus("CONFIRMED", "SENT", future)).toBe("SENT");
  });

  it("fingerprint ổn định theo variant và phát hiện cart thay đổi", () => {
    const first = cartFingerprint([
      { variantId: "b", quantity: 1 },
      { variantId: "a", quantity: 2 },
    ]);
    expect(first).toBe(
      cartFingerprint([
        { variantId: "a", quantity: 2 },
        { variantId: "b", quantity: 1 },
      ]),
    );
    expect(first).not.toBe(
      cartFingerprint([
        { variantId: "a", quantity: 3 },
        { variantId: "b", quantity: 1 },
      ]),
    );
  });
});
