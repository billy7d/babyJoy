const ACCESS_CREDENTIAL_PREFIX = "storefront-access:v1";
const ADMIN_ANALYTICS_PREFIX = "storefront-admin-analytics:v1";
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

export const DEFAULT_STOREFRONT_SESSION_TTL_SECONDS = 15 * 24 * 60 * 60;
export const MIN_STOREFRONT_SESSION_TTL_SECONDS = 60 * 60;
export const MAX_STOREFRONT_SESSION_TTL_SECONDS = 365 * 24 * 60 * 60;
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
export const ADMIN_ANALYTICS_COOKIE_MAX_AGE_SECONDS = 60 * 60;

export type AccessLinkStatus = "ACTIVE" | "REVOKED";

export type AccessLinkGroupInput = {
  name: string;
  url?: string | null;
};

export type AccessLinkInput = {
  name: string;
  notes?: string | null;
  groups: AccessLinkGroupInput[];
  sessionTtlSeconds: number | null;
};

export type AccessSessionAuthorization = {
  valid: boolean;
  reason?:
    | "GATE_DISABLED"
    | "MISSING_SECRET"
    | "MISSING_COOKIE"
    | "INVALID_SESSION"
    | "EXPIRED"
    | "REVOKED"
    | "LINK_REVOKED"
    | "VERSION_MISMATCH";
  session?: AccessSessionRow;
};

type AccessLinkRow = {
  id: string;
  name: string;
  notes: string | null;
  status: AccessLinkStatus;
  version: number;
  sessionTtlSeconds: number | null;
  createdByEmail: string | null;
  updatedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  deletedAt: string | null;
  lastUsedAt: string | null;
};

export type AccessSessionRow = {
  id: string;
  tokenHash: string;
  accessLinkId: string;
  linkVersion: number;
  visitorHash: string | null;
  isAdmin: number;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
};

type AccessEventRow = {
  id: string;
  accessLinkId: string;
  visitorHash: string | null;
  sessionId: string | null;
  eventType: string;
  isAdmin: number;
  createdAt: string;
};

type AccessLinkGroupRow = {
  id: string;
  accessLinkId: string;
  groupName: string;
  groupUrl: string | null;
  createdAt: string;
};

export type AccessLinkStats = {
  validLinkOpens: number;
  uniqueVisitors: number;
  sessionsIssued: number;
  activeSessions: number;
  opensToday: number;
  opens7d: number;
  opens30d: number;
  lastUsedAt: string | null;
};

export type AccessLinkDto = {
  id: string;
  name: string;
  notes: string | null;
  groups: Array<{ id: string; name: string; url: string | null }>;
  status: AccessLinkStatus;
  version: number;
  sessionTtlSeconds: number;
  usesDefaultTtl: boolean;
  accessUrl: string;
  createdByEmail: string | null;
  updatedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  stats: AccessLinkStats;
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return new Uint8Array(signature);
}

export function getStorefrontAccessSecret(env: Env) {
  const secret = String(env.STOREFRONT_ACCESS_SECRET ?? "").trim();
  return secret || null;
}

export function isStorefrontAccessGateEnabled(env: Env) {
  return (
    String(env.STOREFRONT_ACCESS_GATE_ENABLED ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}

export async function signAccessCredential(
  secret: string,
  linkId: string,
  version: number,
) {
  const signature = await hmac(
    secret,
    ACCESS_CREDENTIAL_PREFIX + ":" + linkId + ":" + version,
  );
  return bytesToBase64Url(signature);
}

export async function generateAccessCredential(
  secret: string,
  linkId: string,
  version: number,
) {
  return linkId + "." + (await signAccessCredential(secret, linkId, version));
}

export function parseAccessCredential(value: string) {
  if (!value || value.length > 512 || value.includes("/")) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;
  const linkId = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(linkId)) return null;
  if (!base64UrlToBytes(signature)) return null;
  return { linkId, signature };
}

export async function verifyAccessCredential(
  secret: string,
  linkId: string,
  version: number,
  signature: string,
) {
  const supplied = base64UrlToBytes(signature);
  if (!supplied) return false;
  const expected = await hmac(
    secret,
    ACCESS_CREDENTIAL_PREFIX + ":" + linkId + ":" + version,
  );
  return constantTimeEqual(supplied, expected);
}

function cookieName(request: Request, kind: "session" | "visitor" | "admin") {
  const secure = new URL(request.url).protocol === "https:";
  if (kind === "session")
    return secure ? "__Host-mp_access_session" : "mp_access_session";
  if (kind === "visitor")
    return secure ? "__Host-mp_visitor_id" : "mp_visitor_id";
  return secure ? "__Host-mp_admin_analytics" : "mp_admin_analytics";
}

export function getAccessSessionCookieName(request: Request) {
  return cookieName(request, "session");
}

export function getVisitorCookieName(request: Request) {
  return cookieName(request, "visitor");
}

export function getAdminAnalyticsCookieName(request: Request) {
  return cookieName(request, "admin");
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name)
      return part.slice(separator + 1).trim() || null;
  }
  return null;
}

