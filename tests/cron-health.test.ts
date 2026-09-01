import { describe, expect, it, afterEach, vi } from "vitest";
import worker from "../workers/app";
import {
  buildCronHealthData,
  buildCronHeartbeat,
  CRON_HEALTH_HEARTBEAT_KEY,
  CRON_STALE_AFTER_MS,
  evaluateCronHealth,
  parseCronHeartbeat,
  type CronRunSnapshot,
} from "../shared/cron-health";
import {
  cleanupExpiredReservations,
  cleanupExpiredReservationsDetailed,
} from "../workers/inventory";
import { runInventoryCleanupCron } from "../workers/scheduled-inventory-cleanup";

type FakeD1Options = {
  schemaAvailable?: boolean;
  candidates?: string[];
  failBatchIds?: string[];
  selectError?: Error;
  writeError?: Error;
  heartbeat?: string | null;
};

class FakeD1 {
  schemaAvailable: boolean;
  candidates: string[];
  failBatchIds: Set<string>;
  selectError: Error | undefined;
  writeError: Error | undefined;
  heartbeat: string | null;
  writeCount = 0;

  constructor(options: FakeD1Options = {}) {
    this.schemaAvailable = options.schemaAvailable ?? true;
    this.candidates = options.candidates ?? [];
    this.failBatchIds = new Set(options.failBatchIds ?? []);
    this.selectError = options.selectError;
    this.writeError = options.writeError;
    this.heartbeat = options.heartbeat ?? null;
  }

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]) {
    const cartRequestId = statements[0]?.values.at(-1);
    if (typeof cartRequestId === "string" && this.failBatchIds.has(cartRequestId))
      throw new Error("BATCH_FAILURE customer-phone=hidden");
    return statements.map(() => ({ meta: { changes: 1 } }));
  }
}

class FakeStatement {
  values: unknown[] = [];

  constructor(
    private readonly database: FakeD1,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    const statement = new FakeStatement(this.database, this.sql);
    statement.values = values;
    return statement;
  }

  async first<T>() {
    if (this.sql.includes("sqlite_master"))
      return (this.database.schemaAvailable
        ? { name: "inventory_reservations" }
        : null) as T | null;
    if (this.sql.includes("pragma_table_info"))
      return (this.database.schemaAvailable ? { name: "checkout_state" } : null) as T | null;
    if (this.sql.includes("FROM app_settings"))
      return (this.database.heartbeat === null
        ? null
        : { value: this.database.heartbeat }) as T | null;
    throw new Error(`UNEXPECTED_FIRST ${this.sql}`);
  }

  async all<T>() {
    if (!this.sql.includes("SELECT id FROM cart_requests"))
      throw new Error(`UNEXPECTED_ALL ${this.sql}`);
    if (this.database.selectError) throw this.database.selectError;
    const limit = Number(this.values[1]);
    const candidates = Number.isFinite(limit)
      ? this.database.candidates.slice(0, limit)
      : this.database.candidates;
    return {
      results: candidates.map((id) => ({ id })) as T[],
    };
  }

  async run() {
    if (this.sql.includes("INSERT INTO app_settings")) {
      this.database.writeCount += 1;
      if (this.database.writeError) throw this.database.writeError;
      this.database.heartbeat = String(this.values[1]);
    }
    return { meta: { changes: 1 } };
  }
}

function createEnv(options: FakeD1Options = {}) {
  const database = new FakeD1(options);
  return {
    database,
    env: {
      DB: database,
      ENVIRONMENT: "development",
      ACCESS_TEAM_DOMAIN: "",
      ACCESS_AUD: "",
      STOREFRONT_ACCESS_GATE_ENABLED: "false",
    } as unknown as Env,
  };
}

function runSnapshot(
  outcome: CronRunSnapshot["outcome"],
  completedAt: string,
  counts: Pick<CronRunSnapshot, "candidateCount" | "releasedCount" | "failedCount"> = {
    candidateCount: 0,
    releasedCount: 0,
    failedCount: 0,
  },
): CronRunSnapshot {
  return {
    runId: `run-${outcome.toLowerCase()}`,
    outcome,
    scheduledAt: completedAt,
    startedAt: completedAt,
    completedAt,
    durationMs: 20,
    schemaAvailable: outcome !== "SCHEMA_MISSING",
    ...counts,
    limit: 100,
  };
}

