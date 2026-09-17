import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertSmokeResult } from "./production-financial-smoke.mjs";

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const BASE_URL = process.env.BABYJOY_BASE_URL ?? "http://127.0.0.1:5173";
const FIXTURE_PREFIX = "isolated-financial-smoke";

const ids = {
  noPromoProduct: `${FIXTURE_PREFIX}-no-promo-product`,
  noPromoVariant: `${FIXTURE_PREFIX}-no-promo-variant`,
  realizedProduct: `${FIXTURE_PREFIX}-realized-product`,
  realizedVariant: `${FIXTURE_PREFIX}-realized-variant`,
  giftTriggerProduct: `${FIXTURE_PREFIX}-gift-trigger-product`,
  giftTriggerVariant: `${FIXTURE_PREFIX}-gift-trigger-variant`,
  giftProduct: `${FIXTURE_PREFIX}-gift-product`,
  giftVariant: `${FIXTURE_PREFIX}-gift-variant`,
  freeShippingProduct: `${FIXTURE_PREFIX}-free-shipping-product`,
  freeShippingVariant: `${FIXTURE_PREFIX}-free-shipping-variant`,
  realizedPromotion: `${FIXTURE_PREFIX}-realized-promotion`,
  giftPromotion: `${FIXTURE_PREFIX}-gift-promotion`,
  freeShippingPromotion: `${FIXTURE_PREFIX}-free-shipping-promotion`,
};

export const ISOLATED_SMOKE_CASES = {
  noPromo: [{ variantId: ids.noPromoVariant, quantity: 1 }],
  realized: [{ variantId: ids.realizedVariant, quantity: 1 }],
  giftOnly: [{ variantId: ids.giftTriggerVariant, quantity: 1 }],
  freeShipping: [{ variantId: ids.freeShippingVariant, quantity: 2 }],
};

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function promotionRow(id, name, type, config, createdAt) {
  return `INSERT INTO promotions (
    id, name, description, type, status, priority, stackable,
    starts_at, ends_at, usage_limit_total, usage_limit_per_customer,
    usage_count_total, config_json, archived_at, deleted_at, created_at, updated_at
  ) VALUES (
    ${sql(id)}, ${sql(name)}, ${sql("Isolated financial smoke fixture")}, ${sql(type)},
    'ACTIVE', 100, 0, NULL, NULL, NULL, NULL, 0, ${sql(JSON.stringify(config))},
    NULL, NULL, ${sql(createdAt)}, ${sql(createdAt)}
  );`;
}

