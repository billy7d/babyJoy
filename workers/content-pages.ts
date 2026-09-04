import {
  contentPageLabel,
  CONTENT_PAGE_DEFINITIONS,
  isContentPageSlug,
  type ContentPageSlug,
} from "../shared/content-pages";
import {
  normalizeProductDescriptionDocument,
  parseProductDescriptionContent,
  type ProductDescriptionDocument,
  type ProductDescriptionValidationIssue,
} from "../shared/product-description";
import {
  getProductImageUrlStrategy,
  type ProductImageUrlStrategy,
} from "../shared/images";
import {
  hasContentPageAssetSchema,
  listContentPageDescriptionAssets,
  mapProductDescriptionAssets,
  prepareContentPageDescriptionAssetPersistence,
  validateContentPageDescriptionAssets,
  ProductDescriptionAssetError,
  type ProductDescriptionAssetRow,
} from "./product-description-assets";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const CONTENT_PAGE_MAX_TITLE_LENGTH = 160;
const CONTENT_PAGE_MAX_PAYLOAD_BYTES = 512 * 1024;

type ContentPageStatus = "PUBLISHED" | "DRAFT";

type ContentPageRow = {
  id: string;
  slug: ContentPageSlug;
  title: string;
  contentJson: string;
  status: ContentPageStatus;
  createdAt: string;
  updatedAt: string;
};

