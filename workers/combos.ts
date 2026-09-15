import {
  validateComboConfig,
  type ComboConfig,
  type ComboGroup,
  type ComboGroupItem,
  type ComboGroupMode,
  type ComboSelectionType,
} from "../shared/combos";
import { getPublicImageUrl } from "../shared/images";
import { hasInventorySchema } from "./inventory";
import { hasVariantMediaSchema } from "./variant-media";

type ComboConfigRow = {
  productId: string;
  groupMode: ComboGroupMode;
  configVersion: number;
  compareAtPriceVnd: number | null;
  configCreatedAt: string;
  configUpdatedAt: string;
};

type ComboGroupRow = {
  groupId: string;
  comboProductId: string;
  groupName: string;
  groupDescription: string;
  selectionType: ComboSelectionType;
  minSelect: number;
  maxSelect: number;
  groupDisplayOrder: number;
  groupCreatedAt: string;
  groupUpdatedAt: string;
  itemId: string | null;
  variantId: string | null;
  fixedQuantity: number | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  priceAdjustment: number | null;
  itemDisplayOrder: number | null;
  productId: string | null;
  productName: string | null;
  variantName: string | null;
  packageSize: string | null;
  sku: string | null;
  availability: string | null;
  trackInventory: number | null;
  stockOnHand: number | null;
  reservedQuantity: number | null;
  imageKey: string | null;
};

export type ComboRevalidationResult = {
  productId: string;
  valid: boolean;
  errors: string[];
};

export async function hasComboSchema(env: Env) {
  try {
    const [table, typeColumn, priceColumn, comparePriceColumn] = await Promise.all([
      env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'combo_configs'",
      ).first<{ name: string }>(),
      env.DB.prepare(
        "SELECT name FROM pragma_table_info('products') WHERE name = 'product_type'",
      ).first<{ name: string }>(),
      env.DB.prepare(
        "SELECT name FROM pragma_table_info('products') WHERE name = 'base_price_vnd'",
      ).first<{ name: string }>(),
      env.DB.prepare(
        "SELECT name FROM pragma_table_info('combo_configs') WHERE name = 'compare_at_price_vnd'",
      ).first<{ name: string }>(),
    ]);
    return Boolean(
      table?.name &&
      typeColumn?.name &&
      priceColumn?.name &&
      comparePriceColumn?.name
    );
  } catch {
    return false;
  }
}

export async function hasProductTypeSchema(env: Env) {
  try {
    const column = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('products') WHERE name = 'product_type'",
    ).first<{ name: string }>();
    return Boolean(column?.name);
  } catch {
    return false;
  }
}

function safeNumber(value: unknown, fallback = 0) {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && !value.trim())
  )
    return fallback;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function comboError(message: string) {
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: "VALIDATION_ERROR", message },
    }),
    { status: 422, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
  );
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function error(code: string, message: string, status: number, details?: unknown) {
  return json({ success: false, error: { code, message, details } }, status);
}

async function readJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 512 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 512 * 1024)
    throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(text) as unknown;
}

function mapConfigRows(config: ComboConfigRow, rows: ComboGroupRow[]) {
  const groups = new Map<string, ComboGroup>();
  for (const row of rows) {
    let group = groups.get(row.groupId);
    if (!group) {
      group = {
        id: row.groupId,
        comboProductId: row.comboProductId,
        name: row.groupName,
        description: row.groupDescription,
        selectionType: row.selectionType,
        minSelect: row.minSelect,
        maxSelect: row.maxSelect,
        displayOrder: row.groupDisplayOrder,
        items: [],
      };
      groups.set(row.groupId, group);
    }
    if (!row.itemId || !row.variantId) continue;
    const availableQuantity = row.trackInventory
      ? Math.max(0, Number(row.stockOnHand ?? 0) - Number(row.reservedQuantity ?? 0))
      : null;
    const item: ComboGroupItem = {
      id: row.itemId,
      groupId: row.groupId,
      variantId: row.variantId,
      fixedQuantity: Number(row.fixedQuantity ?? 0),
      minQuantity: Number(row.minQuantity ?? 0),
      maxQuantity: Number(row.maxQuantity ?? 0),
      priceAdjustment: Number(row.priceAdjustment ?? 0),
      displayOrder: Number(row.itemDisplayOrder ?? 0),
      productId: row.productId ?? undefined,
      productName: row.productName ?? undefined,
      variantName: row.variantName
        ? `${row.variantName}${row.packageSize ? ` · ${row.packageSize}` : ""}`
        : undefined,
      sku: row.sku,
      imageKey: row.imageKey,
      availableQuantity,
      availability: row.availability ?? undefined,
    };
    group.items.push(item);
  }
  return {
    productId: config.productId,
    groupMode: config.groupMode,
    configVersion: Number(config.configVersion),
    compareAtPriceVnd:
      config.compareAtPriceVnd == null ? null : Number(config.compareAtPriceVnd),
    createdAt: config.configCreatedAt,
    updatedAt: config.configUpdatedAt,
    groups: [...groups.values()]
      .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id))
      .map((group) => ({
        ...group,
        items: group.items.sort(
          (a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id),
        ),
      })),
  } satisfies ComboConfig;
}

