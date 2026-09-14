import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type {
  ComboConfig,
  ComboGroupItem,
  ComboGroupMode,
  ComboSelectionType,
} from "../../shared/combos";
import type {
  Brand,
  Category,
  Product,
  ProductImageRecord,
} from "../lib/catalog";
import type { CatalogTagGroup } from "../../shared/tag-groups";
import {
  legacyDescriptionToDocument,
  type ProductDescriptionAsset,
  type ProductDescriptionDocument,
} from "../../shared/product-description";
import { ProductDescriptionEditor } from "./product-description-editor";
import { ProductImage } from "./product-image";
import { AdminShell, Icon, StatusBadge, Tag } from "./ui";
import {
  formatProductImageBytes,
  optimizeAndUploadProductImage,
  processProductImageFilesSequentially,
  validateProductImageFiles,
} from "../lib/image-upload";

type VariantOption = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  availability: string;
  availableQuantity: number | null;
  imageUrl: string | null;
};

type EditableComboItem = Pick<
  ComboGroupItem,
  | "id"
  | "variantId"
  | "fixedQuantity"
  | "minQuantity"
  | "maxQuantity"
  | "priceAdjustment"
  | "displayOrder"
> & { variantLabel: string };

type EditableComboGroup = {
  id: string;
  comboProductId: string;
  name: string;
  description: string;
  selectionType: ComboSelectionType;
  minSelect: number;
  maxSelect: number;
  displayOrder: number;
  items: EditableComboItem[];
};

type AdminProductData = Product & {
  status?: string;
  sortOrder?: number;
  featured?: boolean | number;
  tagIds?: string[];
  isBestSeller?: boolean | number;
  bestSellerRank?: number | null;
};

const selectionTypeLabels: Record<ComboSelectionType, string> = {
  FIXED: "Cố định",
  CHOOSE: "Chọn số Item",
  CHOOSE_QUANTITY: "Chọn theo tổng số lượng",
};

function newId() {
  return crypto.randomUUID();
}

function createGroup(displayOrder: number): EditableComboGroup {
  return {
    id: newId(),
    comboProductId: "",
    name: "Group mới",
    description: "",
    selectionType: "FIXED",
    minSelect: 0,
    maxSelect: 0,
    displayOrder,
    items: [],
  };
}

function toEditableGroups(config: ComboConfig | null | undefined) {
  if (!config?.groups?.length) return [createGroup(0)];
  return config.groups.map((group, groupIndex) => ({
    id: group.id,
    comboProductId: group.comboProductId,
    name: group.name,
    description: group.description,
    selectionType: group.selectionType,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    displayOrder: group.displayOrder ?? groupIndex,
    items: group.items.map((item, itemIndex) => ({
      id: item.id,
      variantId: item.variantId,
      variantLabel:
        [item.productName, item.variantName, item.sku ? `SKU ${item.sku}` : ""]
          .filter(Boolean)
          .join(" · ") || item.variantId,
      fixedQuantity: item.fixedQuantity,
      minQuantity: item.minQuantity,
      maxQuantity: item.maxQuantity,
      priceAdjustment: item.priceAdjustment,
      displayOrder: item.displayOrder ?? itemIndex,
    })),
  }));
}

