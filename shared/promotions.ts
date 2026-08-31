export const promotionTypes = [
  "ORDER_FIXED_DISCOUNT",
  "ORDER_PERCENTAGE_DISCOUNT",
  "ORDER_GIFT",
  "BUY_X_GET_Y",
  "PRODUCT_DISCOUNT",
  "CATEGORY_DISCOUNT",
  "QUANTITY_DISCOUNT",
  "COMBO_DISCOUNT",
  "TIERED_DISCOUNT",
] as const;

export type PromotionType = (typeof promotionTypes)[number];

export const promotionStatuses = [
  "DRAFT",
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
] as const;

export type PromotionStatus = (typeof promotionStatuses)[number];
export type DiscountKind = "FIXED" | "PERCENTAGE";
export type PromotionScope =
  | "ENTIRE_CART"
  | "SELECTED_PRODUCTS"
  | "SELECTED_CATEGORIES";

type BaseReward = {
  kind: DiscountKind;
  amount?: number;
  percentage?: number;
  maximumDiscount?: number | null;
};

export type PromotionConfig =
  | {
      type: "ORDER_FIXED_DISCOUNT";
      minimumSubtotal: number;
      discountAmount: number;
    }
  | {
      type: "ORDER_PERCENTAGE_DISCOUNT";
      minimumSubtotal: number;
      percentage: number;
      maximumDiscount?: number | null;
    }
  | {
      type: "ORDER_GIFT";
      minimumSubtotal: number;
      giftProductId: string;
      giftQuantity: number;
    }
  | {
      type: "BUY_X_GET_Y";
      triggerProductId: string;
      requiredQuantity: number;
      rewardProductId: string;
      rewardQuantity: number;
      allowRepeatedApplications?: boolean;
    }
  | {
      type: "PRODUCT_DISCOUNT";
      productIds: string[];
      reward: BaseReward;
    }
  | {
      type: "CATEGORY_DISCOUNT";
      categoryIds: string[];
      reward: BaseReward;
    }
  | {
      type: "QUANTITY_DISCOUNT";
      requiredQuantity: number;
      scope: PromotionScope;
      productIds?: string[];
      categoryIds?: string[];
      reward: BaseReward;
      allowRepeatedApplications?: boolean;
    }
  | {
      type: "COMBO_DISCOUNT";
      items: Array<{ productId: string; quantity: number }>;
      reward: BaseReward;
      allowRepeatedApplications?: boolean;
    }
  | {
      type: "TIERED_DISCOUNT";
      tiers: Array<{ threshold: number; reward: BaseReward }>;
    };

export type PromotionDefinition = {
  id: string;
  name: string;
  description: string;
  type: PromotionType;
  status: PromotionStatus;
  priority: number;
  stackable: boolean;
  startsAt: string | null;
  endsAt: string | null;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  usageCountTotal: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  config: PromotionConfig;
};

export type PromotionInput = {
  name: unknown;
  description?: unknown;
  type: unknown;
  status?: unknown;
  priority?: unknown;
  stackable?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  usageLimitTotal?: unknown;
  usageLimitPerCustomer?: unknown;
  config: unknown;
};

export type PromotionCartLine = {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  imageKey: string | null;
  priceVnd: number;
  quantity: number;
  categoryIds: string[];
  // Các trường inventory là tuỳ chọn để bộ máy promotion vẫn chạy với fixture/schema legacy.
  trackInventory?: boolean;
  stockOnHand?: number;
  reservedQuantity?: number;
  availableQuantity?: number;
  inventoryAvailability?: "AVAILABLE" | "OUT_OF_STOCK";
};

export type PromotionCatalogProduct = {
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  sku: string | null;
  imageKey: string | null;
  priceVnd: number;
  availability: string;
  productStatus: string;
  trackInventory?: boolean;
  stockOnHand?: number;
  reservedQuantity?: number;
  availableQuantity?: number;
  inventoryAvailability?: "AVAILABLE" | "OUT_OF_STOCK";
};

export type PromotionGiftItem = {
  promotionId: string;
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  imageKey: string | null;
  unitPriceVnd: 0;
  quantity: number;
  lineTotalVnd: 0;
  isPromotionGift: true;
  trackInventory?: boolean;
  availableQuantity?: number;
};

export type AppliedPromotion = {
  promotionId: string;
  promotionName: string;
  type: PromotionType;
  discountAmountVnd: number;
  giftItems: PromotionGiftItem[];
  giftUnavailable: boolean;
};

export type PromotionProgress = {
  promotionId: string;
  promotionName: string;
  type: PromotionType;
  priority: number;
  remainingAmountVnd?: number;
  remainingQuantity?: number;
  currentReward?: string;
  nextReward: string;
  message: string;
};

export type PromotionCartLineResult = PromotionCartLine & {
  originalLineTotalVnd: number;
  discountAmountVnd: number;
  lineTotalVnd: number;
};

export type PromotionEvaluationResult = {
  subtotalVnd: number;
  discountTotalVnd: number;
  finalTotalVnd: number;
  totalQuantity: number;
  items: PromotionCartLineResult[];
  gifts: PromotionGiftItem[];
  appliedPromotions: AppliedPromotion[];
  progress: PromotionProgress[];
};