function serializeCookie(
  request: Request,
  name: string,
  value: string,
  maxAge: number,
  httpOnly: boolean,
) {
  const parts = [
    name + "=" + value,
    "Path=/",
    "SameSite=Lax",
    "Max-Age=" + Math.max(0, Math.floor(maxAge)),
  ];
  const secure = new URL(request.url).protocol === "https:";
  if (secure) parts.push("Secure");
  if (httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

function appendCookie(response: Response, cookie: string) {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function responseHeaders() {
  return new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
}

function jsonResponse(data: unknown, status = 200, headers?: Headers) {
  const next = headers ?? responseHeaders();
  next.set("content-type", "application/json; charset=utf-8");
  next.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: next });
}

export function storefrontSessionRequiredResponse() {
  return jsonResponse(
    {
      error: "STOREFRONT_SESSION_REQUIRED",
      message: "Access session is required.",
    },
    401,
  );
}

export function storefrontGateMisconfiguredResponse() {
  return jsonResponse(
    {
      error: "STOREFRONT_ACCESS_NOT_CONFIGURED",
      message: "Storefront access is not configured.",
    },
    503,
  );
}

export function storefrontAccessRequiredRedirect(
  request: Request,
  clearSession = false,
) {
  const headers = responseHeaders();
  headers.set("location", "/access-required");
  let response = new Response(null, { status: 303, headers });
  if (clearSession)
    response = appendCookie(
      response,
      serializeCookie(request, getAccessSessionCookieName(request), "", 0, true),
    );
  return response;
}

export function isAccessEndpointPath(path: string) {
  return /^\/access\/[^/]+$/.test(path);
}

export function isAdminHtmlPath(path: string) {
  return path === "/admin" || path.startsWith("/admin/");
}

export function isStorefrontProtectedApiPath(path: string) {
  if (!path.startsWith("/api/")) return false;
  if (path.startsWith("/api/admin/")) return false;
  if (path === "/api/meta/messenger/webhook") return false;
  if (/^\/api\/cart\/share\/[^/]+$/.test(path)) return false;
  if (/^\/api\/cart\/messenger\/status\/[^/]+$/.test(path)) return false;
  return (
    path === "/api/categories" ||
    path === "/api/brands" ||
    path === "/api/products" ||
    path.startsWith("/api/products/") ||
    path === "/api/search" ||
    path === "/api/checkout-config" ||
    path === "/api/cart/share/prepare" ||
    path === "/api/cart/messenger/start"
  );
}

function isStaticPath(path: string) {
  return (
    path.startsWith("/assets/") ||
    path.startsWith("/build/") ||
    path.startsWith("/images/") ||
    path.startsWith("/fonts/") ||
    path.startsWith("/media/") ||
    path === "/favicon.ico" ||
    path === "/robots.txt" ||
    path === "/manifest.webmanifest"
  );
}

function isReactRouterInternalPath(path: string) {
  // React Router uses this endpoint for route discovery during client
  // navigation. It must receive its JSON response even when the storefront
  // access gate is enabled.
  return path === "/__manifest";
}

export function isStorefrontProtectedHtmlPath(path: string) {
  if (
    !path ||
    path.startsWith("/api/") ||
    isStaticPath(path) ||
    isReactRouterInternalPath(path)
  )
    return false;
  const isAdminPath = isAdminHtmlPath(path);
  const isAccessPath = path === "/access" || path.startsWith("/access/");
  if (
    isAdminPath ||
    path === "/access-required" ||
    isAccessPath ||
    /^\/c\/[^/]+$/.test(path)
  )
    return false;
  return true;
}

function parseIsoTime(value: string) {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}

export function validateSessionTtl(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const ttl =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isSafeInteger(ttl) ||
    ttl < MIN_STOREFRONT_SESSION_TTL_SECONDS ||
    ttl > MAX_STOREFRONT_SESSION_TTL_SECONDS
  )
    throw new Error("INVALID_SESSION_TTL");
  return ttl;
}

export function validateFacebookGroupUrl(value: unknown) {
  if (typeof value !== "string" || value.trim().length > 500)
    throw new Error("INVALID_FACEBOOK_GROUP_URL");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("INVALID_FACEBOOK_GROUP_URL");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (hostname !== "facebook.com" && !hostname.endsWith(".facebook.com")) ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/groups/") ||
    url.pathname === "/groups/"
  )
    throw new Error("INVALID_FACEBOOK_GROUP_URL");
  return url.toString();
}

