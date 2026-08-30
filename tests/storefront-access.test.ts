import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  createAccessLink,
  createAdminAnalyticsMarker,
  deleteAccessLink,
  generateAccessCredential,
  getAccessSessionCookieName,
  getAccessLinkStats,
  getVisitorCookieName,
  handleAccessRequest,
  hashSessionToken,
  authorizeStorefrontSession,
  isAccessEndpointPath,
  isAdminHtmlPath,
  isStorefrontProtectedApiPath,
  isStorefrontProtectedHtmlPath,
  resetAccessLinkSessions,
  rotateAccessLink,
  revokeAccessLink,
  saveStorefrontSettings,
  storefrontSessionRequiredResponse,
  validateAccessLinkInput,
  validateSessionTtl,
  verifyAccessCredential,
  verifyAdminAnalyticsMarker,
  type AccessLinkDto,
} from "../workers/storefront-access";

function migration(name: string) {
  return readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8");
}

class StatementAdapter {
  private values: unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]) {
    const next = new StatementAdapter(this.statement);
    next.values = values;
    return next;
  }

  all<T>() {
    return Promise.resolve({
      results: this.statement.all(...this.values) as T[],
    });
  }

  first<T>() {
    return Promise.resolve(
      (this.statement.get(...this.values) as T | undefined) ?? null,
    );
  }

  run() {
    const result = this.statement.run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }
}

class D1Adapter {
  constructor(readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new StatementAdapter(this.database.prepare(sql));
  }
}

function createTestEnv() {
  const database = new DatabaseSync(":memory:");
  for (const name of [
    "0001_initial.sql",
    "0002_seed.sql",
    "0003_messenger_checkout_v1.sql",
    "0004_direct_seller_cart_share_v1.sql",
    "0005_remove_demo_cart_request.sql",
    "0006_product_taxonomy_v1.sql",
    "0007_storefront_access_gate_v1.sql",
  ])
    database.exec(migration(name));
  const env = {
    DB: new D1Adapter(database),
    STOREFRONT_ACCESS_GATE_ENABLED: "true",
    STOREFRONT_ACCESS_SECRET: "test-storefront-access-secret-123456",
  } as unknown as Env;
  return { database, env };
}

function cookieValues(response: Response) {
  const typedHeaders = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const values = typedHeaders.getSetCookie?.() ?? [
    response.headers.get("set-cookie") ?? "",
  ];
  return values.flatMap((value) => {
    const first = value.split(";")[0];
    const separator = first.indexOf("=");
    return separator > 0
      ? [[first.slice(0, separator), first.slice(separator + 1)] as const]
      : [];
  });
}

function applyCookies(
  jar: Map<string, string>,
  response: Response,
) {
  for (const [name, value] of cookieValues(response)) jar.set(name, value);
}

function cookieHeader(jar: Map<string, string>) {
  return Array.from(jar.entries())
    .map(([name, value]) => name + "=" + value)
    .join("; ");
}

function accessRequest(
  url: string,
  jar = new Map<string, string>(),
) {
  const absoluteUrl = url.startsWith("/")
    ? "https://metraphuong.com" + url
    : url;
  const headers = new Headers();
  const cookies = cookieHeader(jar);
  if (cookies) headers.set("cookie", cookies);
  return new Request(absoluteUrl, { headers });
}

async function createLink(
  env: Env,
  input: Record<string, unknown> = {},
) {
  const response = await createAccessLink(
    new Request("https://metraphuong.com/api/admin/access-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Group BabyJoy Hà Nội",
        notes: "v1",
        groups: [
          {
            name: "BabyJoy Hà Nội",
            url: "https://facebook.com/groups/babyjoy-hanoi",
          },
        ],
        sessionTtlSeconds: null,
        ...input,
      }),
    }),
    env,
    "verified@metraphuong.com",
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { data: AccessLinkDto };
  return body.data;
}

function tamperBase64Url(value: string) {
  if (!value) throw new Error("Cannot tamper empty value");
  return (value.startsWith("a") ? "b" : "a") + value.slice(1);
}

