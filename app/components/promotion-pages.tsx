import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  derivePromotionState,
  promotionStatuses,
  promotionTypeLabel,
  promotionTypes,
  type PromotionDefinition,
  type PromotionStatus,
  type PromotionType,
} from "../../shared/promotions";
import { formatVnd } from "../lib/catalog";
import { AdminShell, Icon, Price, StatusBadge, Tag } from "./ui";

type AdminPromotion = PromotionDefinition & {
  currentState: ReturnType<typeof derivePromotionState>;
  invalidConfig?: boolean;
};

type ProductOption = {
  id: string;
  name: string;
  slug: string;
  status: string;
  imageUrl: string | null;
  priceVnd: number | null;
};

type CategoryOption = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

type PromotionOptions = {
  products: ProductOption[];
  categories: CategoryOption[];
};

type RewardDraft = {
  kind: "FIXED" | "PERCENTAGE";
  amount?: number | string;
  percentage?: number | string;
  maximumDiscount?: number | string;
};

type PromotionForm = {
  name: string;
  description: string;
  type: PromotionType;
  status: PromotionStatus;
  startsAt: string;
  endsAt: string;
  priority: string;
  stackable: boolean;
  usageLimitTotal: string;
  config: Record<string, unknown>;
};

const typeLabels: Record<PromotionType, string> = {
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

const stateLabels: Record<ReturnType<typeof derivePromotionState>, string> = {
  DRAFT: "Bản nháp",
  SCHEDULED: "Đã lên lịch",
  RUNNING: "Đang chạy",
  ENDED: "Đã kết thúc",
  INACTIVE: "Đã tắt",
  ARCHIVED: "Đã archive",
};

function createDefaultConfig(type: PromotionType): Record<string, unknown> {
  if (type === "ORDER_FIXED_DISCOUNT")
    return { type, minimumSubtotal: 500000, discountAmount: 30000 };
  if (type === "ORDER_PERCENTAGE_DISCOUNT")
    return { type, minimumSubtotal: 500000, percentage: 10, maximumDiscount: "" };
  if (type === "ORDER_GIFT")
    return { type, minimumSubtotal: 800000, giftProductId: "", giftQuantity: 1 };
  if (type === "BUY_X_GET_Y")
    return {
      type,
      triggerProductId: "",
      requiredQuantity: 3,
      rewardProductId: "",
      rewardQuantity: 1,
      allowRepeatedApplications: true,
    };
  if (type === "PRODUCT_DISCOUNT")
    return { type, productIds: [], reward: { kind: "PERCENTAGE", percentage: 10 } };
  if (type === "CATEGORY_DISCOUNT")
    return { type, categoryIds: [], reward: { kind: "PERCENTAGE", percentage: 10 } };
  if (type === "QUANTITY_DISCOUNT")
    return {
      type,
      requiredQuantity: 5,
      scope: "ENTIRE_CART",
      productIds: [],
      categoryIds: [],
      reward: { kind: "FIXED", amount: 30000 },
      allowRepeatedApplications: false,
    };
  if (type === "COMBO_DISCOUNT")
    return {
      type,
      items: [{ productId: "", quantity: 1 }],
      reward: { kind: "FIXED", amount: 40000 },
      allowRepeatedApplications: false,
    };
  return {
    type,
    tiers: [
      { threshold: 300000, reward: { kind: "FIXED", amount: 10000 } },
      { threshold: 500000, reward: { kind: "FIXED", amount: 30000 } },
    ],
  };
}

function emptyPromotionForm(): PromotionForm {
  return {
    name: "",
    description: "",
    type: "ORDER_FIXED_DISCOUNT",
    status: "DRAFT",
    startsAt: "",
    endsAt: "",
    priority: "0",
    stackable: false,
    usageLimitTotal: "",
    config: createDefaultConfig("ORDER_FIXED_DISCOUNT"),
  };
}

function numberValue(config: Record<string, unknown>, key: string, fallback = 0) {
  const value = config[key];
  return typeof value === "number" || typeof value === "string"
    ? value
    : fallback;
}

function rewardValue(config: Record<string, unknown>): RewardDraft {
  const reward = config.reward;
  return reward && typeof reward === "object"
    ? (reward as RewardDraft)
    : { kind: "FIXED", amount: 0 };
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function formatAdminDate(value: string | null) {
  if (!value) return "Không giới hạn";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Không hợp lệ"
    : date.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

function collectProductIds(type: PromotionType, config: Record<string, unknown>) {
  const ids: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && value) ids.push(value);
  };
  if (type === "ORDER_GIFT") add(config.giftProductId);
  if (type === "BUY_X_GET_Y") {
    add(config.triggerProductId);
    add(config.rewardProductId);
  }
  if (type === "PRODUCT_DISCOUNT")
    (Array.isArray(config.productIds) ? config.productIds : []).forEach(add);
  if (type === "QUANTITY_DISCOUNT")
    (Array.isArray(config.productIds) ? config.productIds : []).forEach(add);
  if (type === "COMBO_DISCOUNT")
    (Array.isArray(config.items) ? config.items : []).forEach((item) => {
      if (item && typeof item === "object") add((item as Record<string, unknown>).productId);
    });
  return [...new Set(ids)];
}

function promotionPreview(form: PromotionForm) {
  const config = form.config;
  const min = formatVnd(Number(numberValue(config, "minimumSubtotal")) || 0);
  if (form.type === "ORDER_FIXED_DISCOUNT")
    return `Đơn hàng từ ${min} → giảm ${formatVnd(Number(numberValue(config, "discountAmount")) || 0)}.`;
  if (form.type === "ORDER_PERCENTAGE_DISCOUNT")
    return `Đơn hàng từ ${min} → giảm ${numberValue(config, "percentage")}%${config.maximumDiscount ? `, tối đa ${formatVnd(Number(config.maximumDiscount))}` : ""}.`;
  if (form.type === "ORDER_GIFT")
    return `Đơn hàng từ ${min} → tặng ${numberValue(config, "giftQuantity", 1)} sản phẩm đã chọn.`;
  if (form.type === "BUY_X_GET_Y")
    return `Mua ${numberValue(config, "requiredQuantity", 1)} sản phẩm kích hoạt → tặng ${numberValue(config, "rewardQuantity", 1)} sản phẩm.`;
  if (form.type === "PRODUCT_DISCOUNT")
    return `Giảm ${rewardDescription(rewardValue(config))} cho ${Array.isArray(config.productIds) ? config.productIds.length : 0} sản phẩm.`;
  if (form.type === "CATEGORY_DISCOUNT")
    return `Giảm ${rewardDescription(rewardValue(config))} cho ${Array.isArray(config.categoryIds) ? config.categoryIds.length : 0} danh mục.`;
  if (form.type === "QUANTITY_DISCOUNT")
    return `Mua từ ${numberValue(config, "requiredQuantity", 1)} sản phẩm trong phạm vi đã chọn → ${rewardDescription(rewardValue(config))}.`;
  if (form.type === "COMBO_DISCOUNT")
    return `Đủ ${Array.isArray(config.items) ? config.items.length : 0} sản phẩm trong combo → ${rewardDescription(rewardValue(config))}.`;
  const tiers = Array.isArray(config.tiers) ? config.tiers : [];
  return tiers
    .map((tier) => {
      const row = tier as Record<string, unknown>;
      return `${formatVnd(Number(row.threshold) || 0)} → ${rewardDescription((row.reward ?? {}) as RewardDraft)}`;
    })
    .join(" · ");
}

function rewardDescription(reward: RewardDraft) {
  if (reward.kind === "PERCENTAGE")
    return `giảm ${reward.percentage ?? 0}%${reward.maximumDiscount ? ` tối đa ${formatVnd(Number(reward.maximumDiscount))}` : ""}`;
  return `giảm ${formatVnd(Number(reward.amount) || 0)}`;
}

function extractIssue(body: unknown) {
  if (!body || typeof body !== "object") return "Thao tác promotion thất bại.";
  const error = (body as { error?: { message?: string; details?: { message?: string } } }).error;
  return error?.details?.message || error?.message || "Thao tác promotion thất bại.";
}

export function AdminPromotionsPage() {
  const navigate = useNavigate();
  const [promotions, setPromotions] = useState<AdminPromotion[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = () => {
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (query.trim()) params.set("q", query.trim());
    void fetch(`/api/admin/promotions?${params.toString()}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(extractIssue(body));
        return body as { data?: AdminPromotion[] };
      })
      .then((body) => setPromotions(Array.isArray(body.data) ? body.data : []))
      .catch((caught) => setMessage(caught instanceof Error ? caught.message : "Không tải được promotions."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [statusFilter, query]);

  const action = async (promotion: AdminPromotion, kind: "duplicate" | "status" | "delete") => {
    if (kind === "delete" && !window.confirm("Nếu chương trình đã được dùng, hệ thống sẽ archive để giữ lịch sử. Tiếp tục?")) return;
    if (kind === "status" && !window.confirm("Thay đổi trạng thái chương trình này?")) return;
    const targetStatus = promotion.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    const request =
      kind === "duplicate"
        ? fetch(`/api/admin/promotions/${encodeURIComponent(promotion.id)}/duplicate`, { method: "POST" })
        : kind === "delete"
          ? fetch(`/api/admin/promotions/${encodeURIComponent(promotion.id)}`, { method: "DELETE" })
          : fetch(`/api/admin/promotions/${encodeURIComponent(promotion.id)}/status`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ status: targetStatus }),
            });
    try {
      const response = await request;
      const body = (await response.json()) as { id?: string };
      if (!response.ok) throw new Error(extractIssue(body));
      if (kind === "duplicate" && body.id) navigate(`/admin/promotions/${body.id}/edit`);
      else load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Thao tác promotion thất bại.");
    }
  };

  const tabs = ["ALL", "DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"];
  return (
    <AdminShell title="Khuyến mãi">
      <div className="admin-page-heading">
        <div>
          <h1>Khuyến mãi</h1>
          <p>Tạo và kiểm soát các ưu đãi trên storefront</p>
        </div>
        <Link className="btn primary" to="/admin/promotions/new">
          <Icon>add</Icon> THÊM KHUYẾN MÃI
        </Link>
      </div>
      <section className="admin-table-card promotion-table-card">
        <div className="admin-table-tools">
          <div className="admin-tabs">
            {tabs.map((tab) => (
              <button key={tab} className={statusFilter === tab ? "active" : ""} onClick={() => setStatusFilter(tab)}>
                {tab === "ALL" ? "Tất cả" : tab === "ACTIVE" ? "Đang bật" : tab === "INACTIVE" ? "Đã tắt" : tab === "ARCHIVED" ? "Archived" : "Bản nháp"}
              </button>
            ))}
          </div>
          <label className="admin-search">
            <Icon>search</Icon>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm chương trình..." />
          </label>
        </div>
        {message && <p className="form-error promotion-page-message">{message}</p>}
        {loading ? (
          <p className="table-footer">Đang tải danh sách khuyến mãi…</p>
        ) : promotions.length === 0 ? (
          <div className="empty-state promotion-empty-state">
            <Icon>local_offer</Icon>
            <h2>Chưa có chương trình khuyến mãi.</h2>
            <p>Tạo ưu đãi đầu tiên để storefront tự động áp dụng khi đủ điều kiện.</p>
            <Link className="btn primary" to="/admin/promotions/new">Tạo chương trình</Link>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="promotion-table">
              <thead>
                <tr>
                  <th>Chương trình</th>
                  <th>Loại</th>
                  <th>Trạng thái</th>
                  <th>Hiệu lực</th>
                  <th>Priority</th>
                  <th>Cộng dồn</th>
                  <th>Usage</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((promotion) => {
                  const state = derivePromotionState(promotion, new Date());
                  return (
                    <tr key={promotion.id}>
                      <td><b>{promotion.name}</b><small>{promotion.description || "Không có mô tả"}</small></td>
                      <td>{promotionTypeLabel(promotion.type)}</td>
                      <td><StatusBadge status={promotion.status} /><Tag tone={state === "RUNNING" ? "primary" : state === "ARCHIVED" ? "neutral" : "secondary"}>{stateLabels[state]}</Tag></td>
                      <td><small>{formatAdminDate(promotion.startsAt)}</small><small>→ {formatAdminDate(promotion.endsAt)}</small></td>
                      <td>{promotion.priority}</td>
                      <td>{promotion.stackable ? "Có" : "Không"}</td>
                      <td>{promotion.usageCountTotal}{promotion.usageLimitTotal ? ` / ${promotion.usageLimitTotal}` : ""}</td>
                      <td>
                        <div className="row-actions promotion-row-actions">
                          <Link to={`/admin/promotions/${promotion.id}/edit`} aria-label="Sửa"><Icon>edit</Icon></Link>
                          <button type="button" onClick={() => void action(promotion, "duplicate")} aria-label="Nhân bản"><Icon>content_copy</Icon></button>
                          {promotion.status !== "ARCHIVED" && <button type="button" onClick={() => void action(promotion, "status")} aria-label={promotion.status === "ACTIVE" ? "Tắt" : "Bật"}><Icon>{promotion.status === "ACTIVE" ? "pause_circle" : "play_circle"}</Icon></button>}
                          {promotion.status !== "ARCHIVED" && <button type="button" onClick={() => void action(promotion, "delete")} aria-label="Xóa hoặc archive"><Icon>delete</Icon></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}

function PromotionSelectorSearch({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // Tách khung tìm kiếm khỏi label chung để không bị CSS form-editor làm co giãn sai.
  return (
    <div className="promotion-selector-search">
      <Icon>search</Icon>
      <input
        type="text"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          className="promotion-selector-search-clear"
          aria-label={`Xóa ${label.toLowerCase()}`}
          onClick={() => onChange("")}
        >
          <Icon>close</Icon>
        </button>
      )}
    </div>
  );
}

function ProductPicker({
  label,
  selectedIds,
  options,
  multiple,
  onChange,
  onSearch,
}: {
  label: string;
  selectedIds: string[];
  options: ProductOption[];
  multiple?: boolean;
  onChange: (ids: string[]) => void;
  onSearch: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = new Set(selectedIds);
  const toggle = (id: string) => {
    if (multiple) onChange(selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
    else onChange(selected.has(id) ? [] : [id]);
  };
  const handleSearch = (value: string) => {
    setQuery(value);
    onSearch(value);
  };
  return (
    <div className="promotion-selector">
      <span className="promotion-field-label">{label}</span>
      <PromotionSelectorSearch label="Tìm sản phẩm" placeholder="Tìm sản phẩm..." value={query} onChange={handleSearch} />
      <div className="promotion-option-list">
        {options.length ? options.map((option) => (
          <button type="button" key={option.id} className={selected.has(option.id) ? "selected" : ""} onClick={() => toggle(option.id)} aria-pressed={selected.has(option.id)}>
            {option.imageUrl ? <img src={option.imageUrl} alt="" /> : <span className="promotion-option-placeholder"><Icon>inventory_2</Icon></span>}
            <span><b>{option.name}</b><small>{option.status === "AVAILABLE" ? formatVnd(option.priceVnd ?? 0) : "Không bán"}</small></span>
            {selected.has(option.id) && <Icon>check_circle</Icon>}
          </button>
        )) : <small className="promotion-selector-empty">Không tìm thấy sản phẩm.</small>}
      </div>
      {selectedIds.length > 0 && <div className="promotion-selected-tags">{selectedIds.map((id) => <Tag key={id} tone="primary">{options.find((option) => option.id === id)?.name ?? "Sản phẩm đã chọn"}</Tag>)}</div>}
    </div>
  );
}

function CategoryPicker({
  selectedIds,
  options,
  onChange,
}: {
  selectedIds: string[];
  options: CategoryOption[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = new Set(selectedIds);
  const selectedOptions = selectedIds
    .map((id) => options.find((option) => option.id === id))
    .filter((option): option is CategoryOption => Boolean(option));
  const visibleOptions = options.filter((option) =>
    `${option.name} ${option.slug}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const toggle = (id: string) => {
    onChange(selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  };
  return (
    <div className="promotion-selector">
      <span className="promotion-field-label">Danh mục áp dụng</span>
      <PromotionSelectorSearch label="Tìm danh mục" placeholder="Tìm danh mục..." value={query} onChange={setQuery} />
      <div className="promotion-option-list category-option-list">
        {visibleOptions.length ? visibleOptions.map((option) => (
          <button type="button" key={option.id} className={selected.has(option.id) ? "selected" : ""} onClick={() => toggle(option.id)} aria-pressed={selected.has(option.id)}>
            <span><b>{option.name}</b><small>{option.isActive ? "Đang hoạt động" : "Đã ẩn"}</small></span>
            {selected.has(option.id) && <Icon>check_circle</Icon>}
          </button>
        )) : <small className="promotion-selector-empty">{options.length ? "Không tìm thấy danh mục phù hợp." : "Chưa có danh mục."}</small>}
      </div>
      {/* Summary nằm ngoài vùng cuộn để admin luôn thấy và bỏ chọn được các mục đã chọn. */}
      <div className="promotion-selection-summary" aria-live="polite">
        <span className="promotion-selection-count">{selectedIds.length} danh mục đã chọn</span>
        {selectedOptions.length > 0 && (
          <div className="promotion-selection-chips" aria-label="Danh mục đã chọn">
            {selectedOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                className="promotion-selection-chip"
                aria-label={`Bỏ chọn ${option.name}`}
                onClick={() => toggle(option.id)}
              >
                <span>{option.name}</span>
                <Icon>close</Icon>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RewardFields({
  reward,
  onChange,
}: {
  reward: RewardDraft;
  onChange: (next: RewardDraft) => void;
}) {
  return (
    <div className="promotion-reward-fields">
      <label>Kiểu ưu đãi<select value={reward.kind} onChange={(event) => onChange({ kind: event.target.value as RewardDraft["kind"], amount: "", percentage: "", maximumDiscount: "" })}><option value="FIXED">Giảm số tiền</option><option value="PERCENTAGE">Giảm phần trăm</option></select></label>
      {reward.kind === "FIXED" ? (
        <label>Số tiền giảm<input type="number" min="1" step="1" value={reward.amount ?? ""} onChange={(event) => onChange({ ...reward, amount: event.target.value })} /></label>
      ) : (
        <>
          <label>Phần trăm<input type="number" min="1" max="100" step="1" value={reward.percentage ?? ""} onChange={(event) => onChange({ ...reward, percentage: event.target.value })} /></label>
          <label>Tối đa (không bắt buộc)<input type="number" min="1" step="1" value={reward.maximumDiscount ?? ""} onChange={(event) => onChange({ ...reward, maximumDiscount: event.target.value })} /></label>
        </>
      )}
    </div>
  );
}

function PromotionConfigFields({
  form,
  options,
  onConfig,
  onProductSearch,
}: {
  form: PromotionForm;
  options: PromotionOptions;
  onConfig: (key: string, value: unknown) => void;
  onProductSearch: (query: string) => void;
}) {
  const config = form.config;
  const reward = rewardValue(config);
  const setReward = (next: RewardDraft) => onConfig("reward", next);
  if (form.type === "ORDER_FIXED_DISCOUNT")
    return <div className="form-grid"><label>Giá trị đơn tối thiểu<input type="number" min="1" step="1" value={numberValue(config, "minimumSubtotal")} onChange={(event) => onConfig("minimumSubtotal", event.target.value)} /></label><label>Số tiền giảm<input type="number" min="1" step="1" value={numberValue(config, "discountAmount")} onChange={(event) => onConfig("discountAmount", event.target.value)} /></label></div>;
  if (form.type === "ORDER_PERCENTAGE_DISCOUNT")
    return <div className="form-grid"><label>Giá trị đơn tối thiểu<input type="number" min="1" step="1" value={numberValue(config, "minimumSubtotal")} onChange={(event) => onConfig("minimumSubtotal", event.target.value)} /></label><label>Phần trăm<input type="number" min="1" max="100" step="1" value={numberValue(config, "percentage")} onChange={(event) => onConfig("percentage", event.target.value)} /></label><label>Tối đa (không bắt buộc)<input type="number" min="1" step="1" value={typeof config.maximumDiscount === "number" || typeof config.maximumDiscount === "string" ? config.maximumDiscount : ""} onChange={(event) => onConfig("maximumDiscount", event.target.value)} /></label></div>;
  if (form.type === "ORDER_GIFT")
    return <div className="promotion-config-stack"><div className="form-grid"><label>Giá trị đơn tối thiểu<input type="number" min="1" step="1" value={numberValue(config, "minimumSubtotal")} onChange={(event) => onConfig("minimumSubtotal", event.target.value)} /></label><label>Số lượng quà<input type="number" min="1" step="1" value={numberValue(config, "giftQuantity", 1)} onChange={(event) => onConfig("giftQuantity", event.target.value)} /></label></div><ProductPicker label="Sản phẩm quà tặng" selectedIds={typeof config.giftProductId === "string" && config.giftProductId ? [config.giftProductId] : []} options={options.products} onChange={(ids) => onConfig("giftProductId", ids[0] ?? "")} onSearch={onProductSearch} /></div>;
  if (form.type === "BUY_X_GET_Y")
    return <div className="promotion-config-stack"><ProductPicker label="Sản phẩm kích hoạt" selectedIds={typeof config.triggerProductId === "string" && config.triggerProductId ? [config.triggerProductId] : []} options={options.products} onChange={(ids) => onConfig("triggerProductId", ids[0] ?? "")} onSearch={onProductSearch} /><div className="form-grid"><label>Số lượng cần mua<input type="number" min="1" step="1" value={numberValue(config, "requiredQuantity", 1)} onChange={(event) => onConfig("requiredQuantity", event.target.value)} /></label><label>Số lượng quà mỗi lần<input type="number" min="1" step="1" value={numberValue(config, "rewardQuantity", 1)} onChange={(event) => onConfig("rewardQuantity", event.target.value)} /></label></div><ProductPicker label="Sản phẩm được tặng" selectedIds={typeof config.rewardProductId === "string" && config.rewardProductId ? [config.rewardProductId] : []} options={options.products} onChange={(ids) => onConfig("rewardProductId", ids[0] ?? "")} onSearch={onProductSearch} /><label className="promotion-checkbox"><input type="checkbox" checked={config.allowRepeatedApplications === true} onChange={(event) => onConfig("allowRepeatedApplications", event.target.checked)} /> Cho phép lặp theo số lượng mua</label></div>;
  if (form.type === "PRODUCT_DISCOUNT")
    return <div className="promotion-config-stack"><ProductPicker label="Sản phẩm áp dụng" selectedIds={Array.isArray(config.productIds) ? config.productIds.filter((id): id is string => typeof id === "string") : []} options={options.products} multiple onChange={(ids) => onConfig("productIds", ids)} onSearch={onProductSearch} /><RewardFields reward={reward} onChange={setReward} /></div>;
  if (form.type === "CATEGORY_DISCOUNT")
    return <div className="promotion-config-stack"><CategoryPicker selectedIds={Array.isArray(config.categoryIds) ? config.categoryIds.filter((id): id is string => typeof id === "string") : []} options={options.categories} onChange={(ids) => onConfig("categoryIds", ids)} /><RewardFields reward={reward} onChange={setReward} /></div>;
  if (form.type === "QUANTITY_DISCOUNT") {
    const scope = config.scope === "SELECTED_PRODUCTS" || config.scope === "SELECTED_CATEGORIES" ? config.scope : "ENTIRE_CART";
    return <div className="promotion-config-stack"><div className="form-grid"><label>Số lượng yêu cầu<input type="number" min="1" step="1" value={numberValue(config, "requiredQuantity", 1)} onChange={(event) => onConfig("requiredQuantity", event.target.value)} /></label><label>Phạm vi<select value={scope} onChange={(event) => onConfig("scope", event.target.value)}><option value="ENTIRE_CART">Toàn bộ giỏ hàng</option><option value="SELECTED_PRODUCTS">Sản phẩm chọn</option><option value="SELECTED_CATEGORIES">Danh mục chọn</option></select></label></div>{scope === "SELECTED_PRODUCTS" && <ProductPicker label="Sản phẩm áp dụng" selectedIds={Array.isArray(config.productIds) ? config.productIds.filter((id): id is string => typeof id === "string") : []} options={options.products} multiple onChange={(ids) => onConfig("productIds", ids)} onSearch={onProductSearch} />}{scope === "SELECTED_CATEGORIES" && <CategoryPicker selectedIds={Array.isArray(config.categoryIds) ? config.categoryIds.filter((id): id is string => typeof id === "string") : []} options={options.categories} onChange={(ids) => onConfig("categoryIds", ids)} />}<RewardFields reward={reward} onChange={setReward} /><label className="promotion-checkbox"><input type="checkbox" checked={config.allowRepeatedApplications === true} onChange={(event) => onConfig("allowRepeatedApplications", event.target.checked)} /> Cho phép áp dụng lặp theo bội số</label></div>;
  }
  if (form.type === "COMBO_DISCOUNT") {
    const items = Array.isArray(config.items) ? config.items : [];
    return <div className="promotion-config-stack"><div className="promotion-combo-list">{items.map((item, index) => { const row = item as Record<string, unknown>; return <div className="promotion-combo-row" key={index}><label>Sản phẩm {index + 1}<select value={typeof row.productId === "string" ? row.productId : ""} onChange={(event) => onConfig("items", items.map((current, currentIndex) => currentIndex === index ? { ...row, productId: event.target.value } : current))}><option value="">Chọn sản phẩm</option>{options.products.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label><label>Số lượng<input type="number" min="1" step="1" value={numberValue(row, "quantity", 1)} onChange={(event) => onConfig("items", items.map((current, currentIndex) => currentIndex === index ? { ...row, quantity: event.target.value } : current))} /></label><button type="button" className="icon-button" onClick={() => onConfig("items", items.filter((_, currentIndex) => currentIndex !== index))} aria-label="Xóa sản phẩm combo"><Icon>delete</Icon></button></div>; })}</div><button type="button" className="outline-add" onClick={() => onConfig("items", [...items, { productId: "", quantity: 1 }])}><Icon>add</Icon> Thêm sản phẩm combo</button><RewardFields reward={reward} onChange={setReward} /><label className="promotion-checkbox"><input type="checkbox" checked={config.allowRepeatedApplications === true} onChange={(event) => onConfig("allowRepeatedApplications", event.target.checked)} /> Cho phép áp dụng nhiều combo</label></div>;
  }
  const tiers = Array.isArray(config.tiers) ? config.tiers : [];
  return <div className="promotion-config-stack"><div className="promotion-tier-list">{tiers.map((tier, index) => { const row = tier as Record<string, unknown>; return <div className="promotion-tier-row" key={index}><label>Bậc {index + 1}<input type="number" min="1" step="1" value={numberValue(row, "threshold")} onChange={(event) => onConfig("tiers", tiers.map((current, currentIndex) => currentIndex === index ? { ...row, threshold: event.target.value } : current))} /></label><RewardFields reward={(row.reward ?? { kind: "FIXED", amount: "" }) as RewardDraft} onChange={(next) => onConfig("tiers", tiers.map((current, currentIndex) => currentIndex === index ? { ...row, reward: next } : current))} /><div className="promotion-tier-actions"><button type="button" onClick={() => index > 0 && onConfig("tiers", tiers.map((current, currentIndex) => currentIndex === index - 1 ? tiers[index] : currentIndex === index ? tiers[index - 1] : current))} disabled={index === 0} aria-label="Đưa bậc lên"><Icon>arrow_upward</Icon></button><button type="button" onClick={() => index < tiers.length - 1 && onConfig("tiers", tiers.map((current, currentIndex) => currentIndex === index + 1 ? tiers[index] : currentIndex === index ? tiers[index + 1] : current))} disabled={index === tiers.length - 1} aria-label="Đưa bậc xuống"><Icon>arrow_downward</Icon></button><button type="button" onClick={() => onConfig("tiers", tiers.filter((_, currentIndex) => currentIndex !== index))} disabled={tiers.length <= 1} aria-label="Xóa bậc"><Icon>delete</Icon></button></div></div>; })}</div><button type="button" className="outline-add" onClick={() => onConfig("tiers", [...tiers, { threshold: "", reward: { kind: "FIXED", amount: "" } }])}><Icon>add</Icon> Thêm bậc</button></div>;
}

export function PromotionEditorPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const segments = location.pathname.split("/").filter(Boolean);
  const id = segments.at(-1) === "edit" ? segments.at(-2) : undefined;
  const [form, setForm] = useState<PromotionForm>(emptyPromotionForm);
  const [options, setOptions] = useState<PromotionOptions>({ products: [], categories: [] });
  const [optionSearch, setOptionSearch] = useState("");
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!id) {
      setForm(emptyPromotionForm());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetch(`/api/admin/promotions/${encodeURIComponent(id)}`)
      .then(async (response) => {
        const body = (await response.json()) as { data?: AdminPromotion };
        if (!response.ok || !body.data) throw new Error(extractIssue(body));
        return body.data as AdminPromotion;
      })
      .then((promotion) => {
        if (cancelled) return;
        setForm({
          name: promotion.name,
          description: promotion.description,
          type: promotion.type,
          status: promotion.status,
          startsAt: toLocalDateTime(promotion.startsAt),
          endsAt: toLocalDateTime(promotion.endsAt),
          priority: String(promotion.priority),
          stackable: promotion.stackable,
          usageLimitTotal: promotion.usageLimitTotal === null ? "" : String(promotion.usageLimitTotal),
          config: promotion.config as unknown as Record<string, unknown>,
        });
      })
      .catch((caught) => {
        if (!cancelled) setMessage(caught instanceof Error ? caught.message : "Không tải được promotion.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const selectedProductKey = useMemo(
    () => collectProductIds(form.type, form.config).join(","),
    [form.type, form.config],
  );
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (optionSearch.trim()) params.set("q", optionSearch.trim());
      if (selectedProductKey) params.set("ids", selectedProductKey);
      void fetch(`/api/admin/promotions/options?${params.toString()}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("Không tải được selector sản phẩm.");
          return response.json() as Promise<PromotionOptions>;
        })
        .then((body) => {
          if (!cancelled) setOptions({ products: body.products ?? [], categories: body.categories ?? [] });
        })
        .catch((caught) => {
          if (!cancelled) setMessage(caught instanceof Error ? caught.message : "Không tải được dữ liệu selector.");
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [optionSearch, selectedProductKey]);

  const setConfig = (key: string, value: unknown) => {
    setForm((current) => ({ ...current, config: { ...current.config, [key]: value } }));
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const payload = {
      name: form.name,
      description: form.description,
      type: form.type,
      status: form.status,
      startsAt: toIsoDateTime(form.startsAt),
      endsAt: toIsoDateTime(form.endsAt),
      priority: form.priority,
      stackable: form.stackable,
      usageLimitTotal: form.usageLimitTotal || null,
      usageLimitPerCustomer: null,
      config: { ...form.config, type: form.type },
    };
    try {
      const response = await fetch(id ? `/api/admin/promotions/${encodeURIComponent(id)}` : "/api/admin/promotions", {
        method: id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { id?: string };
      if (!response.ok) throw new Error(extractIssue(body));
      navigate(`/admin/promotions/${body.id ?? id}/edit`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Chưa thể lưu promotion.");
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return <AdminShell title="Khuyến mãi"><p className="table-footer">Đang tải chương trình…</p></AdminShell>;
  return (
    <AdminShell title={id ? "Sửa khuyến mãi" : "Tạo khuyến mãi"}>
      <div className="editor-heading promotion-editor-heading">
        <div><Link to="/admin/promotions"><Icon>arrow_back</Icon> Danh sách khuyến mãi</Link><h1>{id ? "Sửa chương trình" : "Tạo chương trình"}</h1><p>Cấu hình rule, phần thưởng và thời gian hiệu lực.</p></div>
        <div><Link to="/admin/promotions">Hủy</Link><button form="promotion-editor-form" className="btn primary" disabled={saving}>{saving ? "ĐANG LƯU..." : "LƯU CHƯƠNG TRÌNH"}</button></div>
      </div>
      {message && <p className="form-error promotion-page-message">{message}</p>}
      <form id="promotion-editor-form" className="editor-grid promotion-editor-grid" onSubmit={save}>
        <div className="editor-main">
          <section className="editor-card">
            <div className="editor-card-title"><span><Icon>description</Icon><h2>Thông tin chung</h2></span></div>
            <label>Tên chương trình<input required maxLength={180} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ví dụ: Ưu đãi tháng 9" /></label>
            <label>Mô tả<textarea className="short" maxLength={2000} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Mô tả ngắn để admin dễ nhận biết" /></label>
            <div className="form-grid"><label>Loại promotion<select value={form.type} onChange={(event) => { const type = event.target.value as PromotionType; setForm((current) => ({ ...current, type, config: createDefaultConfig(type) })); }}><option value="">Chọn loại</option>{promotionTypes.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}</select></label><label>Trạng thái<select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as PromotionStatus }))}>{promotionStatuses.map((status) => <option key={status} value={status}>{status === "DRAFT" ? "Bản nháp" : status === "ACTIVE" ? "Đang bật" : status === "INACTIVE" ? "Đã tắt" : "Archived"}</option>)}</select></label></div>
          </section>
          <section className="editor-card">
            <div className="editor-card-title"><span><Icon>tune</Icon><h2>Điều kiện & phần thưởng</h2></span><Tag tone="neutral">{typeLabels[form.type]}</Tag></div>
            <PromotionConfigFields form={form} options={options} onConfig={setConfig} onProductSearch={setOptionSearch} />
          </section>
        </div>
        <aside className="editor-side">
          <section className="editor-card">
            <div className="editor-card-title"><span><Icon>schedule</Icon><h2>Lịch chạy</h2></span></div>
            <label>Bắt đầu<input type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} /></label>
            <label>Kết thúc<input type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} /></label>
            <small className="field-hint">Giờ được lưu theo UTC và hiển thị theo múi giờ máy admin.</small>
          </section>
          <section className="editor-card">
            <div className="editor-card-title"><span><Icon>low_priority</Icon><h2>Ưu tiên</h2></span></div>
            <label>Priority<input type="number" min="0" step="1" value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))} /></label>
            <label className="promotion-checkbox"><input type="checkbox" checked={form.stackable} onChange={(event) => setForm((current) => ({ ...current, stackable: event.target.checked }))} /> Cho phép cộng dồn</label>
            <label>Giới hạn tổng lượt dùng<input type="number" min="1" step="1" value={form.usageLimitTotal} onChange={(event) => setForm((current) => ({ ...current, usageLimitTotal: event.target.value }))} placeholder="Không giới hạn" /></label>
            <label className="promotion-disabled-field">Giới hạn mỗi khách<input disabled value="" placeholder="Chưa có định danh khách ổn định" /><small>Để trống ở P0/P1; không tạo định danh giả phía client.</small></label>
          </section>
          <section className="editor-card promotion-preview-card">
            <div className="editor-card-title"><span><Icon>visibility</Icon><h2>Xem trước</h2></span></div>
            <p className="promotion-preview-copy">{promotionPreview(form)}</p>
            <dl><div><dt>Hiệu lực</dt><dd>{formatAdminDate(toIsoDateTime(form.startsAt))} → {formatAdminDate(toIsoDateTime(form.endsAt))}</dd></div><div><dt>Cộng dồn</dt><dd>{form.stackable ? "Có" : "Không"}</dd></div><div><dt>Priority</dt><dd>{form.priority || "0"}</dd></div></dl>
          </section>
        </aside>
      </form>
    </AdminShell>
  );
}