export type PromotionEvaluationInput = {
  cart: PromotionCartLine[];
  promotions: PromotionDefinition[];
  catalog?: PromotionCatalogProduct[];
  now?: Date | string;
  customerId?: string;
};

export type PromotionValidationIssue = {
  code: string;
  field?: string;
  message: string;
};

export class PromotionValidationError extends Error {
  constructor(readonly issue: PromotionValidationIssue) {
    super(issue.message);
  }
}

const maxSafeInteger = Number.MAX_SAFE_INTEGER;

function invalid(field: string, message: string): never {
  throw new PromotionValidationError({
    code: "VALIDATION_ERROR",
    field,
    message,
  });
}

function requiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") invalid(field, "Giá trị phải là chuỗi.");
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength)
    invalid(field, "Giá trị bắt buộc hoặc vượt quá độ dài cho phép.");
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null || value === "") return "";
  return requiredString(value, field, maxLength);
}

function nullableDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = requiredString(value, field, 80);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) invalid(field, "Mốc thời gian không hợp lệ.");
  return new Date(timestamp).toISOString();
}

function positiveInteger(value: unknown, field: string, message: string) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (!Number.isSafeInteger(number) || Number(number) < 1)
    invalid(field, message);
  return Number(number);
}

function nonNegativeInteger(value: unknown, field: string, message: string) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (!Number.isSafeInteger(number) || Number(number) < 0)
    invalid(field, message);
  return Number(number);
}

function percentage(value: unknown, field: string) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (!Number.isSafeInteger(number) || Number(number) <= 0 || Number(number) > 100)
    invalid(field, "Phần trăm phải lớn hơn 0 và không vượt quá 100.");
  return Number(number);
}

function idList(value: unknown, field: string, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum)
    invalid(field, "Cần chọn ít nhất một đối tượng.");
  const result = value.map((item) => requiredString(item, field, 120));
  if (new Set(result).size !== result.length)
    invalid(field, "Không được chọn trùng đối tượng.");
  return result;
}

function optionalMaximumDiscount(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  return positiveInteger(value, field, "Mức giảm tối đa phải lớn hơn 0.");
}

function reward(value: unknown, field: string): BaseReward {
  if (!value || typeof value !== "object")
    invalid(field, "Cấu hình mức ưu đãi không hợp lệ.");
  const source = value as Record<string, unknown>;
  const kind = source.kind;
  if (kind !== "FIXED" && kind !== "PERCENTAGE")
    invalid(`${field}.kind`, "Loại ưu đãi không hợp lệ.");
  if (kind === "FIXED") {
    return {
      kind,
      amount: positiveInteger(
        source.amount,
        `${field}.amount`,
        "Số tiền giảm phải lớn hơn 0.",
      ),
      maximumDiscount: optionalMaximumDiscount(
        source.maximumDiscount,
        `${field}.maximumDiscount`,
      ),
    };
  }
  return {
    kind,
    percentage: percentage(source.percentage, `${field}.percentage`),
    maximumDiscount: optionalMaximumDiscount(
      source.maximumDiscount,
      `${field}.maximumDiscount`,
    ),
  };
}

function boolOrDefault(value: unknown, defaultValue: boolean) {
  return value === undefined ? defaultValue : value === true;
}

