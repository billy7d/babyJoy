import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  CloudflareApiError,
  CronVerificationError,
  checkSchedules,
  createCloudflareApi,
  createTriggerFreeDeployConfig,
  cronListsMatch,
  extractProductionDeploymentMetadata,
  getVerifiedWorkerState,
  normalizeCronList,
  parseJsonc,
  reconcileSchedules,
  assertWorkerVersionUnchanged,
} from "../scripts/cloudflare-production-cron.mjs";

const accountId = "a".repeat(32);
const scriptName = "babyjoy-web-app-production";
const expectedCron = ["* * * * *"];
const token = "test-production-token";

function apiResponse(result: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      errors: [],
      messages: [],
      result,
      success: status >= 200 && status < 300,
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

function apiError(status: number, code: number, message: string) {
  return new Response(
    JSON.stringify({
      errors: [{ code, message }],
      messages: [],
      result: null,
      success: false,
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

function createTestApi(fetchImpl: typeof fetch) {
  return createCloudflareApi({
    token,
    accountId,
    scriptName,
    fetchImpl,
    baseUrl: "https://api.example.test/client/v4",
  });
}

describe("production Cron comparison", () => {
  it("detects a missing Cron", () => {
    expect(cronListsMatch(expectedCron, [])).toBe(false);
  });

  it("accepts an exact Cron list", () => {
    expect(cronListsMatch(expectedCron, expectedCron)).toBe(true);
  });

  it("rejects an additional Cron", () => {
    expect(
      cronListsMatch(expectedCron, ["* * * * *", "0 * * * *"]),
    ).toBe(false);
  });

  it("rejects a different Cron", () => {
    expect(cronListsMatch(expectedCron, ["*/5 * * * *"])).toBe(false);
  });

  it("rejects duplicate actual Cron expressions", () => {
    expect(() => normalizeCronList(["* * * * *", "* * * * *"], "Actual Cron list"))
      .toThrow("duplicate");
  });
});

describe("production Cron API client", () => {
  it.each([401, 403])("fails safely for HTTP %s responses", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      apiError(status, 10000, `unauthorized ${token}`),
    );
    const api = createTestApi(fetchImpl);

    const error = await api.getSchedules().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CloudflareApiError);
    expect(error).toMatchObject({ status });
    expect(String((error as Error).message)).not.toContain(token);
  });

  it("requires both production credentials without implicit discovery", () => {
    expect(() =>
      createCloudflareApi({ token: undefined, accountId, scriptName }),
    ).toThrow("CLOUDFLARE_API_TOKEN is required");
    expect(() =>
      createCloudflareApi({ token, accountId: undefined, scriptName }),
    ).toThrow("CLOUDFLARE_ACCOUNT_ID is required");
  });

  it("addresses the configured account and Worker script exactly", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      apiResponse({ schedules: [{ cron: "* * * * *" }] }),
    );
    const api = createTestApi(fetchImpl);

    await api.getSchedules();

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/schedules`,
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${token}`,
    });
  });

  it("lists custom domains through the account-level Workers Domains API", async () => {
    const domains = [
      { hostname: "metraphuong.com", service: scriptName },
    ];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      apiResponse(domains),
    );
    const api = createTestApi(fetchImpl);

    await expect(api.listWorkerDomains()).resolves.toEqual(domains);

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/client/v4/accounts/${accountId}/workers/domains?service=${scriptName}`,
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it.each([401, 403])("fails safely for a custom domain HTTP %s response", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      apiError(status, 10000, `unauthorized ${token}`),
    );
    const api = createTestApi(fetchImpl);

    const error = await api.listWorkerDomains().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CloudflareApiError);
    expect(error).toMatchObject({ status });
    expect(String((error as Error).message)).not.toContain(token);
  });

  it("requires success=true and a JSON array for custom domain responses", async () => {
    const unsuccessfulResponse = new Response(
      JSON.stringify({
        errors: [{ code: 1000, message: "request failed" }],
        messages: [],
        result: [],
        success: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(unsuccessfulResponse);
    const api = createTestApi(fetchImpl);

    await expect(api.listWorkerDomains()).rejects.toBeInstanceOf(CloudflareApiError);

    fetchImpl.mockResolvedValueOnce(apiResponse({ domains: [] }));
    await expect(api.listWorkerDomains()).rejects.toThrow(
      "non-array Worker domains value",
    );
  });

  it("rejects malformed custom domain records", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      apiResponse([{ hostname: "metraphuong.com" }]),
    );
    const api = createTestApi(fetchImpl);

    await expect(api.listWorkerDomains()).rejects.toThrow(
      "invalid Worker domain",
    );
  });

  it("fails safely for a missing Worker/10007 response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      apiError(404, 10007, "Worker not found"),
    );
    const api = createTestApi(fetchImpl);

    const error = await api.getSchedules().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CloudflareApiError);
    expect(error).toMatchObject({ status: 404, codes: [10007] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses GET schedules and never attempts PUT for a wrong account", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      apiError(404, 10007, "Worker not found"),
    );
    const api = createTestApi(fetchImpl);

    await expect(reconcileSchedules(api, expectedCron)).rejects.toBeInstanceOf(
      CloudflareApiError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("reconciles by PUTing the complete expected list and reading it back", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse({ schedules: [] }))
      .mockResolvedValueOnce(
        apiResponse({ schedules: [{ cron: "* * * * *" }] }),
      )
      .mockResolvedValueOnce(
        apiResponse({ schedules: [{ cron: "* * * * *" }] }),
      );
    const api = createTestApi(fetchImpl);

    const result = await reconcileSchedules(api, expectedCron);

    expect(result.operation).toBe("UPDATED");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("PUT");
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual([
      { cron: "* * * * *" },
    ]);
  });

  it("is a no-op when schedules already match", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        apiResponse({
          schedules: [
            {
              cron: "* * * * *",
              created_on: "2026-09-01T00:00:00Z",
              modified_on: "2026-09-01T00:00:00Z",
            },
          ],
        }),
      );
    const api = createTestApi(fetchImpl);

    const result = await reconcileSchedules(api, expectedCron);

    expect(result.operation).toBe("NO-OP");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails when the final GET still differs", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse({ schedules: [] }))
      .mockResolvedValueOnce(
        apiResponse({ schedules: [{ cron: "*/5 * * * *" }] }),
      )
      .mockResolvedValueOnce(
        apiResponse({ schedules: [{ cron: "*/5 * * * *" }] }),
      );
    const api = createTestApi(fetchImpl);

    await expect(reconcileSchedules(api, expectedCron)).rejects.toBeInstanceOf(
      CronVerificationError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails when the PUT API request fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse({ schedules: [] }))
      .mockResolvedValueOnce(apiError(500, 1000, "update failed"));
    const api = createTestApi(fetchImpl);

    await expect(reconcileSchedules(api, expectedCron)).rejects.toBeInstanceOf(
      CloudflareApiError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns mismatch data from check without mutating", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      apiResponse({ schedules: [] }),
    );
    const api = createTestApi(fetchImpl);

    const result = await checkSchedules(api, expectedCron);

    expect(result).toMatchObject({ expected: expectedCron, actualCrons: [], exact: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("GET");
  });
});

describe("production config contract", () => {
  it("extracts the production Cron from canonical wrangler.jsonc", () => {
    const config = parseJsonc(
      readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
      "wrangler.jsonc",
    );
    const metadata = extractProductionDeploymentMetadata(config, {
      scriptName,
    });

    expect(metadata.crons).toEqual(expectedCron);
    expect(metadata.workersDev).toBe(false);
    expect(metadata.previewUrls).toBe(false);
    expect(metadata.customDomain).toBe("metraphuong.com");
    expect(metadata.scriptName).toBe(scriptName);
  });

  it("supports JSONC comments and trailing commas", () => {
    const metadata = extractProductionDeploymentMetadata(
      parseJsonc(`
        {
          "name": "babyjoy-web-app",
          "env": {
            "production": {
              "workers_dev": false,
              "preview_urls": false,
              "triggers": { "crons": ["* * * * *",], },
              "routes": [{ "pattern": "metraphuong.com", "custom_domain": true, }],
            },
          },
        }
      `),
      { scriptName },
    );

    expect(metadata.crons).toEqual(expectedCron);
  });

  it("creates a deploy config with triggers and Cron keys absent", () => {
    const generatedConfig = {
      configPath: "/repo/wrangler.jsonc",
      userConfigPath: "/repo/wrangler.jsonc",
      topLevelName: "babyjoy-web-app",
      definedEnvironments: ["production"],
      targetEnvironment: "production",
      name: scriptName,
      main: "index.js",
      triggers: { crons: expectedCron },
      workers_dev: false,
      preview_urls: false,
      routes: [{ pattern: "metraphuong.com", custom_domain: true }],
      vars: { STOREFRONT_ACCESS_GATE_ENABLED: "true" },
      d1_databases: [{ binding: "DB", database_name: "babyjoy-db" }],
      r2_buckets: [{ binding: "PRODUCT_IMAGES", bucket_name: "images" }],
    };

    const { config } = createTriggerFreeDeployConfig(generatedConfig, expectedCron);

    expect(config).not.toHaveProperty("triggers");
    expect(config).not.toHaveProperty("crons");
    expect(JSON.stringify(config)).not.toContain('"crons": []');
    expect(config).toMatchObject({
      name: scriptName,
      workers_dev: false,
      preview_urls: false,
      routes: [{ pattern: "metraphuong.com", custom_domain: true }],
      d1_databases: [{ binding: "DB" }],
      r2_buckets: [{ binding: "PRODUCT_IMAGES" }],
    });
  });
});

type WorkerStateOverrides = {
  deployments?: unknown[];
  subdomain?: {
    enabled: boolean;
    previews_enabled: boolean;
  };
  domains?: unknown[];
};

function createWorkerStateApi({
  deployments = [
    {
      id: "deployment-1",
      created_on: "2026-09-01T00:00:00Z",
      versions: [{ percentage: 100, version_id: "version-1" }],
    },
  ],
  subdomain = {
    enabled: false,
    previews_enabled: false,
  },
  domains = [
    { hostname: "metraphuong.com", service: scriptName },
  ],
}: WorkerStateOverrides = {}) {
  return {
    getDeployments: vi.fn().mockResolvedValue(deployments),
    getSubdomain: vi.fn().mockResolvedValue(subdomain),
    listWorkerDomains: vi.fn().mockResolvedValue(domains),
  };
}

describe("production Worker safety verification", () => {
  it("verifies disabled workers.dev, custom domain, and 100% active version", async () => {
    const api = createWorkerStateApi();

    const state = await getVerifiedWorkerState(api, {
      scriptName,
      customDomain: "metraphuong.com",
    });

    expect(state).toMatchObject({
      scriptName,
      customDomain: "metraphuong.com",
      workersDev: false,
      previewUrls: false,
      activeVersionIds: ["version-1"],
    });
    expect(api.listWorkerDomains).toHaveBeenCalledTimes(1);
    expect(assertWorkerVersionUnchanged(state, { activeVersionIds: ["version-1"] })).toBe(true);
  });

  it("does not inspect List Scripts routes when verifying a Worker", async () => {
    const api = {
      ...createWorkerStateApi(),
      listScripts: vi.fn().mockResolvedValue([{ id: scriptName }]),
    };

    await expect(
      getVerifiedWorkerState(api, {
        scriptName,
        customDomain: "metraphuong.com",
      }),
    ).resolves.toMatchObject({
      scriptName,
      customDomain: "metraphuong.com",
    });
    expect(api.listScripts).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", []],
    ["another Worker", [{ hostname: "metraphuong.com", service: "other-worker" }]],
    ["another hostname", [{ hostname: "other.example.com", service: scriptName }]],
  ])("fails when the custom domain response is %s", async (_label, domains) => {
    await expect(
      getVerifiedWorkerState(createWorkerStateApi({ domains }), {
        scriptName,
        customDomain: "metraphuong.com",
      }),
    ).rejects.toThrow(
      "Custom domain verification failed: metraphuong.com is not attached to babyjoy-web-app-production.",
    );
  });

  it("fails when workers.dev is enabled", async () => {
    await expect(
      getVerifiedWorkerState(
        createWorkerStateApi({
          subdomain: { enabled: true, previews_enabled: false },
        }),
        { scriptName, customDomain: "metraphuong.com" },
      ),
    ).rejects.toThrow("subdomain verification failed");
  });

  it("fails when preview URLs are enabled", async () => {
    await expect(
      getVerifiedWorkerState(
        createWorkerStateApi({
          subdomain: { enabled: false, previews_enabled: true },
        }),
        { scriptName, customDomain: "metraphuong.com" },
      ),
    ).rejects.toThrow("subdomain verification failed");
  });

  it("fails when the active Worker deployment does not serve 100% traffic", async () => {
    await expect(
      getVerifiedWorkerState(
        createWorkerStateApi({
          deployments: [
            {
              versions: [{ percentage: 99, version_id: "version-1" }],
            },
          ],
        }),
        { scriptName, customDomain: "metraphuong.com" },
      ),
    ).rejects.toThrow("does not serve 100% traffic");
  });
});
