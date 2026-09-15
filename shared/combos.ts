export const COMBO_PRODUCT_TYPES = ["STANDARD", "COMBO"] as const;
export type ComboProductType = (typeof COMBO_PRODUCT_TYPES)[number];

export const COMBO_GROUP_MODES = ["ALL_GROUPS", "ONE_OF_GROUPS"] as const;
export type ComboGroupMode = (typeof COMBO_GROUP_MODES)[number];

export const COMBO_SELECTION_TYPES = [
  "FIXED",
  "CHOOSE",
  "CHOOSE_QUANTITY",
] as const;
export type ComboSelectionType = (typeof COMBO_SELECTION_TYPES)[number];

export type ComboGroupItem = {
  id: string;
  groupId: string;
  variantId: string;
  fixedQuantity: number;
  minQuantity: number;
  maxQuantity: number;
  priceAdjustment: number;
  displayOrder: number;
  productId?: string;
  productName?: string;
  variantName?: string;
  sku?: string | null;
  imageKey?: string | null;
  availableQuantity?: number | null;
  availability?: string;
};

export type ComboGroup = {
  id: string;
  comboProductId: string;
  name: string;
  description: string;
  selectionType: ComboSelectionType;
  minSelect: number;
  maxSelect: number;
  displayOrder: number;
  items: ComboGroupItem[];
};

export type ComboConfig = {
  productId: string;
  groupMode: ComboGroupMode;
  configVersion: number;
  compareAtPriceVnd?: number | null;
  groups: ComboGroup[];
  createdAt?: string;
  updatedAt?: string;
};

export type ComboSelectionItem = {
  groupItemId: string;
  variantId: string;
  quantity: number;
};

export type ComboSelection = {
  selectedGroupId?: string;
  items?: ComboSelectionItem[];
  configVersion?: number;
};

export type ResolvedComboComponent = ComboSelectionItem & {
  groupId: string;
  priceAdjustment: number;
};

export type ComboSelectionValidation = {
  ok: boolean;
  errors: string[];
  components: ResolvedComboComponent[];
  priceAdjustment: number;
};

export type ComboConfigValidation = {
  ok: boolean;
  errors: string[];
};

export type ComboDisplayPrices = {
  salePriceVnd: number;
  compareAtPriceVnd: number | null;
};

/** Tính giá bán authoritative của Combo; compare price không tham gia phép tính này. */
export function calculateComboSalePrice(basePriceVnd: number, priceAdjustment = 0) {
  return Math.max(0, basePriceVnd + priceAdjustment);
}

/** Tính dữ liệu giá để render, giữ compare price ngoài dòng tiền checkout. */
export function getComboDisplayPrices(
  basePriceVnd: number,
  compareAtPriceVnd: number | null | undefined,
  priceAdjustment = 0,
): ComboDisplayPrices {
  const salePriceVnd = calculateComboSalePrice(basePriceVnd, priceAdjustment);
  const adjustedCompareAtPrice =
    compareAtPriceVnd == null
      ? null
      : Math.max(0, compareAtPriceVnd + priceAdjustment);
  return {
    salePriceVnd,
    compareAtPriceVnd:
      adjustedCompareAtPrice !== null && adjustedCompareAtPrice > salePriceVnd
        ? adjustedCompareAtPrice
        : null,
  };
}

