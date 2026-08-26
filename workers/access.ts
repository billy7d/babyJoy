import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type AccessConfig = { teamDomain: string; audience: string };
type VerifyAccessJwt = (
  token: string,
  config: AccessConfig,
) => Promise<{ payload: JWTPayload }>;
type CachedVerifier = {
  issuer: string;
  jwks: ReturnType<typeof createRemoteJWKSet>;
};

// Chỉ cache bộ khóa theo issuer cấu hình cố định; không lưu dữ liệu theo request hoặc người dùng.
let cachedVerifier: CachedVerifier | undefined;

export function normalizeAccessTeamDomain(
  value: string | undefined,
): string | null {
  const raw = value?.trim().replace(/\/+$/, "") ?? "";
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(url.hostname)
    )
      return null;
    return `https://${url.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

export function normalizeAccessConfig(env: Env): AccessConfig | null {
  const teamDomain = normalizeAccessTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience = env.ACCESS_AUD?.trim() ?? "";
  if (!teamDomain || !audience) return null;
  return { teamDomain, audience };
}

function getVerifier(issuer: string) {
  if (!cachedVerifier || cachedVerifier.issuer !== issuer) {
    cachedVerifier = {
      issuer,
      jwks: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
    };
  }
  return cachedVerifier.jwks;
}

async function verifyAccessJwt(token: string, config: AccessConfig) {
  return jwtVerify(token, getVerifier(config.teamDomain), {
    issuer: config.teamDomain,
    audience: config.audience,
    algorithms: ["RS256"],
  });
}

export type AdminAuthorization =
  | { authorized: true; payload?: JWTPayload }
  | {
      authorized: false;
      reason: "MISSING_CONFIG" | "MISSING_TOKEN" | "INVALID_TOKEN";
    };

export async function authorizeAdminRequest(
  request: Request,
  env: Env,
  verifyJwt: VerifyAccessJwt = verifyAccessJwt,
): Promise<AdminAuthorization> {
  // Local development bypass được khóa bằng ENVIRONMENT; production luôn phải xác minh JWT.
  if (env.ENVIRONMENT === "development") return { authorized: true };
  const config = normalizeAccessConfig(env);
  if (!config) return { authorized: false, reason: "MISSING_CONFIG" };
  const token = request.headers.get("cf-access-jwt-assertion")?.trim();
  if (!token) return { authorized: false, reason: "MISSING_TOKEN" };
  try {
    const result = await verifyJwt(token, config);
    if (
      result.payload.type !== "app" ||
      typeof result.payload.email !== "string" ||
      !result.payload.email
    )
      return { authorized: false, reason: "INVALID_TOKEN" };
    return { authorized: true, payload: result.payload };
  } catch {
    return { authorized: false, reason: "INVALID_TOKEN" };
  }
}