function storedHeartbeat(
  outcome: CronRunSnapshot["outcome"],
  completedAt: string,
  lastSuccessAt: string | null = null,
) {
  return JSON.stringify(
    buildCronHeartbeat(runSnapshot(outcome, completedAt), lastSuccessAt),
  );
}

function responseJson(response: Response) {
  return response.json() as Promise<{ data?: Record<string, unknown>; error?: unknown }>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cron health model", () => {
  const now = new Date("2026-09-01T00:10:00.000Z");

  it("trả UNKNOWN cho heartbeat thiếu hoặc malformed", () => {
    expect(evaluateCronHealth(null, now)).toMatchObject({
      health: "UNKNOWN",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastRun: null,
    });
    expect(evaluateCronHealth("not-json", now).health).toBe("UNKNOWN");
    expect(
      evaluateCronHealth(
        JSON.stringify({ version: 1, job: "inventory_expiry_cleanup" }),
        now,
      ).health,
    ).toBe("UNKNOWN");
  });

  it.each([
    ["SUCCESS", "HEALTHY"],
    ["PARTIAL", "DEGRADED"],
    ["ERROR", "ERROR"],
    ["SCHEMA_MISSING", "ERROR"],
  ] as const)("xếp hạng fresh %s là %s", (outcome, health) => {
    const heartbeat = storedHeartbeat(outcome, now.toISOString());
    expect(evaluateCronHealth(heartbeat, now).health).toBe(health);
  });

  it("xếp mọi outcome thành STALE khi lastAttempt đã cũ", () => {
    for (const outcome of ["SUCCESS", "PARTIAL"] as const) {
      const old = new Date(now.getTime() - CRON_STALE_AFTER_MS - 1).toISOString();
      expect(evaluateCronHealth(storedHeartbeat(outcome, old), now).health).toBe("STALE");
    }
  });

  it("dùng ngưỡng stale đúng tại 5 phút và không phụ thuộc đồng hồ ẩn", () => {
    const exact = new Date(now.getTime() - CRON_STALE_AFTER_MS).toISOString();
    const before = new Date(now.getTime() - CRON_STALE_AFTER_MS + 1).toISOString();
    expect(evaluateCronHealth(storedHeartbeat("SUCCESS", exact), now).health).toBe("STALE");
    expect(evaluateCronHealth(storedHeartbeat("SUCCESS", before), now).health).toBe("HEALTHY");
  });

  it("giữ lastSuccessAt cũ khi lần chạy mới partial hoặc error", () => {
    const previousSuccess = "2026-09-01T00:05:00.000Z";
    for (const outcome of ["PARTIAL", "ERROR", "SCHEMA_MISSING"] as const) {
      const heartbeat = buildCronHeartbeat(
        runSnapshot(outcome, now.toISOString()),
        previousSuccess,
      );
      expect(heartbeat.lastSuccessAt).toBe(previousSuccess);
    }
    const success = buildCronHeartbeat(
      runSnapshot("SUCCESS", now.toISOString()),
      previousSuccess,
    );
    expect(success.lastSuccessAt).toBe(now.toISOString());
  });
});