export function buildFixtureSql() {
  const createdAt = new Date().toISOString();
  const products = [
    [ids.noPromoProduct, "Isolated no-promo product", ids.noPromoVariant, "No promo", 100_000],
    [ids.realizedProduct, "Isolated realized discount product", ids.realizedVariant, "Discount line", 120_000],
    [ids.giftTriggerProduct, "Isolated gift trigger product", ids.giftTriggerVariant, "Gift trigger", 120_000],
    [ids.giftProduct, "Isolated gift product", ids.giftVariant, "Gift", 50_000],
    [ids.freeShippingProduct, "Isolated free-shipping product", ids.freeShippingVariant, "Free shipping", 50_000],
  ];
  const statements = [
    `DELETE FROM promotions WHERE id LIKE '${FIXTURE_PREFIX}-%';`,
    `DELETE FROM product_categories WHERE product_id LIKE '${FIXTURE_PREFIX}-%';`,
    `DELETE FROM product_variants WHERE id LIKE '${FIXTURE_PREFIX}-%';`,
    `DELETE FROM products WHERE id LIKE '${FIXTURE_PREFIX}-%';`,
    ...products.map(
      ([productId, productName]) =>
        `INSERT INTO products (id, name, slug, status, featured, sort_order)
         VALUES (${sql(productId)}, ${sql(productName)}, ${sql(productId)}, 'AVAILABLE', 0, 900);`,
    ),
    ...products.map(
      ([productId, , variantId, variantName, priceVnd]) =>
        `INSERT INTO product_variants (id, product_id, name, sku, price_vnd, availability, sort_order)
         VALUES (${sql(variantId)}, ${sql(productId)}, ${sql(variantName)}, ${sql(variantId)}, ${priceVnd}, 'AVAILABLE', 1);`,
    ),
    promotionRow(
      ids.realizedPromotion,
      "Isolated realized discount",
      "PRODUCT_DISCOUNT",
      {
        type: "PRODUCT_DISCOUNT",
        productIds: [ids.realizedProduct],
        reward: { kind: "FIXED", amount: 30_000 },
      },
      createdAt,
    ),
    promotionRow(
      ids.giftPromotion,
      "Isolated gift-only reward",
      "BUY_X_GET_Y",
      {
        type: "BUY_X_GET_Y",
        triggerProductId: ids.giftTriggerProduct,
        requiredQuantity: 1,
        rewardProductId: ids.giftProduct,
        rewardQuantity: 1,
        allowRepeatedApplications: false,
      },
      createdAt,
    ),
    promotionRow(
      ids.freeShippingPromotion,
      "Isolated free shipping reward",
      "QUANTITY_DISCOUNT",
      {
        type: "QUANTITY_DISCOUNT",
        requiredQuantity: 2,
        scope: "SELECTED_PRODUCTS",
        productIds: [ids.freeShippingProduct],
        reward: { kind: "FREE_SHIPPING" },
        allowRepeatedApplications: false,
      },
      createdAt,
    ),
  ];
  // D1 local không cho BEGIN trong lệnh execute; runner này vẫn cô lập bằng prefix và cleanup deterministic.
  return statements.join("\n");
}

async function executeLocal(sqlCommand) {
  const wranglerCli = require.resolve("wrangler");
  try {
    await execFile(
      process.execPath,
      [
        wranglerCli,
        "d1",
        "execute",
        "babyjoy-db",
        "--local",
        "--config",
        "wrangler.jsonc",
        "--command",
        sqlCommand,
        "--yes",
      ],
      {
        cwd: process.cwd(),
        maxBuffer: 4 * 1024 * 1024,
      },
    );
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`Không thể thao tác D1 isolated local: ${error}`);
  }
}

export async function seedIsolatedFinancialSmoke() {
  // Fixture chỉ chạy trên D1 local của runner; tuyệt đối không nhận database production.
  await executeLocal(buildFixtureSql());
  console.log("Isolated financial smoke fixture seeded in local D1.");
}

export async function cleanupIsolatedFinancialSmoke() {
  await executeLocal(`DELETE FROM promotions WHERE id LIKE '${FIXTURE_PREFIX}-%';
DELETE FROM product_categories WHERE product_id LIKE '${FIXTURE_PREFIX}-%';
DELETE FROM product_variants WHERE id LIKE '${FIXTURE_PREFIX}-%';
DELETE FROM products WHERE id LIKE '${FIXTURE_PREFIX}-%';
`);
  console.log("Isolated financial smoke fixture removed from local D1.");
}

export async function runIsolatedFinancialSmoke(baseUrl = BASE_URL) {
  const results = {};
  for (const [caseName, items] of Object.entries(ISOLATED_SMOKE_CASES)) {
    const response = await fetch(`${baseUrl}/api/cart/evaluate`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(`Isolated ${caseName} financial smoke returned HTTP ${response.status}.`);
    results[caseName] = assertSmokeResult(caseName, body);
    const result = results[caseName];
    console.log(
      `Isolated financial smoke ${caseName}: subtotal=${result.subtotal}, discount=${result.discount}, shipping=${result.shipping}, final=${result.finalTotal}`,
    );
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.includes("--seed")) {
    await seedIsolatedFinancialSmoke();
  } else if (process.argv.includes("--cleanup")) {
    await cleanupIsolatedFinancialSmoke();
  } else if (process.argv.includes("--run")) {
    await runIsolatedFinancialSmoke();
  } else {
    throw new Error("Dùng --seed, --run hoặc --cleanup cho isolated financial smoke.");
  }
}
