export const SHIPPING_MIGRATION_FILE = "0025_shipping_fee_v1.sql";
export const ACCESS_LINKS_MIGRATION_FILE = "0026_access_link_codes_v1.sql";
export const PRODUCTION_D1_DATABASE_ID = "6d19fcf2-6385-493b-a377-a31d5e42de03";
export const PRODUCTION_WORKER_SCRIPT_NAME = "babyjoy-web-app-production";
export const PRODUCTION_CUSTOM_DOMAIN = "metraphuong.com";
export const SHIPPING_ROLLOUT_CONFIRMATION = "ROLL_OUT_SHIPPING";
export const ACCESS_LINKS_ROLLOUT_CONFIRMATION = "ROLL_OUT_ACCESS_LINKS";
export const STANDARD_SHIPPING_FEE_VND = 15_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

/** Tách tên migration từ output text của Wrangler mà không phụ thuộc bảng màu. */
export function extractMigrationNames(output) {
  return uniqueSorted(
    String(output ?? "").match(/\b\d{4}_[A-Za-z0-9_-]+\.sql\b/g) ?? [],
  );
}

/** Chỉ cho phép đúng migration shipping đã được review trước khi apply. */
export function assertMigrationAllowlist(
  output,
  expected = [SHIPPING_MIGRATION_FILE],
) {
  const actual = extractMigrationNames(output);
  const allowed = uniqueSorted(expected);
  if (JSON.stringify(actual) !== JSON.stringify(allowed)) {
    throw new Error(
      `Production migration allowlist mismatch: expected ${JSON.stringify(
        allowed,
      )}, received ${JSON.stringify(actual)}.`,
    );
  }
  return actual;
}

function containsQueryEnvelope(value) {
  return isRecord(value) &&
    (Object.prototype.hasOwnProperty.call(value, "results") ||
      Object.prototype.hasOwnProperty.call(value, "success") ||
      Object.prototype.hasOwnProperty.call(value, "meta"));
}

/**
 * Wrangler D1 --json có thể trả một envelope hoặc mảng envelope tùy phiên bản.
 * Chuẩn hoá cả hai dạng để workflow không đoán sai kết quả query read-only.
 */
export function extractD1Rows(payload) {
  let rows;
  let unsuccessful = false;
  const visit = (value) => {
    if (rows) return;
    if (Array.isArray(value)) {
      if (
        value.every(
          (item) => isRecord(item) && !containsQueryEnvelope(item),
        )
      ) {
        rows = value;
        return;
      }
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (value.success === false) unsuccessful = true;
    if (Array.isArray(value.results)) {
      const directRows = value.results.every(
        (item) => isRecord(item) && !containsQueryEnvelope(item),
      );
      if (directRows) rows = value.results;
      else value.results.forEach(visit);
    }
    if (Object.prototype.hasOwnProperty.call(value, "result")) visit(value.result);
    if (Object.prototype.hasOwnProperty.call(value, "data")) visit(value.data);
  };
  visit(payload);
  if (unsuccessful) throw new Error("Cloudflare D1 query returned success=false.");
  if (!rows) throw new Error("Cloudflare D1 query returned no result rows.");
  return rows;
}

export function assertRowsEmpty(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 0)
    throw new Error(`${label} must be empty; received ${JSON.stringify(rows)}.`);
  return true;
}

export function assertSchemaColumn(rows, columnName, expectedPresent) {
  if (!Array.isArray(rows)) throw new Error("Schema query rows must be an array.");
  const present = rows.some((row) => row?.name === columnName);
  if (present !== expectedPresent) {
    throw new Error(
      `Schema column ${columnName} presence mismatch: expected ${String(
        expectedPresent,
      )}, received ${String(present)}.`,
    );
  }
  return present;
}

/** Xác nhận Wrangler đang trỏ đúng database production đã được review. */
export function assertD1DatabaseIdentity(payload, expectedId, expectedName) {
  let foundId = false;
  let foundName = false;
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (["id", "uuid", "database_id", "databaseId"].some((key) => value[key] === expectedId))
      foundId = true;
    if (["name", "database_name", "databaseName"].some((key) => value[key] === expectedName))
      foundName = true;
    Object.values(value).forEach(visit);
  };
  visit(payload);
  if (!foundId || !foundName)
    throw new Error("Production D1 identity does not match the expected database.");
  return true;
}

function safeInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0)
    throw new Error(`${field} must be a non-negative safe integer.`);
  return normalized;
}

export function assertHistoryAggregateUnchanged(beforeRows, afterRows) {
  if (beforeRows.length !== 1 || afterRows.length !== 1)
    throw new Error("Cart history aggregate must contain exactly one row.");
  for (const field of ["cart_count", "subtotal_sum", "discount_sum", "final_sum"]) {
    const before = safeInteger(beforeRows[0]?.[field], `before.${field}`);
    const after = safeInteger(afterRows[0]?.[field], `after.${field}`);
    if (before !== after)
      throw new Error(
        `Historical ${field} changed during migration: ${before} -> ${after}.`,
      );
  }
  return true;
}

/** Kiểm tra invariant cho record mới; không áp dụng global lên lịch sử legacy. */
export function assertAuthoritativeCartSnapshot(row) {
  const subtotal = safeInteger(row?.subtotal_vnd, "subtotal_vnd");
  const discount = safeInteger(row?.promotion_discount_vnd, "promotion_discount_vnd");
  const shipping = safeInteger(row?.shipping_fee_vnd, "shipping_fee_vnd");
  const final = safeInteger(row?.final_total_vnd, "final_total_vnd");
  if (shipping !== 0 && shipping !== STANDARD_SHIPPING_FEE_VND)
    throw new Error(`shipping_fee_vnd must be 0 or ${STANDARD_SHIPPING_FEE_VND}.`);
  const expected = Math.max(0, subtotal - discount) + shipping;
  if (final !== expected)
    throw new Error(`Cart total invariant failed: expected ${expected}, received ${final}.`);
  return true;
}