type ContentPageRead = {
  row: ContentPageRow;
  content: ProductDescriptionDocument;
  assets: ProductDescriptionAssetRow[];
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function error(code: string, message: string, status: number, details?: unknown) {
  return json({ success: false, error: { code, message, details } }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function readBoundedJson(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const bytes = Number(contentLength);
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > CONTENT_PAGE_MAX_PAYLOAD_BYTES
    )
      throw new Error("PAYLOAD_TOO_LARGE");
  }
  const text = await request.text();
  if (
    new TextEncoder().encode(text).byteLength > CONTENT_PAGE_MAX_PAYLOAD_BYTES
  )
    throw new Error("PAYLOAD_TOO_LARGE");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

export async function hasContentPagesSchema(env: Env) {
  try {
    const table = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_pages'",
    ).first<{ name: string }>();
    return Boolean(table?.name && (await hasContentPageAssetSchema(env)));
  } catch {
    return false;
  }
}

async function readContentPage(
  slug: ContentPageSlug,
  env: Env,
  status?: ContentPageStatus,
): Promise<ContentPageRead | null> {
  const row = await env.DB.prepare(
    `SELECT id, slug, title, content_json AS contentJson, status,
      created_at AS createdAt, updated_at AS updatedAt
     FROM content_pages
     WHERE slug = ?${status ? " AND status = ?" : ""}`,
  )
    .bind(...(status ? [slug, status] : [slug]))
    .first<ContentPageRow>();
  if (!row) return null;
  const assets = await listContentPageDescriptionAssets(env, slug);
  const content = parseProductDescriptionContent(row.contentJson, {
    assetIds: new Set(assets.map((asset) => asset.id)),
  });
  if (!content) return null;
  return { row, content, assets };
}

function publicAssets(
  rows: ProductDescriptionAssetRow[],
  imageUrlStrategy: ProductImageUrlStrategy,
) {
  return mapProductDescriptionAssets(rows, imageUrlStrategy).map(
    ({ id, altText, url }) => ({ id, altText, url }),
  );
}

function adminPage(
  page: ContentPageRead,
  imageUrlStrategy: ProductImageUrlStrategy,
) {
  return {
    slug: page.row.slug,
    title: page.row.title,
    status: page.row.status,
    content: page.content,
    assets: mapProductDescriptionAssets(page.assets, imageUrlStrategy),
    updatedAt: page.row.updatedAt,
  };
}

function publicPage(
  page: ContentPageRead,
  imageUrlStrategy: ProductImageUrlStrategy,
) {
  return {
    slug: page.row.slug,
    title: page.row.title,
    content: page.content,
    assets: publicAssets(page.assets, imageUrlStrategy),
    updatedAt: page.row.updatedAt,
  };
}

export async function getPublicContentPage(slug: string, env: Env) {
  if (!isContentPageSlug(slug))
    return error("CONTENT_PAGE_NOT_FOUND", "Không tìm thấy trang nội dung.", 404);
  if (!(await hasContentPagesSchema(env)))
    return error(
      "CONTENT_PAGE_SCHEMA_UNAVAILABLE",
      "Trang nội dung chưa sẵn sàng.",
      503,
    );
  const page = await readContentPage(slug, env, "PUBLISHED");
  if (!page)
    return error(
      "CONTENT_PAGE_NOT_FOUND",
      "Trang nội dung không tồn tại hoặc chưa được hiển thị.",
      404,
    );
  return json({ page: publicPage(page, getProductImageUrlStrategy(env.ENVIRONMENT)) });
}

export async function listAdminContentPages(env: Env) {
  if (!(await hasContentPagesSchema(env)))
    return error(
      "CONTENT_PAGE_SCHEMA_UNAVAILABLE",
      "Trang nội dung chưa sẵn sàng.",
      503,
    );
  const result = await env.DB.prepare(
    `SELECT slug, title, status, updated_at AS updatedAt
     FROM content_pages
     WHERE slug IN (?, ?, ?)
     ORDER BY CASE slug
       WHEN 'shipping-policy' THEN 1
       WHEN 'buying-guide' THEN 2
       WHEN 'returns-refunds' THEN 3
       ELSE 4 END`,
  )
    .bind(...CONTENT_PAGE_DEFINITIONS.map((page) => page.slug))
    .all<Pick<ContentPageRow, "slug" | "title" | "status" | "updatedAt">>();
  return json({
    data: result.results.map((page) => ({
      ...page,
      label: contentPageLabel(page.slug),
    })),
  });
}

export async function getAdminContentPage(slug: string, env: Env) {
  if (!isContentPageSlug(slug))
    return error("CONTENT_PAGE_NOT_FOUND", "Không tìm thấy trang nội dung.", 404);
  if (!(await hasContentPagesSchema(env)))
    return error(
      "CONTENT_PAGE_SCHEMA_UNAVAILABLE",
      "Trang nội dung chưa sẵn sàng.",
      503,
    );
  const page = await readContentPage(slug, env);
  if (!page)
    return error("CONTENT_PAGE_NOT_FOUND", "Không tìm thấy trang nội dung.", 404);
  return json({ page: adminPage(page, getProductImageUrlStrategy(env.ENVIRONMENT)) });
}

function invalidContent(
  issues: ProductDescriptionValidationIssue[],
  message = "Nội dung rich text chưa hợp lệ.",
) {
  return error("INVALID_CONTENT", message, 422, issues);
}

function normalizedTitle(value: unknown) {
  if (typeof value !== "string") return null;
  const title = value.trim();
  if (
    !title ||
    title.length > CONTENT_PAGE_MAX_TITLE_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(title)
  )
    return null;
  return title;
}

function assetErrorResponse(caught: ProductDescriptionAssetError) {
  if (caught.code === "CONTENT_PAGE_NOT_FOUND")
    return error("CONTENT_PAGE_NOT_FOUND", "Không tìm thấy trang nội dung.", 404);
  if (caught.code === "ASSET_OWNERSHIP")
    return error(
      "INVALID_CONTENT_ASSET",
      "Asset ảnh không thuộc trang nội dung này.",
      422,
    );
  return error(
    "INVALID_CONTENT_ASSET",
    "Một ảnh trong nội dung không hợp lệ.",
    422,
  );
}

export async function saveAdminContentPage(
  request: Request,
  slug: string,
  env: Env,
) {
  if (!isContentPageSlug(slug))
    return error("CONTENT_PAGE_NOT_FOUND", "Không tìm thấy trang nội dung.", 404);
  if (!(await hasContentPagesSchema(env)))
    return error(
      "CONTENT_PAGE_SCHEMA_UNAVAILABLE",
      "Trang nội dung chưa sẵn sàng.",
      503,
    );
  const current = await readContentPage(slug, env);
  if (!current)
    return error("CONTENT_PAGE_NOT_FOUND", "Không tìm thấy trang nội dung.", 404);

  let body: Record<string, unknown>;
  try {
    const parsed = await readBoundedJson(request);
    if (!isRecord(parsed)) throw new Error("INVALID_BODY");
    body = parsed;
  } catch (caught) {
    if (caught instanceof Error && caught.message === "PAYLOAD_TOO_LARGE")
      return error("PAYLOAD_TOO_LARGE", "Nội dung vượt giới hạn cho phép.", 413);
    return error("VALIDATION_ERROR", "Thông tin trang nội dung chưa hợp lệ.", 400);
  }

  if (body.slug !== undefined && body.slug !== slug)
    return error(
      "SLUG_IMMUTABLE",
      "Slug của trang hệ thống không được thay đổi.",
      422,
    );
  const title = normalizedTitle(body.title);
  if (!title)
    return error(
      "INVALID_TITLE",
      "Tiêu đề không được để trống và không vượt quá 160 ký tự.",
      422,
    );
  if (body.status !== "PUBLISHED" && body.status !== "DRAFT")
    return error("INVALID_STATUS", "Trạng thái trang không hợp lệ.", 422);
  if (body.updatedAt !== undefined && typeof body.updatedAt !== "string")
    return error("INVALID_REVISION", "Phiên bản nội dung không hợp lệ.", 422);
  if (
    typeof body.updatedAt === "string" &&
    body.updatedAt !== current.row.updatedAt
  )
    return error(
      "CONTENT_PAGE_CONFLICT",
      "Trang vừa được cập nhật bởi một phiên khác. Hãy tải lại trước khi lưu.",
      409,
    );

  const preliminary = normalizeProductDescriptionDocument(body.content);
  if (!preliminary.ok) return invalidContent(preliminary.issues);
  const uploadSessionId =
    body.contentPageUploadSessionId === undefined
      ? null
      : typeof body.contentPageUploadSessionId === "string"
        ? body.contentPageUploadSessionId.trim()
        : "";
  if (body.contentPageUploadSessionId !== undefined && !uploadSessionId)
    return error("INVALID_UPLOAD_SESSION", "Phiên tải ảnh không hợp lệ.", 422);

  let assetRows: ProductDescriptionAssetRow[];
  try {
    const validation = await validateContentPageDescriptionAssets(
      env,
      preliminary.document,
      slug,
      uploadSessionId,
    );
    assetRows = validation.rows;
  } catch (caught) {
    if (caught instanceof ProductDescriptionAssetError)
      return assetErrorResponse(caught);
    throw caught;
  }
  const normalized = normalizeProductDescriptionDocument(preliminary.document, {
    assetIds: new Set(assetRows.map((asset) => asset.id)),
  });
  if (!normalized.ok) return invalidContent(normalized.issues);

  const now = new Date().toISOString();
  const persistence = await prepareContentPageDescriptionAssetPersistence(
    env,
    slug,
    normalized.document,
    assetRows,
    now,
  );
  const updateSql =
    body.updatedAt === undefined
      ? `UPDATE content_pages
         SET title = ?, content_json = ?, status = ?, updated_at = ?
         WHERE slug = ?`
      : `UPDATE content_pages
         SET title = ?, content_json = ?, status = ?, updated_at = ?
         WHERE slug = ? AND updated_at = ?`;
  const updateValues = [
    title,
    JSON.stringify(normalized.document),
    body.status,
    now,
    slug,
    ...(typeof body.updatedAt === "string" ? [body.updatedAt] : []),
  ];
  const statements = [env.DB.prepare(updateSql).bind(...updateValues), ...persistence.statements];
  const results = await env.DB.batch(statements);
  if (!results[0]?.meta?.changes)
    return error(
      "CONTENT_PAGE_CONFLICT",
      "Trang vừa được cập nhật bởi một phiên khác. Hãy tải lại trước khi lưu.",
      409,
    );
  const saved = await readContentPage(slug, env);
  if (!saved)
    return error("CONTENT_PAGE_UNAVAILABLE", "Chưa thể đọc lại nội dung vừa lưu.", 500);
  return json({
    success: true,
    page: adminPage(saved, getProductImageUrlStrategy(env.ENVIRONMENT)),
  });
}