describe("inventory cleanup metrics", () => {
  const cleanupAt = new Date("2026-09-01T00:10:00.000Z");

  it("trả zero metrics khi không có candidate", async () => {
    const { database, env } = createEnv();
    await expect(cleanupExpiredReservationsDetailed(env, cleanupAt)).resolves.toEqual({
      schemaAvailable: true,
      candidateCount: 0,
      releasedCount: 0,
      failedCount: 0,
      limit: 100,
    });
    expect(database.writeCount).toBe(0);
  });

  it("trả 3/3/0 cho ba candidate xử lý thành công", async () => {
    const { env } = createEnv({ candidates: ["a", "b", "c"] });
    await expect(cleanupExpiredReservationsDetailed(env, cleanupAt)).resolves.toMatchObject({
      schemaAvailable: true,
      candidateCount: 3,
      releasedCount: 3,
      failedCount: 0,
      limit: 100,
    });
  });

  it("trả 3/2/1 và vẫn xử lý các candidate còn lại", async () => {
    const { env } = createEnv({
      candidates: ["a", "b", "c"],
      failBatchIds: ["b"],
    });
    const result = await cleanupExpiredReservationsDetailed(env, cleanupAt, 100, {
      runId: "run-partial",
    });
    expect(result).toEqual({
      schemaAvailable: true,
      candidateCount: 3,
      releasedCount: 2,
      failedCount: 1,
      limit: 100,
    });
    expect(result.candidateCount).toBe(result.releasedCount + result.failedCount);
  });

  it("bounded effective limit không vượt quá 100", async () => {
    const { env } = createEnv({
      candidates: Array.from({ length: 150 }, (_, index) => `candidate-${index}`),
    });
    const result = await cleanupExpiredReservationsDetailed(env, cleanupAt, 500);
    expect(result.limit).toBe(100);
    expect(result.candidateCount).toBe(100);
  });

  it("báo schema missing rõ ràng và wrapper legacy vẫn trả number", async () => {
    const missing = createEnv({ schemaAvailable: false });
    await expect(cleanupExpiredReservationsDetailed(missing.env, cleanupAt)).resolves.toEqual({
      schemaAvailable: false,
      candidateCount: 0,
      releasedCount: 0,
      failedCount: 0,
      limit: 100,
    });
    const legacy = createEnv({ candidates: ["a", "b"] });
    await expect(cleanupExpiredReservations(legacy.env, cleanupAt)).resolves.toBe(2);
    expect(legacy.database.writeCount).toBe(0);
  });
});

describe("scheduled inventory cleanup runner", () => {
  const scheduledAt = new Date("2026-09-01T00:10:00.000Z");

  it("ghi heartbeat + info terminal log và resolve khi SUCCESS", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:10:01.000Z"));
    const { database, env } = createEnv();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await runInventoryCleanupCron(env, scheduledAt);
    const heartbeat = parseCronHeartbeat(database.heartbeat);
    expect(result.outcome).toBe("SUCCESS");
    expect(heartbeat).toMatchObject({
      version: 1,
      job: "inventory_expiry_cleanup",
      lastSuccessAt: result.completedAt,
      lastRun: { runId: result.runId, outcome: "SUCCESS" },
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      event: "inventory_cleanup_cron_run",
      job: "inventory_expiry_cleanup",
      runId: result.runId,
      outcome: "SUCCESS",
      scheduledAt: scheduledAt.toISOString(),
      candidateCount: 0,
      releasedCount: 0,
      failedCount: 0,
      schemaAvailable: true,
      limit: 100,
    });
  });

  it("persist PARTIAL, giữ last success cũ, log error và reject sau metrics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:10:01.000Z"));
    const previousSuccess = "2026-09-01T00:09:00.000Z";
    const { database, env } = createEnv({
      candidates: ["a", "b", "c"],
      failBatchIds: ["b"],
      heartbeat: storedHeartbeat("SUCCESS", previousSuccess, previousSuccess),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(runInventoryCleanupCron(env, scheduledAt)).rejects.toThrow(
      "INVENTORY_CLEANUP_PARTIAL",
    );
    const heartbeat = parseCronHeartbeat(database.heartbeat);
    expect(heartbeat).toMatchObject({
      lastSuccessAt: previousSuccess,
      lastRun: {
        outcome: "PARTIAL",
        candidateCount: 3,
        releasedCount: 2,
        failedCount: 1,
      },
    });
    expect(info).not.toHaveBeenCalled();
    const terminal = error.mock.calls
      .map(([value]) => JSON.parse(String(value)) as Record<string, unknown>)
      .find((value) => value.event === "inventory_cleanup_cron_run");
    expect(terminal).toMatchObject({ outcome: "PARTIAL", candidateCount: 3 });
  });

  it("ghi ERROR sanitized khi cleanup lỗi cứng và vẫn persist heartbeat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:10:01.000Z"));
    const { database, env } = createEnv({
      candidates: ["a"],
      selectError: new Error("customerName=Nguyen; phone=0900000000"),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runInventoryCleanupCron(env, scheduledAt)).rejects.toThrow(
      "customerName=Nguyen; phone=0900000000",
    );
    expect(parseCronHeartbeat(database.heartbeat)).toMatchObject({
      lastRun: { outcome: "ERROR", candidateCount: 0, failedCount: 0 },
    });
    const logs = error.mock.calls.map(([value]) => String(value)).join("\n");
    expect(logs).not.toContain("customerName=Nguyen");
    expect(logs).not.toContain("0900000000");
  });

  it("ghi SCHEMA_MISSING vào heartbeat và reject, không coi là zero thành công", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:10:01.000Z"));
    const { database, env } = createEnv({ schemaAvailable: false });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runInventoryCleanupCron(env, scheduledAt)).rejects.toThrow(
      "INVENTORY_CLEANUP_SCHEMA_MISSING",
    );
    expect(parseCronHeartbeat(database.heartbeat)).toMatchObject({
      lastRun: { outcome: "SCHEMA_MISSING", schemaAvailable: false },
    });
    expect(error).toHaveBeenCalled();
  });

  it("reject khi heartbeat write fail sau cleanup và log terminal ERROR", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:10:01.000Z"));
    const { database, env } = createEnv({
      writeError: new Error("app_settings write failed customerEmail=hidden"),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(runInventoryCleanupCron(env, scheduledAt)).rejects.toThrow(
      "app_settings write failed customerEmail=hidden",
    );
    expect(database.heartbeat).toBeNull();
    expect(info).not.toHaveBeenCalled();
    const logs = error.mock.calls.map(([value]) => String(value)).join("\n");
    expect(logs).toContain("inventory_cleanup_cron_heartbeat_failed");
    expect(logs).not.toContain("customerEmail=hidden");
    expect(
      error.mock.calls
        .map(([value]) => JSON.parse(String(value)) as Record<string, unknown>)
        .some((value) => value.event === "inventory_cleanup_cron_run" && value.outcome === "ERROR"),
    ).toBe(true);
  });

  it("không ghi heartbeat khi generic legacy wrapper được gọi", async () => {
    const { database, env } = createEnv({ candidates: ["a"] });
    await cleanupExpiredReservations(env, scheduledAt);
    expect(database.writeCount).toBe(0);
    expect(database.heartbeat).toBeNull();
    expect(CRON_HEALTH_HEARTBEAT_KEY).toBe("cron_inventory_cleanup_health_v1");
  });
});