export function validatePromotionConfig(
  type: PromotionType,
  value: unknown,
): PromotionConfig {
  if (!value || typeof value !== "object")
    invalid("config", "Cấu hình promotion không hợp lệ.");
  const source = value as Record<string, unknown>;
  const configType = source.type ?? type;
  if (configType !== type) invalid("config.type", "Loại cấu hình không khớp promotion.");
  if (type === "ORDER_FIXED_DISCOUNT")
    return {
      type,
      minimumSubtotal: positiveInteger(
        source.minimumSubtotal,
        "config.minimumSubtotal",
        "Giá trị đơn tối thiểu phải lớn hơn 0.",
      ),
      discountAmount: positiveInteger(
        source.discountAmount,
        "config.discountAmount",
        "Số tiền giảm phải lớn hơn 0.",
      ),
    };
  if (type === "ORDER_PERCENTAGE_DISCOUNT")
    return {
      type,
      minimumSubtotal: positiveInteger(
        source.minimumSubtotal,
        "config.minimumSubtotal",
        "Giá trị đơn tối thiểu phải lớn hơn 0.",
      ),
      percentage: percentage(source.percentage, "config.percentage"),
      maximumDiscount: optionalMaximumDiscount(
        source.maximumDiscount,
        "config.maximumDiscount",
      ),
    };
  if (type === "ORDER_GIFT")
    return {
      type,
      minimumSubtotal: positiveInteger(
        source.minimumSubtotal,
        "config.minimumSubtotal",
        "Giá trị đơn tối thiểu phải lớn hơn 0.",
      ),
      giftProductId: requiredString(source.giftProductId, "config.giftProductId", 120),
      giftQuantity: positiveInteger(
        source.giftQuantity,
        "config.giftQuantity",
        "Số lượng quà phải ít nhất là 1.",
      ),
    };
  if (type === "BUY_X_GET_Y")
    return {
      type,
      triggerProductId: requiredString(
        source.triggerProductId,
        "config.triggerProductId",
        120,
      ),
      requiredQuantity: positiveInteger(
        source.requiredQuantity,
        "config.requiredQuantity",
        "Số lượng mua phải ít nhất là 1.",
      ),
      rewardProductId: requiredString(source.rewardProductId, "config.rewardProductId", 120),
      rewardQuantity: positiveInteger(
        source.rewardQuantity,
        "config.rewardQuantity",
        "Số lượng quà phải ít nhất là 1.",
      ),
      allowRepeatedApplications: boolOrDefault(source.allowRepeatedApplications, true),
    };
  if (type === "PRODUCT_DISCOUNT")
    return { type, productIds: idList(source.productIds, "config.productIds"), reward: reward(source.reward, "config.reward") };
  if (type === "CATEGORY_DISCOUNT")
    return { type, categoryIds: idList(source.categoryIds, "config.categoryIds"), reward: reward(source.reward, "config.reward") };
  if (type === "QUANTITY_DISCOUNT") {
    const scope = source.scope;
    if (
      scope !== "ENTIRE_CART" &&
      scope !== "SELECTED_PRODUCTS" &&
      scope !== "SELECTED_CATEGORIES"
    )
      invalid("config.scope", "Phạm vi số lượng không hợp lệ.");
    const productIds =
      scope === "SELECTED_PRODUCTS"
        ? idList(source.productIds, "config.productIds")
        : undefined;
    const categoryIds =
      scope === "SELECTED_CATEGORIES"
        ? idList(source.categoryIds, "config.categoryIds")
        : undefined;
    return {
      type,
      requiredQuantity: positiveInteger(
        source.requiredQuantity,
        "config.requiredQuantity",
        "Số lượng yêu cầu phải ít nhất là 1.",
      ),
      scope,
      productIds,
      categoryIds,
      reward: reward(source.reward, "config.reward"),
      allowRepeatedApplications: boolOrDefault(source.allowRepeatedApplications, false),
    };
  }
  if (type === "COMBO_DISCOUNT") {
    if (!Array.isArray(source.items) || !source.items.length)
      invalid("config.items", "Combo cần ít nhất một sản phẩm.");
    const items = source.items.map((item, index) => {
      if (!item || typeof item !== "object")
        invalid(`config.items.${index}`, "Sản phẩm combo không hợp lệ.");
      const row = item as Record<string, unknown>;
      return {
        productId: requiredString(row.productId, `config.items.${index}.productId`, 120),
        quantity: positiveInteger(
          row.quantity,
          `config.items.${index}.quantity`,
          "Số lượng combo phải ít nhất là 1.",
        ),
      };
    });
    if (new Set(items.map((item) => item.productId)).size !== items.length)
      invalid("config.items", "Mỗi sản phẩm chỉ được xuất hiện một lần trong combo.");
    return {
      type,
      items,
      reward: reward(source.reward, "config.reward"),
      allowRepeatedApplications: boolOrDefault(source.allowRepeatedApplications, false),
    };
  }
  const rawTiers = source.tiers;
  if (!Array.isArray(rawTiers) || !rawTiers.length)
    invalid("config.tiers", "Promotion theo bậc cần ít nhất một bậc.");
  const tiers = rawTiers.map((tier, index) => {
    if (!tier || typeof tier !== "object")
      invalid(`config.tiers.${index}`, "Bậc ưu đãi không hợp lệ.");
    const row = tier as Record<string, unknown>;
    return {
      threshold: positiveInteger(
        row.threshold,
        `config.tiers.${index}.threshold`,
        "Ngưỡng bậc phải lớn hơn 0.",
      ),
      reward: reward(row.reward, `config.tiers.${index}.reward`),
    };
  });
  for (let index = 1; index < tiers.length; index += 1) {
    if (tiers[index].threshold <= tiers[index - 1].threshold)
      invalid("config.tiers", "Các ngưỡng phải tăng dần và không trùng nhau.");
  }
  return { type, tiers };
}

export function validatePromotionInput(value: unknown): Omit<PromotionDefinition, "id" | "createdAt" | "updatedAt" | "usageCountTotal" | "archivedAt" | "deletedAt"> {
  if (!value || typeof value !== "object") invalid("promotion", "Thông tin promotion không hợp lệ.");
  const source = value as PromotionInput;
  const type = source.type;
  if (!promotionTypes.includes(type as PromotionType))
    invalid("type", "Loại promotion không được hỗ trợ.");
  const promotionType = type as PromotionType;
  const startsAt = nullableDate(source.startsAt, "startsAt");
  const endsAt = nullableDate(source.endsAt, "endsAt");
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt))
    invalid("endsAt", "Thời gian kết thúc phải sau thời gian bắt đầu.");
  const status = source.status === undefined ? "DRAFT" : source.status;
  if (!promotionStatuses.includes(status as PromotionStatus))
    invalid("status", "Trạng thái promotion không hợp lệ.");
  const usageLimitTotal =
    source.usageLimitTotal === undefined || source.usageLimitTotal === null || source.usageLimitTotal === ""
      ? null
      : positiveInteger(source.usageLimitTotal, "usageLimitTotal", "Giới hạn tổng phải lớn hơn 0.");
  if (
    source.usageLimitPerCustomer !== undefined &&
    source.usageLimitPerCustomer !== null &&
    source.usageLimitPerCustomer !== ""
  )
    invalid(
      "usageLimitPerCustomer",
      "Giới hạn theo khách chưa được hỗ trợ khi chưa có định danh khách ổn định.",
    );
  const usageLimitPerCustomer = null;
  const priority =
    source.priority === undefined
      ? 0
      : nonNegativeInteger(source.priority, "priority", "Priority phải là số nguyên không âm.");
  const name = requiredString(source.name, "name", 180);
  const description =
    optionalString(source.description, "description", 2000);
  const config = validatePromotionConfig(promotionType, source.config);
  return {
    name,
    description,
    type: promotionType,
    status: status as PromotionStatus,
    priority,
    stackable: source.stackable === true,
    startsAt,
    endsAt,
    usageLimitTotal,
    usageLimitPerCustomer,
    config,
  };
}

