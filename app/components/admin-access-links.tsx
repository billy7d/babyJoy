import { useEffect, useState } from "react";
import { AdminShell, Icon, StatusBadge } from "./ui";

type AccessLink = {
  id: string;
  name: string;
  notes: string | null;
  groups: Array<{ id: string; name: string; url: string | null }>;
  status: "ACTIVE" | "REVOKED";
  version: number;
  sessionTtlSeconds: number;
  usesDefaultTtl: boolean;
  accessUrl: string;
  stats: {
    validLinkOpens: number;
    uniqueVisitors: number;
    sessionsIssued: number;
    activeSessions: number;
    opensToday: number;
    opens7d: number;
    opens30d: number;
    lastUsedAt: string | null;
  };
};

type FormValue = {
  name: string;
  notes: string;
  groups: Array<{ name: string; url: string }>;
  usesDefaultTtl: boolean;
  ttlDays: string;
  ttlHours: string;
};

function blankForm(): FormValue {
  return {
    name: "",
    notes: "",
    groups: [],
    usesDefaultTtl: true,
    ttlDays: "15",
    ttlHours: "0",
  };
}

function formFromLink(link: AccessLink): FormValue {
  const days = Math.floor(link.sessionTtlSeconds / 86400);
  const hours = Math.floor((link.sessionTtlSeconds % 86400) / 3600);
  return {
    name: link.name,
    notes: link.notes ?? "",
    groups: link.groups.map((group) => ({
      name: group.name,
      url: group.url ?? "",
    })),
    usesDefaultTtl: link.usesDefaultTtl,
    ttlDays: String(days),
    ttlHours: String(hours),
  };
}

function formatTtl(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (!days) return hours + " giờ";
  return hours ? days + " ngày " + hours + " giờ" : days + " ngày";
}

function formatDate(value: string | null) {
  if (!value) return "Chưa sử dụng";
  return new Date(value).toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

async function readApiError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
    };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function AccessLinkForm({
  editing,
  onCancel,
  onSaved,
}: {
  editing: AccessLink | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<FormValue>(() =>
    editing ? formFromLink(editing) : blankForm(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(editing ? formFromLink(editing) : blankForm());
    setError("");
  }, [editing]);

  const updateGroup = (
    index: number,
    field: "name" | "url",
    value: string,
  ) => {
    setForm((current) => ({
      ...current,
      groups: current.groups.map((group, groupIndex) =>
        groupIndex === index ? { ...group, [field]: value } : group,
      ),
    }));
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const days = Number(form.ttlDays);
    const hours = Number(form.ttlHours);
    const ttl = days * 86400 + hours * 3600;
    try {
      const response = await fetch(
        editing
          ? "/api/admin/access-links/" + encodeURIComponent(editing.id)
          : "/api/admin/access-links",
        {
          method: editing ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            notes: form.notes || null,
            groups: form.groups,
            sessionTtlSeconds: form.usesDefaultTtl ? null : ttl,
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          await readApiError(response, "Chưa thể lưu access link."),
        );
      await onSaved();
      onCancel();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chưa thể lưu access link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="editor-card access-link-form" onSubmit={save}>
      <div className="editor-card-title">
        <span>
          <Icon>key</Icon>
          <h2>{editing ? "Sửa link truy cập" : "Tạo link truy cập"}</h2>
        </span>
      </div>
      <div className="form-grid">
        <label>
          Tên link *
          <input
            required
            maxLength={180}
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Group BabyJoy Hà Nội"
          />
        </label>
        <label>
          Ghi chú
          <input
            maxLength={2000}
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
            placeholder="Link dùng cho nhóm miền Bắc"
          />
        </label>
      </div>
      <div className="access-link-form-section">
        <div className="editor-heading">
          <div>
            <h3>Facebook Groups</h3>
            <p>Có thể gắn nhiều group vào cùng một link.</p>
          </div>
          <button
            type="button"
            className="btn secondary-btn"
            onClick={() =>
              setForm((current) => ({
                ...current,
                groups: [...current.groups, { name: "", url: "" }],
              }))
            }
          >
            <Icon>add</Icon> THÊM GROUP
          </button>
        </div>
        {form.groups.length === 0 ? (
          <p className="access-link-muted">Chưa gắn Facebook Group nào.</p>
        ) : (
          <div className="access-link-groups-form">
            {form.groups.map((group, index) => (
              <div className="access-link-group-row" key={index}>
                <label>
                  Tên Group *
                  <input
                    required
                    value={group.name}
                    onChange={(event) =>
                      updateGroup(index, "name", event.target.value)
                    }
                    placeholder="BabyJoy Hà Nội"
                  />
                </label>
                <label>
                  Facebook URL
                  <input
                    type="url"
                    value={group.url}
                    onChange={(event) =>
                      updateGroup(index, "url", event.target.value)
                    }
                    placeholder="https://facebook.com/groups/..."
                  />
                </label>
                <button
                  type="button"
                  aria-label={"Xóa group " + (group.name || index + 1)}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      groups: current.groups.filter(
                        (_, groupIndex) => groupIndex !== index,
                      ),
                    }))
                  }
                >
                  <Icon>delete</Icon>
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="access-link-help">
          Muốn thống kê riêng từng Facebook Group, hãy tạo access link riêng cho
          từng group.
        </p>
      </div>
      <div className="access-link-form-section">
        <h3>Thời hạn session</h3>
        <label className="tag-choice access-link-default-toggle">
          <input
            type="checkbox"
            checked={form.usesDefaultTtl}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                usesDefaultTtl: event.target.checked,
              }))
            }
          />
          Dùng thời hạn mặc định trong Cài đặt
        </label>
        {!form.usesDefaultTtl && (
          <div className="form-grid access-link-ttl-grid">
            <label>
              Ngày
              <input
                type="number"
                min="0"
                max="365"
                value={form.ttlDays}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    ttlDays: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Giờ
              <input
                type="number"
                min="0"
                max="23"
                value={form.ttlHours}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    ttlHours: event.target.value,
                  }))
                }
              />
            </label>
            <span className="access-link-ttl-hint">Tối thiểu 1 giờ, tối đa 365 ngày.</span>
          </div>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="editor-heading access-link-form-actions">
        <span />
        <div>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            HỦY
          </button>
          <button className="btn primary" type="submit" disabled={busy}>
            <Icon>save</Icon> {busy ? "ĐANG LƯU..." : "LƯU LINK"}
          </button>
        </div>
      </div>
    </form>
  );
}