/** Tạo khóa deterministic để cùng một cấu hình Combo được gộp thành một dòng giỏ hàng. */
export function comboLineId(productId: string, selection: ComboSelection) {
  const items = [...(selection.items ?? [])]
    .map((item) => `${item.groupItemId}:${item.variantId}:${item.quantity}`)
    .sort()
    .join("|");
  const source = `${productId}:${selection.configVersion ?? ""}:${selection.selectedGroupId ?? ""}:${items}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `combo:${productId}:${(hash >>> 0).toString(36)}`;
}

function isSafeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function errorText(message: string) {
  return message.trim() || "Cấu hình Combo chưa hợp lệ.";
}

export function formatComboGroupSelectionRule(
  group: Pick<ComboGroup, "selectionType" | "minSelect" | "maxSelect">,
) {
  if (group.selectionType === "FIXED") return "Bắt buộc";
  if (group.selectionType === "CHOOSE_QUANTITY")
    return `Tổng số lượng tối thiểu ${group.minSelect} sp / tối đa ${group.maxSelect} sp`;
  return `Chọn tối thiểu ${group.minSelect} sp / tối đa ${group.maxSelect} sp`;
}

export function formatComboGroupSelectionError(
  group: Pick<ComboGroup, "name" | "maxSelect">,
) {
  return `Hãy chọn ${group.maxSelect} sản phẩm trong ${group.name}`;
}

/** Kiểm tra cấu hình Admin trước khi ghi để rule không phụ thuộc vào UI. */
export function validateComboConfig(config: ComboConfig): ComboConfigValidation {
  const errors: string[] = [];
  if (!config.productId) errors.push("Combo chưa có sản phẩm sở hữu.");
  if (!COMBO_GROUP_MODES.includes(config.groupMode))
    errors.push("Quan hệ giữa các Group không hợp lệ.");
  if (!Number.isSafeInteger(config.configVersion) || config.configVersion < 1)
    errors.push("Phiên bản cấu hình Combo không hợp lệ.");
  if (
    config.compareAtPriceVnd !== undefined &&
    config.compareAtPriceVnd !== null &&
    !isSafeNonNegativeInteger(config.compareAtPriceVnd)
  )
    errors.push("Giá so sánh Combo phải là số nguyên không âm.");
  if (!Array.isArray(config.groups) || config.groups.length === 0)
    errors.push("Combo phải có ít nhất một Group.");
  const groupIds = new Set<string>();
  for (const group of config.groups ?? []) {
    const groupItems = group.items ?? [];
    const groupName = typeof group.name === "string" ? group.name.trim() : "";
    if (!group.id || groupIds.has(group.id)) errors.push("ID Group bị trùng.");
    groupIds.add(group.id);
    if (group.comboProductId !== config.productId)
      errors.push(`Group "${groupName || group.id}" không thuộc Combo.`);
    if (!groupName || groupName.length > 180)
      errors.push(`Tên Group "${groupName || group.id}" không hợp lệ.`);
    if (!isSafeNonNegativeInteger(group.displayOrder))
      errors.push(`Thứ tự Group "${groupName || group.id}" không hợp lệ.`);
    if (!COMBO_SELECTION_TYPES.includes(group.selectionType))
      errors.push(`Loại lựa chọn của Group "${group.name}" không hợp lệ.`);
    if (
      !isSafeNonNegativeInteger(group.minSelect) ||
      !isSafeNonNegativeInteger(group.maxSelect) ||
      group.minSelect > group.maxSelect
    )
      errors.push(`Khoảng lựa chọn của Group "${group.name}" không hợp lệ.`);
    const itemIds = new Set<string>();
    const variantIds = new Set<string>();
    for (const item of groupItems) {
      if (!item.id || itemIds.has(item.id)) errors.push("ID Item bị trùng.");
      itemIds.add(item.id);
      if (!item.variantId || variantIds.has(item.variantId))
        errors.push(`Variant trong Group "${group.name}" bị trùng.`);
      variantIds.add(item.variantId);
      if (!isSafeNonNegativeInteger(item.displayOrder))
        errors.push(`Thứ tự Item trong Group "${group.name}" không hợp lệ.`);
      if (
        !isSafeNonNegativeInteger(item.fixedQuantity) ||
        !isSafeNonNegativeInteger(item.minQuantity) ||
        !isSafeNonNegativeInteger(item.maxQuantity) ||
        item.minQuantity > item.maxQuantity
      )
        errors.push(`Giới hạn quantity của Group "${group.name}" không hợp lệ.`);
      if (!Number.isSafeInteger(item.priceAdjustment))
        errors.push(`Điều chỉnh giá của Group "${group.name}" không hợp lệ.`);
      if (group.selectionType === "FIXED" && item.fixedQuantity < 1)
        errors.push(`FIXED Group "${group.name}" phải có quantity dương.`);
      if (group.selectionType !== "FIXED" && item.maxQuantity < 1)
        errors.push(`Variant trong Group "${group.name}" phải có max quantity dương.`);
    }
    if (group.selectionType === "FIXED" && groupItems.length === 0)
      errors.push(`FIXED Group "${group.name}" phải có Item.`);
    if (group.selectionType === "CHOOSE" && group.maxSelect > groupItems.length)
      errors.push(`Group "${group.name}" không đủ Item cho max_select.`);
    if (group.selectionType === "CHOOSE_QUANTITY") {
      const totalMax = groupItems.reduce((sum, item) => sum + item.maxQuantity, 0);
      if (group.maxSelect > totalMax)
        errors.push(`Group "${group.name}" không đủ tổng quantity cho max_select.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Chuẩn hóa selection thành component inventory mà server có thể kiểm tra tiếp. */
export function validateComboSelection(
  config: ComboConfig,
  selection: ComboSelection | null | undefined,
): ComboSelectionValidation {
  const errors: string[] = [];
  const components: ResolvedComboComponent[] = [];
  let priceAdjustment = 0;
  if (!selection || typeof selection !== "object")
    return { ok: false, errors: ["Lựa chọn Combo chưa được gửi."], components, priceAdjustment };
  if (
    selection.configVersion !== undefined &&
    selection.configVersion !== config.configVersion
  )
    errors.push("Combo này vừa được cập nhật. Vui lòng kiểm tra lại lựa chọn.");
  const groups = config.groups ?? [];
  const selectedGroupId = selection.selectedGroupId;
  if (config.groupMode === "ONE_OF_GROUPS") {
    if (!selectedGroupId) errors.push("Vui lòng chọn một Group của Combo.");
    if (selectedGroupId && !groups.some((group) => group.id === selectedGroupId))
      errors.push("Group được chọn không thuộc Combo.");
  } else if (selectedGroupId) {
    errors.push("Combo ALL_GROUPS không nhận selectedGroupId.");
  }
  const rawItems = Array.isArray(selection.items) ? selection.items : [];
  const itemById = new Map(
    groups.flatMap((group) => group.items.map((item) => [item.id, { group, item }] as const)),
  );
  const selectedByGroup = new Map<string, ComboSelectionItem[]>();
  const seenItemIds = new Set<string>();
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object") {
      errors.push("Item Combo không hợp lệ.");
      continue;
    }
    const groupItemId = typeof rawItem.groupItemId === "string" ? rawItem.groupItemId : "";
    const variantId = typeof rawItem.variantId === "string" ? rawItem.variantId : "";
    const quantity = rawItem.quantity;
    const match = itemById.get(groupItemId);
    if (!match || match.item.variantId !== variantId) {
      errors.push("Variant không thuộc Group của Combo.");
      continue;
    }
    if (config.groupMode === "ONE_OF_GROUPS" && match.group.id !== selectedGroupId) {
      errors.push("Variant thuộc Group không được chọn.");
      continue;
    }
    if (seenItemIds.has(groupItemId)) {
      errors.push("Một Variant chỉ được chọn một lần trong Group.");
      continue;
    }
    seenItemIds.add(groupItemId);
    if (!isSafeNonNegativeInteger(quantity) || quantity < 1) {
      errors.push("Quantity Combo phải là số nguyên dương.");
      continue;
    }
    if (match.group.selectionType === "FIXED") {
      errors.push("FIXED Group không cho thay đổi lựa chọn.");
      continue;
    }
    if (quantity < match.item.minQuantity || quantity > match.item.maxQuantity)
      errors.push(`Quantity của ${match.item.variantName ?? "Variant"} vượt rule.`);
    const list = selectedByGroup.get(match.group.id) ?? [];
    list.push({ groupItemId, variantId, quantity });
    selectedByGroup.set(match.group.id, list);
  }
  for (const group of groups) {
    const active = config.groupMode === "ONE_OF_GROUPS" && group.id !== selectedGroupId;
    if (active) continue;
    const selected = selectedByGroup.get(group.id) ?? [];
    if (group.selectionType === "FIXED") {
      group.items.forEach((item) => {
        components.push({
          groupId: group.id,
          groupItemId: item.id,
          variantId: item.variantId,
          quantity: item.fixedQuantity,
          priceAdjustment: item.priceAdjustment,
        });
        priceAdjustment += item.priceAdjustment * item.fixedQuantity;
      });
      continue;
    }
    const selectedCount = selected.length;
    // CHOOSE giới hạn số Item khác nhau; CHOOSE_QUANTITY chỉ giới hạn tổng quantity.
    if (
      group.selectionType === "CHOOSE" &&
      (selectedCount < group.minSelect || selectedCount > group.maxSelect)
    )
      errors.push(formatComboGroupSelectionError(group));
    for (const item of selected) {
      const stored = group.items.find((candidate) => candidate.id === item.groupItemId)!;
      components.push({ ...item, groupId: group.id, priceAdjustment: stored.priceAdjustment });
      priceAdjustment += stored.priceAdjustment * item.quantity;
    }
    if (group.selectionType === "CHOOSE_QUANTITY") {
      const totalQuantity = selected.reduce((sum, item) => sum + item.quantity, 0);
      if (totalQuantity < group.minSelect || totalQuantity > group.maxSelect)
        errors.push(formatComboGroupSelectionError(group));
    }
  }
  return { ok: errors.length === 0, errors: errors.map(errorText), components, priceAdjustment };
}