type StoredPromotionRow = {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  priority: number;
  stackable: number;
  startsAt: string | null;
  endsAt: string | null;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  usageCountTotal: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  configJson: string;
};

export function parseStoredPromotion(row: StoredPromotionRow): PromotionDefinition | null {
  if (!promotionTypes.includes(row.type as PromotionType)) return null;
  if (!promotionStatuses.includes(row.status as PromotionStatus)) return null;
  if (
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.description !== "string" ||
    typeof row.configJson !== "string" ||
    typeof row.createdAt !== "string" ||
    typeof row.updatedAt !== "string" ||
    !row.id ||
    !row.name.trim() ||
    (row.stackable !== 0 && row.stackable !== 1) ||
    !Number.isSafeInteger(row.priority) ||
    row.priority < 0 ||
    !Number.isSafeInteger(row.usageCountTotal) ||
    row.usageCountTotal < 0 ||
    (row.usageLimitTotal !== null &&
      (!Number.isSafeInteger(row.usageLimitTotal) || row.usageLimitTotal < 1)) ||
    (row.usageLimitPerCustomer !== null &&
      (!Number.isSafeInteger(row.usageLimitPerCustomer) || row.usageLimitPerCustomer < 1)) ||
    (row.startsAt !== null && typeof row.startsAt !== "string") ||
    (row.endsAt !== null && typeof row.endsAt !== "string") ||
    (row.archivedAt !== null && typeof row.archivedAt !== "string") ||
    (row.deletedAt !== null && typeof row.deletedAt !== "string") ||
    (row.startsAt !== null && !Number.isFinite(Date.parse(row.startsAt))) ||
    (row.endsAt !== null && !Number.isFinite(Date.parse(row.endsAt))) ||
    (row.startsAt !== null &&
      row.endsAt !== null &&
      Date.parse(row.startsAt) >= Date.parse(row.endsAt))
  )
    return null;
  let configValue: unknown;
  try {
    configValue = JSON.parse(row.configJson);
  } catch {
    return null;
  }
  try {
    const config = validatePromotionConfig(row.type as PromotionType, configValue);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      type: row.type as PromotionType,
      status: row.status as PromotionStatus,
      priority: row.priority,
      stackable: Boolean(row.stackable),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      usageLimitTotal: row.usageLimitTotal,
      usageLimitPerCustomer: row.usageLimitPerCustomer,
      usageCountTotal: row.usageCountTotal,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
      deletedAt: row.deletedAt,
      config,
    };
  } catch {
    return null;
  }
}

export function isPromotionRunning(
  promotion: PromotionDefinition,
  now: Date | string = new Date(),
) {
  const timestamp = typeof now === "string" ? Date.parse(now) : now.getTime();
  if (!Number.isFinite(timestamp)) return false;
  if (promotion.status !== "ACTIVE" || promotion.archivedAt || promotion.deletedAt)
    return false;
  if (promotion.startsAt) {
    const startsAt = Date.parse(promotion.startsAt);
    if (!Number.isFinite(startsAt) || timestamp < startsAt) return false;
  }
  if (promotion.endsAt) {
    const endsAt = Date.parse(promotion.endsAt);
    if (!Number.isFinite(endsAt) || timestamp >= endsAt) return false;
  }
  if (
    promotion.usageLimitTotal !== null &&
    promotion.usageCountTotal >= promotion.usageLimitTotal
  )
    return false;
  return true;
}

export type PromotionDerivedState = "DRAFT" | "SCHEDULED" | "RUNNING" | "ENDED" | "INACTIVE" | "ARCHIVED";

export function derivePromotionState(
  promotion: Pick<PromotionDefinition, "status" | "startsAt" | "endsAt" | "archivedAt" | "deletedAt">,
  now: Date | string = new Date(),
): PromotionDerivedState {
  if (promotion.status === "DRAFT") return "DRAFT";
  if (promotion.status === "ARCHIVED" || promotion.archivedAt || promotion.deletedAt)
    return "ARCHIVED";
  if (promotion.status === "INACTIVE") return "INACTIVE";
  const timestamp = typeof now === "string" ? Date.parse(now) : now.getTime();
  if (promotion.startsAt && timestamp < Date.parse(promotion.startsAt)) return "SCHEDULED";
  if (promotion.endsAt && timestamp >= Date.parse(promotion.endsAt)) return "ENDED";
  return "RUNNING";
}