export async function getComboConfig(
  productId: string,
  env: Env,
): Promise<ComboConfig | null> {
  if (!(await hasComboSchema(env))) return null;
  const config = await env.DB.prepare(
    `SELECT product_id AS productId, group_mode AS groupMode,
       config_version AS configVersion,
       compare_at_price_vnd AS compareAtPriceVnd,
       created_at AS configCreatedAt, updated_at AS configUpdatedAt
     FROM combo_configs WHERE product_id = ?`,
  )
    .bind(productId)
    .first<ComboConfigRow>();
  if (!config) return null;
  const variantMediaSchema = await hasVariantMediaSchema(env);
  const inventorySchema = await hasInventorySchema(env);
  const imageSelect = variantMediaSchema
    ? `COALESCE(
         (SELECT r2_key FROM product_variant_images pvi
          WHERE pvi.variant_id = v.id
          ORDER BY pvi.is_primary DESC, pvi.sort_order, pvi.created_at, pvi.id LIMIT 1),
         (SELECT r2_key FROM product_images pi
          WHERE pi.product_id = v.product_id
          ORDER BY pi.sort_order, pi.created_at, pi.id LIMIT 1)
       )`
    : `(SELECT r2_key FROM product_images pi
        WHERE pi.product_id = v.product_id
        ORDER BY pi.sort_order, pi.created_at, pi.id LIMIT 1)`;
  const packageSelect = variantMediaSchema ? "v.package_size" : "''";
  const inventorySelect = inventorySchema
    ? "v.track_inventory, v.stock_on_hand, v.reserved_quantity"
    : "0, 0, 0";
  const rows = await env.DB.prepare(
    `SELECT g.id AS groupId, g.combo_product_id AS comboProductId,
       g.name AS groupName, g.description AS groupDescription,
       g.selection_type AS selectionType, g.min_select AS minSelect,
       g.max_select AS maxSelect, g.display_order AS groupDisplayOrder,
       g.created_at AS groupCreatedAt, g.updated_at AS groupUpdatedAt,
       i.id AS itemId, i.variant_id AS variantId, i.fixed_quantity AS fixedQuantity,
       i.min_quantity AS minQuantity, i.max_quantity AS maxQuantity,
       i.price_adjustment AS priceAdjustment, i.display_order AS itemDisplayOrder,
       v.product_id AS productId, p.name AS productName, v.name AS variantName,
       ${packageSelect} AS packageSize, v.sku, v.availability,
       ${inventorySelect}, ${imageSelect} AS imageKey
     FROM combo_groups g
     LEFT JOIN combo_group_items i ON i.group_id = g.id
     LEFT JOIN product_variants v ON v.id = i.variant_id
     LEFT JOIN products p ON p.id = v.product_id
     WHERE g.combo_product_id = ?
     ORDER BY g.display_order, g.id, i.display_order, i.id`,
  )
    .bind(productId)
    .all<ComboGroupRow>();
  return mapConfigRows(config, rows.results);
}