export function validateAccessLinkInput(value: unknown): AccessLinkInput {
  if (!value || typeof value !== "object") throw new Error("VALIDATION_ERROR");
  const body = value as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 180) throw new Error("INVALID_ACCESS_LINK_NAME");
  if (!Array.isArray(body.groups) || body.groups.length > 100)
    throw new Error("INVALID_ACCESS_LINK_GROUPS");
  const seen = new Set<string>();
  const groups = body.groups.map((item) => {
    if (!item || typeof item !== "object")
      throw new Error("INVALID_ACCESS_LINK_GROUP");
    const row = item as Record<string, unknown>;
    const groupName = typeof row.name === "string" ? row.name.trim() : "";
    if (!groupName || groupName.length > 180)
      throw new Error("INVALID_ACCESS_LINK_GROUP");
    const normalizedName = groupName.toLocaleLowerCase();
    if (seen.has(normalizedName)) throw new Error("DUPLICATE_ACCESS_LINK_GROUP");
    seen.add(normalizedName);
    const rawUrl = row.url;
    const groupUrl =
      rawUrl === null || rawUrl === undefined || rawUrl === ""
        ? null
        : validateFacebookGroupUrl(rawUrl);
    return { name: groupName, url: groupUrl };
  });
  const notes =
    body.notes === null || body.notes === undefined
      ? null
      : typeof body.notes === "string" && body.notes.trim().length <= 2000
        ? body.notes.trim() || null
        : (() => {
            throw new Error("INVALID_ACCESS_LINK_NOTES");
          })();
  const sessionTtlSeconds = validateSessionTtl(body.sessionTtlSeconds);
  return { name, notes, groups, sessionTtlSeconds };
}

export async function createAdminAnalyticsMarker(
  secret: string,
  now = new Date(),
) {
  const expiresAt =
    Math.floor(now.getTime() / 1000) + ADMIN_ANALYTICS_COOKIE_MAX_AGE_SECONDS;
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const signature = bytesToBase64Url(
    await hmac(
      secret,
      ADMIN_ANALYTICS_PREFIX + ":" + expiresAt + ":" + nonce,
    ),
  );
  return expiresAt + "." + nonce + "." + signature;
}

export async function verifyAdminAnalyticsMarker(
  value: string | null,
  secret: string,
  now = new Date(),
) {
  if (!value || value.length > 512) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[0])) return false;
  const expiresAt = Number(parts[0]);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Math.floor(now.getTime() / 1000)
  )
    return false;
  const nonce = parts[1];
  const supplied = base64UrlToBytes(parts[2]);
  if (!nonce || !supplied) return false;
  const expected = await hmac(
    secret,
    ADMIN_ANALYTICS_PREFIX + ":" + expiresAt + ":" + nonce,
  );
  return constantTimeEqual(supplied, expected);
}

export async function addAdminAnalyticsExemption(
  response: Response,
  request: Request,
  env: Env,
) {
  const secret = getStorefrontAccessSecret(env);
  if (!secret) return response;
  const marker = await createAdminAnalyticsMarker(secret);
  return appendCookie(
    response,
    serializeCookie(
      request,
      getAdminAnalyticsCookieName(request),
      marker,
      ADMIN_ANALYTICS_COOKIE_MAX_AGE_SECONDS,
      true,
    ),
  );
}

async function hashValue(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hashSessionToken(token: string) {
  return hashValue(token);
}

export async function generateSessionToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function validVisitorValue(value: string | null) {
  return Boolean(
    value &&
      value.length >= 20 &&
      value.length <= 128 &&
      /^[A-Za-z0-9_-]+$/.test(value),
  );
}

async function readDefaultSessionTtl(env: Env) {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = ?",
    )
      .bind("storefront_session_ttl_seconds")
      .first<{ value: string }>();
    const value = row ? validateSessionTtl(row.value) : null;
    return value ?? DEFAULT_STOREFRONT_SESSION_TTL_SECONDS;
  } catch {
    // Migration 0007 installs the setting. The fallback keeps the gate safe
    // during a staged deployment before the migration has reached a database.
    return DEFAULT_STOREFRONT_SESSION_TTL_SECONDS;
  }
}

export async function getDefaultStorefrontSessionTtl(env: Env) {
  return readDefaultSessionTtl(env);
}

export async function resolveSessionTtl(linkTtl: number | null, env: Env) {
  return linkTtl ?? readDefaultSessionTtl(env);
}

async function loadAccessLink(
  env: Env,
  id: string,
  includeDeleted = false,
) {
  const deletedClause = includeDeleted ? "" : " AND deleted_at IS NULL";
  return env.DB.prepare(
    "SELECT id, name, notes, status, version, " +
      "session_ttl_seconds AS sessionTtlSeconds, " +
      "created_by_email AS createdByEmail, updated_by_email AS updatedByEmail, " +
      "created_at AS createdAt, updated_at AS updatedAt, " +
      "revoked_at AS revokedAt, deleted_at AS deletedAt, last_used_at AS lastUsedAt " +
      "FROM access_links WHERE id = ?" +
      deletedClause,
  )
    .bind(id)
    .first<AccessLinkRow>();
}