function safeMoney(value: number) {
  if (!Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, maxSafeInteger);
}

function moneyProduct(value: number, multiplier: number) {
  if (
    !Number.isSafeInteger(value) ||
    !Number.isSafeInteger(multiplier) ||
    value < 0 ||
    multiplier < 0
  )
    return 0;
  const result = BigInt(value) * BigInt(multiplier);
  return result > BigInt(maxSafeInteger) ? maxSafeInteger : Number(result);
}

function moneySum(values: number[]) {
  let total = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) continue;
    total += BigInt(value);
    if (total > BigInt(maxSafeInteger)) return maxSafeInteger;
  }
  return Number(total);
}

export function roundPercentage(value: number, rate: number) {
  if (!Number.isSafeInteger(rate) || rate < 0) return 0;
  const base = BigInt(safeMoney(value));
  const percentageValue = BigInt(rate);
  const rounded = (base * percentageValue + 50n) / 100n;
  return rounded > BigInt(maxSafeInteger) ? maxSafeInteger : Number(rounded);
}

function rewardAmount(rewardValue: BaseReward, base: number, multiplier = 1) {
  const raw =
    rewardValue.kind === "FIXED"
      ? moneyProduct(rewardValue.amount ?? 0, multiplier)
      : roundPercentage(base, rewardValue.percentage ?? 0);
  const capped =
    rewardValue.maximumDiscount === null || rewardValue.maximumDiscount === undefined
      ? raw
      : Math.min(raw, rewardValue.maximumDiscount);
  return Math.min(safeMoney(base), safeMoney(capped));
}

function describeReward(rewardValue: BaseReward) {
  if (rewardValue.kind === "FIXED") return `giảm ${formatVnd(rewardValue.amount ?? 0)}`;
  const maximum = rewardValue.maximumDiscount
    ? `, tối đa ${formatVnd(rewardValue.maximumDiscount)}`
    : "";
  return `giảm ${rewardValue.percentage ?? 0}%${maximum}`;
}

function formatVnd(value: number) {
  return `${new Intl.NumberFormat("vi-VN").format(value)} ₫`;
}

function sumLineTotals(lines: Array<{ priceVnd: number; quantity: number }>) {
  return moneySum(lines.map((line) => moneyProduct(line.priceVnd, line.quantity)));
}

function quantityFor(lines: PromotionCartLine[], predicate: (line: PromotionCartLine) => boolean) {
  return lines.reduce((sum, line) => (predicate(line) ? sum + line.quantity : sum), 0);
}

function indicesFor(lines: PromotionCartLine[], predicate: (line: PromotionCartLine) => boolean) {
  return lines.map((line, index) => (predicate(line) ? index : -1)).filter((index) => index >= 0);
}

function rewardForScope(
  config: Extract<PromotionConfig, { type: "QUANTITY_DISCOUNT" }>,
  lines: PromotionCartLine[],
) {
  if (config.scope === "ENTIRE_CART") return lines.map((_, index) => index);
  if (config.scope === "SELECTED_PRODUCTS")
    return indicesFor(lines, (line) => config.productIds?.includes(line.productId) ?? false);
  return indicesFor(lines, (line) =>
    line.categoryIds.some((categoryId) => config.categoryIds?.includes(categoryId) ?? false),
  );
}

function comboIndices(
  config: Extract<PromotionConfig, { type: "COMBO_DISCOUNT" }>,
  lines: PromotionCartLine[],
) {
  return indicesFor(lines, (line) => config.items.some((item) => item.productId === line.productId));
}

function triggerQuantity(
  config: Extract<PromotionConfig, { type: "BUY_X_GET_Y" }>,
  lines: PromotionCartLine[],
) {
  return quantityFor(lines, (line) => line.productId === config.triggerProductId);
}

function comboApplications(
  config: Extract<PromotionConfig, { type: "COMBO_DISCOUNT" }>,
  lines: PromotionCartLine[],
) {
  return Math.min(
    ...config.items.map((item) =>
      Math.floor(quantityFor(lines, (line) => line.productId === item.productId) / item.quantity),
    ),
  );
}

type Candidate = {
  promotion: PromotionDefinition;
  estimate: number;
  scope: "LINE" | "CART" | "GIFT";
  eligible: boolean;
};

