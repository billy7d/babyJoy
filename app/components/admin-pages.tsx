import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  categories as fallbackCategories,
  formatVnd,
  type Product,
  type ProductImageRecord,
} from "../lib/catalog";
import { useCatalog } from "../lib/catalog-context";
import {
  getProductEditPath,
  ProductEditorSaveController,
  type ProductEditorSavePayload,
} from "../lib/product-editor-save";
import { AdminShell, Icon, Price, StatusBadge, Tag } from "./ui";
import { ProductImage } from "./product-image";

export function AdminProductsPage() {
  const { products, categories } = useCatalog();
  return (
    <AdminShell title="Sản Phẩm">
      <div className="admin-page-heading">
        <div>
          <h1>Sản phẩm</h1>
          <p>Quản lý thực đơn ăn dặm cho bé</p>
        </div>
        <Link className="btn primary" to="/admin/products/new">
          <Icon>add</Icon> THÊM SẢN PHẨM
        </Link>
      </div>
      <section className="admin-table-card">
        <div className="admin-table-tools">
          <div className="admin-tabs">
            <button className="active">Tất cả (24)</button>
            <button>Đang bán (18)</button>
            <button>Hết hàng (4)</button>
            <button>Đã ẩn (2)</button>
          </div>
          <label className="admin-search">
            <Icon>search</Icon>
            <input placeholder="Tìm kiếm sản phẩm..." />
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Ảnh</th>
                <th>Sản phẩm</th>
                <th>Danh mục</th>
                <th>Phân loại</th>
                <th>Giá</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {products.slice(0, 4).map((product) => (
                <tr key={product.id}>
                  <td>
                    <img className="table-thumb" src={product.image} alt="" />
                  </td>
                  <td>
                    <b>{product.name}</b>
                    <small>
                      {product.variants[0].name}, {product.shortDescription}
                    </small>
                  </td>
                  <td>
                    <Tag tone="neutral">
                      {categories.find((item) => item.slug === product.category)
                        ?.name ?? "Gia vị"}
                    </Tag>
                  </td>
                  <td>{product.variants.length} vị</td>
                  <td>
                    <Price value={product.variants[0].priceVnd} />
                  </td>
                  <td>
                    <StatusBadge status={product.variants[0].availability} />
                  </td>
                  <td>
                    <div className="row-actions">
                      <Link
                        to={`/admin/products/${product.id}/edit`}
                        aria-label="Sửa"
                      >
                        <Icon>edit</Icon>
                      </Link>
                      <button aria-label="Nhân bản">
                        <Icon>content_copy</Icon>
                      </button>
                      <button aria-label="Ẩn">
                        <Icon>visibility_off</Icon>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TableFooter text="Hiển thị 1-4 trên 24 sản phẩm" />
      </section>
    </AdminShell>
  );
}

function TableFooter({ text }: { text: string }) {
  return (
    <div className="table-footer">
      <span>{text}</span>
      <div>
        <button>‹</button>
        <button className="active">1</button>
        <button>2</button>
        <button>3</button>
        <button>›</button>
      </div>
    </div>
  );
}

export function ProductEditorPage() {
  const segments = useLocation().pathname.split("/").filter(Boolean);
  const id = segments.at(-1) === "edit" ? segments.at(-2) : undefined;
  const navigate = useNavigate();
  const { categories, refresh } = useCatalog();
  const [editing, setEditing] = useState<
    (Product & { categoryIds?: string[]; tagIds?: string[]; sortOrder?: number; status?: string }) | null
  >(null);
  const [images, setImages] = useState<ProductImageRecord[]>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [featured, setFeatured] = useState(false);
  const [visible, setVisible] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const saveControllerRef = useRef<ProductEditorSaveController | null>(null);
  const saveController =
    saveControllerRef.current ?? new ProductEditorSaveController(id);
  saveControllerRef.current = saveController;

  useEffect(() => {
    saveController.setProductId(id);
  }, [id, saveController]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const requests: Promise<Response>[] = [fetch("/api/admin/tags")];
      if (id) requests.push(fetch(`/api/admin/products/${id}`));
      const [tagsResponse, productResponse] = await Promise.all(requests);
      if (cancelled) return;
      if (tagsResponse.ok) {
        const body = (await tagsResponse.json()) as {
          data?: Array<{ id: string; name: string }>;
        };
        setTags(body.data ?? []);
      }
      if (id && productResponse?.ok) {
        const body = (await productResponse.json()) as { data: Product };
        const product = body.data as Product & {
          categoryIds?: string[];
          tagIds?: string[];
          sortOrder?: number;
          status?: string;
        };
        setEditing(product);
        setImages(product.images ?? []);
        setFeatured(Boolean(product.featured));
        setVisible(product.status !== "HIDDEN");
      } else if (id) {
        setMessage("Không tải được dữ liệu sản phẩm.");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const uploadFiles = async (files: FileList | null, makePrimary: boolean) => {
    if (!files?.length) return;
    setUploading(true);
    setMessage("Đang tải ảnh lên R2...");
    try {
      const uploaded: ProductImageRecord[] = [];
      for (const file of Array.from(files)) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
          throw new Error("Chỉ hỗ trợ JPEG, PNG và WebP.");
        if (file.size > 5 * 1024 * 1024)
          throw new Error("Mỗi ảnh phải nhỏ hơn hoặc bằng 5MB.");
        const response = await fetch("/api/admin/images", {
          method: "POST",
          headers: { "content-type": file.type },
          body: file,
        });
        const body = (await response.json()) as {
          key?: string;
          url?: string;
          error?: { message?: string };
        };
        if (!response.ok || !body.key || !body.url)
          throw new Error(body.error?.message ?? "Tải ảnh lên R2 thất bại.");
        uploaded.push({
          r2Key: body.key,
          url: body.url,
          altText: editing?.name ?? "Ảnh sản phẩm BabyJoy",
          sortOrder: 0,
        });
      }
      setImages((current) =>
        (makePrimary ? [...uploaded, ...current] : [...current, ...uploaded]).map(
          (image, sortOrder) => ({ ...image, sortOrder }),
        ),
      );
      setMessage("Đã tải ảnh lên R2. Hãy lưu sản phẩm để gắn ảnh.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Tải ảnh thất bại.");
    } finally {
      setUploading(false);
    }
  };

  const moveImage = (index: number, offset: number) => {
    setImages((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((image, sortOrder) => ({ ...image, sortOrder }));
    });
  };

  const makePrimary = (index: number) => {
    setImages((current) => {
      const next = [...current];
      const [selected] = next.splice(index, 1);
      next.unshift(selected);
      return next.map((image, sortOrder) => ({ ...image, sortOrder }));
    });
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("Đang lưu...");
    const form = new FormData(event.currentTarget);
    const payload: ProductEditorSavePayload = {
      name: form.get("name"),
      slug: form.get("slug"),
      brand: form.get("brand"),
      shortDescription: form.get("shortDescription"),
      description: form.get("description"),
      status: visible ? "AVAILABLE" : "HIDDEN",
      featured,
      sortOrder: Number(form.get("sortOrder")),
      categoryIds: form.get("categoryId") ? [String(form.get("categoryId"))] : [],
      tagIds: form.getAll("tagIds"),
      images: images.map(({ id: imageId, r2Key, altText }, sortOrder) => ({
        id: imageId,
        r2Key,
        altText,
        sortOrder,
      })),
      variants: [
        {
          id: editing?.variants[0].id,
          name: form.get("variantName"),
          sku: form.get("sku"),
          priceVnd: Number(form.get("priceVnd")),
          availability: visible ? "AVAILABLE" : "HIDDEN",
        },
      ],
    };
    const task = saveController.save(payload);
    if (!task) return;
    setSaving(true);
    try {
      const result = await task;
      if (result.ok) {
        setMessage("Đã lưu sản phẩm và liên kết ảnh R2.");
        await refresh();
        if (result.created)
          navigate(getProductEditPath(result.id), { replace: true });
      } else {
        setMessage(result.message);
      }
    } catch {
      setMessage("Chưa thể lưu sản phẩm. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <AdminShell title="Sản Phẩm">
      <form
        className="product-editor"
        onSubmit={save}
        key={editing?.id ?? (id ? "loading" : "new")}
      >
        <div className="editor-heading">
          <div>
            <h1>{editing ? "Sửa sản phẩm" : "Thêm sản phẩm"}</h1>
            <p>Quản lý và cập nhật thông tin sản phẩm mới. {message}</p>
          </div>
          <div>
            <Link to="/admin/products">HỦY</Link>
            <button
              className="btn primary"
              type="submit"
              disabled={saving || uploading || Boolean(id && !editing)}
            >
              <Icon>save</Icon> LƯU SẢN PHẨM
            </button>
          </div>
        </div>
        <div className="editor-grid">
          <div className="editor-main">
            <EditorCard icon="info" title="Thông tin chung">
              <label>
                Tên sản phẩm *
                <input
                  name="name"
                  required
                  defaultValue={editing?.name}
                  placeholder="Nhập tên sản phẩm..."
                />
              </label>
              <div className="form-grid">
                <label>
                  Đường dẫn (Slug)
                  <input
                    name="slug"
                    defaultValue={editing?.slug}
                    placeholder="tu-dong-tao-tu-ten..."
                  />
                </label>
                <label>
                  Thương hiệu
                  <select name="brand" defaultValue={editing?.brand ?? ""}>
                    <option value="">Chọn thương hiệu...</option>
                    {["Gerber", "Heinz", "HiPP", "Khác"].map((brand) => (
                      <option key={brand}>{brand}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Mô tả ngắn
                <textarea
                  name="shortDescription"
                  className="short"
                  defaultValue={editing?.shortDescription}
                  placeholder="Tóm tắt công dụng hoặc đặc điểm nổi bật..."
                />
              </label>
              <label>
                Mô tả chi tiết
                <textarea
                  name="description"
                  defaultValue={editing?.description}
                  placeholder="Nhập chi tiết thành phần, hướng dẫn sử dụng, bảo quản..."
                />
              </label>
            </EditorCard>
            <EditorCard
              icon="view_list"
              title="Phân loại & Giá bán"
              action="+ Thêm phân loại"
            >
              <div className="variant-table">
                <div className="variant-head">
                  <span>Tên phân loại</span>
                  <span>Mã SKU</span>
                  <span>Giá bán (₫)</span>
                  <span>Tình trạng</span>
                </div>
                <div>
                  <input
                    name="variantName"
                    defaultValue={editing?.variants[0].name ?? "Mặc định"}
                  />
                  <input
                    name="sku"
                    defaultValue={editing?.variants[0].sku ?? "SP-001"}
                  />
                <input
                  name="priceVnd"
                  type="number"
                    defaultValue={editing?.variants[0].priceVnd ?? 89000}
                  />
                  <StatusBadge status="AVAILABLE" />
                  <button type="button">
                    <Icon>delete</Icon>
                  </button>
                </div>
              </div>
            </EditorCard>
          </div>
          <aside className="editor-side">
            <EditorCard icon="image" title="Hình ảnh">
              <label>Ảnh chính (Ảnh đại diện)</label>
              <label className="upload-box">
                <Icon>add_photo_alternate</Icon>
                <b>Tải ảnh lên</b>
                <span>hoặc kéo thả vào đây</span>
                <small>PNG, JPG, WebP (Max 5MB)</small>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onChange={(event) => void uploadFiles(event.target.files, true)}
                />
              </label>
              {images.length > 0 && (
                <div className="editor-image-list">
                  {images.map((image, index) => (
                    <div key={image.r2Key} className="editor-image-item">
                      <ProductImage image={image} alt={image.altText} />
                      <span>{index === 0 ? "Ảnh chính" : `Ảnh ${index + 1}`}</span>
                      <div>
                        <button
                          type="button"
                          aria-label="Chọn làm ảnh chính"
                          disabled={index === 0}
                          onClick={() => makePrimary(index)}
                        >
                          <Icon>star</Icon>
                        </button>
                        <button
                          type="button"
                          aria-label="Đưa ảnh lên trước"
                          disabled={index === 0}
                          onClick={() => moveImage(index, -1)}
                        >
                          <Icon>arrow_upward</Icon>
                        </button>
                        <button
                          type="button"
                          aria-label="Đưa ảnh xuống sau"
                          disabled={index === images.length - 1}
                          onClick={() => moveImage(index, 1)}
                        >
                          <Icon>arrow_downward</Icon>
                        </button>
                        <button
                          type="button"
                          aria-label="Gỡ ảnh khỏi sản phẩm"
                          onClick={() =>
                            setImages((current) =>
                              current
                                .filter((_, itemIndex) => itemIndex !== index)
                                .map((item, sortOrder) => ({ ...item, sortOrder })),
                            )
                          }
                        >
                          <Icon>delete</Icon>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <label>Thư viện ảnh</label>
              <label className="gallery-add">
                <Icon>add</Icon>
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onChange={(event) => void uploadFiles(event.target.files, false)}
                />
              </label>
            </EditorCard>
            <EditorCard icon="sell" title="Phân loại & Tags">
              <label>
                Danh mục chính
                <select
                  name="categoryId"
                  defaultValue={
                    editing?.categoryIds?.[0] ??
                    categories.find(
                      (category) => category.slug === editing?.category,
                    )?.id ??
                    ""
                  }
                >
                  <option value="">Chọn danh mục...</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>Độ tuổi phù hợp</label>
              <div className="editor-chips">
                {["4+ tháng", "6+ tháng", "8+ tháng", "12+ tháng"].map(
                  (age) => (
                    <button
                      type="button"
                      className={
                        age === (editing?.age ?? "6+ tháng") ? "active" : ""
                      }
                      key={age}
                    >
                      {age}
                    </button>
                  ),
                )}
              </div>
              <label>Đặc điểm nổi bật (Tags)</label>
              <div className="selected-tags">
                {tags.map((tag) => (
                  <label key={tag.id} className="tag-choice">
                    <input
                      type="checkbox"
                      name="tagIds"
                      value={tag.id}
                      defaultChecked={editing?.tagIds?.includes(tag.id)}
                    />
                    <Tag>{tag.name}</Tag>
                  </label>
                ))}
              </div>
              <button className="outline-add" type="button">
                <Icon>add</Icon> Thêm tag
              </button>
            </EditorCard>
            <EditorCard icon="visibility" title="Trạng thái hiển thị">
              <Toggle
                label="Đang bán (Hiển thị)"
                description="Cho phép khách hàng mua sản phẩm này"
                value={visible}
                onChange={setVisible}
              />
              <Toggle
                label="Sản phẩm nổi bật"
                description="Gắn huy hiệu nổi bật trên trang chủ"
                value={featured}
                onChange={setFeatured}
              />
              <label>
                Thứ tự hiển thị (Tùy chọn)
                <input name="sortOrder" type="number" defaultValue={0} />
              </label>
            </EditorCard>
          </aside>
        </div>
      </form>
    </AdminShell>
  );
}

function EditorCard({
  icon,
  title,
  action,
  children,
}: {
  icon: string;
  title: string;
  action?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="editor-card">
      <div className="editor-card-title">
        <span>
          <Icon>{icon}</Icon>
          <h2>{title}</h2>
        </span>
        {action && <button type="button">{action}</button>}
      </div>
      {children}
    </section>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div>
        <b>{label}</b>
        <small>{description}</small>
      </div>
      <button
        type="button"
        className={`toggle ${value ? "on" : ""}`}
        onClick={() => onChange(!value)}
        aria-pressed={value}
      >
        <span />
      </button>
    </div>
  );
}

export function AdminCartRequestsPage() {
  const [scope, setScope] = useState<"queue" | "share" | "messenger">("queue");
  const [requests, setRequests] = useState<
    Array<{
      id: string;
      publicCode: string;
      customerName: string;
      customerPhone: string;
      itemLineCount: number;
      totalQuantity: number;
      subtotalVnd: number;
      status: string;
      telegramStatus: string;
      contactChannel: "LEGACY" | "MESSENGER" | "SHARE";
      messengerDeliveryStatus: string;
      messengerSessionStatus: string | null;
      createdAt: string;
    }>
  >([]);
  useEffect(() => {
    void fetch(`/api/admin/cart-requests?scope=${scope}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("REQUESTS_LOAD_FAILED");
        return response.json() as Promise<{ data?: typeof requests }>;
      })
      .then((body) => setRequests(body.data ?? []))
      .catch(() => setRequests([]));
  }, [scope]);
  return (
    <AdminShell title="Giỏ Hàng Gửi Đến">
      <div className="requests-heading">
        <div>
          <h1>Giỏ hàng gửi đến</h1>
          <p>
            Quản lý yêu cầu giỏ hàng và trạng thái gửi đến kênh liên hệ của
            khách hàng.
          </p>
        </div>
        <label className="admin-search">
          <Icon>search</Icon>
          <input placeholder="Tìm theo mã GH, SĐT..." />
        </label>
        <button className="filter-advanced">
          <Icon>filter_list</Icon>Lọc nâng cao
        </button>
      </div>
      <div className="request-tabs">
        <button
          className={scope === "queue" ? "active" : ""}
          onClick={() => setScope("queue")}
        >
          Hàng chờ xử lý
        </button>
        <button
          className={scope === "share" ? "active" : ""}
          onClick={() => setScope("share")}
        >
          Chia sẻ thủ công
        </button>
        <button
          className={scope === "messenger" ? "active" : ""}
          onClick={() => setScope("messenger")}
        >
          Theo dõi Messenger
        </button>
      </div>
      <section className="admin-table-card request-table">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mã giỏ hàng</th>
                <th>Khách hàng</th>
                <th>Thời gian</th>
                <th>Số mặt hàng</th>
                <th>Tạm tính</th>
                <th>Trạng thái</th>
                <th>Kênh</th>
                <th>Trạng thái gửi</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>
                    <Link
                      className="request-code"
                      to={`/admin/cart-requests/${request.id}`}
                    >
                      {request.publicCode}
                    </Link>
                  </td>
                  <td>
                    <b>{request.customerName || (request.contactChannel === "SHARE" ? "Khách chia sẻ" : "Khách Messenger")}</b>
                    {request.customerPhone ? (
                      <small>
                        <Icon>call</Icon>
                        {request.customerPhone}
                      </small>
                    ) : (
                      <small>
                        {request.contactChannel === "SHARE"
                          ? "Khách tự gửi thông tin tới người bán"
                          : "Trao đổi trực tiếp trên Messenger"}
                      </small>
                    )}
                  </td>
                  <td>
                    {new Date(request.createdAt).toLocaleTimeString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    <small>{new Date(request.createdAt).toLocaleDateString("vi-VN")}</small>
                  </td>
                  <td>
                    <Tag tone="neutral">
                      {request.itemLineCount} mặt hàng • SL {request.totalQuantity}
                    </Tag>
                  </td>
                  <td>
                    <Price value={request.subtotalVnd} />
                  </td>
                  <td>
                    <StatusBadge status={request.status} />
                  </td>
                  <td>
                    <StatusBadge status={request.contactChannel} />
                  </td>
                  <td>
                    <StatusBadge
                      status={
                        request.contactChannel === "SHARE"
                          ? "SHARE_READY"
                          : request.contactChannel === "MESSENGER"
                          ? request.messengerDeliveryStatus === "PENDING"
                            ? request.messengerSessionStatus || "CREATED"
                            : request.messengerDeliveryStatus
                          : request.telegramStatus
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TableFooter text={`Hiển thị ${requests.length} giỏ hàng`} />
      </section>
    </AdminShell>
  );
}

export function AdminCartRequestDetailPage() {
  const requestId =
    useLocation().pathname.split("/").filter(Boolean).at(-1) ??
    "request-canonical";
  const [status, setStatus] = useState("SUBMITTED");
  const [telegram, setTelegram] = useState("FAILED");
  const [messengerDelivery, setMessengerDelivery] = useState("PENDING");
  const [detail, setDetail] = useState<{
    publicCode: string;
    customerName: string | null;
    customerPhone: string | null;
    customerNote?: string | null;
    itemLineCount: number;
    totalQuantity: number;
    subtotalVnd: number;
    status: string;
    telegramStatus: string;
    contactChannel: "LEGACY" | "MESSENGER" | "SHARE";
    messengerDeliveryStatus: string;
    messengerSessionStatus: string | null;
    messengerConfirmedAt: string | null;
    messengerSentAt: string | null;
    messengerAttemptCount: number;
    messengerLastErrorCode: string | null;
    messengerLastError: string | null;
    messengerLastUserInteractionAt: string | null;
    messengerLinked: number;
    createdAt: string;
    items: Array<{
      id: string;
      productName: string;
      variantName: string;
      imageKey: string | null;
      imageUrl: string;
      priceVnd: number;
      quantity: number;
      lineTotalVnd: number;
    }>;
  } | null>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/admin/cart-requests/${requestId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("REQUEST_LOAD_FAILED");
        return response.json() as Promise<{ data: NonNullable<typeof detail> }>;
      })
      .then((body) => {
        if (cancelled) return;
        setDetail(body.data);
        setStatus(body.data.status);
        setTelegram(body.data.telegramStatus);
        setMessengerDelivery(body.data.messengerDeliveryStatus);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Không tải được giỏ hàng từ D1.");
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);
  const updateStatus = async () => {
    const response = await fetch(
      `/api/admin/cart-requests/${requestId}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    if (!response.ok) window.alert("Chưa thể cập nhật trạng thái.");
  };
  const retryTelegram = async () => {
    const response = await fetch(
      `/api/admin/cart-requests/${requestId}/retry-telegram`,
      { method: "POST" },
    );
    if (response.ok) setTelegram("SENT");
    else window.alert("Chưa thể gửi Telegram. Kiểm tra secret và thử lại.");
  };
  const retryMessenger = async () => {
    const response = await fetch(
      `/api/admin/cart-requests/${requestId}/retry-messenger`,
      { method: "POST" },
    );
    const body = (await response.json()) as {
      messengerDeliveryStatus?: string;
      error?: { message?: string };
    };
    if (response.ok) setMessengerDelivery("SENT");
    else window.alert(body.error?.message || "Chưa thể gửi lại Messenger.");
  };
  if (!detail)
    return (
      <AdminShell title="Giỏ Hàng Gửi Đến">
        <div className="empty-state">
          <Icon>{loadError ? "error" : "progress_activity"}</Icon>
          <p>{loadError || "Đang tải dữ liệu giỏ hàng..."}</p>
        </div>
      </AdminShell>
    );
  return (
    <AdminShell title="Giỏ Hàng Gửi Đến">
      <div className="request-detail-heading">
        <div>
          <span>
            CHI TIẾT YÊU CẦU • {new Date(detail.createdAt).toLocaleString("vi-VN")}
          </span>
          <h1>
            {detail.publicCode} <StatusBadge status={status} />
          </h1>
        </div>
        <div>
          <button className="btn secondary-btn">In Phiếu</button>
          {detail.contactChannel !== "SHARE" && (
            <button className="btn primary">Liên Hệ Khách Hàng</button>
          )}
        </div>
      </div>
      <div className="request-detail-grid">
        <div>
          <section className="detail-admin-card customer-card">
            <div className="card-title">
              <h2>
                <Icon>person</Icon> Thông tin Khách hàng
              </h2>
              <button>Chỉnh sửa</button>
            </div>
            <div className="customer-fields">
              <div>
                <span>Tên khách hàng</span>
                <b>{detail.customerName || (detail.contactChannel === "SHARE" ? "Khách chia sẻ" : "Khách Messenger")}</b>
              </div>
              <div>
                <span>Số điện thoại</span>
                <b>
                  {detail.customerPhone || (detail.contactChannel === "SHARE" ? "Không thu thập" : "Không yêu cầu trước khi xác nhận")}
                  {detail.customerPhone && <Icon>content_copy</Icon>}
                </b>
              </div>
            </div>
            <span>Ghi chú từ khách hàng</span>
            <blockquote>{detail.customerNote || "Không có ghi chú."}</blockquote>
          </section>
          <section className="detail-admin-card interest-card">
            <h2>
              <Icon>shopping_bag</Icon> Sản phẩm Quan tâm
            </h2>
            {detail.items.map((item) => (
                <div className="interest-line" key={item.id}>
                  <ProductImage r2Key={item.imageKey} url={item.imageUrl} alt="" />
                  <p>
                    <b>{item.productName}</b>
                    <span>{item.variantName}</span>
                  </p>
                  <p>
                    <Price value={item.lineTotalVnd} />
                    <span>x{item.quantity}</span>
                  </p>
                </div>
              ))}
            <div className="interest-total">
              <span>
                Tổng cộng: {detail.itemLineCount} mặt hàng ({detail.totalQuantity} sản phẩm)
              </span>
              <div>
                <small>Tạm tính</small>
                <Price value={detail.subtotalVnd} />
              </div>
            </div>
          </section>
        </div>
        <aside>
          <section className="status-update-card">
            <h2>Cập nhật Trạng thái</h2>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="SUBMITTED">Mới</option>
              <option value="CONTACTED">Đã liên hệ</option>
              <option value="CONFIRMED">Đã xác nhận</option>
              <option value="COMPLETED">Hoàn thành</option>
              <option value="CANCELLED">Đã hủy</option>
            </select>
            <p>
              Trạng thái hiện tại:{" "}
              <b>
                <StatusBadge status={status} />
              </b>
              . Chọn trạng thái mới để cập nhật tiến trình xử lý yêu cầu.
            </p>
            <button className="btn primary" onClick={updateStatus}>
              <Icon>update</Icon> CẬP NHẬT TRẠNG THÁI
            </button>
          </section>
          {detail.contactChannel === "SHARE" ? (
            <section className="telegram-card share-admin-card">
              <h2>
                <span className="telegram-icon share-icon"><Icon>share</Icon></span>
                Chia sẻ thủ công
              </h2>
              <StatusBadge status="SHARE_READY" />
              <p>Khách tự mở Messenger của người bán.</p>
              <p>
                BabyJoy không xác minh người bán đã nhận. Giỏ hàng và snapshot
                vẫn được giữ nguyên để đối chiếu.
              </p>
            </section>
          ) : detail.contactChannel === "MESSENGER" ? (
            <section className="telegram-card messenger-admin-card">
              <h2>
                <span className="telegram-icon messenger-icon">M</span> Messenger
              </h2>
              <StatusBadge status={messengerDelivery} />
              <span className="telegram-time">
                {detail.messengerSentAt
                  ? new Date(detail.messengerSentAt).toLocaleString("vi-VN")
                  : "Chưa gửi"}
              </span>
              <p>
                Messenger: {detail.messengerLinked ? "Đã liên kết" : "Chưa liên kết"}
              </p>
              <p>
                Xác nhận: {detail.messengerConfirmedAt
                  ? new Date(detail.messengerConfirmedAt).toLocaleString("vi-VN")
                  : "Chưa xác nhận"}
                <br />Số lần gửi: {detail.messengerAttemptCount}
              </p>
              {detail.messengerLastError && (
                <p className="form-error">
                  {detail.messengerLastErrorCode || "MESSENGER_SEND_FAILED"}: {detail.messengerLastError}
                </p>
              )}
              {messengerDelivery === "FAILED" && (
                <button className="btn secondary-btn" onClick={retryMessenger}>
                  <Icon>send</Icon> THỬ GỬI LẠI MESSENGER
                </button>
              )}
            </section>
          ) : (
            <section className="telegram-card">
              <h2>
                <span className="telegram-icon">➤</span> Thông báo Telegram
              </h2>
              <StatusBadge status={telegram} />
              <span className="telegram-time">
                {new Date(detail.createdAt).toLocaleString("vi-VN")}
              </span>
              <p>
                {telegram === "FAILED"
                  ? "Đã có lỗi xảy ra khi gửi thông báo yêu cầu này đến người bán trên Telegram."
                  : "Thông báo đã được gửi thành công đến người bán."}
              </p>
              {telegram === "FAILED" && (
                <button className="btn secondary-btn" onClick={retryTelegram}>
                  <Icon>send</Icon> THỬ GỬI LẠI
                </button>
              )}
            </section>
          )}
        </aside>
      </div>
    </AdminShell>
  );
}

export function AdminTaxonomyPage({ type }: { type: "categories" | "tags" }) {
  const isCategories = type === "categories";
  const rows = isCategories
    ? fallbackCategories.map((item, index) => ({
        name: item.name,
        slug: item.slug,
        group: index ? "Danh mục con" : "Danh mục chính",
        order: index + 1,
      }))
    : [
        { name: "Hữu cơ", slug: "huu-co", group: "Đặc tính", order: 1 },
        {
          name: "Không thêm đường",
          slug: "khong-them-duong",
          group: "Đặc tính",
          order: 2,
        },
        { name: "6–8 tháng", slug: "6-8-thang", group: "Độ tuổi", order: 3 },
      ];
  return (
    <AdminShell title={isCategories ? "Danh Mục" : "Tags"}>
      <div className="admin-page-heading">
        <div>
          <h1>{isCategories ? "Danh mục" : "Tags"}</h1>
          <p>
            {isCategories
              ? "Quản lý nhóm sản phẩm dinh dưỡng"
              : "Quản lý đặc tính và độ tuổi sản phẩm"}
          </p>
        </div>
        <button className="btn primary">
          <Icon>add</Icon> THÊM {isCategories ? "DANH MỤC" : "TAG"}
        </button>
      </div>
      <section className="admin-table-card taxonomy-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Slug</th>
                <th>Nhóm</th>
                <th>Thứ tự</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.slug}>
                  <td>
                    <b>{row.name}</b>
                  </td>
                  <td>{row.slug}</td>
                  <td>{row.group}</td>
                  <td>{row.order}</td>
                  <td>
                    <StatusBadge status="AVAILABLE" />
                  </td>
                  <td>
                    <button>
                      <Icon>edit</Icon>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}

export function AdminSettingsPage() {
  const [seller, setSeller] = useState({
    displayName: "",
    label: "Người bán BabyJoy",
    messengerUrl: "",
    avatarKey: "",
    avatarUrl: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const avatarInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/settings/seller")
      .then(async (response) => {
        if (!response.ok) throw new Error("SETTINGS_LOAD_FAILED");
        return response.json() as Promise<{
          data: {
            displayName: string;
            label: string;
            messengerUrl: string;
            avatarKey: string | null;
            avatarUrl: string | null;
          };
        }>;
      })
      .then((body) => {
        if (!cancelled)
          setSeller({
            ...body.data,
            avatarKey: body.data.avatarKey ?? "",
            avatarUrl: body.data.avatarUrl ?? "",
          });
      })
      .catch(() => {
        if (!cancelled) setError("Không tải được cấu hình người bán từ D1.");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const uploadAvatar = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/images", {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      const body = (await response.json()) as {
        key?: string;
        url?: string;
        error?: { message?: string };
      };
      if (!response.ok || !body.key)
        throw new Error(body.error?.message || "Chưa thể tải ảnh đại diện.");
      setSeller((current) => ({
        ...current,
        avatarKey: body.key ?? "",
        avatarUrl: body.url ?? "",
      }));
      setMessage("Ảnh đã tải lên. Hãy lưu cài đặt để áp dụng.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chưa thể tải ảnh.");
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/settings/seller", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: seller.displayName,
          label: seller.label,
          messengerUrl: seller.messengerUrl,
          avatarKey: seller.avatarKey || null,
        }),
      });
      const body = (await response.json()) as {
        data?: typeof seller;
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(body.error?.message || "Chưa thể lưu cài đặt.");
      if (body.data)
        setSeller({
          ...body.data,
          avatarKey: body.data.avatarKey ?? "",
          avatarUrl: body.data.avatarUrl ?? "",
        });
      setMessage("Đã lưu liên hệ người bán.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chưa thể lưu cài đặt.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminShell title="Cài Đặt">
      <div className="admin-page-heading">
        <div>
          <h1>Cài đặt</h1>
          <p>Cấu hình thông tin công khai của BabyJoy.</p>
        </div>
      </div>
      <section className="editor-card settings-card">
        <div className="editor-card-title">
          <span>
            <Icon>store</Icon>
            <h2>Thông tin cửa hàng</h2>
          </span>
        </div>
        <label>
          Tên hiển thị
          <input defaultValue="BabyJoy" />
        </label>
        <label>
          Email liên hệ
          <input defaultValue="hello@babyjoy.vn" />
        </label>
        <label>
          Số điện thoại
          <input defaultValue="1900 123 456" />
        </label>
        <p>
          Credential Telegram legacy và Meta Messenger được quản lý bằng
          Cloudflare Secret, không hiển thị tại đây.
        </p>
        <button className="btn primary">
          <Icon>save</Icon> LƯU CÀI ĐẶT
        </button>
      </section>
      <section className="editor-card settings-card seller-settings-card">
        <div className="editor-card-title">
          <span>
            <Icon>support_agent</Icon>
            <h2>Liên hệ người bán</h2>
          </span>
        </div>
        <p>Một liên hệ mặc định được hiển thị cho mọi giỏ hàng BabyJoy.</p>
        <div className="seller-settings-avatar">
          {seller.avatarUrl ? (
            <img src={seller.avatarUrl} alt="Ảnh đại diện người bán" />
          ) : (
            <span><Icon>person</Icon></span>
          )}
          <div>
            <button
              className="btn secondary-btn"
              disabled={busy}
              onClick={() => avatarInput.current?.click()}
            >
              TẢI ẢNH TỪ MÁY
            </button>
            <input
              ref={avatarInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAvatar(file);
              }}
            />
          </div>
        </div>
        <label>
          Tên hiển thị
          <input
            value={seller.displayName}
            onChange={(event) => setSeller({ ...seller, displayName: event.target.value })}
            placeholder="Nguyễn A"
          />
        </label>
        <label>
          Nhãn
          <input
            value={seller.label}
            onChange={(event) => setSeller({ ...seller, label: event.target.value })}
            placeholder="Người bán BabyJoy"
          />
        </label>
        <label>
          Messenger URL
          <input
            value={seller.messengerUrl}
            onChange={(event) => setSeller({ ...seller, messengerUrl: event.target.value })}
            placeholder="https://m.me/nguyena"
            inputMode="url"
          />
        </label>
        <label>
          Khóa ảnh R2 hiện có (không bắt buộc)
          <input
            value={seller.avatarKey}
            onChange={(event) => setSeller({ ...seller, avatarKey: event.target.value })}
            placeholder="products/2026-08-28/...webp"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-success">{message}</p>}
        <div className="seller-settings-actions">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            <Icon>save</Icon> {busy ? "ĐANG LƯU..." : "LƯU LIÊN HỆ NGƯỜI BÁN"}
          </button>
          {seller.messengerUrl.startsWith("https://m.me/") && (
            <a className="btn secondary-btn" href={seller.messengerUrl} target="_blank" rel="noreferrer">
              <Icon>open_in_new</Icon> MỞ THỬ MESSENGER
            </a>
          )}
        </div>
      </section>
    </AdminShell>
  );
}
