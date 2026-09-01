import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseJsonc } from "../scripts/cloudflare-production-cron.mjs";

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
    expect(step("Force gate disabled for prepare deploy")).toContain(
      "== 'prepare'",
    );
    expect(step("Enable gate in deployment config")).toContain(
      "== 'enable_gate'",
    );
    expect(step("Build resolved production deployment config")).toContain(
      "!= 'repair_cron'",
    );
    expect(step("Build resolved production deployment config")).toContain(
      "STOREFRONT_ACCESS_GATE_ENABLED",
    );
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
      "npx wrangler deploy --config build/server/wrangler.production-deploy.json",
    );
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
    expect(workflow).toContain("Worker deployment succeeded, but Cron reconciliation failed");
    expect(workflow).not.toContain("echo \"$CLOUDFLARE_API_TOKEN\"");
    expect(workflow).not.toContain("echo \"$CLOUDFLARE_ACCOUNT_ID\"");
  });
});
