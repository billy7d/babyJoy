import {
  getVariantStatus,
  type Availability,
  type ProductImageRecord,
  type Variant,
  type VariantStatus,
} from "./catalog";

/** Trạng thái phân loại có thể chỉnh sửa trong Product Editor. */
export type EditableVariant = {
  id?: string;
  clientId: string;
  name: string;
  packageSize: string;
  sku: string;
  priceVnd: string;
  compareAtPriceVnd: string;
  availability: Availability;
  status: VariantStatus;
  trackInventory: boolean;
  stockOnHand: string;
  reservedQuantity?: number;
  availableQuantity?: number;
  images: Array<ProductImageRecord & { isPrimary: boolean; variantId?: string }>;
};

/** Tạo khóa tạm ổn định cho row draft mà không phụ thuộc SKU đang chỉnh sửa. */
export function createVariantClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createDraftVariant(): EditableVariant {
  return {
    clientId: createVariantClientId(),
    name: "",
    packageSize: "",
    sku: "",
    priceVnd: "",
    compareAtPriceVnd: "",
    availability: "AVAILABLE",
    status: "SELLING",
    trackInventory: true,
    stockOnHand: "0",
    reservedQuantity: 0,
    availableQuantity: 0,
    images: [],
  };
}

export function toEditableVariant(variant: Variant): EditableVariant {
  return {
    id: variant.id,
    clientId: variant.id,
    name: variant.name,
    packageSize: variant.packageSize ?? "",
    sku: variant.sku ?? "",
    priceVnd: String(variant.priceVnd),
    compareAtPriceVnd: variant.compareAtPriceVnd == null ? "" : String(variant.compareAtPriceVnd),
    availability: variant.availability,
    status: getVariantStatus(variant),
    trackInventory: Boolean(variant.trackInventory),
    stockOnHand: String(variant.stockOnHand ?? 0),
    reservedQuantity: variant.reservedQuantity ?? 0,
    availableQuantity: variant.availableQuantity ?? 0,
    images: (variant.images ?? []).map((image) => ({ ...image })),
  };
}

export type VariantField =
  | "name"
  | "packageSize"
  | "sku"
  | "priceVnd"
  | "compareAtPriceVnd"
  | "availability"
  | "status"
  | "trackInventory"
  | "stockOnHand";
export type VariantFieldErrors = Partial<Record<VariantField, string>>;

/** Kiểm tra nhanh từng row trước khi gửi; server vẫn là lớp xác thực cuối. */
export function validateEditableVariants(variants: EditableVariant[]) {
  const errors: Record<string, VariantFieldErrors> = {};
  const seenSku = new Map<string, EditableVariant>();
  variants.forEach((variant) => {
    const rowErrors: VariantFieldErrors = {};
    if (!variant.name.trim() || variant.name.trim().length > 180)
      rowErrors.name = "Tên phân loại là bắt buộc và tối đa 180 ký tự.";
    if (variant.packageSize.trim().length > 120)
      rowErrors.packageSize = "Quy cách tối đa 120 ký tự.";
    const sku = variant.sku.trim();
    if (!sku || sku.length > 120)
      rowErrors.sku = "Mã SKU là bắt buộc và tối đa 120 ký tự.";
    else {
      const previous = seenSku.get(sku);
      if (previous) {
        rowErrors.sku = "Mã SKU bị trùng trong danh sách.";
        const previousErrors = errors[previous.clientId] ?? {};
        errors[previous.clientId] = {
          ...previousErrors,
          sku: "Mã SKU bị trùng trong danh sách.",
        };
      } else seenSku.set(sku, variant);
    }
    const price = Number(variant.priceVnd);
    if (!variant.priceVnd.trim() || !Number.isSafeInteger(price) || price < 0)
      rowErrors.priceVnd = "Giá bán phải là số nguyên không âm.";
    const compareAtPrice = variant.compareAtPriceVnd.trim()
      ? Number(variant.compareAtPriceVnd)
      : null;
    if (compareAtPrice !== null && (!Number.isSafeInteger(compareAtPrice) || compareAtPrice < 0))
      rowErrors.compareAtPriceVnd = "Giá so sánh phải là số nguyên không âm.";
    if (!(["SELLING", "OUT_OF_STOCK", "HIDDEN"] as VariantStatus[]).includes(variant.status))
      rowErrors.status = "Trạng thái phân loại không hợp lệ.";
    const stockOnHand = Number(variant.stockOnHand);
    if (
      !variant.stockOnHand.trim() ||
      !Number.isSafeInteger(stockOnHand) ||
      stockOnHand < 0
    )
      rowErrors.stockOnHand = "Tồn kho thực tế phải là số nguyên không âm.";
    if (Object.keys(rowErrors).length) errors[variant.clientId] = rowErrors;
  });
  return errors;
}

/** Ánh xạ lỗi có cấu trúc từ API về đúng row đang chỉnh sửa. */
export function mapVariantValidationIssue(
  details: unknown,
  variants: EditableVariant[],
  fallbackMessage: string,
) {
  if (!details || typeof details !== "object") return {} as Record<string, VariantFieldErrors>;
  const issue = details as Record<string, unknown>;
  const field = issue.field;
  if (
    field !== "name" &&
    field !== "packageSize" &&
    field !== "sku" &&
    field !== "priceVnd" &&
    field !== "compareAtPriceVnd" &&
    field !== "availability" &&
    field !== "status" &&
    field !== "trackInventory" &&
    field !== "stockOnHand"
  )
    return {} as Record<string, VariantFieldErrors>;
  const clientId = typeof issue.clientId === "string" ? issue.clientId : "";
  const variantId = typeof issue.variantId === "string" ? issue.variantId : "";
  const value = typeof issue.value === "string" ? issue.value.trim() : "";
  const row =
    variants.find((variant) => variant.clientId === clientId) ??
    variants.find((variant) => variant.id === variantId) ??
    (field === "sku" && value
      ? variants.find((variant) => variant.sku.trim() === value)
      : undefined);
  if (!row) return {} as Record<string, VariantFieldErrors>;
  return {
    [row.clientId]: {
      [field]:
        typeof issue.message === "string" && issue.message
          ? issue.message
          : fallbackMessage,
    },
  } as Record<string, VariantFieldErrors>;
}
