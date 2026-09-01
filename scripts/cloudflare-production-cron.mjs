#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const CLOUDFLARE_API_BASE_URL =
  "https://api.cloudflare.com/client/v4";
export const CRON_MISMATCH_EXIT_CODE = 2;

const GENERATED_CONFIG_METADATA_KEYS = [
  "configPath",
  "userConfigPath",
  "topLevelName",
  "definedEnvironments",
  "targetEnvironment",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function redact(value, secret) {
  const text = String(value ?? "");
  return secret ? text.replaceAll(secret, "[REDACTED]") : text;
}

function errorMessage(value) {
  return value instanceof Error ? value.message : String(value);
}

/**
 * Parse the JSONC emitted/configured by Wrangler without adding a runtime
 * dependency just for comments and trailing commas.
 */
export function parseJsonc(text, sourceName = "JSONC input") {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }

    if (character === "/" && text[index + 1] === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r")
        index += 1;
      if (index < text.length) output += text[index];
      continue;
    }

    if (character === "/" && text[index + 1] === "*") {
      index += 2;
      while (
        index < text.length &&
        !(text[index] === "*" && text[index + 1] === "/")
      ) {
        if (text[index] === "\n" || text[index] === "\r") output += text[index];
        else output += " ";
        index += 1;
      }
      if (index < text.length) index += 1;
      continue;
    }

    if (character === ",") {
      let lookahead = index + 1;
      while (/\s/.test(text[lookahead] ?? "")) lookahead += 1;
      if (text[lookahead] === "}" || text[lookahead] === "]") continue;
    }

    output += character;
  }

  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`Could not parse ${sourceName}: ${errorMessage(error)}`);
  }
}

export function readJsoncFile(path) {
  return parseJsonc(readFileSync(path, "utf8"), path);
}