function evaluateCandidate(promotion: PromotionDefinition, lines: PromotionCartLine[]): Candidate {
  const subtotal = sumLineTotals(lines);
  const config = promotion.config;
  if (config.type === "ORDER_FIXED_DISCOUNT")
    return { promotion, scope: "CART", eligible: subtotal >= config.minimumSubtotal, estimate: Math.min(subtotal, config.discountAmount) };
  if (config.type === "ORDER_PERCENTAGE_DISCOUNT")
    return { promotion, scope: "CART", eligible: subtotal >= config.minimumSubtotal, estimate: Math.min(subtotal, config.maximumDiscount ? Math.min(roundPercentage(subtotal, config.percentage), config.maximumDiscount) : roundPercentage(subtotal, config.percentage)) };
  if (config.type === "ORDER_GIFT")
    return { promotion, scope: "GIFT", eligible: subtotal >= config.minimumSubtotal, estimate: 0 };
  if (config.type === "BUY_X_GET_Y") {
    const quantity = triggerQuantity(config, lines);
    return { promotion, scope: "GIFT", eligible: quantity >= config.requiredQuantity, estimate: 0 };
  }
  if (config.type === "PRODUCT_DISCOUNT") {
    const target = indicesFor(lines, (line) => config.productIds.includes(line.productId));
    const estimate = target.reduce((sum, index) => {
      const line = lines[index];
      return sum + (config.reward.kind === "FIXED"
        ? moneyProduct(Math.min(line.priceVnd, config.reward.amount ?? 0), line.quantity)
        : rewardAmount(config.reward, moneyProduct(line.priceVnd, line.quantity)));
    }, 0);
    return { promotion, scope: "LINE", eligible: target.length > 0, estimate };
  }
  if (config.type === "CATEGORY_DISCOUNT") {
    const target = indicesFor(lines, (line) => line.categoryIds.some((id) => config.categoryIds.includes(id)));
    const estimate = target.reduce((sum, index) => {
      const line = lines[index];
      return sum + (config.reward.kind === "FIXED"
        ? moneyProduct(Math.min(line.priceVnd, config.reward.amount ?? 0), line.quantity)
        : rewardAmount(config.reward, moneyProduct(line.priceVnd, line.quantity)));
    }, 0);
    return { promotion, scope: "LINE", eligible: target.length > 0, estimate };
  }
  if (config.type === "QUANTITY_DISCOUNT") {
    const target = rewardForScope(config, lines);
    const count = target.reduce((sum, index) => sum + lines[index].quantity, 0);
    const applications = config.allowRepeatedApplications ? Math.floor(count / config.requiredQuantity) : 1;
    return { promotion, scope: "CART", eligible: count >= config.requiredQuantity, estimate: rewardAmount(config.reward, sumLineTotals(target.map((index) => lines[index])), Math.max(1, applications)) };
  }
  if (config.type === "COMBO_DISCOUNT") {
    const applications = comboApplications(config, lines);
    const target = comboIndices(config, lines);
    return { promotion, scope: "CART", eligible: applications >= 1, estimate: rewardAmount(config.reward, sumLineTotals(target.map((index) => lines[index])), Math.max(1, config.allowRepeatedApplications ? applications : 1)) };
  }
  const tier = [...config.tiers].reverse().find((item) => subtotal >= item.threshold);
  return { promotion, scope: "CART", eligible: Boolean(tier), estimate: tier ? rewardAmount(tier.reward, subtotal) : 0 };
}

function sortCandidates(left: Candidate, right: Candidate) {
  return (
    right.promotion.priority - left.promotion.priority ||
    right.estimate - left.estimate ||
    left.promotion.createdAt.localeCompare(right.promotion.createdAt) ||
    left.promotion.id.localeCompare(right.promotion.id)
  );
}

function allocateDiscount(
  lines: Array<{ currentTotal: number; discount: number }>,
  indexes: number[],
  discount: number,
) {
  let remaining = Math.max(0, discount);
  indexes.forEach((index) => {
    if (!remaining) return;
    const line = lines[index];
    const amount = Math.min(line.currentTotal, remaining);
    line.currentTotal -= amount;
    line.discount += amount;
    remaining -= amount;
  });
  return discount - remaining;
}

function productGift(
  promotionId: string,
  productId: string,
  quantity: number,
  catalog: Map<string, PromotionCatalogProduct>,
) {
  const product = catalog.get(productId);
  if (!product || product.productStatus !== "AVAILABLE" || product.availability !== "AVAILABLE")
    return null;
  if (
    product.trackInventory &&
    (product.availableQuantity ?? 0) < quantity
  )
    return null;
  return {
    promotionId,
    productId: product.productId,
    variantId: product.variantId,
    productName: product.productName,
    variantName: product.variantName,
    sku: product.sku,
    imageKey: product.imageKey,
    unitPriceVnd: 0,
    quantity,
    lineTotalVnd: 0,
    isPromotionGift: true,
    ...(product.trackInventory
      ? { trackInventory: true, availableQuantity: product.availableQuantity ?? 0 }
      : {}),
  } satisfies PromotionGiftItem;
}

