import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runAfter,
  runBefore,
  validateContinuity,
} from "../scripts/storefront-session-continuity.mjs";

const COOKIE =
  "__Host-mp_access_session=old-session; __Host-mp_visitor_id=old-visitor";
let temporaryDirectory: string | undefined;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function accessResponse() {
  const headers = new Headers({ location: "/" });
  headers.append(
    "set-cookie",
    "__Host-mp_access_session=old-session; Path=/; HttpOnly",
  );
  headers.append(
    "set-cookie",
    "__Host-mp_visitor_id=old-visitor; Path=/; HttpOnly",
  );
  return new Response(null, { status: 303, headers });
}

function standardFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const pathname = new URL(url).pathname;
    if (pathname === "/access/continuity-fixture") return accessResponse();
    if (pathname === "/api/storefront/session")
      return jsonResponse({ authenticated: true, gateEnabled: true });
    if (pathname === "/api/products")
      return jsonResponse({
        data: [],
        pagination: { page: 1, limit: 20, totalItems: 0 },
      });
    if (pathname === "/")
      return new Response("<html><body>storefront</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    throw new Error(`Unexpected test URL: ${url}`);
  };
  return { calls, fetchImpl };
}

async function makeCookieFile() {
  temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "babyjoy-session-continuity-"),
  );
  return path.join(temporaryDirectory, "continuity.cookie");
}

afterEach(async () => {
  if (temporaryDirectory)
    await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("storefront session continuity smoke", () => {
  it("giữ nguyên cookie từ before sang after và không mở access link lần hai", async () => {
    const cookieFile = await makeCookieFile();
    const before = standardFetch();
    await runBefore({
      accessUrl: "https://metraphuong.com/access/continuity-fixture",
      cookieFile,
      fetchImpl: before.fetchImpl,
    });
    expect((await readFile(cookieFile, "utf8")).trim()).toBe(COOKIE);

    const after = standardFetch();
    await runAfter({ cookieFile, fetchImpl: after.fetchImpl });
    expect(after.calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/storefront/session",
      "/api/products",
      "/",
    ]);
    expect(
      after.calls.every(
        (call) =>
          (call.init?.headers as Record<string, string>).cookie === COOKIE,
      ),
    ).toBe(true);
  });

  it("chặn before khi access link không cấp cookie", async () => {
    const cookieFile = await makeCookieFile();
    const fetchImpl = async () => new Response(null, { status: 303 });
    await expect(
      runBefore({
        accessUrl: "https://metraphuong.com/access/continuity-fixture",
        cookieFile,
        fetchImpl,
      }),
    ).rejects.toThrow("cookie fixture is invalid or empty");
  });

  it.each([
    [401, "expired or revoked"],
    [503, "missing secret"],
  ])("đánh rớt after khi session cũ trả HTTP %s (%s)", async (status) => {
    const cookieFile = await makeCookieFile();
    await writeFile(cookieFile, `${COOKIE}\n`, "utf8");
    const calls: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL) => {
      calls.push(new URL(String(input)).pathname);
      return jsonResponse(
        {
          error:
            status === 401
              ? "STOREFRONT_SESSION_REQUIRED"
              : "STOREFRONT_ACCESS_NOT_CONFIGURED",
        },
        status,
      );
    };
    await expect(runAfter({ cookieFile, fetchImpl })).rejects.toThrow(
      `HTTP ${status}`,
    );
    expect(calls).toEqual(["/api/storefront/session"]);
    expect(calls).not.toContain("/access/continuity-fixture");
  });

  it("không PASS giả khi gate tắt và API session vẫn trả 200", async () => {
    const cookieFile = await makeCookieFile();
    await writeFile(cookieFile, `${COOKIE}\n`, "utf8");
    const fetchImpl = async () =>
      jsonResponse({ authenticated: true, gateEnabled: false });
    await expect(runAfter({ cookieFile, fetchImpl })).rejects.toThrow(
      "not authenticated",
    );
  });

  it("đánh rớt payload products lỗi dù HTTP là 200", async () => {
    const cookieFile = await makeCookieFile();
    await writeFile(cookieFile, `${COOKIE}\n`, "utf8");
    const { fetchImpl } = standardFetch();
    const invalidFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/api/storefront/session")
        return jsonResponse({ authenticated: true, gateEnabled: true });
      if (pathname === "/api/products")
        return jsonResponse({ error: "fake-success" }, 200);
      return fetchImpl(input, init);
    };
    await expect(
      runAfter({ cookieFile, fetchImpl: invalidFetch }),
    ).rejects.toThrow("valid catalog payload");
  });

  it("ghi nhận NOT_APPLICABLE khi gate đang tắt trước lần enable đầu tiên", async () => {
    const { calls } = standardFetch();
    const disabledGateFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ authenticated: true, gateEnabled: false });
    };
    await expect(
      validateContinuity({ fetchImpl: disabledGateFetch }),
    ).resolves.toEqual({
      applicable: false,
      gateEnabledBefore: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("BLOCKED khi gate đã bật nhưng thiếu hoặc sai fixture trước deploy", async () => {
    const gateEnabledFetch = async () =>
      jsonResponse({ error: "STOREFRONT_SESSION_REQUIRED" }, 401);
    await expect(
      validateContinuity({ fetchImpl: gateEnabledFetch, required: true }),
    ).rejects.toThrow("ACCESS_URL is required");
    await expect(
      validateContinuity({
        accessUrl: "https://example.com/access/not-production",
        fetchImpl: gateEnabledFetch,
        required: true,
      }),
    ).rejects.toThrow("must be an https metraphuong.com access path");
  });
});