describe("storefront access credentials", () => {
  it("ký và verify theo link/version, chống tamper và marker giả", async () => {
    const secret = "secret-for-storefront-access";
    const credential = await generateAccessCredential(secret, "link-a", 7);
    const signature = credential.split(".")[1];
    expect(credential).toMatch(/^link-a\.[A-Za-z0-9_-]{43}$/);
    expect(
      await verifyAccessCredential(secret, "link-a", 7, signature),
    ).toBe(true);
    expect(
      await verifyAccessCredential(secret, "link-a", 8, signature),
    ).toBe(false);
    expect(
      await verifyAccessCredential(
        secret,
        "link-a",
        7,
        tamperBase64Url(signature),
      ),
    ).toBe(false);

    const marker = await createAdminAnalyticsMarker(secret, new Date("2026-08-30T00:00:00Z"));
    const markerParts = marker.split(".");
    const tamperedMarker = [
      markerParts[0],
      markerParts[1],
      tamperBase64Url(markerParts[2]),
    ].join(".");
    expect(
      await verifyAdminAnalyticsMarker(
        marker,
        secret,
        new Date("2026-08-30T00:30:00Z"),
      ),
    ).toBe(true);
    expect(
      await verifyAdminAnalyticsMarker(
        tamperedMarker,
        secret,
        new Date("2026-08-30T00:30:00Z"),
      ),
    ).toBe(false);
  });

  it("validate TTL và nhiều group, nhưng không nhận URL ngoài Facebook Group", () => {
    expect(validateSessionTtl(null)).toBeNull();
    expect(validateSessionTtl(1296000)).toBe(1296000);
    expect(() => validateSessionTtl(3599)).toThrow("INVALID_SESSION_TTL");
    expect(() => validateSessionTtl(31536001)).toThrow("INVALID_SESSION_TTL");
    expect(
      validateAccessLinkInput({
        name: "Link X",
        groups: [{ name: "A" }, { name: "B" }],
        sessionTtlSeconds: 7200,
      }).groups,
    ).toHaveLength(2);
    expect(() =>
      validateAccessLinkInput({
        name: "Link X",
        groups: [{ name: "A", url: "https://example.com/groups/a" }],
        sessionTtlSeconds: null,
      }),
    ).toThrow("INVALID_FACEBOOK_GROUP_URL");
  });

  it("giữ đúng hợp đồng route gate và lỗi API không redirect HTML", async () => {
    expect(isAccessEndpointPath("/access/link.sig")).toBe(true);
    expect(isAccessEndpointPath("/access/link.sig/extra")).toBe(false);
    expect(isAdminHtmlPath("/admin")).toBe(true);
    expect(isAdminHtmlPath("/admin/access-links")).toBe(true);
    expect(isAdminHtmlPath("/administrator")).toBe(false);
    expect(isStorefrontProtectedHtmlPath("/")).toBe(true);
    expect(isStorefrontProtectedHtmlPath("/__manifest")).toBe(false);
    expect(isStorefrontProtectedHtmlPath("/__manifest/extra")).toBe(true);
    expect(isStorefrontProtectedHtmlPath("/admin/access-links")).toBe(false);
    expect(isStorefrontProtectedHtmlPath("/access-required")).toBe(false);
    expect(isStorefrontProtectedHtmlPath("/c/share-token")).toBe(false);
    expect(isStorefrontProtectedHtmlPath("/images/logo.png")).toBe(false);
    expect(isStorefrontProtectedApiPath("/api/products/slug")).toBe(true);
    expect(isStorefrontProtectedApiPath("/api/admin/products")).toBe(false);
    expect(isStorefrontProtectedApiPath("/api/cart/share/token")).toBe(false);
    expect(isStorefrontProtectedApiPath("/api/meta/messenger/webhook")).toBe(false);
    const response = storefrontSessionRequiredResponse();
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: "STOREFRONT_SESSION_REQUIRED",
      message: "Access session is required.",
    });
  });
});

