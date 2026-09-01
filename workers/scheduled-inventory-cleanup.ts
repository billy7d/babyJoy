import {
  buildCronHealthData,
  buildCronHeartbeat,
  CRON_HEALTH_HEARTBEAT_KEY,
  CRON_JOB,
  MAX_CRON_CLEANUP_LIMIT,
  parseCronHeartbeat,
  sanitizeCronErrorType,
  type CronRunOutcome,
  type CronRunSnapshot,
} from "../shared/cron-health";
import {
  cleanupExpiredReservationsDetailed,
  type CleanupExpiredReservationsResult,
} from "./inventory";

type StoredHeartbeatRow = { value: string };

function validDate(value: Date | number) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function boundedLimit(limit: number) {
  const normalized = Number.isFinite(limit) ? Math.floor(limit) : MAX_CRON_CLEANUP_LIMIT;
  return Math.min(MAX_CRON_CLEANUP_LIMIT, Math.max(1, normalized));
}

function emptyMetrics(limit: number): CleanupExpiredReservationsResult {
  return {
    schemaAvailable: true,
    candidateCount: 0,
    releasedCount: 0,
    failedCount: 0,
    limit,
  };
}

export async function readCronHeartbeat(env: Env) {
  const row = await env.DB.prepare(
    "SELECT value FROM app_settings WHERE key = ?",
  )
    .bind(CRON_HEALTH_HEARTBEAT_KEY)
    .first<StoredHeartbeatRow>();
  return row?.value ?? null;
}

export async function writeCronHeartbeat(env: Env, heartbeat: ReturnType<typeof buildCronHeartbeat>) {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(
      CRON_HEALTH_HEARTBEAT_KEY,
      JSON.stringify(heartbeat),
      heartbeat.lastAttemptAt,
    )
    .run();
}

export async function getAdminCronHealthData(env: Env, now = new Date()) {
  try {
    return buildCronHealthData(await readCronHeartbeat(env), now);
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "inventory_cleanup_cron_health_read_failed",
        job: CRON_JOB,
        errorType: sanitizeCronErrorType(caught),
      }),
    );
    return buildCronHealthData(null, now);
  }
}

function buildRunSnapshot(
  runId: string,
  outcome: CronRunOutcome,
  scheduledAt: string,
  startedAt: string,
  completedAt: string,
  metrics: CleanupExpiredReservationsResult,
) {
  return {
    runId,
    outcome,
    scheduledAt,
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    schemaAvailable: metrics.schemaAvailable,
    candidateCount: metrics.candidateCount,
    releasedCount: metrics.releasedCount,
    failedCount: metrics.failedCount,
    limit: metrics.limit,
  } satisfies CronRunSnapshot;
}

function logCleanupFailure(runId: string, caught: unknown) {
  console.error(
    JSON.stringify({
      event: "inventory_cleanup_cron_failed",
      job: CRON_JOB,
      runId,
      errorType: sanitizeCronErrorType(caught),
    }),
  );
}

function logHeartbeatFailure(runId: string, caught: unknown) {
  console.error(
    JSON.stringify({
      event: "inventory_cleanup_cron_heartbeat_failed",
      job: CRON_JOB,
      runId,
      errorType: sanitizeCronErrorType(caught),
    }),
  );
}

export async function runInventoryCleanupCron(
  env: Env,
  scheduledAtInput: Date | number,
  limit = MAX_CRON_CLEANUP_LIMIT,
) {
  const runId = crypto.randomUUID();
  const startedDate = new Date();
  const startedAt = startedDate.toISOString();
  const scheduledDate = validDate(scheduledAtInput) ?? startedDate;
  const scheduledAt = scheduledDate.toISOString();
  const effectiveLimit = boundedLimit(limit);

  let previousLastSuccessAt: string | null = null;
  try {
    previousLastSuccessAt = parseCronHeartbeat(await readCronHeartbeat(env))?.lastSuccessAt ?? null;
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "inventory_cleanup_cron_heartbeat_read_failed",
        job: CRON_JOB,
        runId,
        errorType: sanitizeCronErrorType(caught),
      }),
    );
  }

  let metrics = emptyMetrics(effectiveLimit);
  let cleanupError: unknown = null;
  let cleanupOutcome: CronRunOutcome = "ERROR";
  try {
    metrics = await cleanupExpiredReservationsDetailed(
      env,
      scheduledDate,
      effectiveLimit,
      { runId },
    );
    cleanupOutcome = !metrics.schemaAvailable
      ? "SCHEMA_MISSING"
      : metrics.failedCount > 0
        ? "PARTIAL"
        : "SUCCESS";
  } catch (caught) {
    cleanupError = caught;
    logCleanupFailure(runId, caught);
  }

  const completedAt = new Date().toISOString();
  const cleanupRun = buildRunSnapshot(
    runId,
    cleanupOutcome,
    scheduledAt,
    startedAt,
    completedAt,
    metrics,
  );
  let heartbeatError: unknown = null;
  try {
    await writeCronHeartbeat(env, buildCronHeartbeat(cleanupRun, previousLastSuccessAt));
  } catch (caught) {
    heartbeatError = caught;
    logHeartbeatFailure(runId, caught);
  }

  const terminalOutcome: CronRunOutcome = heartbeatError ? "ERROR" : cleanupOutcome;
  const terminalRun =
    terminalOutcome === cleanupOutcome
      ? cleanupRun
      : buildRunSnapshot(
          runId,
          terminalOutcome,
          scheduledAt,
          startedAt,
          completedAt,
          metrics,
        );
  const terminalLog = JSON.stringify({
    event: "inventory_cleanup_cron_run",
    job: CRON_JOB,
    ...terminalRun,
  });
  if (terminalOutcome === "SUCCESS") console.info(terminalLog);
  else console.error(terminalLog);

  if (cleanupError) throw cleanupError;
  if (heartbeatError) throw heartbeatError;
  if (cleanupOutcome === "PARTIAL")
    throw new Error("INVENTORY_CLEANUP_PARTIAL");
  if (cleanupOutcome === "SCHEMA_MISSING")
    throw new Error("INVENTORY_CLEANUP_SCHEMA_MISSING");
  return cleanupRun;
}
