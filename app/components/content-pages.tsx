import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  contentPageLabel,
  isContentPageSlug,
  type ContentPageSlug,
} from "../../shared/content-pages";
import {
  legacyDescriptionToDocument,
  type ProductDescriptionAsset,
  type ProductDescriptionDocument,
} from "../../shared/product-description";
import { STORE_BRAND } from "../../shared/branding";
import { ProductDescriptionEditor } from "./product-description-editor";
import { ProductRichDescription } from "./product-rich-description";
import { AdminShell, Icon, StatusBadge, PublicShell } from "./ui";

type ContentPageStatus = "PUBLISHED" | "DRAFT";

type ContentPageData = {
  slug: ContentPageSlug;
  title: string;
  status: ContentPageStatus;
  content: ProductDescriptionDocument;
  assets: ProductDescriptionAsset[];
  updatedAt: string;
};

type PublicContentPageData = Omit<ContentPageData, "status">;

type ContentPageListItem = Pick<
  ContentPageData,
  "slug" | "title" | "status" | "updatedAt"
> & { label: string };

type ApiErrorBody = { error?: { message?: unknown } };

function apiErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fallback;
  const message = (body as ApiErrorBody).error?.message;
  return typeof message === "string" && message ? message : fallback;
}

function isPageData(value: unknown): value is ContentPageData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const page = value as Partial<ContentPageData>;
  return (
    isContentPageSlug(page.slug) &&
    typeof page.title === "string" &&
    (page.status === "PUBLISHED" || page.status === "DRAFT") &&
    Boolean(page.content && typeof page.content === "object") &&
    Array.isArray(page.assets) &&
    typeof page.updatedAt === "string"
  );
}

function isPublicPageData(value: unknown): value is PublicContentPageData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const page = value as Partial<PublicContentPageData>;
  return (
    isContentPageSlug(page.slug) &&
    typeof page.title === "string" &&
    Boolean(page.content && typeof page.content === "object") &&
    Array.isArray(page.assets) &&
    typeof page.updatedAt === "string"
  );
}

function formatUpdatedAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Chưa xác định";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(timestamp);
}

function pageFingerprint(
  title: string,
  status: ContentPageStatus,
  content: ProductDescriptionDocument,
) {
  return JSON.stringify({ title: title.trim(), status, content });
}