function progressFor(
  candidate: Candidate,
  lines: PromotionCartLine[],
): PromotionProgress | null {
  if (candidate.promotion.config.type === "TIERED_DISCOUNT") {
    const subtotal = sumLineTotals(lines);
    const tiers = candidate.promotion.config.tiers;
    const next = tiers.find((tier) => tier.threshold > subtotal);
    if (!next) return null;
    const current = [...tiers].reverse().find((tier) => tier.threshold <= subtotal);
    return {
      promotionId: candidate.promotion.id,
      promotionName: candidate.promotion.name,
      type: candidate.promotion.type,
      priority: candidate.promotion.priority,
      remainingAmountVnd: next.threshold - subtotal,
      currentReward: current ? describeReward(current.reward) : undefined,
      nextReward: describeReward(next.reward),
      message: `${current ? `Bạn đang được ${describeReward(current.reward)}. ` : ""}Mua thêm ${formatVnd(next.threshold - subtotal)} để được ${describeReward(next.reward)}.`,
    };
  }
  if (candidate.eligible) return null;
  const config = candidate.promotion.config;
  const subtotal = sumLineTotals(lines);
  if (config.type === "ORDER_FIXED_DISCOUNT" || config.type === "ORDER_PERCENTAGE_DISCOUNT" || config.type === "ORDER_GIFT") {
    const remaining = config.minimumSubtotal - subtotal;
    return {
      promotionId: candidate.promotion.id,
      promotionName: candidate.promotion.name,
      type: candidate.promotion.type,
      priority: candidate.promotion.priority,
      remainingAmountVnd: remaining,
      nextReward: config.type === "ORDER_FIXED_DISCOUNT" ? `giảm ${formatVnd(config.discountAmount)}` : config.type === "ORDER_PERCENTAGE_DISCOUNT" ? describeReward({ kind: "PERCENTAGE", percentage: config.percentage, maximumDiscount: config.maximumDiscount }) : `nhận quà x${config.giftQuantity}`,
      message: `Mua thêm ${formatVnd(remaining)} để ${config.type === "ORDER_GIFT" ? `nhận quà x${config.giftQuantity}` : "được ưu đãi"}.`,
    };
  }
  if (config.type === "BUY_X_GET_Y") {
    const count = triggerQuantity(config, lines);
    const remaining = Math.max(0, config.requiredQuantity - count);
    return {
      promotionId: candidate.promotion.id,
      promotionName: candidate.promotion.name,
      type: candidate.promotion.type,
      priority: candidate.promotion.priority,
      remainingQuantity: remaining,
      nextReward: `tặng ${config.rewardQuantity}`,
      message: `Mua thêm ${remaining} sản phẩm để nhận quà.`,
    };
  }
  if (config.type === "QUANTITY_DISCOUNT") {
    const indexes = rewardForScope(config, lines);
    const count = indexes.reduce((sum, index) => sum + lines[index].quantity, 0);
    const remaining = Math.max(0, config.requiredQuantity - count);
    return {
      promotionId: candidate.promotion.id,
      promotionName: candidate.promotion.name,
      type: candidate.promotion.type,
      priority: candidate.promotion.priority,
      remainingQuantity: remaining,
      nextReward: describeReward(config.reward),
      message: `Bạn đã mua ${count}/${config.requiredQuantity} sản phẩm để ${describeReward(config.reward)}.`,
    };
  }
  if (config.type === "COMBO_DISCOUNT") {
    const missing = config.items
      .map((item) => {
        const current = quantityFor(lines, (line) => line.productId === item.productId);
        return Math.max(0, item.quantity - current);
      })
      .reduce((sum, value) => sum + value, 0);
    return {
      promotionId: candidate.promotion.id,
      promotionName: candidate.promotion.name,
      type: candidate.promotion.type,
      priority: candidate.promotion.priority,
      remainingQuantity: missing,
      nextReward: describeReward(config.reward),
      message: `Bổ sung ${missing} sản phẩm còn thiếu để ${describeReward(config.reward)}.`,
    };
  }
  return null;
}

