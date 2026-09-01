export const CRON_HEALTH_HEARTBEAT_KEY = "cron_inventory_cleanup_health_v1";
export const CRON_JOB = "inventory_expiry_cleanup";
export const CRON_SCHEDULE = "* * * * *";
export const CRON_EXPECTED_INTERVAL_SECONDS = 60;
export const CRON_STALE_AFTER_SECONDS = 300;
export const CRON_EXPECTED_INTERVAL_MS = CRON_EXPECTED_INTERVAL_SECONDS * 1000;
export const CRON_STALE_AFTER_MS = CRON_STALE_AFTER_SECONDS * 1000;
export const MAX_CRON_CLEANUP_LIMIT = 100;

export const CRON_RUN_OUTCOMES = [
  "SUCCESS",
  "PARTIAL",
  "ERROR",
  "SCHEMA_MISSING",
] as const;
export type CronRunOutcome = (typeof CRON_RUN_OUTCOMES)[number];

export const CRON_HEALTH_STATUSES = [
  "HEALTHY",
  "DEGRADED",
  "ERROR",
  "STALE",
  "UNKNOWN",
] as const;
export type CronHealthStatus = (typeof CRON_HEALTH_STATUSES)[number];

export type CronCleanupMetrics = {
  schemaAvailable: boolean;
  candidateCount: number;
  releasedCount: number;
  failedCount: number;
  limit: number;
};

export type CronRunSnapshot = CronCleanupMetrics & {
  runId: string;
  outcome: CronRunOutcome;
  scheduledAt: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
};

export type CronHeartbeat = {
  version: 1;
  job: typeof CRON_JOB;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastRun: CronRunSnapshot;
};

export type CronHealthData = {
  job: typeof CRON_JOB;
  schedule: typeof CRON_SCHEDULE;
  expectedIntervalSeconds: typeof CRON_EXPECTED_INTERVAL_SECONDS;
  staleAfterSeconds: typeof CRON_STALE_AFTER_SECONDS;
  health: CronHealthStatus;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastRun: {
    outcome: CronRunOutcome;
    scheduledAt: string;
    completedAt: string;
    durationMs: number;
    candidateCount: number;
    releasedCount: number;
    failedCount: number;
  } | null;
};

type DateInput = Date | string | number;

function timestamp(value: unknown) {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value === "number")
    return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  return null;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && timestamp(value) !== null;
}

function nonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function validLimit(value: unknown): value is number {
  return (
    nonNegativeInteger(value) &&
    value >= 1 &&
    value <= MAX_CRON_CLEANUP_LIMIT
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseRunSnapshot(value: unknown): CronRunSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.runId !== "string" ||
    value.runId.length < 1 ||
    value.runId.length > 128 ||
    !CRON_RUN_OUTCOMES.includes(value.outcome as CronRunOutcome) ||
    !validTimestamp(value.scheduledAt) ||
    !validTimestamp(value.startedAt) ||
    !validTimestamp(value.completedAt) ||
    !nonNegativeInteger(value.durationMs) ||
    !nonNegativeInteger(value.candidateCount) ||
    !nonNegativeInteger(value.releasedCount) ||
    !nonNegativeInteger(value.failedCount) ||
    !validLimit(value.limit) ||
    typeof value.schemaAvailable !== "boolean"
  )
    return null;
  if (value.candidateCount !== value.releasedCount + value.failedCount)
    return null;
  return {
    runId: value.runId,
    outcome: value.outcome as CronRunOutcome,
    scheduledAt: value.scheduledAt,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    durationMs: value.durationMs,
    schemaAvailable: value.schemaAvailable,
    candidateCount: value.candidateCount,
    releasedCount: value.releasedCount,
    failedCount: value.failedCount,
    limit: value.limit,
  };
}

export function parseCronHeartbeat(value: unknown): CronHeartbeat | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;
  if (
    parsed.version !== 1 ||
    parsed.job !== CRON_JOB ||
    !validTimestamp(parsed.lastAttemptAt) ||
    (parsed.lastSuccessAt !== null && !validTimestamp(parsed.lastSuccessAt))
  )
    return null;
  const lastRun = parseRunSnapshot(parsed.lastRun);
  if (!lastRun) return null;
  return {
    version: 1,
    job: CRON_JOB,
    lastAttemptAt: parsed.lastAttemptAt,
    lastSuccessAt: parsed.lastSuccessAt,
    lastRun,
  };
}

function normalizeNow(now: DateInput) {
  return timestamp(now);
}

export function evaluateCronHealth(
  heartbeat: unknown,
  now: DateInput = Date.now(),
): {
  health: CronHealthStatus;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastRun: CronRunSnapshot | null;
} {
  const parsed = parseCronHeartbeat(heartbeat);
  const nowMilliseconds = normalizeNow(now);
  if (!parsed || nowMilliseconds === null)
    return {
      health: "UNKNOWN",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastRun: null,
    };

  const age = nowMilliseconds - Date.parse(parsed.lastAttemptAt);
  let health: CronHealthStatus;
  // Exactly 300 seconds without a completed attempt is considered stale.
  if (age >= CRON_STALE_AFTER_MS) health = "STALE";
  else if (parsed.lastRun.outcome === "SUCCESS") health = "HEALTHY";
  else if (parsed.lastRun.outcome === "PARTIAL") health = "DEGRADED";
  else health = "ERROR";
  return {
    health,
    lastAttemptAt: parsed.lastAttemptAt,
    lastSuccessAt: parsed.lastSuccessAt,
    lastRun: parsed.lastRun,
  };
}

export function buildCronHealthData(
  heartbeat: unknown,
  now: DateInput = Date.now(),
): CronHealthData {
  const evaluation = evaluateCronHealth(heartbeat, now);
  return {
    job: CRON_JOB,
    schedule: CRON_SCHEDULE,
    expectedIntervalSeconds: CRON_EXPECTED_INTERVAL_SECONDS,
    staleAfterSeconds: CRON_STALE_AFTER_SECONDS,
    health: evaluation.health,
    lastAttemptAt: evaluation.lastAttemptAt,
    lastSuccessAt: evaluation.lastSuccessAt,
    lastRun: evaluation.lastRun
      ? {
          outcome: evaluation.lastRun.outcome,
          scheduledAt: evaluation.lastRun.scheduledAt,
          completedAt: evaluation.lastRun.completedAt,
          durationMs: evaluation.lastRun.durationMs,
          candidateCount: evaluation.lastRun.candidateCount,
          releasedCount: evaluation.lastRun.releasedCount,
          failedCount: evaluation.lastRun.failedCount,
        }
      : null,
  };
}

export function buildCronHeartbeat(
  lastRun: CronRunSnapshot,
  previousLastSuccessAt: string | null,
): CronHeartbeat {
  return {
    version: 1,
    job: CRON_JOB,
    lastAttemptAt: lastRun.completedAt,
    lastSuccessAt:
      lastRun.outcome === "SUCCESS"
        ? lastRun.completedAt
        : previousLastSuccessAt,
    lastRun,
  };
}

export function sanitizeCronErrorType(caught: unknown) {
  const raw = caught instanceof Error ? caught.name : "UNKNOWN";
  const sanitized = raw.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
  return sanitized || "UNKNOWN";
}