export function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${path}: ${errorMessage(error)}`);
  }
}

function writeJsonFile(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function normalizeCronList(crons, label = "Cron list") {
  if (!Array.isArray(crons)) {
    throw new Error(`${label} must be an array.`);
  }

  const values = crons.map((cron, index) => {
    if (typeof cron !== "string" || cron.trim() === "") {
      throw new Error(`${label}[${index}] must be a non-empty string.`);
    }
    return cron;
  });
  const duplicates = values.filter(
    (cron, index) => values.indexOf(cron) !== index,
  );
  if (duplicates.length > 0) {
    throw new Error(
      `${label} contains duplicate cron expression(s): ${JSON.stringify([
        ...new Set(duplicates),
      ])}`,
    );
  }
  return values;
}

export function cronListsMatch(expected, actual) {
  try {
    const normalizedExpected = normalizeCronList(expected, "Expected Cron list").sort();
    const normalizedActual = normalizeCronList(actual, "Actual Cron list").sort();
    return JSON.stringify(normalizedExpected) === JSON.stringify(normalizedActual);
  } catch {
    return false;
  }
}

function scheduleRecords(schedules) {
  if (!Array.isArray(schedules)) {
    throw new Error("Cloudflare returned a non-array schedules value.");
  }
  return schedules.map((schedule, index) => {
    if (!isRecord(schedule) || typeof schedule.cron !== "string") {
      throw new Error(
        `Cloudflare returned an invalid schedule at index ${index}.`,
      );
    }
    const record = { cron: schedule.cron };
    if (typeof schedule.created_on === "string")
      record.created_on = schedule.created_on;
    if (typeof schedule.modified_on === "string")
      record.modified_on = schedule.modified_on;
    return record;
  });
}

function scheduleCrons(schedules) {
  return scheduleRecords(schedules).map((schedule) => schedule.cron);
}

function customDomainFromRoutes(routes) {
  if (!Array.isArray(routes)) return null;
  const route = routes.find(
    (candidate) =>
      isRecord(candidate) &&
      (candidate.custom_domain === true || candidate.customDomain === true) &&
      typeof candidate.pattern === "string" &&
      candidate.pattern.length > 0,
  );
  return route?.pattern ?? null;
}

export function resolveDeploymentConfig(config, environment = "production") {
  if (!isRecord(config)) throw new Error("Wrangler config must be an object.");
  if (isRecord(config.env) && hasOwn(config.env, environment)) {
    if (!isRecord(config.env[environment])) {
      throw new Error(`Wrangler env.${environment} must be an object.`);
    }
    return {
      config: config.env[environment],
      source: `env.${environment}`,
    };
  }
  return { config, source: "top-level" };
}

export function extractProductionDeploymentMetadata(
  config,
  { environment = "production", scriptName: scriptNameOverride } = {},
) {
  const resolved = resolveDeploymentConfig(config, environment);
  const crons = normalizeCronList(
    resolved.config.triggers?.crons,
    `${resolved.source}.triggers.crons`,
  );
  if (crons.length === 0) {
    throw new Error(`${resolved.source}.triggers.crons must not be empty.`);
  }
  const scriptName =
    scriptNameOverride ?? resolved.config.name ?? config.name;
  if (typeof scriptName !== "string" || scriptName.trim() === "") {
    throw new Error("Production Worker script name is missing from Wrangler config.");
  }
  if (typeof resolved.config.workers_dev !== "boolean") {
    throw new Error(`${resolved.source}.workers_dev must be explicitly boolean.`);
  }
  if (typeof resolved.config.preview_urls !== "boolean") {
    throw new Error(`${resolved.source}.preview_urls must be explicitly boolean.`);
  }
  const customDomain = customDomainFromRoutes(resolved.config.routes);
  if (!customDomain) {
    throw new Error(
      `${resolved.source}.routes must contain an explicit custom domain.`,
    );
  }

  return {
    environment,
    source: resolved.source,
    scriptName,
    crons,
    workersDev: resolved.config.workers_dev,
    previewUrls: resolved.config.preview_urls,
    customDomain,
  };
}

function assertNoConfigKey(value, key, path = "config") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoConfigKey(item, key, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  if (hasOwn(value, key)) {
    throw new Error(`Temporary deployment config must not contain ${path}.${key}.`);
  }
  Object.entries(value).forEach(([childKey, childValue]) =>
    assertNoConfigKey(childValue, key, `${path}.${childKey}`),
  );
}

export function createTriggerFreeDeployConfig(config, expectedCrons) {
  const metadata = extractProductionDeploymentMetadata(config);
  if (expectedCrons && !cronListsMatch(expectedCrons, metadata.crons)) {
    throw new Error(
      `Generated Wrangler Cron differs from the extracted expected Cron: expected ${JSON.stringify(
        expectedCrons,
      )}, generated ${JSON.stringify(metadata.crons)}.`,
    );
  }
  if (metadata.workersDev !== false) {
    throw new Error("Production deploy config must keep workers_dev=false.");
  }
  if (metadata.previewUrls !== false) {
    throw new Error("Production deploy config must keep preview_urls=false.");
  }
  if (!Array.isArray(config.d1_databases) || config.d1_databases.length === 0) {
    throw new Error("Generated deploy config is missing D1 bindings.");
  }
  if (!Array.isArray(config.r2_buckets) || config.r2_buckets.length === 0) {
    throw new Error("Generated deploy config is missing R2 bindings.");
  }

  const deployConfig = structuredClone(config);
  GENERATED_CONFIG_METADATA_KEYS.forEach((key) => delete deployConfig[key]);
  delete deployConfig.triggers;
  assertNoConfigKey(deployConfig, "triggers");
  assertNoConfigKey(deployConfig, "crons");

  return { config: deployConfig, metadata };
}

export class CloudflareApiError extends Error {
  constructor({ operation, status, codes = [], message, token }) {
    super(redact(message, token));
    this.name = "CloudflareApiError";
    this.operation = operation;
    this.status = status;
    this.codes = codes;
  }
}

export class CronVerificationError extends Error {
  constructor(expected, before, after) {
    super(
      `Cron verification failed: expected ${JSON.stringify(
        expected,
      )}, received ${JSON.stringify(scheduleCrons(after))}.`,
    );
    this.name = "CronVerificationError";
    this.expected = expected;
    this.before = before;
    this.after = after;
  }
}

function responseErrors(payload) {
  const values = [
    ...(Array.isArray(payload?.errors) ? payload.errors : []),
    ...(Array.isArray(payload?.messages) ? payload.messages : []),
  ];
  return values.map((entry) => ({
    code: typeof entry?.code === "number" ? entry.code : undefined,
    message: typeof entry?.message === "string" ? entry.message : "API error",
  }));
}

function formatResponseErrors(payload, status) {
  const values = responseErrors(payload);
  if (values.length === 0) return `HTTP ${status}`;
  return values
    .map(({ code, message }) => `${code ?? "unknown"}: ${message}`)
    .join("; ");
}

export function createCloudflareApi({
  token,
  accountId,
  scriptName,
  fetchImpl = globalThis.fetch,
  baseUrl = CLOUDFLARE_API_BASE_URL,
}) {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("CLOUDFLARE_API_TOKEN is required.");
  }
  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required.");
  }
  if (typeof scriptName !== "string" || scriptName.trim() === "") {
    throw new Error("Production Worker script name is required.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }

  const resourcePath = `/accounts/${encodeURIComponent(
    accountId,
  )}/workers/scripts/${encodeURIComponent(scriptName)}`;

  async function request(path, { method = "GET", body } = {}) {
    const operation = `${method} ${path}`;
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${resourcePath}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new CloudflareApiError({
        operation,
        status: 0,
        message: `Cloudflare API request failed: ${errorMessage(error)}`,
        token,
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new CloudflareApiError({
        operation,
        status: response.status,
        message: `Cloudflare API returned a non-JSON response (HTTP ${response.status}).`,
        token,
      });
    }

    if (!response.ok || payload?.success !== true) {
      const errors = responseErrors(payload);
      throw new CloudflareApiError({
        operation,
        status: response.status,
        codes: errors.flatMap(({ code }) => (code === undefined ? [] : [code])),
        message: `Cloudflare API request failed (${operation}): ${formatResponseErrors(
          payload,
          response.status,
        )}`,
        token,
      });
    }
    return payload;
  }

  return {
    async getSchedules() {
      const payload = await request("/schedules");
      return scheduleRecords(payload.result?.schedules);
    },

    async updateSchedules(expectedCrons) {
      const normalized = normalizeCronList(expectedCrons, "Expected Cron list");
      const payload = await request("/schedules", {
        method: "PUT",
        body: normalized.map((cron) => ({ cron })),
      });
      return scheduleRecords(payload.result?.schedules);
    },

    async getDeployments() {
      const payload = await request("/deployments");
      if (!Array.isArray(payload.result?.deployments)) {
        throw new Error("Cloudflare returned an invalid deployments value.");
      }
      return payload.result.deployments;
    },

    async getSubdomain() {
      const payload = await request("/subdomain");
      if (!isRecord(payload.result)) {
        throw new Error("Cloudflare returned an invalid subdomain value.");
      }
      return payload.result;
    },

    async listScripts() {
      const payload = await fetchScripts();
      if (!Array.isArray(payload.result)) {
        throw new Error("Cloudflare returned an invalid scripts value.");
      }
      return payload.result;
    },
  };

  async function fetchScripts() {
    const operation = "GET /scripts";
    let response;
    try {
      response = await fetchImpl(
        `${baseUrl}/accounts/${encodeURIComponent(accountId)}/workers/scripts`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        },
      );
    } catch (error) {
      throw new CloudflareApiError({
        operation,
        status: 0,
        message: `Cloudflare API request failed: ${errorMessage(error)}`,
        token,
      });
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new CloudflareApiError({
        operation,
        status: response.status,
        message: `Cloudflare API returned a non-JSON response (HTTP ${response.status}).`,
        token,
      });
    }
    if (!response.ok || payload?.success !== true) {
      const errors = responseErrors(payload);
      throw new CloudflareApiError({
        operation,
        status: response.status,
        codes: errors.flatMap(({ code }) => (code === undefined ? [] : [code])),
        message: `Cloudflare API request failed (${operation}): ${formatResponseErrors(
          payload,
          response.status,
        )}`,
        token,
      });
    }
    return payload;
  }
}

export async function checkSchedules(api, expectedCrons) {
  const expected = normalizeCronList(expectedCrons, "Expected Cron list");
  const actual = scheduleRecords(await api.getSchedules());
  const actualCrons = scheduleCrons(actual);
  return {
    expected,
    actual,
    actualCrons,
    exact: cronListsMatch(expected, actualCrons),
  };
}

export async function reconcileSchedules(api, expectedCrons) {
  const expected = normalizeCronList(expectedCrons, "Expected Cron list");
  const before = scheduleRecords(await api.getSchedules());
  if (cronListsMatch(expected, scheduleCrons(before))) {
    return {
      operation: "NO-OP",
      expected,
      before,
      after: before,
    };
  }

  await api.updateSchedules(expected);
  const after = scheduleRecords(await api.getSchedules());
  if (!cronListsMatch(expected, scheduleCrons(after))) {
    throw new CronVerificationError(expected, before, after);
  }
  return {
    operation: "UPDATED",
    expected,
    before,
    after,
  };
}

function routeMatchesCustomDomain(route, expectedDomain, scriptName) {
  if (!isRecord(route) || typeof route.pattern !== "string") return false;
  const pattern = route.pattern.replace(/\/$/, "");
  const domain = expectedDomain.replace(/\/$/, "");
  return (
    (pattern === domain || pattern === `${domain}/*`) &&
    (route.script === undefined || route.script === null || route.script === scriptName)
  );
}

function activeDeploymentState(deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("Cloudflare returned no active Worker deployment.");
  }
  const active = deployments[0];
  if (!isRecord(active) || !Array.isArray(active.versions) || active.versions.length === 0) {
    throw new Error("Cloudflare returned an invalid active Worker deployment.");
  }
  const versions = active.versions.map((version, index) => {
    if (
      !isRecord(version) ||
      typeof version.version_id !== "string" ||
      typeof version.percentage !== "number"
    ) {
      throw new Error(`Cloudflare returned an invalid active version at index ${index}.`);
    }
    return {
      versionId: version.version_id,
      percentage: version.percentage,
    };
  });
  const percentage = versions.reduce((total, version) => total + version.percentage, 0);
  if (Math.abs(percentage - 100) > 0.001) {
    throw new Error(
      `Active Worker deployment does not serve 100% traffic (currently ${percentage}%).`,
    );
  }
  return {
    deploymentId: active.id ?? null,
    createdOn: active.created_on ?? null,
    versions,
    activeVersionIds: versions.map((version) => version.versionId).sort(),
  };
}

export async function getVerifiedWorkerState(api, metadata) {
  if (!isRecord(metadata)) throw new Error("Worker verification metadata is required.");
  const expectedScriptName = metadata.scriptName;
  const expectedDomain = metadata.customDomain;
  if (typeof expectedScriptName !== "string" || expectedScriptName.length === 0) {
    throw new Error("Worker verification metadata is missing scriptName.");
  }
  if (typeof expectedDomain !== "string" || expectedDomain.length === 0) {
    throw new Error("Worker verification metadata is missing customDomain.");
  }
  const [deployments, subdomain, scripts] = await Promise.all([
    api.getDeployments(),
    api.getSubdomain(),
    api.listScripts(),
  ]);
  if (subdomain.enabled !== false || subdomain.previews_enabled !== false) {
    throw new Error(
      `Worker subdomain verification failed: enabled=${String(
        subdomain.enabled,
      )}, previews_enabled=${String(subdomain.previews_enabled)}.`,
    );
  }
  const script = scripts.find((candidate) => candidate?.id === expectedScriptName);
  if (!script) {
    throw new Error(
      `Worker ${expectedScriptName} was not found in the configured Cloudflare account.`,
    );
  }
  if (!Array.isArray(script.routes)) {
    throw new Error("Cloudflare did not return routes for the production Worker.");
  }
  const customDomainRoute = script.routes.find((route) =>
    routeMatchesCustomDomain(route, expectedDomain, expectedScriptName),
  );
  if (!customDomainRoute) {
    throw new Error(
      `Custom domain verification failed: ${expectedDomain} is not attached to ${expectedScriptName}.`,
    );
  }
  const deployment = activeDeploymentState(deployments);
  return {
    scriptName: expectedScriptName,
    customDomain: expectedDomain,
    workersDev: subdomain.enabled,
    previewUrls: subdomain.previews_enabled,
    activeDeploymentId: deployment.deploymentId,
    activeDeploymentCreatedOn: deployment.createdOn,
    activeVersions: deployment.versions,
    activeVersionIds: deployment.activeVersionIds,
  };
}

export function assertWorkerVersionUnchanged(before, after) {
  const beforeVersions = normalizeVersionIds(before?.activeVersionIds, "Before");
  const afterVersions = normalizeVersionIds(after?.activeVersionIds, "After");
  if (JSON.stringify(beforeVersions) !== JSON.stringify(afterVersions)) {
    throw new Error(
      `Worker active version changed unexpectedly: before ${JSON.stringify(
        beforeVersions,
      )}, after ${JSON.stringify(afterVersions)}.`,
    );
  }
  return true;
}

function normalizeVersionIds(value, label) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new Error(`${label} Worker state has invalid activeVersionIds.`);
  }
  return [...value].sort();
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function requiredOption(args, name) {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required option --${name}.`);
  }
  return value;
}

function expectedCronsFromFile(path) {
  return normalizeCronList(readJsonFile(path), `Expected Cron file ${path}`);
}

function apiFromEnvironment(args) {
  return createCloudflareApi({
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    scriptName: args["script-name"] ?? process.env.PRODUCTION_WORKER_SCRIPT_NAME,
  });
}

function writeState(path, state) {
  if (path) writeJsonFile(path, state);
}

async function runCommand(command, args) {
  if (command === "extract") {
    const configPath = requiredOption(args, "config");
    const metadata = extractProductionDeploymentMetadata(
      readJsoncFile(configPath),
      {
        environment: args.environment ?? "production",
        scriptName: args["script-name"],
      },
    );
    if (args.output) writeJsonFile(args.output, metadata.crons);
    if (args["metadata-output"]) writeJsonFile(args["metadata-output"], metadata);
    console.log(`Extracted production Cron: ${JSON.stringify(metadata.crons)}`);
    console.log(`Resolved production Worker script: ${metadata.scriptName}`);
    return 0;
  }

  if (command === "prepare-deploy-config") {
    const inputPath = requiredOption(args, "input");
    const outputPath = requiredOption(args, "output");
    const expected = args["expected-file"]
      ? expectedCronsFromFile(args["expected-file"])
      : undefined;
    const { config, metadata } = createTriggerFreeDeployConfig(
      readJsonFile(inputPath),
      expected,
    );
    writeJsonFile(outputPath, config);
    console.log(
      `Prepared trigger-free Worker config for ${metadata.scriptName}: ${outputPath}`,
    );
    console.log(`Canonical production Cron retained separately: ${JSON.stringify(metadata.crons)}`);
    return 0;
  }

  if (command === "check") {
    const expected = expectedCronsFromFile(requiredOption(args, "expected-file"));
    const api = apiFromEnvironment(args);
    const result = await checkSchedules(api, expected);
    writeState(args["state-output"], result);
    console.log(`Cron schedules: ${JSON.stringify(result.actualCrons)}`);
    if (!result.exact) {
      console.error(
        `Cron mismatch: expected ${JSON.stringify(result.expected)}, actual ${JSON.stringify(
          result.actualCrons,
        )}.`,
      );
      return CRON_MISMATCH_EXIT_CODE;
    }
    console.log("Cron check: EXACT MATCH");
    return 0;
  }

  if (command === "reconcile") {
    const expected = expectedCronsFromFile(requiredOption(args, "expected-file"));
    const api = apiFromEnvironment(args);
    let result;
    try {
      result = await reconcileSchedules(api, expected);
    } catch (error) {
      if (error instanceof CronVerificationError) {
        writeState(args["state-output"], {
          operation: "FAILED",
          expected: error.expected,
          before: error.before,
          after: error.after,
          actualCrons: scheduleCrons(error.after),
          exact: false,
        });
      }
      throw error;
    }
    writeState(args["state-output"], {
      operation: result.operation,
      expected: result.expected,
      before: result.before,
      after: result.after,
      actualCrons: scheduleCrons(result.after),
      exact: true,
    });
    console.log(`Cron reconciliation: ${result.operation}`);
    console.log(`Cron schedules after: ${JSON.stringify(scheduleCrons(result.after))}`);
    return 0;
  }

  if (command === "worker-state") {
    const metadata = readJsonFile(requiredOption(args, "metadata-file"));
    const state = await getVerifiedWorkerState(apiFromEnvironment(args), metadata);
    writeState(args["state-output"], state);
    console.log(
      `Worker state verified: ${state.scriptName}, active version(s) ${JSON.stringify(
        state.activeVersionIds,
      )}, workers.dev disabled, custom domain ${state.customDomain}.`,
    );
    return 0;
  }

  if (command === "assert-version-unchanged") {
    const before = readJsonFile(requiredOption(args, "before"));
    const after = readJsonFile(requiredOption(args, "after"));
    assertWorkerVersionUnchanged(before, after);
    console.log("Worker active version unchanged: YES");
    return 0;
  }

  throw new Error(
    `Unknown command ${command}. Expected extract, prepare-deploy-config, check, reconcile, worker-state, or assert-version-unchanged.`,
  );
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!command) throw new Error("A command is required.");
  return runCommand(command, parseArgs(argv));
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const token = process.env.CLOUDFLARE_API_TOKEN;
      if (error instanceof CloudflareApiError) {
        if (error.status === 404 || error.codes.includes(10007)) {
          console.error(
            "Production credential/account mismatch: worker not found in configured GitHub production account.",
          );
        } else if (error.status === 401 || error.status === 403) {
          console.error(
            `Production Cloudflare credential cannot access the requested Worker API (${error.status}).`,
          );
        } else {
          console.error(redact(error.message, token));
        }
      } else {
        console.error(redact(errorMessage(error), token));
      }
      process.exitCode = 1;
    });
}