export function evaluatePromotions(input: PromotionEvaluationInput): PromotionEvaluationResult {
  const now = input.now ?? new Date();
  const lines = input.cart.map((line) => ({ ...line, categoryIds: [...line.categoryIds] }));
  const subtotalVnd = sumLineTotals(lines);
  const candidates = input.promotions
    .filter((promotion) => isPromotionRunning(promotion, now))
    .map((promotion) => evaluateCandidate(promotion, lines))
    .filter((candidate) => candidate.eligible)
    .sort(sortCandidates);
  const exclusive = candidates.find((candidate) => !candidate.promotion.stackable);
  const selected = candidates
    .filter((candidate) => candidate.promotion.stackable || candidate === exclusive)
    .sort((left, right) => {
      const leftOrder = left.scope === "LINE" ? 0 : 1;
      const rightOrder = right.scope === "LINE" ? 0 : 1;
      return leftOrder - rightOrder || sortCandidates(left, right);
    });
  const currentLines = lines.map((line) => ({
    currentTotal: moneyProduct(line.priceVnd, line.quantity),
    discount: 0,
  }));
  const catalog = new Map((input.catalog ?? []).map((product) => [product.productId, product]));
  const appliedPromotions: AppliedPromotion[] = [];
  const gifts: PromotionGiftItem[] = [];
  selected.forEach((candidate) => {
    const config = candidate.promotion.config;
    const target = candidate.scope === "LINE"
      ? config.type === "PRODUCT_DISCOUNT"
        ? indicesFor(lines, (line) => config.productIds.includes(line.productId))
        : config.type === "CATEGORY_DISCOUNT"
          ? indicesFor(lines, (line) => line.categoryIds.some((id) => config.categoryIds.includes(id)))
          : []
      : config.type === "QUANTITY_DISCOUNT"
        ? rewardForScope(config, lines)
        : config.type === "COMBO_DISCOUNT"
          ? comboIndices(config, lines)
          : lines.map((_, index) => index);
    let discount = 0;
    let giftItems: PromotionGiftItem[] = [];
    let giftUnavailable = false;
    if (config.type === "PRODUCT_DISCOUNT" || config.type === "CATEGORY_DISCOUNT") {
      let maximum = config.reward.maximumDiscount ?? maxSafeInteger;
      target.forEach((index) => {
        if (!maximum) return;
        const line = lines[index];
        const base = currentLines[index].currentTotal;
        const raw = config.reward.kind === "FIXED"
          ? Math.min(base, moneyProduct(config.reward.amount ?? 0, line.quantity))
          : rewardAmount(config.reward, base);
        const amount = Math.min(raw, maximum);
        discount = safeMoney(discount + allocateDiscount(currentLines, [index], amount));
        maximum -= amount;
      });
    } else if (config.type === "ORDER_FIXED_DISCOUNT") {
      discount = allocateDiscount(currentLines, target, config.discountAmount);
    } else if (config.type === "ORDER_PERCENTAGE_DISCOUNT") {
      discount = allocateDiscount(currentLines, target, rewardAmount({ kind: "PERCENTAGE", percentage: config.percentage, maximumDiscount: config.maximumDiscount }, currentLines.reduce((sum, line) => sum + line.currentTotal, 0)));
    } else if (config.type === "QUANTITY_DISCOUNT") {
      const count = target.reduce((sum, index) => sum + lines[index].quantity, 0);
      const multiplier = config.allowRepeatedApplications ? Math.floor(count / config.requiredQuantity) : 1;
      const base = target.reduce((sum, index) => sum + currentLines[index].currentTotal, 0);
      discount = allocateDiscount(currentLines, target, rewardAmount(config.reward, base, Math.max(1, multiplier)));
    } else if (config.type === "COMBO_DISCOUNT") {
      const applications = comboApplications(config, lines);
      const base = target.reduce((sum, index) => sum + currentLines[index].currentTotal, 0);
      discount = allocateDiscount(currentLines, target, rewardAmount(config.reward, base, Math.max(1, config.allowRepeatedApplications ? applications : 1)));
    }
    if (config.type === "ORDER_GIFT") {
      const gift = productGift(candidate.promotion.id, config.giftProductId, config.giftQuantity, catalog);
      if (gift) giftItems = [gift];
      else giftUnavailable = true;
    } else if (config.type === "BUY_X_GET_Y") {
      const quantity = triggerQuantity(config, lines);
      const applications = config.allowRepeatedApplications ? Math.floor(quantity / config.requiredQuantity) : 1;
      const gift = productGift(candidate.promotion.id, config.rewardProductId, config.rewardQuantity * Math.max(1, applications), catalog);
      if (gift) giftItems = [gift];
      else giftUnavailable = true;
    } else if (config.type === "TIERED_DISCOUNT") {
      const tier = [...config.tiers].reverse().find((item) => subtotalVnd >= item.threshold);
      if (tier) {
        const currentSubtotal = moneySum(currentLines.map((line) => line.currentTotal));
        discount = allocateDiscount(
          currentLines,
          target,
          rewardAmount(tier.reward, currentSubtotal),
        );
      }
    }
    gifts.push(...giftItems);
    appliedPromotions.push({
      promotionId: candidate.promotion.id,
      promotionName: candidate.promotion.name,
      type: candidate.promotion.type,
      discountAmountVnd: discount,
      giftItems,
      giftUnavailable,
    });
  });
  const items = lines.map((line, index) => ({
    ...line,
    originalLineTotalVnd: moneyProduct(line.priceVnd, line.quantity),
    discountAmountVnd: currentLines[index].discount,
    lineTotalVnd: currentLines[index].currentTotal,
  }));
  const discountTotalVnd = moneySum(items.map((item) => item.discountAmountVnd));
  const progress = input.promotions
    .filter((promotion) => isPromotionRunning(promotion, now))
    .map((promotion) => evaluateCandidate(promotion, lines))
    .map((candidate) => progressFor(candidate, lines))
    .filter((value): value is PromotionProgress => Boolean(value))
    .sort((left, right) => right.priority - left.priority || (left.remainingAmountVnd ?? Number.MAX_SAFE_INTEGER) - (right.remainingAmountVnd ?? Number.MAX_SAFE_INTEGER) || (left.remainingQuantity ?? Number.MAX_SAFE_INTEGER) - (right.remainingQuantity ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 3);
  return {
    subtotalVnd,
    discountTotalVnd,
    finalTotalVnd: Math.max(0, subtotalVnd - discountTotalVnd),
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    items,
    gifts,
    appliedPromotions,
    progress,
  };
}

export function promotionTypeLabel(type: PromotionType) {
  const labels: Record<PromotionType, string> = {
    ORDER_FIXED_DISCOUNT: "Đơn đạt X giảm Y tiền",
    ORDER_PERCENTAGE_DISCOUNT: "Đơn đạt X giảm Y%",
    ORDER_GIFT: "Đơn đạt X nhận quà",
    BUY_X_GET_Y: "Mua X tặng Y",
    PRODUCT_DISCOUNT: "Theo sản phẩm",
    CATEGORY_DISCOUNT: "Theo danh mục",
    QUANTITY_DISCOUNT: "Đủ số lượng",
    COMBO_DISCOUNT: "Combo",
    TIERED_DISCOUNT: "Theo bậc",
  };
  return labels[type];
}