export async function getComboConfigs(
  productIds: string[],
  env: Env,
) {
  const map = new Map<string, ComboConfig>();
  if (!productIds.length || !(await hasComboSchema(env))) return map;
  await Promise.all(
    [...new Set(productIds)].map(async (productId) => {
      const config = await getComboConfig(productId, env);
      if (config) map.set(productId, config);
    }),
  );
  return map;
}

function normalizeGroupInput(
  raw: Record<string, unknown>,
  productId: string,
  index: number,
): ComboGroup {
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : crypto.randomUUID(),
    comboProductId: productId,
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    selectionType: raw.selectionType as ComboSelectionType,
    minSelect: safeNumber(raw.minSelect),
    maxSelect: safeNumber(raw.maxSelect),
    displayOrder: safeNumber(raw.displayOrder, index),
    items: rawItems.map((item, itemIndex) => {
      const value = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : crypto.randomUUID(),
        groupId: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "",
        variantId: typeof value.variantId === "string" ? value.variantId.trim() : "",
        fixedQuantity: safeNumber(value.fixedQuantity),
        minQuantity: safeNumber(value.minQuantity, 1),
        maxQuantity: safeNumber(value.maxQuantity, 1),
        priceAdjustment: safeNumber(value.priceAdjustment),
        displayOrder: safeNumber(value.displayOrder, itemIndex),
      } satisfies ComboGroupItem;
    }),
  };
}

function normalizeConfigInput(value: unknown, productId: string, version: number): ComboConfig {
  if (!value || typeof value !== "object")
    throw new Error("CONFIG_REQUIRED");
  const raw = value as Record<string, unknown>;
  const groupMode = raw.groupMode as ComboGroupMode;
  const compareAtPriceVnd =
    raw.compareAtPriceVnd === null ||
    raw.compareAtPriceVnd === undefined ||
    (typeof raw.compareAtPriceVnd === "string" && !raw.compareAtPriceVnd.trim())
      ? null
      : Number(raw.compareAtPriceVnd);
  const groups = Array.isArray(raw.groups)
    ? raw.groups.map((group, index) =>
        normalizeGroupInput(
          group && typeof group === "object" ? (group as Record<string, unknown>) : {},
          productId,
          index,
        ),
      )
    : [];
  groups.forEach((group) => group.items.forEach((item) => (item.groupId = group.id)));
  return {
    productId,
    groupMode,
    configVersion: version,
    compareAtPriceVnd,
    groups,
  };
}

async function verifyComboProduct(productId: string, env: Env) {
  if (!(await hasComboSchema(env)))
    return error("COMBO_SCHEMA_UNAVAILABLE", "Cấu hình Combo chưa sẵn sàng trên cơ sở dữ liệu.", 409);
  const product = await env.DB.prepare(
    "SELECT id, product_type AS productType FROM products WHERE id = ?",
  )
    .bind(productId)
    .first<{ id: string; productType: string }>();
  if (!product) return error("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.", 404);
  if (product.productType !== "COMBO")
    return error("PRODUCT_NOT_COMBO", "Sản phẩm này không phải Combo.", 409);
  return null;
}

async function verifyVariantMemberships(groups: ComboGroup[], env: Env) {
  const variantIds = [...new Set(groups.flatMap((group) => group.items.map((item) => item.variantId)))];
  if (!variantIds.length) return null;
  const rows = await env.DB.prepare(
    `SELECT v.id, p.product_type AS productType
     FROM product_variants v JOIN products p ON p.id = v.product_id
     WHERE v.id IN (${variantIds.map(() => "?").join(",")})`,
  )
    .bind(...variantIds)
    .all<{ id: string; productType: string }>();
  const found = new Map(rows.results.map((row) => [row.id, row]));
  const invalid = variantIds.filter((id) => !found.has(id) || found.get(id)?.productType === "COMBO");
  return invalid.length
    ? error("INVALID_COMBO_VARIANT", "Mỗi Combo Item phải tham chiếu Variant của Product thường.", 422, { variantIds: invalid })
    : null;
}