async function loadSessionByHash(env: Env, tokenHash: string) {
  return env.DB.prepare(
    "SELECT id, token_hash AS tokenHash, access_link_id AS accessLinkId, " +
      "link_version AS linkVersion, visitor_hash AS visitorHash, " +
      "is_admin AS isAdmin, created_at AS createdAt, expires_at AS expiresAt, " +
      "last_seen_at AS lastSeenAt, revoked_at AS revokedAt, " +
      "revoke_reason AS revokeReason FROM access_sessions WHERE token_hash = ?",
  )
    .bind(tokenHash)
    .first<AccessSessionRow>();
}

async function loadGroups(env: Env, accessLinkId: string) {
  const result = await env.DB.prepare(
    "SELECT id, access_link_id AS accessLinkId, group_name AS groupName, " +
      "group_url AS groupUrl, created_at AS createdAt " +
      "FROM access_link_groups WHERE access_link_id = ? " +
      "ORDER BY created_at, group_name",
  )
    .bind(accessLinkId)
    .all<AccessLinkGroupRow>();
  return result.results;
}

function windowStart(now: Date, days: number) {
  const calendarDays = Math.max(1, Math.floor(days));
  const vietnamTime = new Date(now.getTime() + VIETNAM_UTC_OFFSET_MS);
  vietnamTime.setUTCHours(0, 0, 0, 0);
  vietnamTime.setUTCDate(vietnamTime.getUTCDate() - (calendarDays - 1));
  return new Date(vietnamTime.getTime() - VIETNAM_UTC_OFFSET_MS).toISOString();
}

export async function getAccessLinkStats(
  env: Env,
  accessLinkId: string,
  now = new Date(),
): Promise<AccessLinkStats> {
  const [events, activeSessions] = await Promise.all([
    env.DB.prepare(
      "SELECT id, access_link_id AS accessLinkId, visitor_hash AS visitorHash, " +
        "session_id AS sessionId, event_type AS eventType, is_admin AS isAdmin, " +
        "created_at AS createdAt FROM access_link_events " +
        "WHERE access_link_id = ?",
    )
      .bind(accessLinkId)
      .all<AccessEventRow>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM access_sessions s " +
        "JOIN access_links l ON l.id = s.access_link_id " +
        "WHERE s.access_link_id = ? AND s.expires_at > ? " +
        "AND s.revoked_at IS NULL AND s.is_admin = 0 " +
        "AND l.status = 'ACTIVE' AND l.deleted_at IS NULL " +
        "AND s.link_version = l.version",
    )
      .bind(accessLinkId, now.toISOString())
      .first<{ count: number }>(),
  ]);
  const opens = events.results.filter(
    (event) => event.eventType === "LINK_OPENED" && event.isAdmin === 0,
  );
  const issued = events.results.filter(
    (event) => event.eventType === "SESSION_ISSUED" && event.isAdmin === 0,
  );
  const countFrom = (start: string) =>
    opens.filter((event) => event.createdAt >= start).length;
  return {
    validLinkOpens: opens.length,
    uniqueVisitors: new Set(
      opens.map((event) => event.visitorHash).filter(Boolean),
    ).size,
    sessionsIssued: issued.length,
    activeSessions: Number(activeSessions?.count ?? 0),
    opensToday: countFrom(windowStart(now, 1)),
    opens7d: countFrom(windowStart(now, 7)),
    opens30d: countFrom(windowStart(now, 30)),
    lastUsedAt:
      opens
        .map((event) => event.createdAt)
        .sort()
        .at(-1) ?? null,
  };
}

export async function toAccessLinkDto(
  request: Request,
  env: Env,
  link: AccessLinkRow,
  now = new Date(),
): Promise<AccessLinkDto> {
  const secret = getStorefrontAccessSecret(env);
  if (!secret) throw new Error("STOREFRONT_ACCESS_SECRET_MISSING");
  const defaultTtl = await readDefaultSessionTtl(env);
  const groups = await loadGroups(env, link.id);
  const stats = await getAccessLinkStats(env, link.id, now);
  const credential = await generateAccessCredential(
    secret,
    link.id,
    link.version,
  );
  return {
    id: link.id,
    name: link.name,
    notes: link.notes,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.groupName,
      url: group.groupUrl,
    })),
    status: link.status,
    version: link.version,
    sessionTtlSeconds: link.sessionTtlSeconds ?? defaultTtl,
    usesDefaultTtl: link.sessionTtlSeconds === null,
    accessUrl: new URL("/access/" + credential, request.url).toString(),
    createdByEmail: link.createdByEmail,
    updatedByEmail: link.updatedByEmail,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    revokedAt: link.revokedAt,
    stats,
  };
}

function adminEmail(email: string | undefined) {
  return email?.trim() || "local-admin";
}

async function parseRequestJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (text.length > 64 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("VALIDATION_ERROR");
  }
}

function adminApiError(code: string, message: string, status: number) {
  return jsonResponse({ success: false, error: { code, message } }, status);
}