function resolvedProductionConfig(config) {
  if (!isRecord(config)) throw new Error("Production deployment config must be an object.");
  const production = config.env?.production;
  return isRecord(production) ? production : config;
}

function gateVarsContainer(config) {
  if (
    isRecord(config.env?.production?.vars) &&
    Object.prototype.hasOwnProperty.call(
      config.env.production.vars,
      "STOREFRONT_ACCESS_GATE_ENABLED",
    )
  )
    return config.env.production.vars;
  if (isRecord(config.vars) && Object.prototype.hasOwnProperty.call(config.vars, "STOREFRONT_ACCESS_GATE_ENABLED"))
    return config.vars;
  throw new Error("Deployment artifact is missing STOREFRONT_ACCESS_GATE_ENABLED.");
}

/** Đổi duy nhất biến gate trong JSON đã parse, không thay chuỗi tự do trong config. */
export function setProductionGateValue(config, value) {
  if (value !== "true" && value !== "false")
    throw new Error("Storefront gate value must be the literal string true or false.");
  const next = structuredClone(config);
  gateVarsContainer(next).STOREFRONT_ACCESS_GATE_ENABLED = value;
  return next;
}

export function productionGateValue(config) {
  return gateVarsContainer(config).STOREFRONT_ACCESS_GATE_ENABLED;
}

/** Tạo config tạm chỉ chứa migration đã allowlist; không dùng config này để deploy Worker. */
export function buildShippingMigrationConfig(config, migrationDir = "shipping-migrations") {
  if (!isRecord(config) || !isRecord(config.env?.production))
    throw new Error("Production migration config must contain env.production.");
  if (
    typeof migrationDir !== "string" ||
    !/^[A-Za-z0-9._/-]+$/.test(migrationDir) ||
    migrationDir.startsWith("/") ||
    migrationDir.includes("..") ||
    migrationDir.includes("\\")
  )
    throw new Error("Migration directory must be a relative safe path.");
  const next = structuredClone(config);
  next.name = PRODUCTION_WORKER_SCRIPT_NAME;
  next.main = "./index.js";
  const production = next.env.production;
  production.name = PRODUCTION_WORKER_SCRIPT_NAME;
  if (!Array.isArray(production.d1_databases) || production.d1_databases.length !== 1)
    throw new Error("Production migration config must contain exactly one D1 binding.");
  production.d1_databases = production.d1_databases.map((database) => ({
    ...database,
    database_name: "babyjoy-db",
    database_id: PRODUCTION_D1_DATABASE_ID,
    migrations_dir: migrationDir,
  }));
  return next;
}

/** Tạo config migration riêng cho access-link; không dùng config này để deploy Worker. */
export function buildAccessLinksMigrationConfig(
  config,
  migrationDir = "access-links-migrations",
) {
  return buildShippingMigrationConfig(config, migrationDir);
}

export function assertProductionDeploymentConfig(
  config,
  {
    scriptName = PRODUCTION_WORKER_SCRIPT_NAME,
    databaseId = PRODUCTION_D1_DATABASE_ID,
    customDomain = PRODUCTION_CUSTOM_DOMAIN,
    gateValue = "true",
    requireWorkerName = false,
  } = {},
) {
  const production = resolvedProductionConfig(config);
  if (requireWorkerName) {
    const artifactName = production.name ?? config.name;
    if (artifactName !== scriptName)
      throw new Error(
        `Deployment artifact Worker must be ${scriptName}; received ${String(
          artifactName,
        )}.`,
      );
  }
  if (productionGateValue(config) !== gateValue)
    throw new Error(
      `Deployment artifact gate must be ${gateValue}; received ${String(
        productionGateValue(config),
      )}.`,
    );
  if (production.workers_dev !== false || production.preview_urls !== false)
    throw new Error("Production deployment artifact must keep workers_dev=false and preview_urls=false.");
  const databases = Array.isArray(production.d1_databases)
    ? production.d1_databases
    : Array.isArray(config.d1_databases)
      ? config.d1_databases
      : [];
  if (
    !databases.some(
      (database) =>
        database?.database_name === "babyjoy-db" &&
        database?.database_id === databaseId,
    )
  )
    throw new Error("Production deployment artifact does not bind the expected babyjoy-db.");
  const routes = Array.isArray(production.routes)
    ? production.routes
    : Array.isArray(config.routes)
      ? config.routes
      : [];
  if (
    !routes.some(
      (route) => route?.pattern === customDomain && route?.custom_domain === true,
    )
  )
    throw new Error(`Production deployment artifact is not attached to ${customDomain}.`);
  if (scriptName !== PRODUCTION_WORKER_SCRIPT_NAME)
    throw new Error(`Unexpected production Worker script: ${scriptName}.`);
  return true;
}

export function assertSingleActiveWorkerVersion(state, label = "Worker") {
  const versions = state?.activeVersions;
  if (
    !Array.isArray(versions) ||
    versions.length !== 1 ||
    versions[0]?.percentage !== 100 ||
    typeof versions[0]?.versionId !== "string" ||
    versions[0].versionId.length === 0
  )
    throw new Error(`${label} must serve exactly one active version at 100%.`);
  return versions[0].versionId;
}
