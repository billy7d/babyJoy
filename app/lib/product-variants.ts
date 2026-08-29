import type { Availability, Variant } from "./catalog";

/** Trạng thái phân loại có thể chỉnh sửa trong Product Editor. */
export type EditableVariant = {
  id?: string;
  clientId: string;
  name: string;
  sku: string;
  priceVnd: string;
  compareAtPriceVnd?: number | null;
  availability: Availability;
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
    sku: "",
    priceVnd: "",
    availability: "AVAILABLE",
  };
}

export function toEditableVariant(variant: Variant): EditableVariant {
  return {
    id: variant.id,
    clientId: variant.id,
    name: variant.name,
    sku: variant.sku ?? "",
    priceVnd: String(variant.priceVnd),
    compareAtPriceVnd: variant.compareAtPriceVnd ?? null,
    availability: variant.availability,
  };
}

export type VariantField = "name" | "sku" | "priceVnd" | "availability";
export type VariantFieldErrors = Partial<Record<VariantField, string>>;

/** Kiểm tra nhanh từng row trước khi gửi; server vẫn là lớp xác thực cuối. */
export function validateEditableVariants(variants: EditableVariant[]) {
  const errors: Record<string, VariantFieldErrors> = {};
  const seenSku = new Map<string, EditableVariant>();
  variants.forEach((variant) => {
    const rowErrors: VariantFieldErrors = {};
    if (!variant.name.trim() || variant.name.trim().length > 180)
      rowErrors.name = "Tên phân loại là bắt buộc và tối đa 180 ký tự.";
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
    if (!variant.priceVnd.trim() || !Number.isSafeInteger(price) || price <= 0)
      rowErrors.priceVnd = "Giá bán phải là số nguyên lớn hơn 0.";
    if (!(["AVAILABLE", "OUT_OF_STOCK", "HIDDEN"] as Availability[]).includes(variant.availability))
      rowErrors.availability = "Tình trạng phân loại không hợp lệ.";
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
    field !== "sku" &&
    field !== "priceVnd" &&
    field !== "availability"
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