function mapAccessLinkError(caught: unknown) {
  const code = caught instanceof Error ? caught.message : "VALIDATION_ERROR";
  const known: Record<string, [string, number]> = {
    PAYLOAD_TOO_LARGE: ["Payload quá lớn.", 413],
    INVALID_ACCESS_LINK_NAME: ["Tên access link là bắt buộc.", 422],
    INVALID_ACCESS_LINK_GROUPS: [
      "Danh sách Facebook Group không hợp lệ.",
      422,
    ],
    INVALID_ACCESS_LINK_GROUP: [
      "Tên hoặc mapping Facebook Group không hợp lệ.",
      422,
    ],
    DUPLICATE_ACCESS_LINK_GROUP: ["Facebook Group bị trùng.", 422],
    INVALID_ACCESS_LINK_NOTES: ["Ghi chú access link không hợp lệ.", 422],
    INVALID_FACEBOOK_GROUP_URL: ["URL Facebook Group không hợp lệ.", 422],
    INVALID_SESSION_TTL: [
      "Thời hạn session phải từ 1 giờ đến 365 ngày.",
      422,
    ],
    STOREFRONT_ACCESS_SECRET_MISSING: [
      "Storefront access secret chưa được cấu hình.",
      503,
    ],
    VALIDATION_ERROR: ["Dữ liệu access link không hợp lệ.", 422],
  };
  const mapped = known[code] ?? ["Không thể xử lý access link.", 500];
  return { code, message: mapped[0], status: mapped[1] };
}

export async function listAccessLinks(request: Request, env: Env) {
  if (!getStorefrontAccessSecret(env))
    return adminApiError(
      "STOREFRONT_ACCESS_SECRET_MISSING",
      "Storefront access secret chưa được cấu hình.",
      503,
    );
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const status = url.searchParams.get("status")?.trim().toUpperCase() ?? "";
  const where = ["l.deleted_at IS NULL"];
  const values: Array<string> = [];
  if (status === "ACTIVE" || status === "REVOKED") {
    where.push("l.status = ?");
    values.push(status);
  }
  if (query) {
    where.push(
      "(l.name LIKE ? OR l.notes LIKE ? OR EXISTS " +
        "(SELECT 1 FROM access_link_groups qg " +
        "WHERE qg.access_link_id = l.id AND qg.group_name LIKE ?))",
    );
    values.push("%" + query + "%", "%" + query + "%", "%" + query + "%");
  }
  const result = await env.DB.prepare(
    "SELECT l.id, l.name, l.notes, l.status, l.version, " +
      "l.session_ttl_seconds AS sessionTtlSeconds, " +
      "l.created_by_email AS createdByEmail, l.updated_by_email AS updatedByEmail, " +
      "l.created_at AS createdAt, l.updated_at AS updatedAt, " +
      "l.revoked_at AS revokedAt, l.deleted_at AS deletedAt, " +
      "l.last_used_at AS lastUsedAt FROM access_links l WHERE " +
      where.join(" AND ") +
      " ORDER BY l.created_at DESC",
  )
    .bind(...values)
    .all<AccessLinkRow>();
  const links = await Promise.all(
    result.results.map((link) => toAccessLinkDto(request, env, link)),
  );
  return jsonResponse({ data: links });
}