export async function validateAdminComboConfigInput(
  value: unknown,
  productId: string,
  env: Env,
  version = 1,
) {
  let config: ComboConfig;
  try {
    config = normalizeConfigInput(value, productId, version);
  } catch {
    return {
      config: null,
      response: comboError("Cấu hình Combo chưa hợp lệ."),
    } as const;
  }
  const validation = validateComboConfig(config);
  if (!validation.ok)
    return {
      config: null,
      response: comboError(validation.errors[0] ?? "Cấu hình Combo chưa hợp lệ."),
    } as const;
  const membershipError = await verifyVariantMemberships(config.groups, env);
  if (membershipError)
    return { config: null, response: membershipError } as const;
  return { config, response: null } as const;
}

export async function saveAdminComboConfig(
  request: Request,
  productId: string,
  env: Env,
) {
  const productError = await verifyComboProduct(productId, env);
  if (productError) return productError;
  let raw: unknown;
  try {
    raw = await readJson(request);
  } catch {
    return comboError("Cấu hình Combo chưa hợp lệ.");
  }
  const current = await env.DB.prepare(
    "SELECT config_version AS configVersion FROM combo_configs WHERE product_id = ?",
  )
    .bind(productId)
    .first<{ configVersion: number }>();
  const version = Number(current?.configVersion ?? 0) + 1;
  const prepared = await validateAdminComboConfigInput(raw, productId, env, version);
  if (prepared.response) return prepared.response;
  const config = prepared.config;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO combo_configs (
         product_id, group_mode, config_version, compare_at_price_vnd,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET group_mode = excluded.group_mode,
         config_version = excluded.config_version,
         compare_at_price_vnd = excluded.compare_at_price_vnd,
         updated_at = excluded.updated_at`,
    ).bind(
      productId,
      config.groupMode,
      version,
      config.compareAtPriceVnd ?? null,
      now,
      now,
    ),
    env.DB.prepare("DELETE FROM combo_groups WHERE combo_product_id = ?").bind(productId),
  ];
  for (const group of config.groups) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO combo_groups (
          id, combo_product_id, name, description, selection_type, min_select,
          max_select, display_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        group.id,
        productId,
        group.name,
        group.description,
        group.selectionType,
        group.minSelect,
        group.maxSelect,
        group.displayOrder,
        now,
        now,
      ),
    );
    for (const item of group.items) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO combo_group_items (
            id, group_id, variant_id, fixed_quantity, min_quantity, max_quantity,
            price_adjustment, display_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          item.id,
          group.id,
          item.variantId,
          item.fixedQuantity,
          item.minQuantity,
          item.maxQuantity,
          item.priceAdjustment,
          item.displayOrder,
          now,
          now,
        ),
      );
    }
  }
  try {
    await env.DB.batch(statements);
  } catch (caught) {
    console.error(JSON.stringify({ event: "combo_config_save_failed", productId, errorType: caught instanceof Error ? caught.name : "UNKNOWN" }));
    return error("COMBO_SAVE_FAILED", "Chưa thể lưu cấu hình Combo.", 409);
  }
  const revalidated = await revalidateComboProduct(productId, env);
  return json({ success: true, data: await getComboConfig(productId, env), revalidated });
}

export async function saveAdminComboGroup(
  request: Request,
  productId: string,
  env: Env,
  groupId?: string,
) {
  if (!productId && groupId) {
    const owner = await env.DB.prepare(
      "SELECT combo_product_id AS productId FROM combo_groups WHERE id = ?",
    )
      .bind(groupId)
      .first<{ productId: string }>();
    if (!owner) return error("COMBO_GROUP_NOT_FOUND", "Không tìm thấy Group trong Combo.", 404);
    productId = owner.productId;
  }
  const productError = await verifyComboProduct(productId, env);
  if (productError) return productError;
  const config = await getComboConfig(productId, env);
  if (!config) return error("COMBO_CONFIG_NOT_FOUND", "Combo chưa có cấu hình Group.", 409);
  let raw: Record<string, unknown>;
  try {
    const value = await readJson(request);
    raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return comboError("Group Combo chưa hợp lệ.");
  }
  const id = groupId ?? crypto.randomUUID();
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const selectionType = raw.selectionType as ComboSelectionType;
  const minSelect = safeNumber(raw.minSelect);
  const maxSelect = safeNumber(raw.maxSelect);
  const displayOrder = safeNumber(raw.displayOrder, config.groups.length - 1);
  if (
    !name ||
    name.length > 180 ||
    !["FIXED", "CHOOSE", "CHOOSE_QUANTITY"].includes(selectionType) ||
    !Number.isSafeInteger(minSelect) ||
    !Number.isSafeInteger(maxSelect) ||
    minSelect < 0 ||
    maxSelect < 0 ||
    minSelect > maxSelect ||
    !Number.isSafeInteger(displayOrder) ||
    displayOrder < 0
  )
    return comboError("Group Combo chưa hợp lệ.");
  if (groupId) {
    const owner = config.groups.find((group) => group.id === groupId);
    if (!owner) return error("COMBO_GROUP_NOT_FOUND", "Không tìm thấy Group trong Combo.", 404);
  }
  const now = new Date().toISOString();
  const statement = groupId
    ? env.DB.prepare(
        `UPDATE combo_groups SET name = ?, description = ?, selection_type = ?,
           min_select = ?, max_select = ?, display_order = ?, updated_at = ?
         WHERE id = ? AND combo_product_id = ?`,
      ).bind(
        name,
        typeof raw.description === "string" ? raw.description.trim() : "",
        selectionType,
        minSelect,
        maxSelect,
        displayOrder,
        now,
        id,
        productId,
      )
    : env.DB.prepare(
        `INSERT INTO combo_groups (
          id, combo_product_id, name, description, selection_type, min_select,
          max_select, display_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        productId,
        name,
        typeof raw.description === "string" ? raw.description.trim() : "",
        selectionType,
        minSelect,
        maxSelect,
        safeNumber(raw.displayOrder, config.groups.length),
        now,
        now,
      );
  try {
    await env.DB.batch([
      statement,
      env.DB.prepare(
        "UPDATE combo_configs SET config_version = config_version + 1, updated_at = ? WHERE product_id = ?",
      ).bind(now, productId),
    ]);
  } catch {
    return error("COMBO_GROUP_SAVE_FAILED", "Chưa thể lưu Group Combo.", 409);
  }
  const revalidated = await revalidateComboProduct(productId, env);
  return json(
    { success: true, data: await getComboConfig(productId, env), revalidated },
    groupId ? 200 : 201,
  );
}

export async function deleteAdminComboGroup(groupId: string, env: Env) {
  const owner = await env.DB.prepare(
    "SELECT combo_product_id AS productId FROM combo_groups WHERE id = ?",
  )
    .bind(groupId)
    .first<{ productId: string }>();
  if (!owner) return error("COMBO_GROUP_NOT_FOUND", "Không tìm thấy Group trong Combo.", 404);
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM combo_groups WHERE id = ?").bind(groupId),
      env.DB.prepare(
        "UPDATE combo_configs SET config_version = config_version + 1, updated_at = ? WHERE product_id = ?",
      ).bind(now, owner.productId),
    ]);
  } catch {
    return error("COMBO_GROUP_DELETE_FAILED", "Chưa thể xóa Group Combo.", 409);
  }
  const revalidated = await revalidateComboProduct(owner.productId, env);
  return json({ success: true, id: groupId, deleted: true, revalidated });
}

