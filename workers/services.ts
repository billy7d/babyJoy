export type CartInputItem = { variantId: string; quantity: number; displayedPrice?: number };
export type CartSubmission = {
  submissionToken: string;
  customerName: string;
  customerPhone: string;
  customerContact?: string;
  customerNote?: string;
  acceptCurrentPrices?: boolean;
  items: CartInputItem[];
};

export type PricedItem = {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  imageKey: string | null;
  priceVnd: number;
  quantity: number;
  lineTotalVnd: number;
};

export function calculateCart(items: Array<{ priceVnd: number; quantity: number }>) {
  return {
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalVnd: items.reduce((sum, item) => sum + item.priceVnd * item.quantity, 0),
  };
}

export function validateSubmission(value: unknown): CartSubmission {
  if (!value || typeof value !== "object") throw new Error("VALIDATION_ERROR");
  const body = value as Record<string, unknown>;
  const submissionToken = stringField(body.submissionToken, 120, true);
  const customerName = stringField(body.customerName, 120, true);
  const customerPhone = stringField(body.customerPhone, 30, true);
  const customerContact = stringField(body.customerContact, 255, false);
  const customerNote = stringField(body.customerNote, 1000, false);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw new Error("VALIDATION_ERROR");
  const seen = new Set<string>();
  const items = body.items.map((item) => {
    if (!item || typeof item !== "object") throw new Error("VALIDATION_ERROR");
    const row = item as Record<string, unknown>;
    const variantId = stringField(row.variantId, 120, true);
    if (seen.has(variantId)) throw new Error("VALIDATION_ERROR");
    seen.add(variantId);
    if (!Number.isInteger(row.quantity) || Number(row.quantity) < 1 || Number(row.quantity) > 99) throw new Error("VALIDATION_ERROR");
    return { variantId, quantity: Number(row.quantity), displayedPrice: typeof row.displayedPrice === "number" ? row.displayedPrice : undefined };
  });
  return { submissionToken, customerName, customerPhone, customerContact, customerNote, acceptCurrentPrices: body.acceptCurrentPrices === true, items };
}

function stringField(value: unknown, max: number, required: boolean): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if ((required && !normalized) || normalized.length > max) throw new Error("VALIDATION_ERROR");
  return normalized;
}

export function generatePublicCode(now = new Date(), bytes?: Uint8Array): string {
  const source = bytes ?? crypto.getRandomValues(new Uint8Array(4));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const suffix = Array.from(source, (byte) => alphabet[byte % alphabet.length]).join("").slice(0, 4);
  const year = String(now.getUTCFullYear()).slice(-2);
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `GH-${year}${month}${day}-${suffix}`;
}

function formatVnd(value: number) {
  return `${new Intl.NumberFormat("vi-VN").format(value)} ₫`;
}

export function composeTelegramMessage(request: { code: string; createdAt: string; customerName: string; customerPhone: string; customerContact?: string; customerNote?: string; items: PricedItem[]; totalQuantity: number; subtotalVnd: number }) {
  const lines = ["GIỎ HÀNG MỚI", "", `Mã: ${request.code}`, `Thời gian: ${request.createdAt}`, "", "Khách hàng:", request.customerName, request.customerPhone];
  if (request.customerContact) lines.push(request.customerContact);
  lines.push("");
  request.items.forEach((item, index) => lines.push(`${index + 1}. ${item.productName}`, item.variantName, `${formatVnd(item.priceVnd)} × ${item.quantity}`, `Thành tiền: ${formatVnd(item.lineTotalVnd)}`, ""));
  lines.push(`Tổng số lượng: ${request.totalQuantity}`, `Tạm tính: ${formatVnd(request.subtotalVnd)}`);
  if (request.customerNote) lines.push("", "Ghi chú:", request.customerNote);
  return lines.join("\n");
}

export function splitTelegramMessage(message: string, maxLength = 4000): string[] {
  if (message.length <= maxLength) return [message];
  const chunks: string[] = [];
  let remaining = message;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);
    if (cut < maxLength / 2) cut = maxLength;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export const statusLabels: Record<string, string> = {
  SUBMITTED: "Mới",
  CONTACTED: "Đã liên hệ",
  CONFIRMED: "Đã xác nhận",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};