export function PublicContentPage({ slug }: { slug: ContentPageSlug }) {
  const [page, setPage] = useState<PublicContentPageData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not-found" | "error">(
    "loading",
  );

  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setState("loading");
    void fetch(`/api/content-pages/${encodeURIComponent(slug)}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as { page?: unknown };
        if (response.status === 404) {
          setState("not-found");
          return;
        }
        if (!response.ok || !isPublicPageData(body.page)) throw new Error("CONTENT_PAGE_LOAD_FAILED");
        setPage(body.page);
        document.title = `${body.page.title} | ${STORE_BRAND}`;
        setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => controller.abort();
  }, [slug]);

  return (
    <PublicShell>
      <section className="content-page" aria-busy={state === "loading"}>
        <div className="content-page-breadcrumbs">
          <Link to="/">Trang chủ</Link>
          <Icon>chevron_right</Icon>
          <span>{contentPageLabel(slug)}</span>
        </div>
        {state === "loading" && (
          <div className="content-page-card content-page-state" role="status">
            <Icon>progress_activity</Icon>
            <p>Đang tải nội dung…</p>
          </div>
        )}
        {state === "not-found" && (
          <div className="content-page-card content-page-state">
            <Icon>edit_note</Icon>
            <h1>Nội dung đang được cập nhật</h1>
            <p>Vui lòng quay lại sau hoặc liên hệ cửa hàng để được hỗ trợ.</p>
          </div>
        )}
        {state === "error" && (
          <div className="content-page-card content-page-state" role="alert">
            <Icon>cloud_off</Icon>
            <h1>Chưa thể tải nội dung</h1>
            <p>Vui lòng thử lại sau.</p>
          </div>
        )}
        {state === "ready" && page && (
          <article className="content-page-card">
            <header className="content-page-heading">
              <span>HỖ TRỢ</span>
              <h1>{page.title}</h1>
            </header>
            <ProductRichDescription
              content={page.content}
              assets={page.assets}
              fallback="Nội dung đang được cập nhật."
            />
          </article>
        )}
      </section>
    </PublicShell>
  );
}

export function AdminContentPagesPage() {
  const [pages, setPages] = useState<ContentPageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/content-pages", {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as { data?: unknown } & ApiErrorBody;
        if (!response.ok || !Array.isArray(body.data))
          throw new Error(apiErrorMessage(body, "Không tải được danh sách trang nội dung."));
        setPages(body.data as ContentPageListItem[]);
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : "Không tải được danh sách trang nội dung.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <AdminShell title="Trang nội dung">
      <div className="admin-page-heading">
        <div>
          <h1>Trang nội dung</h1>
          <p>Quản lý các trang hỗ trợ hiển thị ở footer storefront.</p>
        </div>
      </div>
      <section className="admin-table-card admin-content-pages-card">
        {loading && <p className="table-footer">Đang tải danh sách trang…</p>}
        {!loading && error && <p className="table-footer form-error" role="alert">{error}</p>}
        {!loading && !error && (
          <div className="table-scroll">
            <table className="admin-content-pages-table">
              <thead>
                <tr>
                  <th>Tên trang</th>
                  <th>Slug</th>
                  <th>Trạng thái</th>
                  <th>Cập nhật lần cuối</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => (
                  <tr key={page.slug}>
                    <td><b>{page.title || page.label}</b></td>
                    <td><code>{page.slug}</code></td>
                    <td><StatusBadge status={page.status} /></td>
                    <td>{formatUpdatedAt(page.updatedAt)}</td>
                    <td className="row-actions">
                      <Link className="btn secondary-btn" to={`/admin/content-pages/${page.slug}/edit`}>
                        <Icon>edit</Icon> Chỉnh sửa
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}

export function AdminContentPageEditorPage() {
  const pathname = useLocation().pathname;
  const segments = pathname.split("/").filter(Boolean);
  const rawSlug = segments.at(-2) ?? "";
  const slug = isContentPageSlug(rawSlug) ? rawSlug : null;
  const [page, setPage] = useState<ContentPageData | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<ContentPageStatus>("PUBLISHED");
  const [content, setContent] = useState<ProductDescriptionDocument>(() =>
    legacyDescriptionToDocument(""),
  );
  const [assets, setAssets] = useState<ProductDescriptionAsset[]>([]);
  const [uploadSessionId, setUploadSessionId] = useState(() => crypto.randomUUID());
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [loading, setLoading] = useState(Boolean(slug));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const currentFingerprint = useMemo(
    () => pageFingerprint(title, status, content),
    [content, status, title],
  );
  const dirty = Boolean(savedFingerprint) && currentFingerprint !== savedFingerprint;

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      setLoadError("Không tìm thấy trang nội dung.");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    setFeedback("");
    setSaveError("");
    setUploadSessionId(crypto.randomUUID());
    void fetch(`/api/admin/content-pages/${encodeURIComponent(slug)}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as { page?: unknown } & ApiErrorBody;
        if (!response.ok || !isPageData(body.page))
          throw new Error(apiErrorMessage(body, "Không tải được trang nội dung."));
        const loaded = body.page;
        setPage(loaded);
        setTitle(loaded.title);
        setStatus(loaded.status);
        setContent(loaded.content);
        setAssets(loaded.assets);
        setSavedFingerprint(pageFingerprint(loaded.title, loaded.status, loaded.content));
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setLoadError(caught instanceof Error ? caught.message : "Không tải được trang nội dung.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (!slug)
    return (
      <AdminShell title="Trang nội dung">
        <p className="form-error" role="alert">Không tìm thấy trang nội dung.</p>
      </AdminShell>
    );

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!page || saving) return;
    setSaving(true);
    setFeedback("");
    setSaveError("");
    try {
      const response = await fetch(`/api/admin/content-pages/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          title,
          status,
          content,
          updatedAt: page.updatedAt,
          contentPageUploadSessionId: uploadSessionId,
        }),
      });
      const body = (await response.json()) as { page?: unknown } & ApiErrorBody;
      if (!response.ok || !isPageData(body.page)) {
        if (response.status === 409)
          throw new Error("Trang vừa được cập nhật bởi một phiên khác. Hãy tải lại trước khi lưu.");
        throw new Error(apiErrorMessage(body, "Không thể lưu nội dung. Vui lòng thử lại."));
      }
      const saved = body.page;
      setPage(saved);
      setTitle(saved.title);
      setStatus(saved.status);
      setContent(saved.content);
      setAssets(saved.assets);
      setSavedFingerprint(pageFingerprint(saved.title, saved.status, saved.content));
      setFeedback("Đã lưu thay đổi");
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Không thể lưu nội dung. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };

  const leaveEditor = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (dirty && !window.confirm("Bạn có thay đổi chưa lưu. Rời trang sẽ mất nội dung đó?"))
      event.preventDefault();
  };

  return (
    <AdminShell title="Trang nội dung">
      <form className="admin-content-page-editor" onSubmit={save}>
        <div className="editor-heading">
          <div>
            <h1>{loading ? "Đang tải…" : `Sửa: ${title || contentPageLabel(slug)}`}</h1>
            <p>Chỉnh sửa nội dung hiển thị tại <code>/{slug}</code>.</p>
          </div>
          <div className="admin-content-page-actions">
            <Link to="/admin/content-pages" onClick={leaveEditor}>HỦY</Link>
            <button className="btn primary" type="submit" disabled={loading || saving || !page}>
              <Icon>save</Icon> {saving ? "ĐANG LƯU…" : "LƯU THAY ĐỔI"}
            </button>
          </div>
        </div>
        {loadError && <p className="form-error" role="alert">{loadError}</p>}
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
        {feedback && <p className="content-page-save-feedback" role="status">{feedback}</p>}
        {!loading && page && (
          <div className="admin-content-page-grid">
            <section className="editor-card admin-content-page-card">
              <h2>Thông tin trang</h2>
              <label>
                Tiêu đề *
                <input
                  value={title}
                  maxLength={160}
                  required
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label>
                Slug hệ thống
                <input value={slug} readOnly aria-readonly="true" />
              </label>
              <label className="content-page-publish-toggle">
                <input
                  type="checkbox"
                  checked={status === "PUBLISHED"}
                  onChange={(event) => setStatus(event.target.checked ? "PUBLISHED" : "DRAFT")}
                />
                <span>
                  <b>Hiển thị trang này ngoài storefront</b>
                  <small>{status === "PUBLISHED" ? "Khách hàng có thể truy cập trang." : "Trang đang ở chế độ bản nháp."}</small>
                </span>
              </label>
            </section>
            <section className="editor-card admin-content-page-card admin-content-page-rich-card">
              <h2>Nội dung rich text</h2>
              <ProductDescriptionEditor
                value={content}
                uploadSessionId={uploadSessionId}
                contentPageSlug={slug}
                assets={assets}
                onChange={setContent}
                onAsset={(asset) =>
                  setAssets((current) =>
                    current.some((item) => item.id === asset.id)
                      ? current
                      : [...current, asset],
                  )
                }
              />
            </section>
          </div>
        )}
      </form>
    </AdminShell>
  );
}