export function AdminAccessLinksPage() {
  const [links, setLinks] = useState<AccessLink[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<AccessLink | null | "new">(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const loadLinks = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (status) params.set("status", status);
      const response = await fetch(
        "/api/admin/access-links" + (params.toString() ? "?" + params : ""),
        { headers: { accept: "application/json" } },
      );
      if (!response.ok)
        throw new Error(
          await readApiError(response, "Không tải được danh sách link truy cập."),
        );
      const body = (await response.json()) as { data?: AccessLink[] };
      setLinks(body.data ?? []);
    } catch (caught) {
      setLinks([]);
      setError(caught instanceof Error ? caught.message : "Không tải được danh sách link truy cập.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLinks(), 180);
    return () => window.clearTimeout(timer);
  }, [query, status]);

  const copyLink = async (accessUrl: string) => {
    try {
      await navigator.clipboard.writeText(accessUrl);
      setFeedback("Đã sao chép link truy cập.");
    } catch {
      setFeedback("Không thể sao chép tự động. Hãy dùng nút Test Link.");
    }
    window.setTimeout(() => setFeedback(""), 2500);
  };

  const mutate = async (
    link: AccessLink,
    action: "reset-sessions" | "rotate" | "revoke" | "delete",
  ) => {
    const messages: Record<typeof action, string> = {
      "reset-sessions":
        "Tất cả session hiện tại của link sẽ mất quyền. Link hiện tại vẫn giữ nguyên và người dùng có thể click lại link đó để truy cập.",
      rotate:
        "Tất cả session hiện tại sẽ mất quyền và link cũ sẽ không còn hoạt động. Hệ thống sẽ tạo link mới; cần cập nhật link mới trong Facebook Group.",
      revoke:
        "Link sẽ bị khóa và toàn bộ session từ link này mất quyền ngay.",
      delete:
        "Link sẽ bị xóa khỏi danh sách và toàn bộ session hiện tại mất quyền. Lịch sử analytics vẫn được giữ.",
    };
    if (!window.confirm(messages[action])) return;
    const response = await fetch(
      "/api/admin/access-links/" +
        encodeURIComponent(link.id) +
        (action === "delete" ? "" : "/" + action),
      { method: action === "delete" ? "DELETE" : "POST" },
    );
    if (!response.ok) {
      setFeedback(await readApiError(response, "Thao tác chưa thành công."));
      return;
    }
    setFeedback(
      action === "rotate"
        ? "Đã rotate link. Hãy cập nhật URL mới trong Facebook Group."
        : "Đã cập nhật access link.",
    );
    await loadLinks();
  };

  const testLink = async (link: AccessLink) => {
    const target = window.open("about:blank", "_blank");
    try {
      const response = await fetch(
        "/api/admin/access-links/" + encodeURIComponent(link.id) + "/test",
        { method: "POST" },
      );
      if (!response.ok)
        throw new Error(await readApiError(response, "Không thể test link."));
      const body = (await response.json()) as {
        data?: { accessUrl?: string };
      };
      if (!body.data?.accessUrl) throw new Error("Không nhận được URL test.");
      if (target) target.location.href = body.data.accessUrl;
      else window.location.href = body.data.accessUrl;
    } catch (caught) {
      target?.close();
      setFeedback(caught instanceof Error ? caught.message : "Không thể test link.");
    }
  };

  return (
    <AdminShell title="Link Truy Cập">
      <div className="admin-page-heading">
        <div>
          <h1>Link truy cập</h1>
          <p>Quản lý quyền vào storefront cho thành viên Facebook Group.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing("new")}>
          <Icon>add</Icon> TẠO LINK
        </button>
      </div>
      <div className="access-link-info">
        <Icon>info</Icon>
        <span>
          Một link có thể dùng cho nhiều Facebook Group. Analytics chỉ xác định
          được link; muốn thống kê riêng từng group, hãy tạo link riêng.
        </span>
      </div>
      {(editing === "new" || editing) && (
        <AccessLinkForm
          editing={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={loadLinks}
        />
      )}
      <section className="admin-table-card access-link-table-card">
        <div className="admin-table-tools">
          <label className="admin-search">
            <Icon>search</Icon>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm theo tên hoặc Facebook Group..."
            />
          </label>
          <label className="access-link-status-filter">
            Trạng thái
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Tất cả</option>
              <option value="ACTIVE">Đang hoạt động</option>
              <option value="REVOKED">Đã khóa</option>
            </select>
          </label>
        </div>
        {feedback && <p className="form-success access-link-feedback">{feedback}</p>}
        {loading ? (
          <p className="table-footer">Đang tải danh sách link…</p>
        ) : error ? (
          <p className="table-footer form-error">{error}</p>
        ) : links.length === 0 ? (
          <div className="access-link-empty">
            <Icon>key_off</Icon>
            <h2>Chưa có access link</h2>
            <p>Tạo link đầu tiên để chia sẻ storefront trong Facebook Group.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="access-links-table">
              <thead>
                <tr>
                  <th>Link</th>
                  <th>Groups</th>
                  <th>Trạng thái</th>
                  <th>TTL</th>
                  <th>Analytics</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {links.map((link) => (
                  <tr key={link.id}>
                    <td className="access-link-name-cell">
                      <b>{link.name}</b>
                      <small>Version {link.version}</small>
                      <button
                        type="button"
                        className="access-link-url"
                        onClick={() => void copyLink(link.accessUrl)}
                        title="Sao chép link"
                      >
                        <Icon>content_copy</Icon>
                        <span>{link.accessUrl}</span>
                      </button>
                    </td>
                    <td>
                      <div className="access-link-group-list">
                        {link.groups.length ? (
                          link.groups.map((group) => (
                            <span key={group.id} className="access-link-group-chip">
                              {group.url ? (
                                <a href={group.url} target="_blank" rel="noreferrer">
                                  {group.name}
                                </a>
                              ) : (
                                group.name
                              )}
                            </span>
                          ))
                        ) : (
                          <small>Chưa gắn group</small>
                        )}
                      </div>
                    </td>
                    <td><StatusBadge status={link.status} /></td>
                    <td>
                      {formatTtl(link.sessionTtlSeconds)}
                      {link.usesDefaultTtl && <small className="access-link-default-label">Mặc định</small>}
                    </td>
                    <td className="access-link-stats-cell">
                      <span><b>{link.stats.validLinkOpens}</b> lượt mở</span>
                      <span><b>{link.stats.uniqueVisitors}</b> visitor riêng (ước tính)</span>
                      <span><b>{link.stats.sessionsIssued}</b> session đã cấp</span>
                      <span><b>{link.stats.activeSessions}</b> session còn hiệu lực</span>
                      <small>Hôm nay {link.stats.opensToday} · 7 ngày {link.stats.opens7d} · 30 ngày {link.stats.opens30d}</small>
                      <small>Gần nhất: {formatDate(link.stats.lastUsedAt)}</small>
                    </td>
                    <td>
                      <div className="access-link-actions">
                        <button type="button" onClick={() => void copyLink(link.accessUrl)}>
                          <Icon>content_copy</Icon><span>Copy Link</span>
                        </button>
                        {link.status === "ACTIVE" && (
                          <button type="button" onClick={() => void testLink(link)}>
                            <Icon>open_in_new</Icon><span>Test Link</span>
                          </button>
                        )}
                        <button type="button" onClick={() => setEditing(link)}>
                          <Icon>edit</Icon><span>Edit</span>
                        </button>
                        <button type="button" onClick={() => void mutate(link, "reset-sessions")}>
                          <Icon>refresh</Icon><span>Reset Sessions</span>
                        </button>
                        <button type="button" onClick={() => void mutate(link, "rotate")}>
                          <Icon>sync_lock</Icon><span>Rotate Link</span>
                        </button>
                        {link.status === "ACTIVE" && (
                          <button type="button" onClick={() => void mutate(link, "revoke")}>
                            <Icon>lock</Icon><span>Revoke</span>
                          </button>
                        )}
                        <button type="button" onClick={() => void mutate(link, "delete")}>
                          <Icon>delete</Icon><span>Xóa</span>
                        </button>
                      </div>
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