function optionLabel(option: VariantOption) {
  return [
    option.productName,
    option.variantName,
    option.sku ? `SKU ${option.sku}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ComboEditorPage() {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const segments = pathname.split("/").filter(Boolean);
  const id = segments.at(-1) === "edit" ? segments.at(-2) : undefined;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [basePriceVnd, setBasePriceVnd] = useState("0");
  const [shortDescription, setShortDescription] = useState("");
  const [descriptionContent, setDescriptionContent] =
    useState<ProductDescriptionDocument>(() => legacyDescriptionToDocument(""));
  const [descriptionAssets, setDescriptionAssets] = useState<ProductDescriptionAsset[]>([]);
  const [descriptionUploadSessionId] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState("HIDDEN");
  const [images, setImages] = useState<ProductImageRecord[]>([]);
  const [classificationCategories, setClassificationCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [tagGroups, setTagGroups] = useState<CatalogTagGroup[]>([]);
  const [taxonomyReady, setTaxonomyReady] = useState(false);
  const [groupMode, setGroupMode] = useState<ComboGroupMode>("ALL_GROUPS");
  const [groups, setGroups] = useState<EditableComboGroup[]>(() => [createGroup(0)]);
  const [variantTargetGroupId, setVariantTargetGroupId] = useState("");
  const [variantQuery, setVariantQuery] = useState("");
  const [variantOptions, setVariantOptions] = useState<VariantOption[]>([]);
  const [variantLoading, setVariantLoading] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [preservedFields, setPreservedFields] = useState({
    brandId: null as string | null,
    categoryIds: [] as string[],
    tagIds: [] as string[],
    minAgeMonths: null as number | null,
    isBestSeller: false,
    bestSellerRank: null as number | null,
    featured: false,
    sortOrder: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const loadTaxonomy = async () => {
      try {
        const [categoriesResponse, brandsResponse, tagGroupsResponse] =
          await Promise.all([
            fetch("/api/admin/categories", {
              headers: { accept: "application/json" },
            }),
            fetch("/api/admin/brands", {
              headers: { accept: "application/json" },
            }),
            fetch("/api/admin/tag-groups", {
              headers: { accept: "application/json" },
            }),
          ]);
        if (cancelled) return;
        if (categoriesResponse.ok) {
          const body = (await categoriesResponse.json()) as { data?: Category[] };
          setClassificationCategories(
            (body.data ?? []).map((category) => ({
              ...category,
              isActive: Boolean(category.isActive),
            })),
          );
        }
        if (brandsResponse.ok) {
          const body = (await brandsResponse.json()) as { data?: Brand[] };
          setBrands(
            (body.data ?? []).map((brand) => ({
              ...brand,
              isActive: Boolean(brand.isActive),
            })),
          );
        }
        if (tagGroupsResponse.ok) {
          const body = (await tagGroupsResponse.json()) as {
            data?: CatalogTagGroup[];
          };
          setTagGroups(body.data ?? []);
        }
      } catch {
        if (!cancelled) {
          setClassificationCategories([]);
          setBrands([]);
          setTagGroups([]);
        }
      } finally {
        if (!cancelled) setTaxonomyReady(true);
      }
    };
    void loadTaxonomy();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!variantTargetGroupId && groups[0]) {
      setVariantTargetGroupId(groups[0].id);
      return;
    }
    if (
      variantTargetGroupId &&
      !groups.some((group) => group.id === variantTargetGroupId)
    )
      setVariantTargetGroupId(groups[0]?.id ?? "");
  }, [groups, variantTargetGroupId]);

  useEffect(() => {
    let cancelled = false;
    const loadVariants = async () => {
      setVariantLoading(true);
      try {
        const response = await fetch(
          `/api/admin/combo-variants?q=${encodeURIComponent(variantQuery.trim())}`,
          { headers: { accept: "application/json" } },
        );
        const body = (await response.json().catch(() => ({}))) as {
          data?: VariantOption[];
        };
        if (!cancelled) setVariantOptions(response.ok ? body.data ?? [] : []);
      } catch {
        if (!cancelled) setVariantOptions([]);
      } finally {
        if (!cancelled) setVariantLoading(false);
      }
    };
    const timer = window.setTimeout(() => void loadVariants(), 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [variantQuery]);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    void fetch(`/api/admin/products/${id}`, {
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          data?: AdminProductData;
          error?: { message?: string };
        };
        if (!response.ok || !body.data)
          throw new Error(body.error?.message ?? "Không tải được Combo.");
        return body.data;
      })
      .then((product) => {
        if (cancelled) return;
        if (product.productType !== "COMBO")
          throw new Error("Sản phẩm này không phải Combo.");
        setName(product.name);
        setSlug(product.slug);
        setBasePriceVnd(String(product.basePriceVnd ?? 0));
        setShortDescription(product.shortDescription ?? "");
        setDescriptionContent(
          product.descriptionContent ??
            legacyDescriptionToDocument(product.description ?? ""),
        );
        setDescriptionAssets(product.descriptionAssets ?? []);
        setStatus(product.status ?? "HIDDEN");
        setImages(product.images ?? []);
        setGroupMode(product.comboConfig?.groupMode ?? "ALL_GROUPS");
        setGroups(toEditableGroups(product.comboConfig));
        setPreservedFields({
          brandId: product.brandId ?? null,
          categoryIds: product.categoryIds ?? [],
          tagIds: product.tagIds ?? [],
          minAgeMonths: product.minAgeMonths ?? null,
          isBestSeller: Boolean(product.isBestSeller),
          bestSellerRank: product.bestSellerRank ?? null,
          featured: Boolean(product.featured),
          sortOrder: product.sortOrder ?? 0,
        });
      })
      .catch((caught) => {
        if (!cancelled)
          setMessage(
            caught instanceof Error ? caught.message : "Không tải được Combo.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const uploadFiles = async (files: FileList | null, makePrimary: boolean) => {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    setSaving(true);
    let uploadedCount = 0;
    try {
      validateProductImageFiles(selectedFiles);
      let prependNext = makePrimary;
      const optimizationSummaries: string[] = [];
      await processProductImageFilesSequentially(
        selectedFiles,
        async (file, index, total) => {
          const { response, optimized } = await optimizeAndUploadProductImage(file, {
            endpoint: "/api/admin/images",
            onPhase: (phase, result) => {
              if (phase === "optimizing") {
                setMessage(`Đang xử lý ảnh Combo ${index + 1}/${total}: Đang tối ưu ảnh...`);
                return;
              }
              setMessage(
                `Đang xử lý ảnh Combo ${index + 1}/${total}: ${formatProductImageBytes(result?.originalBytes ?? 0)} → ${formatProductImageBytes(result?.optimizedBytes ?? 0)}.`,
              );
            },
          });
          optimizationSummaries.push(
            `${formatProductImageBytes(optimized.originalBytes)} → ${formatProductImageBytes(optimized.optimizedBytes)} (${optimized.width}×${optimized.height})`,
          );
          const body = (await response.json().catch(() => ({}))) as {
            key?: string;
            url?: string;
            error?: { message?: string };
          };
          if (!response.ok || !body.key || !body.url)
            throw new Error(body.error?.message ?? "Tải ảnh lên R2 thất bại.");
          const uploadedImage: ProductImageRecord = {
            r2Key: body.key,
            url: body.url,
            altText: name || "Ảnh Combo BabyJoy",
            sortOrder: 0,
          };
          setImages((current) => {
            const next = prependNext
              ? [uploadedImage, ...current]
              : [...current, uploadedImage];
            prependNext = false;
            return next.map((image, sortOrder) => ({ ...image, sortOrder }));
          });
          uploadedCount += 1;
        },
      );
      setMessage(
        `Đã tải ${uploadedCount} ảnh Combo lên R2. ${optimizationSummaries.join("; ")} Hãy lưu để gắn ảnh.`,
      );
    } catch (caught) {
      const messageText = caught instanceof Error ? caught.message : "Tải ảnh Combo thất bại.";
      setMessage(
        uploadedCount
          ? `Đã tải ${uploadedCount}/${selectedFiles.length} ảnh. ${messageText}`
          : messageText,
      );
    } finally {
      setSaving(false);
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
      if (!selected) return current;
      next.unshift(selected);
      return next.map((image, sortOrder) => ({ ...image, sortOrder }));
    });
  };

  const comboConfig = useMemo(
    () => ({
      groupMode,
      groups: groups.map((group, groupIndex) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        selectionType: group.selectionType,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        displayOrder: groupIndex,
        items: group.items.map((item, itemIndex) => ({
          id: item.id,
          variantId: item.variantId,
          fixedQuantity: item.fixedQuantity,
          minQuantity: item.minQuantity,
          maxQuantity: item.maxQuantity,
          priceAdjustment: item.priceAdjustment,
          displayOrder: itemIndex,
        })),
      })),
    }),
    [groupMode, groups],
  );

  const updateGroup = (groupId: string, patch: Partial<EditableComboGroup>) => {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId ? { ...group, ...patch } : group,
      ),
    );
  };

  const updateItem = (
    groupId: string,
    itemId: string,
    patch: Partial<EditableComboItem>,
  ) => {
    setGroups((current) =>
      current.map((group) =>
        group.id !== groupId
          ? group
          : {
              ...group,
              items: group.items.map((item) =>
                item.id === itemId ? { ...item, ...patch } : item,
              ),
            },
      ),
    );
  };

  const addVariant = (option: VariantOption) => {
    const target = groups.find((group) => group.id === variantTargetGroupId);
    if (!target) {
      setMessage("Hãy chọn Group nhận Variant trước.");
      return;
    }
    if (target.items.some((item) => item.variantId === option.variantId)) {
      setMessage("Variant này đã có trong Group đang chọn.");
      return;
    }
    setGroups((current) =>
      current.map((group) =>
        group.id !== target.id
          ? group
          : {
              ...group,
              items: [
                ...group.items,
                {
                  id: newId(),
                  variantId: option.variantId,
                  variantLabel: optionLabel(option),
                  fixedQuantity: 1,
                  minQuantity: 1,
                  maxQuantity: 1,
                  priceAdjustment: 0,
                  displayOrder: group.items.length,
                },
              ],
            },
      ),
    );
    setMessage("");
  };

  const moveGroup = (groupIndex: number, offset: number) => {
    setGroups((current) => {
      const target = groupIndex + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[groupIndex], next[target]] = [next[target], next[groupIndex]];
      return next.map((group, displayOrder) => ({ ...group, displayOrder }));
    });
  };

  const moveItem = (groupId: string, itemIndex: number, offset: number) => {
    setGroups((current) =>
      current.map((group) => {
        if (group.id !== groupId) return group;
        const target = itemIndex + offset;
        if (target < 0 || target >= group.items.length) return group;
        const items = [...group.items];
        [items[itemIndex], items[target]] = [items[target], items[itemIndex]];
        return {
          ...group,
          items: items.map((item, displayOrder) => ({ ...item, displayOrder })),
        };
      }),
    );
  };

  const toggleCategory = (categoryId: string, selected: boolean) => {
    setPreservedFields((current) => ({
      ...current,
      categoryIds: selected
        ? [...new Set([...current.categoryIds, categoryId])]
        : current.categoryIds.filter((id) => id !== categoryId),
    }));
  };

  const toggleProductTag = (
    group: CatalogTagGroup,
    tagId: string,
    selected: boolean,
  ) => {
    setPreservedFields((current) => {
      const groupTagIds = new Set(group.tags.map((tag) => tag.id));
      const nextTagIds =
        group.assignmentMode === "SINGLE"
          ? current.tagIds.filter((id) => !groupTagIds.has(id))
          : current.tagIds.filter((id) => id !== tagId);
      if (selected) nextTagIds.push(tagId);
      return { ...current, tagIds: [...new Set(nextTagIds)] };
    });
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || loading || !taxonomyReady) return;
    const parsedPrice = Number(basePriceVnd);
    if (!name.trim() || !Number.isSafeInteger(parsedPrice) || parsedPrice < 0) {
      setMessage("Tên Combo và giá cơ bản phải hợp lệ.");
      return;
    }
    setSaving(true);
    setMessage("Đang lưu Combo...");
    try {
      const response = await fetch(
        id ? `/api/admin/combos/${id}` : "/api/admin/combos",
        {
          method: id ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            productType: "COMBO",
            name: name.trim(),
            slug: slug.trim(),
            basePriceVnd: parsedPrice,
            shortDescription,
            descriptionContent,
            descriptionUploadSessionId,
            images: images.map(({ id: imageId, r2Key, altText }, sortOrder) => ({
              id: imageId,
              r2Key,
              altText,
              sortOrder,
            })),
            status,
            brandId: preservedFields.brandId,
            categoryIds: preservedFields.categoryIds,
            tagIds: preservedFields.tagIds,
            minAgeMonths: preservedFields.minAgeMonths,
            isBestSeller: preservedFields.isBestSeller,
            bestSellerRank: preservedFields.bestSellerRank,
            featured: preservedFields.featured,
            sortOrder: preservedFields.sortOrder,
            comboConfig,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        setMessage(body.error?.message ?? "Chưa thể lưu Combo.");
        return;
      }
      const savedId = id ?? body.id;
      if (savedId && !id) {
        navigate(`/admin/combos/${savedId}/edit`, { replace: true });
        return;
      }
      setMessage("Đã lưu Combo và phiên bản cấu hình.");
    } catch {
      setMessage("Chưa thể lưu Combo. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };

  const deleteCombo = async () => {
    if (!id || saving) return;
    // Luôn đọc impact mới nhất để xác nhận rõ các Product/Variant gốc sẽ được giữ lại.
    const preflightResponse = await fetch(
      `/api/admin/products/${id}/delete-preflight`,
      { headers: { accept: "application/json" } },
    );
    const preflight = (await preflightResponse.json().catch(() => ({}))) as {
      data?: {
        product?: { name?: string };
        counts?: {
          variants?: number;
          activeCarts?: number;
          historicalCartLines?: number;
          productImages?: number;
          comboMemberships?: number;
        };
      };
      error?: { message?: string };
    };
    if (!preflightResponse.ok || !preflight.data) {
      setMessage(preflight.error?.message ?? "Chưa thể kiểm tra phạm vi xóa Combo.");
      return;
    }
    const counts = preflight.data.counts ?? {};
    if (
      !window.confirm(
        `XÓA VĨNH VIỄN Combo “${preflight.data.product?.name ?? name}”?\n\nSẽ xóa cấu hình, Group, membership, media và giỏ đang chờ (${counts.activeCarts ?? 0}). Product/Variant gốc trong Combo không bị xóa. Lịch sử vẫn giữ snapshot. Hành động này không thể hoàn tác.`,
      )
    )
      return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/products/${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (response.ok) navigate("/admin/products");
      else setMessage(body.error?.message ?? "Chưa thể xóa vĩnh viễn Combo.");
    } catch {
      setMessage("Chưa thể xóa vĩnh viễn Combo. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell title="Combo">
      <form className="combo-admin-editor" onSubmit={save}>
        <div className="editor-heading combo-admin-heading">
          <div>
            <Link to="/admin/products">
              <Icon>arrow_back</Icon> Sản phẩm
            </Link>
            <h1>{id ? "Sửa Combo" : "Tạo Combo"}</h1>
            <p>
              Ghép các Variant thật thành một dòng bán hàng và giữ tồn kho theo
              từng thành phần. {message}
            </p>
          </div>
          <div>
            <Link to="/admin/products">HỦY</Link>
            <button className="btn primary" type="submit" disabled={saving || loading || !taxonomyReady}>
              <Icon>save</Icon> LƯU COMBO
            </button>
            {id && (
              <button className="btn combo-delete-button" type="button" onClick={() => void deleteCombo()} disabled={saving || loading}>
                <Icon>delete_forever</Icon> XÓA VĨNH VIỄN
              </button>
            )}
          </div>
        </div>
        {loading ? (
          <section className="editor-card">
            <p>Đang tải dữ liệu Combo...</p>
          </section>
        ) : (
          <div className="editor-grid combo-admin-grid">
            <div className="editor-main">
              <section className="editor-card">
                <div className="editor-card-title">
                  <span><Icon>info</Icon><h2>Thông tin Combo</h2></span>
                </div>
                <label>
                  Tên Combo *
                  <input value={name} onChange={(event) => setName(event.target.value)} required />
                </label>
                <div className="form-grid">
                  <label>
                    Đường dẫn (Slug)
                    <input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="tu-dong-tao-tu-ten" />
                  </label>
                  <label>
                    Thương hiệu
                    <select
                      value={preservedFields.brandId ?? ""}
                      onChange={(event) =>
                        setPreservedFields((current) => ({
                          ...current,
                          brandId: event.target.value || null,
                        }))
                      }
                    >
                      <option value="">Chọn thương hiệu...</option>
                      {brands.map((brand) => (
                        <option
                          key={brand.id}
                          value={brand.id}
                          disabled={brand.isActive === false && brand.id !== preservedFields.brandId}
                        >
                          {brand.name}{brand.isActive === false ? " (đã ẩn)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Giá cơ bản (₫) *
                    <input type="number" min="0" step="1" value={basePriceVnd} onChange={(event) => setBasePriceVnd(event.target.value)} required />
                  </label>
                  <label>
                    Trạng thái
                    <select value={status} onChange={(event) => setStatus(event.target.value)}>
                      <option value="AVAILABLE">Đang bán</option>
                      <option value="HIDDEN">Đã ẩn</option>
                      <option value="OUT_OF_STOCK">Hết hàng</option>
                    </select>
                  </label>
                  <label>
                    Độ tuổi tối thiểu (tháng)
                    <input
                      type="number"
                      min="0"
                      max="240"
                      step="1"
                      value={preservedFields.minAgeMonths ?? ""}
                      onChange={(event) =>
                        setPreservedFields((current) => ({
                          ...current,
                          minAgeMonths: event.target.value === "" ? null : Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Thứ tự hiển thị
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={preservedFields.sortOrder}
                      onChange={(event) =>
                        setPreservedFields((current) => ({
                          ...current,
                          sortOrder: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                </div>
                <label className="inventory-toggle-label">
                  <input
                    type="checkbox"
                    checked={preservedFields.featured}
                    onChange={(event) =>
                      setPreservedFields((current) => ({
                        ...current,
                        featured: event.target.checked,
                      }))
                    }
                  />
                  <span>Hiển thị Combo ở khu vực nổi bật</span>
                </label>
                <label>
                  Mô tả ngắn
                  <textarea className="short" value={shortDescription} onChange={(event) => setShortDescription(event.target.value)} />
                </label>
                <div>
                  <span>Mô tả chi tiết</span>
                  <ProductDescriptionEditor
                    value={descriptionContent}
                    productId={id}
                    uploadSessionId={descriptionUploadSessionId}
                    assets={descriptionAssets}
                    onChange={setDescriptionContent}
                    onAsset={(asset) =>
                      setDescriptionAssets((current) =>
                        current.some((item) => item.id === asset.id)
                          ? current
                          : [...current, asset],
                      )
                    }
                  />
                </div>
              </section>

              <section className="editor-card combo-rule-card">
                <div className="editor-card-title">
                  <span><Icon>account_tree</Icon><h2>Quan hệ Group</h2></span>
                </div>
                <label>
                  Kiểu ghép
                  <select value={groupMode} onChange={(event) => setGroupMode(event.target.value as ComboGroupMode)}>
                    <option value="ALL_GROUPS">Khách chọn trong tất cả Group</option>
                    <option value="ONE_OF_GROUPS">Khách chọn một trong các Group</option>
                  </select>
                </label>
                <p className="field-help">
                  Mỗi lần thay đổi sẽ tăng config version và các lựa chọn cũ sẽ
                  được server kiểm tra lại.
                </p>
              </section>

              {groups.map((group, groupIndex) => (
                <section className="editor-card combo-group-editor" key={group.id}>
                  <div className="editor-card-title">
                    <span><Icon>view_module</Icon><h2>Group {groupIndex + 1}</h2></span>
                    <div className="combo-group-actions">
                      <button type="button" className="icon-button" disabled={groupIndex === 0} onClick={() => moveGroup(groupIndex, -1)} aria-label={`Đưa Group ${groupIndex + 1} lên trước`}>
                        <Icon>arrow_upward</Icon>
                      </button>
                      <button type="button" className="icon-button" disabled={groupIndex === groups.length - 1} onClick={() => moveGroup(groupIndex, 1)} aria-label={`Đưa Group ${groupIndex + 1} xuống sau`}>
                        <Icon>arrow_downward</Icon>
                      </button>
                      {groups.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setGroups((current) => current.filter((item) => item.id !== group.id))}
                        >
                          Xóa Group
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="form-grid">
                    <label>
                      Tên Group *
                      <input value={group.name} onChange={(event) => updateGroup(group.id, { name: event.target.value })} required />
                    </label>
                    <label>
                      Loại lựa chọn
                      <select
                        value={group.selectionType}
                        onChange={(event) => {
                          const next = event.target.value as ComboSelectionType;
                          updateGroup(group.id, {
                            selectionType: next,
                            ...(next === "FIXED"
                              ? { minSelect: 0, maxSelect: 0 }
                              : {
                                  minSelect: 1,
                                  maxSelect: Math.max(1, group.maxSelect),
                                }),
                          });
                        }}
                      >
                        {Object.entries(selectionTypeLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    Mô tả Group
                    <input value={group.description} onChange={(event) => updateGroup(group.id, { description: event.target.value })} />
                  </label>
                  {group.selectionType !== "FIXED" && (
                    <div className="form-grid combo-range-fields">
                      <label>
                        {group.selectionType === "CHOOSE_QUANTITY" ? "Tổng quantity tối thiểu" : "Số Item tối thiểu"}
                        <input type="number" min="0" step="1" value={group.minSelect} onChange={(event) => updateGroup(group.id, { minSelect: Number(event.target.value) })} />
                      </label>
                      <label>
                        {group.selectionType === "CHOOSE_QUANTITY" ? "Tổng quantity tối đa" : "Số Item tối đa"}
                        <input type="number" min="0" step="1" value={group.maxSelect} onChange={(event) => updateGroup(group.id, { maxSelect: Number(event.target.value) })} />
                      </label>
                    </div>
                  )}
                  <div className="combo-items-list">
                    {group.items.length ? (
                      group.items.map((item, itemIndex) => (
                        <div className="combo-admin-item" key={item.id}>
                          <div className="combo-admin-item-copy">
                            <b>{item.variantLabel}</b>
                            <small>{item.variantId}</small>
                          </div>
                          <label>
                            {group.selectionType === "FIXED" ? "Quantity" : "Min"}
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={group.selectionType === "FIXED" ? item.fixedQuantity : item.minQuantity}
                              onChange={(event) =>
                                updateItem(
                                  group.id,
                                  item.id,
                                  group.selectionType === "FIXED"
                                    ? { fixedQuantity: Number(event.target.value) }
                                    : { minQuantity: Number(event.target.value) },
                                )
                              }
                            />
                          </label>
                          <label>
                            {group.selectionType === "FIXED" ? "Điều chỉnh giá / đơn vị" : "Max"}
                            <input
                              type="number"
                              step="1"
                              value={group.selectionType === "FIXED" ? item.priceAdjustment : item.maxQuantity}
                              onChange={(event) =>
                                updateItem(
                                  group.id,
                                  item.id,
                                  group.selectionType === "FIXED"
                                    ? { priceAdjustment: Number(event.target.value) }
                                    : { maxQuantity: Number(event.target.value) },
                                )
                              }
                            />
                          </label>
                          {group.selectionType !== "FIXED" && (
                            <label>
                              Điều chỉnh giá
                              <input type="number" step="1" value={item.priceAdjustment} onChange={(event) => updateItem(group.id, item.id, { priceAdjustment: Number(event.target.value) })} />
                            </label>
                          )}
                          <div className="combo-admin-item-actions">
                            <button className="icon-button" type="button" disabled={itemIndex === 0} onClick={() => moveItem(group.id, itemIndex, -1)} aria-label="Đưa Variant lên trước">
                              <Icon>arrow_upward</Icon>
                            </button>
                            <button className="icon-button" type="button" disabled={itemIndex === group.items.length - 1} onClick={() => moveItem(group.id, itemIndex, 1)} aria-label="Đưa Variant xuống sau">
                              <Icon>arrow_downward</Icon>
                            </button>
                            <button className="icon-button" type="button" onClick={() => updateGroup(group.id, { items: group.items.filter((candidate) => candidate.id !== item.id) })} aria-label="Gỡ Variant khỏi Group">
                              <Icon>delete</Icon>
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="combo-empty-items">Chưa có Variant. Chọn Variant ở khung bên phải.</p>
                    )}
                  </div>
                </section>
              ))}
              <button className="btn secondary-btn combo-add-group" type="button" onClick={() => setGroups((current) => [...current, createGroup(current.length)])}>
                <Icon>add</Icon> THÊM GROUP
              </button>
            </div>

            <aside className="editor-side combo-admin-side">
              <section className="editor-card combo-image-editor">
                <div className="editor-card-title">
                  <span><Icon>image</Icon><h2>Hình ảnh Combo</h2></span>
                </div>
                <label className="upload-box">
                  <Icon>add_photo_alternate</Icon>
                  <b>Tải ảnh lên</b>
                  <span>Ảnh đầu tiên là ảnh đại diện</span>
                  <small>PNG, JPG, WebP (tối đa 30 MiB/ảnh; tự tối ưu)</small>
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    disabled={saving}
                    onChange={(event) => void uploadFiles(event.target.files, images.length === 0)}
                  />
                </label>
                {images.length > 0 && (
                  <div className="editor-image-list">
                    {images.map((image, index) => (
                      <div key={image.r2Key} className="editor-image-item">
                        <ProductImage image={image} alt={image.altText} />
                        <span>{index === 0 ? "Ảnh chính" : `Ảnh ${index + 1}`}</span>
                        <div>
                          <button type="button" aria-label="Chọn làm ảnh chính" disabled={index === 0} onClick={() => makePrimary(index)}>
                            <Icon>star</Icon>
                          </button>
                          <button type="button" aria-label="Đưa ảnh lên trước" disabled={index === 0} onClick={() => moveImage(index, -1)}>
                            <Icon>arrow_upward</Icon>
                          </button>
                          <button type="button" aria-label="Đưa ảnh xuống sau" disabled={index === images.length - 1} onClick={() => moveImage(index, 1)}>
                            <Icon>arrow_downward</Icon>
                          </button>
                          <button type="button" aria-label="Gỡ ảnh khỏi Combo" onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index).map((item, sortOrder) => ({ ...item, sortOrder })))}>
                            <Icon>delete</Icon>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className="editor-card combo-taxonomy-editor">
                <div className="editor-card-title">
                  <span><Icon>sell</Icon><h2>Danh mục & nhãn</h2></span>
                </div>
                <fieldset>
                  <legend>Danh mục</legend>
                  <div className="selected-tags taxonomy-choices">
                    {classificationCategories.length ? (
                      classificationCategories.map((category) => (
                        <label className="tag-choice" key={category.id}>
                          <input
                            type="checkbox"
                            checked={preservedFields.categoryIds.includes(category.id)}
                            disabled={category.isActive === false && !preservedFields.categoryIds.includes(category.id)}
                            onChange={(event) => toggleCategory(category.id, event.target.checked)}
                          />
                          <Tag tone={category.isActive === false ? "neutral" : "secondary"}>
                            {category.name}{category.isActive === false ? " (đã ẩn)" : ""}
                          </Tag>
                        </label>
                      ))
                    ) : (
                      <small className="field-help">Chưa có danh mục khả dụng.</small>
                    )}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Nhãn Product</legend>
                  <div className="combo-product-tag-groups">
                    {tagGroups.length ? (
                      tagGroups.map((group) => (
                        <div className="combo-product-tag-group" key={group.id}>
                          <b>{group.displayName}</b>
                          <div className="selected-tags taxonomy-choices">
                            {group.tags.map((tag) => (
                              <label className="tag-choice" key={tag.id}>
                                <input
                                  type="checkbox"
                                  checked={preservedFields.tagIds.includes(tag.id)}
                                  disabled={tag.isActive === false && !preservedFields.tagIds.includes(tag.id)}
                                  onChange={(event) => toggleProductTag(group, tag.id, event.target.checked)}
                                />
                                <Tag tone={tag.isActive === false ? "neutral" : "secondary"}>
                                  {tag.displayName ?? tag.name}{tag.isActive === false ? " (đã ẩn)" : ""}
                                </Tag>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <small className="field-help">Chưa có nhãn khả dụng.</small>
                    )}
                  </div>
                </fieldset>
                <small className="field-help">
                  Category và nhãn được lưu trên Product Combo; thuộc tính của từng Variant thành phần vẫn giữ nguyên.
                </small>
              </section>
              <section className="editor-card combo-variant-picker">
                <div className="editor-card-title">
                  <span><Icon>inventory_2</Icon><h2>Thêm Variant</h2></span>
                </div>
                <label>
                  Thêm vào Group
                  <select value={variantTargetGroupId} onChange={(event) => setVariantTargetGroupId(event.target.value)}>
                    {groups.map((group, index) => (
                      <option key={group.id} value={group.id}>Group {index + 1}: {group.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Tìm Product / Variant / SKU
                  <input value={variantQuery} onChange={(event) => setVariantQuery(event.target.value)} placeholder="Tìm kiếm..." />
                </label>
                <div className="combo-variant-options">
                  {variantLoading ? (
                    <p className="field-help">Đang tìm...</p>
                  ) : variantOptions.length ? (
                    variantOptions.map((option) => (
                      <button type="button" key={option.variantId} onClick={() => addVariant(option)}>
                        {option.imageUrl ? (
                          <img src={option.imageUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="combo-variant-placeholder"><Icon>inventory_2</Icon></span>
                        )}
                        <span>
                          <b>{option.productName}</b>
                          <small>
                            {option.variantName} · {option.sku ?? "Chưa có SKU"}
                            {option.availableQuantity !== null ? ` · Còn ${option.availableQuantity}` : ""}
                          </small>
                        </span>
                        <Tag tone={option.availability === "AVAILABLE" ? "secondary" : "neutral"}>
                          {option.availability === "AVAILABLE" ? "Đang bán" : option.availability}
                        </Tag>
                        <Icon>add</Icon>
                      </button>
                    ))
                  ) : (
                    <p className="field-help">Không tìm thấy Variant Product thường.</p>
                  )}
                </div>
              </section>
              <section className="editor-card combo-admin-help">
                <div className="editor-card-title">
                  <span><Icon>verified_user</Icon><h2>Nguyên tắc</h2></span>
                </div>
                <ul>
                  <li>Combo chỉ lưu Variant của Product thường.</li>
                  <li>Giá và rule được server xác thực lại khi thêm vào giỏ.</li>
                  <li>Tồn kho được trừ theo từng component thực tế.</li>
                  <li>Combo chưa đủ cấu hình sẽ tự ẩn khỏi storefront.</li>
                </ul>
                <StatusBadge status={status} />
              </section>
            </aside>
          </div>
        )}
      </form>
    </AdminShell>
  );
}