export async function saveAdminComboItem(
  request: Request,
  groupId: string,
  env: Env,
  itemId?: string,
) {
  if (!groupId && itemId) {
    const owner = await env.DB.prepare(
      `SELECT group_id AS groupId FROM combo_group_items WHERE id = ?`,
    )
      .bind(itemId)
      .first<{ groupId: string }>();
    if (!owner) return error("COMBO_ITEM_NOT_FOUND", "Không tìm thấy Item trong Group.", 404);
    groupId = owner.groupId;
  }
  const group = await env.DB.prepare(
    `SELECT id, combo_product_id AS productId, selection_type AS selectionType
     FROM combo_groups WHERE id = ?`,
  )
    .bind(groupId)
    .first<{ id: string; productId: string; selectionType: ComboSelectionType }>();
  if (!group) return error("COMBO_GROUP_NOT_FOUND", "Không tìm thấy Group trong Combo.", 404);
  const productError = await verifyComboProduct(group.productId, env);
  if (productError) return productError;
  let raw: Record<string, unknown>;
  try {
    const value = await readJson(request);
    raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return comboError("Item Combo chưa hợp lệ.");
  }
  const variantId = typeof raw.variantId === "string" ? raw.variantId.trim() : "";
  const variant = variantId
    ? await env.DB.prepare(
        `SELECT v.id, p.product_type AS productType FROM product_variants v
         JOIN products p ON p.id = v.product_id WHERE v.id = ?`,
      ).bind(variantId).first<{ id: string; productType: string }>()
    : null;
  if (!variant || variant.productType === "COMBO")
    return error("INVALID_COMBO_VARIANT", "Variant không thuộc Product thường.", 422);
  const values = {
    fixedQuantity: safeNumber(raw.fixedQuantity),
    minQuantity: safeNumber(raw.minQuantity, 1),
    maxQuantity: safeNumber(raw.maxQuantity, 1),
    priceAdjustment: safeNumber(raw.priceAdjustment),
    displayOrder: safeNumber(raw.displayOrder),
  };
  if (
    !Number.isSafeInteger(values.fixedQuantity) ||
    !Number.isSafeInteger(values.minQuantity) ||
    !Number.isSafeInteger(values.maxQuantity) ||
    !Number.isSafeInteger(values.priceAdjustment) ||
    !Number.isSafeInteger(values.displayOrder) ||
    values.fixedQuantity < 0 ||
    values.minQuantity < 0 ||
    values.maxQuantity < 0 ||
    values.displayOrder < 0 ||
    values.minQuantity > values.maxQuantity ||
    values.maxQuantity < 1 ||
    (group.selectionType === "FIXED" && values.fixedQuantity < 1)
  )
    return comboError("Quantity rule của Item Combo chưa hợp lệ.");
  const id = itemId ?? crypto.randomUUID();
  if (itemId) {
    const owner = await env.DB.prepare(
      "SELECT id FROM combo_group_items WHERE id = ? AND group_id = ?",
    ).bind(itemId, groupId).first();
    if (!owner) return error("COMBO_ITEM_NOT_FOUND", "Không tìm thấy Item trong Group.", 404);
  }
  const now = new Date().toISOString();
  const statement = itemId
    ? env.DB.prepare(
        `UPDATE combo_group_items SET variant_id = ?, fixed_quantity = ?,
           min_quantity = ?, max_quantity = ?, price_adjustment = ?,
           display_order = ?, updated_at = ? WHERE id = ? AND group_id = ?`,
      ).bind(variantId, values.fixedQuantity, values.minQuantity, values.maxQuantity, values.priceAdjustment, values.displayOrder, now, id, groupId)
    : env.DB.prepare(
        `INSERT INTO combo_group_items (
          id, group_id, variant_id, fixed_quantity, min_quantity, max_quantity,
          price_adjustment, display_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, groupId, variantId, values.fixedQuantity, values.minQuantity, values.maxQuantity, values.priceAdjustment, values.displayOrder, now, now);
  try {
    await env.DB.batch([
      statement,
      env.DB.prepare(
        `UPDATE combo_configs SET config_version = config_version + 1, updated_at = ?
         WHERE product_id = ?`,
      ).bind(now, group.productId),
    ]);
  } catch (caught) {
    if (caught instanceof Error && caught.message.includes("UNIQUE"))
      return error("COMBO_VARIANT_ALREADY_IN_GROUP", "Variant đã có trong Group này.", 409);
    return error("COMBO_ITEM_SAVE_FAILED", "Chưa thể lưu Item Combo.", 409);
  }
  const revalidated = await revalidateComboProduct(group.productId, env);
  return json(
    { success: true, data: await getComboConfig(group.productId, env), revalidated },
    itemId ? 200 : 201,
  );
}

export async function deleteAdminComboItem(itemId: string, env: Env) {
  const owner = await env.DB.prepare(
    `SELECT g.combo_product_id AS productId
     FROM combo_group_items i JOIN combo_groups g ON g.id = i.group_id
     WHERE i.id = ?`,
  )
    .bind(itemId)
    .first<{ productId: string }>();
  if (!owner) return error("COMBO_ITEM_NOT_FOUND", "Không tìm thấy Item trong Group.", 404);
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM combo_group_items WHERE id = ?").bind(itemId),
      env.DB.prepare(
        "UPDATE combo_configs SET config_version = config_version + 1, updated_at = ? WHERE product_id = ?",
      ).bind(now, owner.productId),
    ]);
  } catch {
    return error("COMBO_ITEM_DELETE_FAILED", "Chưa thể gỡ Item khỏi Combo.", 409);
  }
  const revalidated = await revalidateComboProduct(owner.productId, env);
  return json({ success: true, id: itemId, deleted: true, revalidated });
}

export async function listAdminComboVariants(request: Request, env: Env) {
  if (!(await hasComboSchema(env))) return error("COMBO_SCHEMA_UNAVAILABLE", "Cấu hình Combo chưa sẵn sàng trên cơ sở dữ liệu.", 409);
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length > 120) return comboError("Từ khóa Variant quá dài.");
  const inventorySchema = await hasInventorySchema(env);
  const variantMediaSchema = await hasVariantMediaSchema(env);
  const imageSelect = variantMediaSchema
    ? `COALESCE(
         (SELECT r2_key FROM product_variant_images pvi
          WHERE pvi.variant_id = v.id
          ORDER BY pvi.is_primary DESC, pvi.sort_order, pvi.created_at, pvi.id LIMIT 1),
         (SELECT r2_key FROM product_images pi
          WHERE pi.product_id = v.product_id
          ORDER BY pi.sort_order, pi.created_at, pi.id LIMIT 1)
       )`
    : `(SELECT r2_key FROM product_images pi
        WHERE pi.product_id = v.product_id
        ORDER BY pi.sort_order, pi.created_at, pi.id LIMIT 1)`;
  const rows = await env.DB.prepare(
    `SELECT v.id AS variantId, v.product_id AS productId, p.name AS productName,
       v.name AS variantName, v.sku, v.availability,
       ${inventorySchema ? "v.track_inventory AS trackInventory, v.stock_on_hand AS stockOnHand, v.reserved_quantity AS reservedQuantity" : "0 AS trackInventory, 0 AS stockOnHand, 0 AS reservedQuantity"}
       , ${imageSelect} AS imageKey
     FROM product_variants v JOIN products p ON p.id = v.product_id
     WHERE p.product_type = 'STANDARD'
       AND (? = '' OR p.name LIKE ? OR v.name LIKE ? OR COALESCE(v.sku, '') LIKE ?)
     ORDER BY p.name, v.sort_order, v.name LIMIT 200`,
  )
    .bind(q, `%${q}%`, `%${q}%`, `%${q}%`)
    .all<Record<string, unknown>>();
  return json({ data: rows.results.map((row) => ({
    ...row,
    imageUrl: row.imageKey ? getPublicImageUrl(String(row.imageKey)) : null,
    availableQuantity: row.trackInventory
      ? Math.max(0, Number(row.stockOnHand ?? 0) - Number(row.reservedQuantity ?? 0))
      : null,
  })) });
}

export async function revalidateComboProduct(
  productId: string,
  env: Env,
): Promise<ComboRevalidationResult> {
  const config = await getComboConfig(productId, env);
  if (!config) return { productId, valid: false, errors: ["Combo chưa có cấu hình."] };
  let errors = [...validateComboConfig(config).errors];
  if (errors.length && config.groupMode === "ONE_OF_GROUPS") {
    // ONE_OF_GROUPS chỉ cần còn một phương án hoàn chỉnh sau khi gỡ Variant.
    const hasValidAlternative = config.groups.some((group) =>
      validateComboConfig({
        ...config,
        groupMode: "ALL_GROUPS",
        groups: [group],
      }).ok,
    );
    if (hasValidAlternative) errors = [];
  }
  const now = new Date().toISOString();
  if (errors.length) {
    await env.DB.prepare(
      "UPDATE products SET status = 'HIDDEN', updated_at = ? WHERE id = ? AND status = 'AVAILABLE'",
    ).bind(now, productId).run();
  }
  return { productId, valid: errors.length === 0, errors };
}

export async function revalidateComboProducts(productIds: string[], env: Env) {
  return Promise.all([...new Set(productIds)].map((productId) => revalidateComboProduct(productId, env)));
}
