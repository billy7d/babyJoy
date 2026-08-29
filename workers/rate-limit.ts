export class RateLimitError extends Error {
  readonly code = "RATE_LIMITED";
  readonly status = 429;

  constructor() {
    super("Bạn thao tác quá nhanh. Vui lòng thử lại sau.");
  }
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function consumeRateLimit(
  env: Env,
  request: Request,
  scope: string,
  limit: number,
) {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const scopeKey = await sha256(`${scope}:${ip}`);
  const now = new Date();
  const cutoff = new Date(now.getTime() - 60_000).toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO messenger_rate_limits (scope_key, window_started_at, request_count)
     VALUES (?, ?, 1)
     ON CONFLICT(scope_key) DO UPDATE SET
       request_count = CASE WHEN window_started_at <= ? THEN 1 ELSE request_count + 1 END,
       window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END
     RETURNING request_count AS requestCount`,
  )
    .bind(scopeKey, now.toISOString(), cutoff, cutoff)
    .first<{ requestCount: number }>();
  if ((row?.requestCount ?? limit + 1) > limit) throw new RateLimitError();
}