describe("storefront access sessions and analytics", () => {
  it("issues opaque fixed-TTL session, reuses it on repeat click and handles expiry", async () => {
    const { database, env } = createTestEnv();
    const t0 = new Date("2026-08-30T08:00:00.000Z");
    const link = await createLink(env);
    const jar = new Map<string, string>();

    const first = await handleAccessRequest(
      accessRequest(link.accessUrl, jar),
      env,
      t0,
    );
    expect(first.status).toBe(303);
    applyCookies(jar, first);
    const firstToken = jar.get("__Host-mp_access_session");
    expect(firstToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(firstToken).not.toBe(
      database
        .prepare("SELECT token_hash AS tokenHash FROM access_sessions")
        .get()?.tokenHash,
    );
    const firstSession = database
      .prepare("SELECT expires_at AS expiresAt FROM access_sessions")
      .get() as { expiresAt: string };
    expect(firstSession.expiresAt).toBe(
      new Date(t0.getTime() + 1296000 * 1000).toISOString(),
    );
    expect(
      await authorizeStorefrontSession(accessRequest("/", jar), env, t0),
    ).toMatchObject({ valid: true });

    const repeated = await handleAccessRequest(
      accessRequest(link.accessUrl, jar),
      env,
      new Date("2026-08-31T08:00:00.000Z"),
    );
    applyCookies(jar, repeated);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM access_sessions").get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare("SELECT expires_at AS expiresAt FROM access_sessions")
        .get(),
    ).toEqual(firstSession);
    expect(await getAccessLinkStats(env, link.id, new Date("2026-08-31T08:00:00Z"))).toMatchObject({
      validLinkOpens: 2,
      uniqueVisitors: 1,
      sessionsIssued: 1,
      activeSessions: 1,
      opens7d: 2,
      opens30d: 2,
    });

    const expiredAt = new Date("2026-09-14T08:00:01.000Z");
    expect(
      await authorizeStorefrontSession(accessRequest("/", jar), env, expiredAt),
    ).toMatchObject({ valid: false, reason: "EXPIRED" });
    const renewed = await handleAccessRequest(
      accessRequest(link.accessUrl, jar),
      env,
      expiredAt,
    );
    applyCookies(jar, renewed);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM access_sessions").get(),
    ).toEqual({ count: 2 });
    expect(await getAccessLinkStats(env, link.id, expiredAt)).toMatchObject({
      validLinkOpens: 3,
      uniqueVisitors: 1,
      sessionsIssued: 2,
    });
    expect(await hashSessionToken(firstToken!)).not.toBe(firstToken);
    expect(cookieValues(first).map(([name]) => name)).toEqual(
      expect.arrayContaining([
        getAccessSessionCookieName(accessRequest("/")),
        getVisitorCookieName(accessRequest("/")),
      ]),
    );
    expect(first.headers.get("set-cookie")).toContain("Secure");
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");
    database.close();
  });

  it("admin marker is signed and excluded from every user metric", async () => {
    const { database, env } = createTestEnv();
    const link = await createLink(env);
    const marker = await createAdminAnalyticsMarker(
      env.STOREFRONT_ACCESS_SECRET,
      new Date("2026-08-30T08:00:00Z"),
    );
    const jar = new Map<string, string>([["__Host-mp_admin_analytics", marker]]);
    const response = await handleAccessRequest(
      accessRequest(link.accessUrl, jar),
      env,
      new Date("2026-08-30T08:00:00Z"),
    );
    applyCookies(jar, response);
    expect(await getAccessLinkStats(env, link.id)).toMatchObject({
      validLinkOpens: 0,
      uniqueVisitors: 0,
      sessionsIssued: 0,
      activeSessions: 0,
    });
    expect(
      database
        .prepare("SELECT is_admin AS isAdmin FROM access_sessions")
        .get(),
    ).toEqual({ isAdmin: 1 });
    database.close();
  });

  it("reset giữ URL/version, rotate invalid URL cũ, revoke kick ngay và switch link", async () => {
    const { database, env } = createTestEnv();
    const t0 = new Date("2026-08-30T08:00:00Z");
    const linkA = await createLink(env);
    const linkB = await createLink(env, {
      name: "Group BabyJoy Hồ Chí Minh",
      groups: [{ name: "BabyJoy Hồ Chí Minh" }],
    });
    const jar = new Map<string, string>();
    applyCookies(jar, await handleAccessRequest(accessRequest(linkA.accessUrl, jar), env, t0));
    const resetResponse = await resetAccessLinkSessions(
      new Request("https://metraphuong.com/api/admin/access-links/" + linkA.id + "/reset-sessions"),
      env,
      linkA.id,
      "verified@metraphuong.com",
    );
    expect(resetResponse.status).toBe(200);
    const resetBody = (await resetResponse.json()) as { data: AccessLinkDto };
    expect(resetBody.data.version).toBe(linkA.version);
    expect(resetBody.data.accessUrl).toBe(linkA.accessUrl);
    expect(
      await authorizeStorefrontSession(accessRequest("/", jar), env, t0),
    ).toMatchObject({ valid: false, reason: "REVOKED" });
    expect(
      (await handleAccessRequest(accessRequest(linkA.accessUrl, jar), env, t0)).status,
    ).toBe(303);

    const afterReset = await handleAccessRequest(accessRequest(linkA.accessUrl, jar), env, t0);
    applyCookies(jar, afterReset);
    expect(await authorizeStorefrontSession(accessRequest("/", jar), env, t0)).toMatchObject({ valid: true });

    const rotateResponse = await rotateAccessLink(
      new Request("https://metraphuong.com/api/admin/access-links/" + linkA.id + "/rotate"),
      env,
      linkA.id,
      "verified@metraphuong.com",
    );
    const rotated = (await rotateResponse.json()) as { data: AccessLinkDto };
    expect(rotated.data.version).toBe(linkA.version + 1);
    expect(rotated.data.accessUrl).not.toBe(linkA.accessUrl);
    expect((await handleAccessRequest(accessRequest(linkA.accessUrl, jar), env, t0)).headers.get("location")).toBe("/access-required");
    expect((await handleAccessRequest(accessRequest(rotated.data.accessUrl, jar), env, t0)).status).toBe(303);

    const revokeResponse = await revokeAccessLink(
      new Request("https://metraphuong.com/api/admin/access-links/" + rotated.data.id + "/revoke"),
      env,
      rotated.data.id,
      "verified@metraphuong.com",
    );
    expect(revokeResponse.status).toBe(200);
    expect((await handleAccessRequest(accessRequest(rotated.data.accessUrl, jar), env, t0)).status).toBe(303);

    const jarB = new Map<string, string>();
    applyCookies(jarB, await handleAccessRequest(accessRequest(linkA.accessUrl, jarB), env, new Date("2026-08-30T09:00:00Z")));
    applyCookies(jarB, await handleAccessRequest(accessRequest(linkB.accessUrl, jarB), env, new Date("2026-08-30T09:00:01Z")));
    expect(
      database
        .prepare("SELECT access_link_id AS accessLinkId, revoked_at IS NOT NULL AS revoked FROM access_sessions ORDER BY created_at")
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { accessLinkId: linkA.id, revoked: 1 },
        { accessLinkId: linkB.id, revoked: 0 },
      ]),
    );
    database.close();
  });

  it("gate enabled không có secret thì fail closed", async () => {
    const { database, env } = createTestEnv();
    const missingSecret = {
      ...env,
      STOREFRONT_ACCESS_SECRET: "",
    } as unknown as Env;
    const result = await authorizeStorefrontSession(
      accessRequest("https://metraphuong.com/"),
      missingSecret,
    );
    expect(result).toEqual({ valid: false, reason: "MISSING_SECRET" });
    expect(
      (await handleAccessRequest(
        accessRequest("https://metraphuong.com/access/invalid"),
        missingSecret,
      )).status,
    ).toBe(503);
    database.close();
  });

  it("đổi default TTL cho session mới và soft-delete vẫn giữ analytics", async () => {
    const { database, env } = createTestEnv();
    const customDefault = 30 * 24 * 60 * 60;
    const settingsResponse = await saveStorefrontSettings(
      new Request("https://metraphuong.com/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storefrontSessionTtlSeconds: customDefault }),
      }),
      env,
    );
    expect(settingsResponse.status).toBe(200);
    expect(await settingsResponse.json()).toMatchObject({
      data: { storefrontSessionTtlSeconds: customDefault },
    });
    const link = await createLink(env, { sessionTtlSeconds: null });
    expect(link.sessionTtlSeconds).toBe(customDefault);
    const jar = new Map<string, string>();
    applyCookies(
      jar,
      await handleAccessRequest(
        accessRequest(link.accessUrl, jar),
        env,
        new Date("2026-08-30T08:00:00Z"),
      ),
    );
    expect(
      database.prepare("SELECT expires_at AS expiresAt FROM access_sessions").get(),
    ).toEqual({
      expiresAt: new Date("2026-09-29T08:00:00Z").toISOString(),
    });
    const deleted = await deleteAccessLink(
      new Request("https://metraphuong.com/api/admin/access-links/" + link.id, {
        method: "DELETE",
      }),
      env,
      link.id,
      "verified@metraphuong.com",
    );
    expect(deleted.status).toBe(200);
    expect(
      database.prepare("SELECT deleted_at IS NOT NULL AS deleted FROM access_links WHERE id = ?").get(link.id),
    ).toEqual({ deleted: 1 });
    expect(await getAccessLinkStats(env, link.id)).toMatchObject({
      validLinkOpens: 1,
      sessionsIssued: 1,
      activeSessions: 0,
    });
    database.close();
  });
});