describe("GET /api/admin/cron-health", () => {
  const now = new Date("2026-09-01T00:10:00.000Z");

  async function api(env: Env) {
    return worker.fetch(
      new Request("https://metraphuong.com/api/admin/cron-health"),
      env,
      {} as ExecutionContext,
    );
  }

  it("trả health healthy/stale/error với no-store", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    for (const [outcome, expected] of [
      ["SUCCESS", "HEALTHY"],
      ["PARTIAL", "DEGRADED"],
      ["ERROR", "ERROR"],
    ] as const) {
      const { env } = createEnv({ heartbeat: storedHeartbeat(outcome, now.toISOString()) });
      const response = await api(env);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await responseJson(response)).data).toMatchObject({ health: expected });
    }
    const old = new Date(now.getTime() - CRON_STALE_AFTER_MS - 1).toISOString();
    const stale = await api(createEnv({ heartbeat: storedHeartbeat("SUCCESS", old) }).env);
    expect((await responseJson(stale)).data).toMatchObject({ health: "STALE" });
  });

  it("trả UNKNOWN + field null cho heartbeat malformed", async () => {
    const response = await api(createEnv({ heartbeat: "not-json" }).env);
    expect(await responseJson(response)).toMatchObject({
      data: {
        health: "UNKNOWN",
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastRun: null,
      },
    });
  });

  it("giữ endpoint dưới auth admin, production thiếu JWT bị từ chối", async () => {
    const { env } = createEnv();
    const production = {
      ...env,
      ENVIRONMENT: "production",
      ACCESS_TEAM_DOMAIN: "metraphuong.cloudflareaccess.com",
      ACCESS_AUD: "production-audience",
    } as unknown as Env;
    const response = await api(production);
    expect(response.status).toBe(401);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });
});
