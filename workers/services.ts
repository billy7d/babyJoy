import { getPublicImageUrl } from "../shared/images";

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

export type CartItemSnapshotRow = {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  variantName: string;
  sku: string | null;
  imageKey: string | null;
  priceVnd: number;
  quantity: number;
  lineTotalVnd: number;
  createdAt: string;
  lineType?: "STANDARD" | "COMBO";
  comboProductId?: string | null;
  comboVersion?: number | null;
  comboSelectionJson?: string | null;
  comboComponents?: CartComboComponentSnapshot[];
};

export type CartComboComponentSnapshot = {
  id: string;
  groupId: string | null;
  groupName: string;
  groupItemId: string | null;
  variantId: string | null;
  productId: string | null;
  productName: string;
  variantName: string;
  sku: string | null;
  imageKey: string | null;
  quantity: number;
  priceAdjustmentVnd: number;
  createdAt: string;
};

export function mapCartItemSnapshot(row: CartItemSnapshotRow) {
  return {
    ...row,
    // URL luôn được dựng từ khóa snapshot, không đọc ảnh hiện tại của sản phẩm.
    imageUrl: getPublicImageUrl(row.imageKey),
    ...(row.comboComponents
      ? {
          comboComponents: row.comboComponents.map((component) => ({
            ...component,
            // Thành phần lịch sử cũng phải dùng ảnh snapshot độc lập với Product hiện tại.
            imageUrl: getPublicImageUrl(component.imageKey),
          })),
        }
      : {}),
  };
}

export function calculateCart(items: Array<{ priceVnd: number; quantity: number }>) {
  return {
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalVnd: items.reduce((sum, item) => sum + item.priceVnd * item.quantity, 0),
  };
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

export const statusLabels: Record<string, string> = {
  SUBMITTED: "Mới",
  CONTACTED: "Đã liên hệ",
  CONFIRMED: "Đã xác nhận",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};
