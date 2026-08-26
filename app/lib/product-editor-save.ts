export type ProductEditorSavePayload = {
  images: Array<{
    id?: string;
    r2Key: string;
    altText: string;
    sortOrder: number;
  }>;
  variants: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

type SaveResponseBody = {
  id?: string;
  slug?: string;
  error?: { code?: string; message?: string; details?: unknown };
};

export type ProductEditorSaveResult =
  | { ok: true; id: string; slug?: string; created: boolean }
  | { ok: false; code?: string; message: string; details?: unknown };

type RequestProductSave = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export function getProductEditPath(productId: string) {
  return `/admin/products/${productId}/edit`;
}

export class ProductEditorSaveController {
  private productId?: string;
  private inFlight: Promise<ProductEditorSaveResult> | null = null;

  constructor(
    productId?: string,
    private readonly request: RequestProductSave = (input, init) =>
      fetch(input, init),
  ) {
    this.productId = productId;
  }

  setProductId(productId?: string) {
    this.productId = productId;
  }

  getProductId() {
    return this.productId;
  }

  save(payload: ProductEditorSavePayload) {
    // Khóa đồng bộ trước khi fetch để hai submit liên tiếp không thể tạo hai POST.
    if (this.inFlight) return null;
    const currentId = this.productId;
    const task = this.execute(currentId, payload).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = task;
    return task;
  }

  private async execute(
    currentId: string | undefined,
    payload: ProductEditorSavePayload,
  ): Promise<ProductEditorSaveResult> {
    const response = await this.request(
      currentId ? `/api/admin/products/${currentId}` : "/api/admin/products",
      {
        method: currentId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const body = (await response.json()) as SaveResponseBody;
    if (!response.ok) {
      return {
        ok: false,
        code: body.error?.code,
        message:
          body.error?.message ??
          "Chưa thể lưu sản phẩm. Vui lòng kiểm tra slug và SKU.",
        details: body.error?.details,
      };
    }
    if (!body.id) {
      return {
        ok: false,
        message: "Phản hồi lưu sản phẩm không có Product ID.",
      };
    }
    // Ghi nhớ ID ngay khi create thành công; Save kế tiếp luôn là PUT dù route chưa render lại.
    this.productId = body.id;
    return { ok: true, id: body.id, slug: body.slug, created: !currentId };
  }
}
