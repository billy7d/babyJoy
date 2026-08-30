import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  authorizeStorefrontSession,
  createAccessLink,
  getAccessLinkStats,
  handleAccessRequest,
  rotateAccessLink,
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
  ]) database.exec(migration(name));
  const env = {
    DB: new D1Adapter(database),
    STOREFRONT_ACCESS_GATE_ENABLED: "true",
    STOREFRONT_ACCESS_SECRET: "test-storefront-access-secret-123456",
  } as unknown as Env;
  return { database, env };
}

function cookieValues(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return values.flatMap((value) => {
    const first = value.split(";")[0];
    const separator = first.indexOf("=");
    return separator > 0 ? [[first.slice(0, separator), first.slice(separator + 1)] as const] : [];
  });
}

function applyCookies(jar: Map<string, string>, response: Response) {
  for (const [name, value] of cookieValues(response)) jar.set(name, value);
}

function request(url: string, jar = new Map<string, string>()) {
  const absolute = url.startsWith("/") ? "https://metraphuong.com" + url : url;
  const headers = new Headers();
  if (jar.size) headers.set("cookie", Array.from(jar).map(([k, v]) => `${k}=${v}`).join("; "));
  return new Request(absolute, { headers });
}

async function createLink(env: Env) {
  const response = await createAccessLink(
    new Request("https://metraphuong.com/api/admin/access-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Hardening test link",
        notes: null,
        groups: [{ name: "Hardening group" }],
        sessionTtlSeconds: null,
      }),
    }),
    env,
    "admin@metraphuong.com",
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: AccessLinkDto }).data;
}

describe("storefront access hardening", () => {
  it("tính Hôm nay/7 ngày/30 ngày theo ngày lịch Asia/Ho_Chi_Minh", async () => {
    const { database, env } = createTestEnv();
    const link = await createLink(env);
    const insert = database.prepare(
      "INSERT INTO access_link_events (id, access_link_id, visitor_hash, session_id, event_type, is_admin, created_at) VALUES (?, ?, ?, NULL, 'LINK_OPENED', 0, ?)",
    );
    // 30/08 23:59:59 tại Việt Nam: không thuộc "Hôm nay" khi now là 31/08 00:30 ICT.
    insert.run("before-midnight", link.id, "visitor-a", "2026-08-30T16:59:59.000Z");
    // 31/08 00:00:00 tại Việt Nam: bắt đầu đúng ngày mới.
    insert.run("at-midnight", link.id, "visitor-b", "2026-08-30T17:00:00.000Z");
    insert.run("after-midnight", link.id, "visitor-c", "2026-08-30T17:20:00.000Z");

    const stats = await getAccessLinkStats(
      env,
      link.id,
      new Date("2026-08-30T17:30:00.000Z"),
    );
    expect(stats).toMatchObject({
      validLinkOpens: 3,
      uniqueVisitors: 3,
      opensToday: 2,
      opens7d: 3,
      opens30d: 3,
    });
    database.close();
  });

  it("không xóa session hợp lệ khi user vô tình mở credential cũ sau rotate", async () => {
    const { database, env } = createTestEnv();
    const t0 = new Date("2026-08-30T08:00:00.000Z");
    const link = await createLink(env);
    const rotatedResponse = await rotateAccessLink(
      new Request(`https://metraphuong.com/api/admin/access-links/${link.id}/rotate`, { method: "POST" }),
      env,
      link.id,
      "admin@metraphuong.com",
    );
    const rotated = ((await rotatedResponse.json()) as { data: AccessLinkDto }).data;
    const jar = new Map<string, string>();
    applyCookies(jar, await handleAccessRequest(request(rotated.accessUrl, jar), env, t0));
    expect(await authorizeStorefrontSession(request("/", jar), env, t0)).toMatchObject({ valid: true });

    const stale = await handleAccessRequest(
      request(link.accessUrl, jar),
      env,
      new Date("2026-08-30T08:01:00.000Z"),
    );
    expect(stale.status).toBe(303);
    expect(stale.headers.get("location")).toBe("/");
    expect(cookieValues(stale).some(([name, value]) => name.includes("access_session") && value === "")).toBe(false);
    expect(
      await authorizeStorefrontSession(
        request("/", jar),
        env,
        new Date("2026-08-30T08:01:00.000Z"),
      ),
    ).toMatchObject({ valid: true });

    expect(database.prepare("SELECT COUNT(*) AS count FROM access_sessions WHERE revoked_at IS NULL").get()).toEqual({ count: 1 });
    database.close();
  });
});
