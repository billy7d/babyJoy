import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseJsonc } from "../scripts/cloudflare-production-cron.mjs";
import {
  PRODUCTION_CUSTOM_DOMAIN,
  PRODUCTION_D1_DATABASE_ID,
  PRODUCTION_WORKER_SCRIPT_NAME,
  SHIPPING_MIGRATION_FILE,
  assertAuthoritativeCartSnapshot,
  buildShippingMigrationConfig,
  assertD1DatabaseIdentity,
  assertHistoryAggregateUnchanged,
  assertMigrationAllowlist,
  assertSchemaColumn,
  assertSingleActiveWorkerVersion,
  extractD1Rows,
  productionGateValue,
  setProductionGateValue,
  assertProductionDeploymentConfig,
} from "../scripts/production-shipping-rollout.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/production-rollout.yml", import.meta.url),
  "utf8",
);

function step(name: string) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  if (start < 0) throw new Error(`Workflow step not found: ${name}`);
  const next = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, next < 0 ? workflow.length : next);
}

describe("production rollout workflow safeguards", () => {
  it("exposes the three rollout modes and explicit confirmations", () => {
    expect(workflow).toContain("- prepare");
    expect(workflow).toContain("- enable_gate");
    expect(workflow).toContain("- repair_cron");
    expect(workflow).toContain("confirm_enable_gate:");
    expect(workflow).toContain("confirm_repair_cron:");
    expect(workflow).toContain("REPAIR_CRON");
    expect(workflow).toContain("- shipping_rollout");
    expect(workflow).toContain("confirm_shipping_rollout:");
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("ROLL_OUT_SHIPPING");
    expect(workflow).toContain("STOREFRONT_FINANCIAL_SMOKE_ACCESS_URL");
    expect(workflow).toContain("SHIPPING_FINANCIAL_SMOKE_CASES_JSON");
    expect(workflow).toContain("production-financial-smoke.mjs --validate");
    expect(workflow).toContain("production-financial-smoke.mjs --validate --production");
    expect(workflow).toContain("isolated-financial-smoke.mjs");
    expect(workflow).toContain("environment: production");
  });

  it("uses only explicit GitHub production credentials", () => {
    expect(workflow).toContain(
      "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    );
    expect(workflow).toContain(
      "CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    );
    expect(workflow).not.toContain("npx wrangler whoami");
    expect(workflow).not.toContain("GITHUB_ENV, `CLOUDFLARE_ACCOUNT_ID");
    expect(workflow).toContain('if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]');
    expect(workflow).toContain('if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]');
    expect(workflow).toContain("CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal");
  });

  it("keeps repair_cron away from application deployment operations", () => {
    expect(step("Install dependencies")).toContain("!= 'repair_cron'");
    expect(step("Run quality checks")).toContain("!= 'repair_cron'");
    expect(step("Apply production D1 migrations")).toContain("== 'prepare'");
    expect(step("Initialize storefront access secret if missing")).toContain(
      "== 'prepare'",
    );
    expect(step("Build resolved production deployment config")).toContain(
      "!= 'repair_cron'",
    );
    expect(step("Build resolved production deployment config")).toContain(
      "productionGateValue",
    );
    expect(step("Guard legacy prepare against shipping pricing rollout")).toContain(
      "migrations/0025_shipping_fee_v1.sql",
    );
    expect(workflow).toContain("setProductionGateValue");
    expect(workflow).not.toContain("content.replaceAll");
    expect(workflow).not.toContain("content = content.replace");
    expect(step("Create trigger-free Worker deployment config")).toContain(
      "!= 'repair_cron'",
    );
    expect(step("Validate trigger-free Wrangler deployment (dry run)")).toContain(
      "!= 'repair_cron'",
    );
    expect(step("Deploy production Worker")).toContain("!= 'repair_cron'");
    expect(step("Smoke test gate disabled")).toContain("== 'prepare'");
    expect(step("Smoke test gate enabled")).toContain("== 'enable_gate'");
    expect(workflow).not.toContain("workers_dev = true");
    expect(workflow).not.toContain("workers_dev=true");
    expect(workflow).not.toContain("workers dev enable");
  });

  it("deploys from a generated config with triggers omitted", () => {
    const deployStep = step("Deploy production Worker");
    expect(workflow).toContain("prepare-deploy-config");
    expect(workflow).toContain("build/server/wrangler.production-deploy.json");
    expect(deployStep).toContain(
      "--config build/server/wrangler.production-deploy.json",
    );
    expect(deployStep).toContain("--keep-vars");
    expect(deployStep).not.toContain("--env production");
    expect(workflow).not.toContain('"crons": []');
    expect(workflow).not.toMatch(/npx wrangler deploy[^\n]*\|\|\s*true/);
    expect(workflow).not.toContain("continue-on-error");
  });

  it("runs preflight, reconciliation, and final verification through the helper", () => {
    expect(workflow).toContain(
      "scripts/cloudflare-production-cron.mjs check",
    );
    expect(workflow).toContain(
      "scripts/cloudflare-production-cron.mjs reconcile",
    );
    expect(workflow).toContain("Cron API read preflight");
    expect(workflow).toContain("Verify production Cron exact state");
    expect(workflow).toContain("Verify production Worker routing and deployment state");
    expect(workflow).toContain("assert-version-unchanged");
    expect(workflow).toContain("$RUNNER_TEMP/babyjoy-production-crons.json");
    expect(workflow).toContain("$RUNNER_TEMP/babyjoy-production-metadata.json");
  });

  it("preflights the configured Worker before production mutations", () => {
    const preflight = workflow.indexOf("- name: Cron API read preflight");
    const migrations = workflow.indexOf("- name: Apply production D1 migrations");
    const secret = workflow.indexOf("- name: Initialize storefront access secret if missing");
    const deploy = workflow.indexOf("- name: Deploy production Worker");

    expect(preflight).toBeGreaterThan(-1);
    expect(migrations).toBeGreaterThan(preflight);
    expect(secret).toBeGreaterThan(preflight);
    expect(deploy).toBeGreaterThan(preflight);
  });

  it("chạy đủ bốn financial case trên Worker/D1 isolated trước mọi production mutation", () => {
    const isolatedSeed = workflow.indexOf("- name: Seed isolated D1 financial smoke fixture");
    const isolatedRun = workflow.indexOf("- name: Run full isolated financial smoke through Worker and D1");
    const d1Preflight = workflow.indexOf("- name: Read-only shipping D1 preflight");
    const backup = workflow.indexOf("- name: Create and verify full production D1 backup");
    const migration = workflow.indexOf("- name: Apply only allowlisted shipping migration");
    expect(isolatedSeed).toBeGreaterThan(-1);
    expect(isolatedRun).toBeGreaterThan(isolatedSeed);
    expect(d1Preflight).toBeGreaterThan(isolatedRun);
    expect(backup).toBeGreaterThan(isolatedRun);
    expect(migration).toBeGreaterThan(isolatedRun);
    expect(step("Seed isolated D1 financial smoke fixture")).toContain("npm run db:migrate:local");
    expect(step("Seed isolated D1 financial smoke fixture")).toContain("isolated-financial-smoke.mjs --seed");
    expect(step("Start isolated Worker against local D1")).toContain("npm run dev");
    expect(step("Run full isolated financial smoke through Worker and D1")).toContain(
      "isolated-financial-smoke.mjs --run",
    );
    expect(step("Clean isolated financial smoke fixture")).toContain("--cleanup");
  });

  it("keeps canonical production Cron and safety settings in wrangler.jsonc", () => {
    const config = parseJsonc(
      readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
      "wrangler.jsonc",
    ) as {
      env?: {
        production?: {
          triggers?: { crons?: string[] };
          workers_dev?: boolean;
          preview_urls?: boolean;
          routes?: Array<{ pattern?: string; custom_domain?: boolean }>;
        };
      };
    };
    expect(config.env?.production?.triggers?.crons).toEqual(["* * * * *"]);
    expect(config.env?.production?.workers_dev).toBe(false);
    expect(config.env?.production?.preview_urls).toBe(false);
    expect(config.env?.production?.routes).toContainEqual({
      pattern: "metraphuong.com",
      custom_domain: true,
    });
  });

  it("writes a secret-free deployment summary", () => {
    expect(workflow).toContain("$GITHUB_STEP_SUMMARY");
    expect(workflow).toContain("Production Rollout Summary");
    expect(workflow).toContain("Storefront Session Continuity");
    expect(workflow).toContain("Status: $continuity_status");
    expect(workflow).toContain("Worker deployment succeeded, but Cron reconciliation failed");
    expect(workflow).not.toContain("echo \"$CLOUDFLARE_API_TOKEN\"");
    expect(workflow).not.toContain("echo \"$CLOUDFLARE_ACCOUNT_ID\"");
  });

  it("đặt continuity smoke đúng trước và sau từng Worker deploy cần kiểm chứng", () => {
    expect(workflow).toContain(
      "STOREFRONT_SESSION_CONTINUITY_ACCESS_URL: ${{ secrets.STOREFRONT_SESSION_CONTINUITY_ACCESS_URL }}",
    );
    expect(workflow).toContain("storefront-session-continuity.mjs validate");
    expect(workflow).toContain("storefront-session-continuity.mjs validate --required");
    expect(workflow).toContain("storefront-session-continuity.mjs before");
    expect(workflow).toContain("storefront-session-continuity.mjs after");
    expect(workflow).toContain("storefront-session-continuity.mjs cleanup");

    const validate = workflow.indexOf("- name: Validate storefront session continuity preflight");
    const before = workflow.indexOf("- name: Create storefront continuity session before deploy");
    const compatibilityDeploy = workflow.indexOf("- name: Deploy rollback-compatible Worker before shipping migration");
    const compatibilityAfter = workflow.indexOf("- name: Verify old storefront session after compatibility deploy");
    const migration = workflow.indexOf("- name: Apply only allowlisted shipping migration");
    const finalDeploy = workflow.indexOf("- name: Deploy production Worker");
    const finalAfter = workflow.indexOf("- name: Verify old storefront session after final deploy");
    const summary = workflow.indexOf("- name: Write production rollout summary");
    const cleanup = workflow.indexOf("- name: Cleanup storefront session continuity fixture");
    expect(validate).toBeGreaterThan(-1);
    expect(before).toBeGreaterThan(validate);
    expect(compatibilityDeploy).toBeGreaterThan(before);
    expect(compatibilityAfter).toBeGreaterThan(compatibilityDeploy);
    expect(compatibilityAfter).toBeLessThan(migration);
    expect(finalAfter).toBeGreaterThan(finalDeploy);
    expect(finalAfter).toBeLessThan(summary);
    expect(cleanup).toBeGreaterThan(summary);
    expect(step("Cleanup storefront session continuity fixture")).toContain("always()");
    expect(step("Verify old storefront session after compatibility deploy")).toContain(
      "steps.session_continuity_validate.outputs.applicable == 'true'",
    );
    expect(step("Verify old storefront session after final deploy")).toContain(
      "steps.session_continuity_validate.outputs.applicable == 'true'",
    );
  });

  it("không in access URL hoặc cookie vào log continuity", () => {
    const script = readFileSync(
      new URL("../scripts/storefront-session-continuity.mjs", import.meta.url),
      "utf8",
    );
    expect(script).not.toMatch(/console\.log\([^\n]*(cookie|accessUrl|accessUrl)/i);
    expect(workflow).not.toContain("STOREFRONT_SESSION_CONTINUITY_ACCESS_URL\"");
    expect(workflow).not.toContain("Cookie:");
  });

  it("keeps the shipping sequence guarded and ordered", () => {
    const d1Preflight = workflow.indexOf("- name: Read-only shipping D1 preflight");
    const backup = workflow.indexOf("- name: Create and verify full production D1 backup");
    const compatibility = workflow.indexOf(
      "- name: Deploy rollback-compatible Worker before shipping migration",
    );
    const compatibilityCutover = workflow.indexOf(
      "- name: Verify no financial writes during compatibility cutover",
    );
    const migration = workflow.indexOf("- name: Apply only allowlisted shipping migration");
    const postMigration = workflow.indexOf("- name: Verify shipping schema and historical totals");
    const deploy = workflow.indexOf("- name: Deploy production Worker");
    const identity = workflow.indexOf("- name: Verify validated shipping deployment identity");
    expect(d1Preflight).toBeGreaterThan(-1);
    expect(backup).toBeGreaterThan(d1Preflight);
    expect(compatibility).toBeGreaterThan(backup);
    expect(compatibilityCutover).toBeGreaterThan(compatibility);
    expect(migration).toBeGreaterThan(compatibilityCutover);
    expect(postMigration).toBeGreaterThan(migration);
    expect(deploy).toBeGreaterThan(postMigration);
    expect(identity).toBeGreaterThan(deploy);

    const compatibilityStep = step(
      "Deploy rollback-compatible Worker before shipping migration",
    );
    expect(compatibilityStep).toContain("--keep-vars");
    expect(compatibilityStep).toContain("--strict");
    expect(compatibilityStep).toContain("shipping compatibility");
    expect(step("Apply only allowlisted shipping migration")).toContain(
      "npx wrangler d1 migrations apply babyjoy-db --remote --env production --config build/server/wrangler.shipping-migration.json",
    );
    expect(step("Recheck shipping migration allowlist immediately before apply")).toContain(
      "assertMigrationAllowlist",
    );
    expect(step("Persist tested shipping rollback artifact")).toContain(
      "SHIPPING_PRICING_NOT_READY",
    );
    expect(step("Persist tested shipping rollback artifact")).toContain(
      "npx wrangler rollback",
    );
    expect(step("Upload tested shipping rollback artifact")).toContain(
      "actions/upload-artifact@v4",
    );
    expect(step("Prepare shipping-only migration config")).toContain(
      "containing only ${SHIPPING_MIGRATION_FILE}",
    );
    expect(step("Create and verify full production D1 backup")).toContain(
      "d1 export babyjoy-db --remote --env production --config wrangler.jsonc",
    );
    expect(step("Persist production backup artifact outside Git")).toContain(
      "actions/upload-artifact@v4",
    );
    expect(step("Read-only shipping D1 preflight")).toContain(
      "assertMigrationAllowlist",
    );
    expect(step("Verify shipping schema and historical totals")).toContain(
      "nonzero_legacy_fee_count",
    );
    expect(step("Smoke test shipping financial pricing on compatibility Worker")).toContain(
      "production-financial-smoke.mjs",
    );
    expect(step("Smoke test shipping financial pricing on compatibility Worker")).toContain(
      "--production",
    );
    expect(step("Smoke test shipping financial pricing on final Worker")).toContain(
      "production-financial-smoke.mjs",
    );
    expect(step("Smoke test shipping financial pricing on final Worker")).toContain(
      "--production",
    );
  });

  it("passes the pre-migration history snapshot across shipping steps", () => {
    const preflight = step("Read-only shipping D1 preflight");
    const cutover = step("Verify no financial writes during compatibility cutover");
    const postMigration = step("Verify shipping schema and historical totals");

    expect(preflight).toContain('echo "history_path=$D1_HISTORY_PATH" >> "$GITHUB_OUTPUT"');
    expect(cutover).toContain(
      "D1_HISTORY_PATH: ${{ steps.shipping_d1_preflight.outputs.history_path }}",
    );
    expect(postMigration).toContain(
      "D1_HISTORY_PATH: ${{ steps.shipping_d1_preflight.outputs.history_path }}",
    );
  });

  it("validates the final artifact without changing access policy accidentally", () => {
    const source = parseJsonc(
      readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
      "wrangler.jsonc",
    ) as Record<string, unknown>;
    expect(assertProductionDeploymentConfig(source)).toBe(true);
    expect(productionGateValue(source)).toBe("true");
    expect(PRODUCTION_WORKER_SCRIPT_NAME).toBe("babyjoy-web-app-production");
    expect(PRODUCTION_CUSTOM_DOMAIN).toBe("metraphuong.com");
    expect(PRODUCTION_D1_DATABASE_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const prepare = setProductionGateValue(source, "false");
    expect(productionGateValue(prepare)).toBe("false");
    expect(productionGateValue(source)).toBe("true");
    expect(() => setProductionGateValue(source, "0" as never)).toThrow();
  });

  it("giới hạn config apply migration vào đúng D1 production và file 0025", () => {
    const source = parseJsonc(
      readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
      "wrangler.jsonc",
    ) as Record<string, any>;
    const migrationConfig = buildShippingMigrationConfig(source);
    expect(migrationConfig.main).toBe("./index.js");
    expect(migrationConfig.name).toBe(PRODUCTION_WORKER_SCRIPT_NAME);
    expect(migrationConfig.env.production.name).toBe(PRODUCTION_WORKER_SCRIPT_NAME);
    expect(migrationConfig.env.production.d1_databases).toEqual([
      expect.objectContaining({
        database_name: "babyjoy-db",
        database_id: PRODUCTION_D1_DATABASE_ID,
        migrations_dir: "shipping-migrations",
      }),
    ]);
    expect(() => buildShippingMigrationConfig(source, "../unsafe")).toThrow();
  });

  it("rejects a wrong production D1, migration, schema, or Worker state", () => {
    expect(() =>
      assertD1DatabaseIdentity(
        { result: { uuid: "wrong", name: "babyjoy-db" } },
        PRODUCTION_D1_DATABASE_ID,
        "babyjoy-db",
      ),
    ).toThrow();
    expect(() => assertMigrationAllowlist("0024_combo_compare_price_v1.sql")).toThrow();
    expect(assertMigrationAllowlist(`pending: ${SHIPPING_MIGRATION_FILE}`)).toEqual([
      SHIPPING_MIGRATION_FILE,
    ]);
    expect(assertSchemaColumn([{ name: "shipping_fee_vnd" }], "shipping_fee_vnd", true)).toBe(true);
    expect(() => assertSchemaColumn([], "shipping_fee_vnd", true)).toThrow();
    expect(() =>
      assertSingleActiveWorkerVersion({
        activeVersions: [{ versionId: "one", percentage: 50 }, { versionId: "two", percentage: 50 }],
      }),
    ).toThrow();
  });

  it("normalizes D1 envelopes and preserves financial invariants", () => {
    expect(
      extractD1Rows({
        success: true,
        result: { results: [{ shipping_fee_vnd: 15_000 }] },
      }),
    ).toEqual([{ shipping_fee_vnd: 15_000 }]);
    expect(() => extractD1Rows({ success: false, errors: [] })).toThrow();
    expect(
      assertHistoryAggregateUnchanged(
        [{ cart_count: 1, subtotal_sum: 100_000, discount_sum: 0, final_sum: 100_000 }],
        [{ cart_count: 1, subtotal_sum: 100_000, discount_sum: 0, final_sum: 100_000 }],
      ),
    ).toBe(true);
    expect(() =>
      assertHistoryAggregateUnchanged(
        [{ cart_count: 1, subtotal_sum: 100_000, discount_sum: 0, final_sum: 100_000 }],
        [{ cart_count: 1, subtotal_sum: 100_000, discount_sum: 0, final_sum: 115_000 }],
      ),
    ).toThrow();
    expect(
      assertAuthoritativeCartSnapshot({
        subtotal_vnd: 100_000,
        promotion_discount_vnd: 0,
        shipping_fee_vnd: 15_000,
        final_total_vnd: 115_000,
      }),
    ).toBe(true);
    expect(() =>
      assertAuthoritativeCartSnapshot({
        subtotal_vnd: 100_000,
        promotion_discount_vnd: 0,
        shipping_fee_vnd: 0,
        final_total_vnd: 100_000,
      }),
    ).not.toThrow();
  });
});
