import { describe, expect, it } from "vitest";
import { generateKeyPair, jwtVerify, SignJWT } from "jose";
import {
  authorizeAdminRequest,
  normalizeAccessConfig,
  type AccessConfig,
} from "../workers/access";

const audience =
  "a6fb2fc920581c374a4f7509800f1e2d6d370938cf70d365a1ad26de64c8e057";
const issuer = "https://metraphuong.cloudflareaccess.com";
const productionEnv = {
  ENVIRONMENT: "production",
  ACCESS_TEAM_DOMAIN: "metraphuong.cloudflareaccess.com",
  ACCESS_AUD: audience,
} as Env;

async function createJwt(options: {
  issuer?: string;
  audience?: string;
  expirationTime?: string;
  email?: string;
  signingKey?: CryptoKey;
}) {
  const keys = await generateKeyPair("RS256");
  const signingKey = options.signingKey ?? keys.privateKey;
  const token = await new SignJWT({
    type: "app",
    email: options.email ?? "admin@metraphuong.com",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setIssuedAt()
    .setExpirationTime(options.expirationTime ?? "5m")
    .sign(signingKey);
  return { token, publicKey: keys.publicKey };
}

function localVerifier(publicKey: CryptoKey) {
  return (token: string, config: AccessConfig) =>
    jwtVerify(token, publicKey, {
      issuer: config.teamDomain,
      audience: config.audience,
      algorithms: ["RS256"],
    });
}

function accessRequest(token?: string, emailHeader?: string) {
  const headers = new Headers();
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  if (emailHeader)
    headers.set("cf-access-authenticated-user-email", emailHeader);
  return new Request("https://example.test/api/admin/products", { headers });
}

describe("Cloudflare Access cho admin API", () => {
  it("chỉ bypass rõ ràng trong development", async () => {
    const result = await authorizeAdminRequest(
      new Request("https://example.test/api/admin/products"),
      { ENVIRONMENT: "development" } as Env,
    );
    expect(result).toEqual({ authorized: true });
  });

  it("production fail-closed khi thiếu team domain hoặc audience", async () => {
    const result = await authorizeAdminRequest(
      new Request("https://example.test/api/admin/products", {
        headers: { "cf-access-jwt-assertion": "not-a-jwt" },
      }),
      {
        ENVIRONMENT: "production",
        ACCESS_TEAM_DOMAIN: "",
        ACCESS_AUD: "",
      } as Env,
    );
    expect(result).toEqual({ authorized: false, reason: "MISSING_CONFIG" });
  });

  it("không bypass khi ENVIRONMENT bị thiếu hoặc gõ sai", async () => {
    const missingEnvironment = await authorizeAdminRequest(
      accessRequest(),
      {
        ACCESS_TEAM_DOMAIN: "metraphuong.cloudflareaccess.com",
        ACCESS_AUD: audience,
      } as Env,
    );
    const mistypedEnvironment = await authorizeAdminRequest(
      accessRequest(),
      { ...productionEnv, ENVIRONMENT: "prod" } as Env,
    );
    expect(missingEnvironment).toEqual({
      authorized: false,
      reason: "MISSING_TOKEN",
    });
    expect(mistypedEnvironment).toEqual({
      authorized: false,
      reason: "MISSING_TOKEN",
    });
  });

  it("chuẩn hóa hostname production thành issuer và JWKS hợp lệ", () => {
    expect(normalizeAccessConfig(productionEnv)).toEqual({
      teamDomain: issuer,
      audience,
    });
    expect(
      normalizeAccessConfig({
        ...productionEnv,
        ACCESS_TEAM_DOMAIN: `${issuer}/`,
      } as Env),
    ).toEqual({ teamDomain: issuer, audience });
    expect(
      normalizeAccessConfig({
        ...productionEnv,
        ACCESS_TEAM_DOMAIN: `https://${issuer}`,
      } as Env),
    ).toBeNull();
  });

  it("production từ chối khi thiếu JWT dù email header bị giả mạo", async () => {
    const result = await authorizeAdminRequest(
      accessRequest(undefined, "spoofed@example.com"),
      productionEnv,
    );
    expect(result).toEqual({ authorized: false, reason: "MISSING_TOKEN" });
  });

  it("chấp nhận email từ payload chỉ sau khi JWT hợp lệ", async () => {
    const { token, publicKey } = await createJwt({});
    const result = await authorizeAdminRequest(
      accessRequest(token, "spoofed@example.com"),
      productionEnv,
      localVerifier(publicKey),
    );
    expect(result.authorized).toBe(true);
    if (result.authorized)
      expect(result.payload?.email).toBe("admin@metraphuong.com");
  });

  it.each([
    ["wrong issuer", { issuer: "https://other.cloudflareaccess.com" }],
    ["wrong audience", { audience: "wrong-audience" }],
    ["expired JWT", { expirationTime: "0s" }],
  ])("production từ chối %s", async (_label, tokenOptions) => {
    const { token, publicKey } = await createJwt(tokenOptions);
    const result = await authorizeAdminRequest(
      accessRequest(token),
      productionEnv,
      localVerifier(publicKey),
    );
    expect(result).toEqual({ authorized: false, reason: "INVALID_TOKEN" });
  });

  it("production từ chối JWT có chữ ký không hợp lệ", async () => {
    const trustedKeys = await generateKeyPair("RS256");
    const { token } = await createJwt({});
    const result = await authorizeAdminRequest(
      accessRequest(token),
      productionEnv,
      localVerifier(trustedKeys.publicKey),
    );
    expect(result).toEqual({ authorized: false, reason: "INVALID_TOKEN" });
  });
});