export async function createAccessLink(
  request: Request,
  env: Env,
  verifiedEmail?: string,
) {
  if (!getStorefrontAccessSecret(env))
    return adminApiError(
      "STOREFRONT_ACCESS_SECRET_MISSING",
      "Storefront access secret chưa được cấu hình.",
      503,
    );
  try {
    const input = validateAccessLinkInput(await parseRequestJson(request));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const email = adminEmail(verifiedEmail);
    await env.DB.prepare(
      "INSERT INTO access_links (" +
        "id, name, notes, status, version, session_ttl_seconds, " +
        "created_by_email, updated_by_email, created_at, updated_at" +
        ") VALUES (?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        input.name,
        input.notes,
        input.sessionTtlSeconds,
        email,
        email,
        now,
        now,
      )
      .run();
    for (const group of input.groups) {
      await env.DB.prepare(
        "INSERT INTO access_link_groups " +
          "(id, access_link_id, group_name, group_url, created_at) " +
          "VALUES (?, ?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), id, group.name, group.url, now)
        .run();
    }
    const link = await loadAccessLink(env, id);
    if (!link)
      return adminApiError(
        "ACCESS_LINK_NOT_FOUND",
        "Không tìm thấy access link vừa tạo.",
        500,
      );
    const data = await toAccessLinkDto(request, env, link);
    return jsonResponse({ success: true, data }, 201);
  } catch (caught) {
    const mapped = mapAccessLinkError(caught);
    return adminApiError(mapped.code, mapped.message, mapped.status);
  }
}

export async function updateAccessLink(
  request: Request,
  env: Env,
  id: string,
  verifiedEmail?: string,
) {
  try {
    const input = validateAccessLinkInput(await parseRequestJson(request));
    const existing = await loadAccessLink(env, id);
    if (!existing)
      return adminApiError(
        "ACCESS_LINK_NOT_FOUND",
        "Không tìm thấy access link.",
        404,
      );
    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE access_links SET name = ?, notes = ?, session_ttl_seconds = ?, " +
        "updated_by_email = ?, updated_at = ? " +
        "WHERE id = ? AND deleted_at IS NULL",
    )
      .bind(
        input.name,
        input.notes,
        input.sessionTtlSeconds,
        adminEmail(verifiedEmail),
        now,
        id,
      )
      .run();
    await env.DB.prepare(
      "DELETE FROM access_link_groups WHERE access_link_id = ?",
    )
      .bind(id)
      .run();
    for (const group of input.groups) {
      await env.DB.prepare(
        "INSERT INTO access_link_groups " +
          "(id, access_link_id, group_name, group_url, created_at) " +
          "VALUES (?, ?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), id, group.name, group.url, now)
        .run();
    }
    const link = await loadAccessLink(env, id);
    if (!link)
      return adminApiError(
        "ACCESS_LINK_NOT_FOUND",
        "Không tìm thấy access link.",
        404,
      );
    const data = await toAccessLinkDto(request, env, link);
    return jsonResponse({ success: true, data });
  } catch (caught) {
    const mapped = mapAccessLinkError(caught);
    return adminApiError(mapped.code, mapped.message, mapped.status);
  }
}

async function revokeSessions(
  env: Env,
  accessLinkId: string,
  now: string,
  reason: string,
) {
  await env.DB.prepare(
    "UPDATE access_sessions SET revoked_at = ?, revoke_reason = ? " +
      "WHERE access_link_id = ? AND revoked_at IS NULL",
  )
    .bind(now, reason, accessLinkId)
    .run();
}

export async function resetAccessLinkSessions(
  request: Request,
  env: Env,
  id: string,
  verifiedEmail?: string,
) {
  const link = await loadAccessLink(env, id);
  if (!link)
    return adminApiError(
      "ACCESS_LINK_NOT_FOUND",
      "Không tìm thấy access link.",
      404,
    );
  const now = new Date().toISOString();
  await revokeSessions(env, id, now, "RESET_SESSIONS");
  await env.DB.prepare(
    "UPDATE access_links SET updated_by_email = ?, updated_at = ? WHERE id = ?",
  )
    .bind(adminEmail(verifiedEmail), now, id)
    .run();
  const fresh = await loadAccessLink(env, id);
  if (!fresh)
    return adminApiError(
      "ACCESS_LINK_NOT_FOUND",
      "Không tìm thấy access link.",
      404,
    );
  return jsonResponse({
    success: true,
    data: await toAccessLinkDto(request, env, fresh),
  });
}

export async function rotateAccessLink(
  request: Request,
  env: Env,
  id: string,
  verifiedEmail?: string,
) {
  const link = await loadAccessLink(env, id);
  if (!link)
    return adminApiError(
      "ACCESS_LINK_NOT_FOUND",
      "Không tìm thấy access link.",
      404,
    );
  const now = new Date().toISOString();
  await revokeSessions(env, id, now, "ROTATE");
  await env.DB.prepare(
    "UPDATE access_links SET status = 'ACTIVE', version = version + 1, " +
      "revoked_at = NULL, updated_by_email = ?, updated_at = ? " +
      "WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(adminEmail(verifiedEmail), now, id)
    .run();
  const fresh = await loadAccessLink(env, id);
  if (!fresh)
    return adminApiError(
      "ACCESS_LINK_NOT_FOUND",
      "Không tìm thấy access link.",
      404,
    );
  return jsonResponse({
    success: true,
    data: await toAccessLinkDto(request, env, fresh),
  });
}

export async function revokeAccessLink(
  request: Request,
  env: Env,
  id: string,
  verifiedEmail?: string,
) {
  const link = await loadAccessLink(env, id);
  if (!link)
    return adminApiError(
      "ACCESS_LINK_NOT_FOUND",
      "Không tìm thấy access link.",
      404,
    );
  const now = new Date().toISOString();
  await revokeSessions(env, id, now, "REVOKE_LINK");
  await env.DB.prepare(
    "UPDATE access_links SET status = 'REVOKED', revoked_at = ?, " +
      "updated_by_email = ?, updated_at = ? " +
      "WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(now, adminEmail(verifiedEmail), now, id)
    .run();
  const fresh = await loadAccessLink(env, id);
  if (!fresh)
    return adminApiError(
      "ACCESS_LINK_NOT_FOUND",
      "Không tìm thấy access link.",
      404,
    );
  return jsonResponse({
    success: true,
    data: await toAccessLinkDto(request, env, fresh),
  });
}

export async function deleteAccessLink(
  request: Request,
  env: Env,
  id: string,
  verifiedEmail?: string,
) {
  const link = await loadAccessLink(env, id);
  if (!link)
    return adminApiError(
      "ACCESS_LINK_NOT_FOUND",
      "Không tìm thấy access link.",
      404,
    );
  const now = new Date().toISOString();
  await revokeSessions(env, id, now, "DELETE_LINK");
  await env.DB.prepare(
    "UPDATE access_links SET status = 'REVOKED', " +
      "revoked_at = COALESCE(revoked_at, ?), deleted_at = ?, " +
      "updated_by_email = ?, updated_at = ? " +
      "WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(now, now, adminEmail(verifiedEmail), now, id)
    .run();
  return jsonResponse({ success: true, id, deleted: true });
}

export async function testAccessLink(request: Request, env: Env, id: string) {
  const link = await loadAccessLink(env, id);
  if (!link)
    return adminApiError(
      "ACCESS_LINK_NOT_FOUND",
      "Không tìm thấy access link.",
      404,
    );
  if (link.status !== "ACTIVE")
    return adminApiError(
      "ACCESS_LINK_REVOKED",
      "Access link đang bị khóa.",
      409,
    );
  const secret = getStorefrontAccessSecret(env);
  if (!secret)
    return adminApiError(
      "STOREFRONT_ACCESS_SECRET_MISSING",
      "Storefront access secret chưa được cấu hình.",
      503,
    );
  const credential = await generateAccessCredential(
    secret,
    link.id,
    link.version,
  );
  return jsonResponse({
    success: true,
    data: {
      accessUrl: new URL("/access/" + credential, request.url).toString(),
    },
  });
}

export async function getStorefrontSettings(env: Env) {
  return jsonResponse({
    data: {
      storefrontSessionTtlSeconds: await readDefaultSessionTtl(env),
    },
  });
}

export async function saveStorefrontSettings(request: Request, env: Env) {
  try {
    const parsed = await parseRequestJson(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("VALIDATION_ERROR");
    const body = parsed as Record<string, unknown>;
    const ttl = validateSessionTtl(body.storefrontSessionTtlSeconds);
    if (ttl === null) throw new Error("INVALID_SESSION_TTL");
    await env.DB.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, " +
        "updated_at = excluded.updated_at",
    )
      .bind(
        "storefront_session_ttl_seconds",
        String(ttl),
        new Date().toISOString(),
      )
      .run();
    return getStorefrontSettings(env);
  } catch (caught) {
    const mapped = mapAccessLinkError(caught);
    return adminApiError(mapped.code, mapped.message, mapped.status);
  }
}

export async function authorizeStorefrontSession(
  request: Request,
  env: Env,
  now = new Date(),
): Promise<AccessSessionAuthorization> {
  if (!isStorefrontAccessGateEnabled(env))
    return { valid: true, reason: "GATE_DISABLED" };
  if (!getStorefrontAccessSecret(env))
    return { valid: false, reason: "MISSING_SECRET" };
  const rawToken = readCookie(request, getAccessSessionCookieName(request));
  if (!rawToken) return { valid: false, reason: "MISSING_COOKIE" };
  const tokenHash = await hashSessionToken(rawToken);
  const session = await loadSessionByHash(env, tokenHash);
  if (!session) return { valid: false, reason: "INVALID_SESSION" };
  if (session.revokedAt) return { valid: false, reason: "REVOKED", session };
  if (parseIsoTime(session.expiresAt) <= now.getTime())
    return { valid: false, reason: "EXPIRED", session };
  const link = await loadAccessLink(env, session.accessLinkId, true);
  if (!link || link.deletedAt)
    return { valid: false, reason: "LINK_REVOKED", session };
  if (link.status !== "ACTIVE")
    return { valid: false, reason: "LINK_REVOKED", session };
  if (session.linkVersion !== link.version)
    return { valid: false, reason: "VERSION_MISMATCH", session };
  return { valid: true, session };
}

async function handleValidAccessLink(
  request: Request,
  env: Env,
  link: AccessLinkRow,
  secret: string,
  now = new Date(),
) {
  const marker = readCookie(request, getAdminAnalyticsCookieName(request));
  const hasAdminMarker = await verifyAdminAnalyticsMarker(marker, secret, now);
  let visitorId = readCookie(request, getVisitorCookieName(request));
  let setVisitorCookie = false;
  if (!validVisitorValue(visitorId)) {
    visitorId = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    setVisitorCookie = true;
  }
  if (!visitorId) throw new Error("VISITOR_ID_GENERATION_FAILED");
  const visitorHash = await hashValue(visitorId);
  const currentToken = readCookie(request, getAccessSessionCookieName(request));
  const currentHash = currentToken ? await hashSessionToken(currentToken) : null;
  const currentSession = currentHash
    ? await loadSessionByHash(env, currentHash)
    : null;
  const nowIso = now.toISOString();
  const currentSessionIsValid = Boolean(
    currentSession &&
      !currentSession.revokedAt &&
      parseIsoTime(currentSession.expiresAt) > now.getTime() &&
      currentSession.accessLinkId === link.id &&
      currentSession.linkVersion === link.version,
  );
  // A valid admin-issued session remains analytics-exempt, but an expired or
  // revoked admin session must never promote the next session to admin.
  const isAdmin =
    hasAdminMarker || Boolean(currentSessionIsValid && currentSession?.isAdmin === 1);
  let sessionToken = currentToken;
  let session = currentSession;
  let issued = false;

  if (!currentSessionIsValid) {
    if (currentSession && !currentSession.revokedAt)
      await env.DB.prepare(
        "UPDATE access_sessions SET revoked_at = ?, revoke_reason = ? " +
          "WHERE id = ? AND revoked_at IS NULL",
      )
        .bind(nowIso, "SWITCH_OR_REAUTHENTICATE", currentSession.id)
        .run();
    const ttl = await resolveSessionTtl(link.sessionTtlSeconds, env);
    sessionToken = await generateSessionToken();
    const tokenHash = await hashSessionToken(sessionToken);
    const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
    const sessionId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO access_sessions (" +
        "id, token_hash, access_link_id, link_version, visitor_hash, is_admin, " +
        "created_at, expires_at" +
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        sessionId,
        tokenHash,
        link.id,
        link.version,
        visitorHash,
        isAdmin ? 1 : 0,
        nowIso,
        expiresAt,
      )
      .run();
    session = {
      id: sessionId,
      tokenHash,
      accessLinkId: link.id,
      linkVersion: link.version,
      visitorHash,
      isAdmin: isAdmin ? 1 : 0,
      createdAt: nowIso,
      expiresAt,
      lastSeenAt: null,
      revokedAt: null,
      revokeReason: null,
    };
    issued = true;
  } else if (isAdmin && session && session.isAdmin === 0) {
    await env.DB.prepare("UPDATE access_sessions SET is_admin = 1 WHERE id = ?")
      .bind(session.id)
      .run();
    session = { ...session, isAdmin: 1 };
  }

  const sessionId = session?.id ?? null;
  await env.DB.prepare(
    "INSERT INTO access_link_events (" +
      "id, access_link_id, visitor_hash, session_id, event_type, is_admin, created_at" +
      ") VALUES (?, ?, ?, ?, 'LINK_OPENED', ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      link.id,
      visitorHash,
      sessionId,
      isAdmin ? 1 : 0,
      nowIso,
    )
    .run();
  if (issued)
    await env.DB.prepare(
      "INSERT INTO access_link_events (" +
        "id, access_link_id, visitor_hash, session_id, event_type, is_admin, created_at" +
        ") VALUES (?, ?, ?, ?, 'SESSION_ISSUED', ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        link.id,
        visitorHash,
        sessionId,
        isAdmin ? 1 : 0,
        nowIso,
      )
      .run();
  if (!isAdmin)
    await env.DB.prepare(
      "UPDATE access_links SET last_used_at = ?, updated_at = updated_at WHERE id = ?",
    )
      .bind(nowIso, link.id)
      .run();

  const headers = responseHeaders();
  headers.set("location", "/");
  let response = new Response(null, { status: 303, headers });
  const remainingSeconds = session
    ? Math.max(
        0,
        Math.ceil((parseIsoTime(session.expiresAt) - now.getTime()) / 1000),
      )
    : 0;
  response = appendCookie(
    response,
    serializeCookie(
      request,
      getAccessSessionCookieName(request),
      sessionToken ?? "",
      remainingSeconds,
      true,
    ),
  );
  if (setVisitorCookie)
    response = appendCookie(
      response,
      serializeCookie(
        request,
        getVisitorCookieName(request),
        visitorId,
        VISITOR_COOKIE_MAX_AGE_SECONDS,
        true,
      ),
    );
  return response;
}

async function invalidAccessCredentialResponse(
  request: Request,
  env: Env,
  now: Date,
) {
  const currentAuthorization = await authorizeStorefrontSession(request, env, now);
  if (currentAuthorization.valid && currentAuthorization.session) {
    const headers = responseHeaders();
    headers.set("location", "/");
    return new Response(null, { status: 303, headers });
  }
  return storefrontAccessRequiredRedirect(request, true);
}

export async function handleAccessRequest(
  request: Request,
  env: Env,
  now = new Date(),
) {
  if (request.method !== "GET") {
    const headers = responseHeaders();
    headers.set("allow", "GET");
    return new Response(null, { status: 405, headers });
  }
  const secret = getStorefrontAccessSecret(env);
  if (!secret) return storefrontGateMisconfiguredResponse();
  const credentialValue = new URL(request.url).pathname.slice(
    "/access/".length,
  );
  const credential = parseAccessCredential(credentialValue);
  if (!credential)
    return invalidAccessCredentialResponse(request, env, now);
  const link = await loadAccessLink(env, credential.linkId);
  if (
    !link ||
    link.status !== "ACTIVE" ||
    link.deletedAt ||
    !(await verifyAccessCredential(
      secret,
      link.id,
      link.version,
      credential.signature,
    ))
  )
    return invalidAccessCredentialResponse(request, env, now);
  return handleValidAccessLink(request, env, link, secret, now);
}

export async function validateStorefrontRequest(
  request: Request,
  env: Env,
  now = new Date(),
) {
  return authorizeStorefrontSession(request, env, now);
}

export function redactPathForLog(path: string) {
  if (path.startsWith("/access/")) return "/access/[REDACTED]";
  return path;
}
