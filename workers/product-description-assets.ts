import {
  isAllowedImageType,
  isImmutableProductDescriptionImageKey,
  getProductImageUrl,
  MAX_STORED_IMAGE_BYTES,
  type ProductImageUrlStrategy,
} from "../shared/images";
import {
  getProductDescriptionImageNodes,
  type ProductDescriptionAsset,
  type ProductDescriptionDocument,
} from "../shared/product-description";
import { isContentPageSlug } from "../shared/content-pages";
import {
  ImageUploadError,
  uploadImmutableProductImage,
} from "./image-service";

export type ProductDescriptionAssetRow = {
  id: string;
  productId: string | null;
  uploadSessionId: string;
  r2Key: string;
  altText: string;
  claimedAt: string | null;
  contentPageSlug?: string | null;
  createdAt: string;
  updatedAt: string;
};

export class ProductDescriptionAssetError extends Error {
  constructor(
    public readonly code:
      | "DESCRIPTION_SCHEMA_UNAVAILABLE"
      | "INVALID_UPLOAD_SESSION"
      | "PRODUCT_NOT_FOUND"
      | "CONTENT_PAGE_NOT_FOUND"
      | "INVALID_OWNER"
      | "INVALID_ALT_TEXT"
      | "INVALID_ASSET_REFERENCE"
      | "ASSET_OWNERSHIP",
  ) {
    super(code);
  }
}

function isSafeUploadSessionId(value: string) {
  return /^[A-Za-z0-9_-]{16,120}$/.test(value);
}

function normalizeAltText(value: string | null) {
  const altText = value?.trim() ?? "";
  if (altText.length > 250 || /[\u0000-\u001f\u007f]/.test(altText))
    throw new ProductDescriptionAssetError("INVALID_ALT_TEXT");
  return altText;
}

export async function hasProductDescriptionSchema(env: Env) {
  try {
    const column = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('products') WHERE name = 'description_content'",
    ).first<{ name: string }>();
    const table = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'product_description_assets'",
    ).first<{ name: string }>();
    return Boolean(column?.name && table?.name);
  } catch {
    return false;
  }
}

export async function hasContentPageAssetSchema(env: Env) {
  try {
    const column = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('product_description_assets') WHERE name = 'content_page_slug'",
    ).first<{ name: string }>();
    return Boolean(column?.name);
  } catch {
    return false;
  }
}

function assetPlaceholders(ids: string[]) {
  return ids.map(() => "?").join(",");
}

export async function listProductDescriptionAssets(
  env: Env,
  productIds: string[],
  imageUrlStrategy: ProductImageUrlStrategy,
): Promise<ProductDescriptionAssetRow[]> {
  if (!productIds.length || !(await hasProductDescriptionSchema(env))) return [];
  const rows = await env.DB.prepare(
    `SELECT id, product_id AS productId, upload_session_id AS uploadSessionId,
      r2_key AS r2Key, alt_text AS altText, claimed_at AS claimedAt,
      created_at AS createdAt, updated_at AS updatedAt
     FROM product_description_assets
     WHERE product_id IN (${assetPlaceholders(productIds)})
     ORDER BY created_at, id`,
  )
    .bind(...productIds)
    .all<ProductDescriptionAssetRow>();
  return rows.results.map((row) => ({ ...row }));
}

export function mapProductDescriptionAssets(
  rows: ProductDescriptionAssetRow[],
  imageUrlStrategy: ProductImageUrlStrategy,
): ProductDescriptionAsset[] {
  return rows.map((row) => ({
    id: row.id,
    r2Key: row.r2Key,
    altText: row.altText,
    url: getProductImageUrl(row.r2Key, imageUrlStrategy),
  }));
}

export async function uploadProductDescriptionAsset(
  request: Request,
  env: Env,
  productId: string | null,
  uploadSessionId: string,
  imageUrlStrategy: ProductImageUrlStrategy,
  contentPageSlug: string | null = null,
) {
  if (!isSafeUploadSessionId(uploadSessionId))
    throw new ProductDescriptionAssetError("INVALID_UPLOAD_SESSION");
  if (productId && contentPageSlug)
    throw new ProductDescriptionAssetError("INVALID_OWNER");
  if (productId) {
    const product = await env.DB.prepare("SELECT id FROM products WHERE id = ?")
      .bind(productId)
      .first<{ id: string }>();
    if (!product) throw new ProductDescriptionAssetError("PRODUCT_NOT_FOUND");
  }
  if (contentPageSlug) {
    if (!(await hasContentPageAssetSchema(env)) || !isContentPageSlug(contentPageSlug))
      throw new ProductDescriptionAssetError("CONTENT_PAGE_NOT_FOUND");
    const page = await env.DB.prepare(
      "SELECT slug FROM content_pages WHERE slug = ?",
    )
      .bind(contentPageSlug)
      .first<{ slug: string }>();
    if (!page) throw new ProductDescriptionAssetError("CONTENT_PAGE_NOT_FOUND");
  }
  const altText = normalizeAltText(request.headers.get("x-alt-text"));
  let uploaded: { key: string };
  try {
    uploaded = await uploadImmutableProductImage(request, env.PRODUCT_IMAGES, {
      purpose: "product-description",
    });
  } catch (caught) {
    throw caught;
  }
  const id = `pda_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      contentPageSlug
        ? `INSERT INTO product_description_assets
         (id, product_id, content_page_slug, upload_session_id, r2_key, alt_text, claimed_at, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, ?)`
        : `INSERT INTO product_description_assets
         (id, product_id, upload_session_id, r2_key, alt_text, claimed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
      .bind(
        ...(contentPageSlug
          ? [id, contentPageSlug, uploadSessionId, uploaded.key, altText, now, now]
          : [id, null, uploadSessionId, uploaded.key, altText, now, now]),
      )
      .run();
  } catch (caught) {
    // Nếu D1 từ chối metadata thì không để lại object upload không thể sở hữu.
    await env.PRODUCT_IMAGES.delete(uploaded.key).catch(() => undefined);
    throw caught;
  }
  const asset: ProductDescriptionAsset = {
    id,
    r2Key: uploaded.key,
    altText,
    url: getProductImageUrl(uploaded.key, imageUrlStrategy),
  };
  return { asset };
}

export async function validateProductDescriptionAssets(
  env: Env,
  document: ProductDescriptionDocument,
  productId: string,
  uploadSessionId: string | null,
) {
  if (!(await hasProductDescriptionSchema(env)))
    throw new ProductDescriptionAssetError("DESCRIPTION_SCHEMA_UNAVAILABLE");
  if (uploadSessionId !== null && !isSafeUploadSessionId(uploadSessionId))
    throw new ProductDescriptionAssetError("INVALID_UPLOAD_SESSION");
  const nodes = getProductDescriptionImageNodes(document);
  const ids = [...new Set(nodes.map((node) => node.attrs.assetId))];
  if (!ids.length) return { rows: [] as ProductDescriptionAssetRow[], ids };
  const pageAssetSchema = await hasContentPageAssetSchema(env);
  const result = await env.DB.prepare(
    `SELECT id, product_id AS productId, upload_session_id AS uploadSessionId,
      r2_key AS r2Key, alt_text AS altText, claimed_at AS claimedAt,
      created_at AS createdAt, updated_at AS updatedAt${
        pageAssetSchema ? ", content_page_slug AS contentPageSlug" : ""
      }
     FROM product_description_assets WHERE id IN (${assetPlaceholders(ids)})`,
  )
    .bind(...ids)
    .all<ProductDescriptionAssetRow>();
  const byId = new Map(result.results.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new ProductDescriptionAssetError("INVALID_ASSET_REFERENCE");
    const ownedByProduct =
      row.productId === productId && row.contentPageSlug == null;
    const ownedBySession =
      row.productId === null &&
      row.contentPageSlug == null &&
      uploadSessionId !== null &&
      row.uploadSessionId === uploadSessionId;
    if (!ownedByProduct && !ownedBySession)
      throw new ProductDescriptionAssetError("ASSET_OWNERSHIP");
    if (!isImmutableProductDescriptionImageKey(row.r2Key))
      throw new ProductDescriptionAssetError("INVALID_ASSET_REFERENCE");
    const object = await env.PRODUCT_IMAGES.head(row.r2Key);
    if (
      !object ||
      object.size > MAX_STORED_IMAGE_BYTES ||
      !isAllowedImageType(object.httpMetadata?.contentType ?? "")
    )
      throw new ProductDescriptionAssetError("INVALID_ASSET_REFERENCE");
  }
  return { rows: ids.map((id) => byId.get(id)!), ids };
}

export async function listContentPageDescriptionAssets(
  env: Env,
  slug: string,
): Promise<ProductDescriptionAssetRow[]> {
  if (!(await hasContentPageAssetSchema(env))) return [];
  const rows = await env.DB.prepare(
    `SELECT id, product_id AS productId, content_page_slug AS contentPageSlug,
      upload_session_id AS uploadSessionId, r2_key AS r2Key, alt_text AS altText,
      claimed_at AS claimedAt, created_at AS createdAt, updated_at AS updatedAt
     FROM product_description_assets
     WHERE content_page_slug = ? AND product_id IS NULL
     ORDER BY created_at, id`,
  )
    .bind(slug)
    .all<ProductDescriptionAssetRow>();
  return rows.results;
}

export async function validateContentPageDescriptionAssets(
  env: Env,
  document: ProductDescriptionDocument,
  slug: string,
  uploadSessionId: string | null,
) {
  if (!(await hasContentPageAssetSchema(env)))
    throw new ProductDescriptionAssetError("DESCRIPTION_SCHEMA_UNAVAILABLE");
  if (uploadSessionId !== null && !isSafeUploadSessionId(uploadSessionId))
    throw new ProductDescriptionAssetError("INVALID_UPLOAD_SESSION");
  const nodes = getProductDescriptionImageNodes(document);
  const ids = [...new Set(nodes.map((node) => node.attrs.assetId))];
  if (!ids.length) return { rows: [] as ProductDescriptionAssetRow[], ids };
  const result = await env.DB.prepare(
    `SELECT id, product_id AS productId, content_page_slug AS contentPageSlug,
      upload_session_id AS uploadSessionId, r2_key AS r2Key, alt_text AS altText,
      claimed_at AS claimedAt, created_at AS createdAt, updated_at AS updatedAt
     FROM product_description_assets WHERE id IN (${assetPlaceholders(ids)})`,
  )
    .bind(...ids)
    .all<ProductDescriptionAssetRow>();
  const byId = new Map(result.results.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new ProductDescriptionAssetError("INVALID_ASSET_REFERENCE");
    const ownedByPage =
      row.productId === null && row.contentPageSlug === slug;
    const ownedBySession =
      row.productId === null &&
      row.contentPageSlug == null &&
      uploadSessionId !== null &&
      row.uploadSessionId === uploadSessionId;
    if (!ownedByPage && !ownedBySession)
      throw new ProductDescriptionAssetError("ASSET_OWNERSHIP");
    if (!isImmutableProductDescriptionImageKey(row.r2Key))
      throw new ProductDescriptionAssetError("INVALID_ASSET_REFERENCE");
    const object = await env.PRODUCT_IMAGES.head(row.r2Key);
    if (
      !object ||
      object.size > MAX_STORED_IMAGE_BYTES ||
      !isAllowedImageType(object.httpMetadata?.contentType ?? "")
    )
      throw new ProductDescriptionAssetError("INVALID_ASSET_REFERENCE");
  }
  return { rows: ids.map((id) => byId.get(id)!), ids };
}

export async function prepareContentPageDescriptionAssetPersistence(
  env: Env,
  slug: string,
  document: ProductDescriptionDocument | null,
  imageNodes: ProductDescriptionAssetRow[],
  now: string,
): Promise<ProductDescriptionAssetPersistence> {
  const current = await env.DB.prepare(
    `SELECT id, product_id AS productId, content_page_slug AS contentPageSlug,
      upload_session_id AS uploadSessionId, r2_key AS r2Key, alt_text AS altText,
      claimed_at AS claimedAt, created_at AS createdAt, updated_at AS updatedAt
     FROM product_description_assets
     WHERE content_page_slug = ? AND product_id IS NULL`,
  )
    .bind(slug)
    .all<ProductDescriptionAssetRow>();
  const referencedIds = new Set(imageNodes.map((row) => row.id));
  const removed = current.results.filter((row) => !referencedIds.has(row.id));
  const statements: D1PreparedStatement[] = [];
  removed.forEach((row) => {
    statements.push(
      env.DB.prepare(
        `UPDATE product_description_assets
         SET content_page_slug = NULL, claimed_at = NULL, updated_at = ?
         WHERE id = ? AND content_page_slug = ? AND product_id IS NULL`,
      ).bind(now, row.id, slug),
    );
  });
  imageNodes.forEach((row) => {
    const node = document
      ? getProductDescriptionImageNodes(document).find(
          (item) => item.attrs.assetId === row.id,
        )
      : undefined;
    statements.push(
      env.DB.prepare(
        `UPDATE product_description_assets
         SET content_page_slug = ?, claimed_at = ?, alt_text = ?, updated_at = ?
         WHERE id = ? AND product_id IS NULL
           AND (content_page_slug = ? OR (content_page_slug IS NULL AND upload_session_id = ?))`,
      ).bind(
        slug,
        now,
        node?.attrs.alt ?? row.altText,
        now,
        row.id,
        slug,
        row.uploadSessionId,
      ),
    );
  });
  return { statements, removed };
}

export type ProductDescriptionAssetPersistence = {
  statements: D1PreparedStatement[];
  removed: ProductDescriptionAssetRow[];
};

export async function prepareProductDescriptionAssetPersistence(
  env: Env,
  productId: string,
  document: ProductDescriptionDocument | null,
  imageNodes: ProductDescriptionAssetRow[],
  now: string,
): Promise<ProductDescriptionAssetPersistence> {
  const pageAssetSchema = await hasContentPageAssetSchema(env);
  const current = await env.DB.prepare(
    `SELECT id, product_id AS productId, upload_session_id AS uploadSessionId,
      r2_key AS r2Key, alt_text AS altText, claimed_at AS claimedAt,
      created_at AS createdAt, updated_at AS updatedAt
     FROM product_description_assets WHERE product_id = ?`,
  )
    .bind(productId)
    .all<ProductDescriptionAssetRow>();
  const referencedIds = new Set(imageNodes.map((row) => row.id));
  const removed = current.results.filter((row) => !referencedIds.has(row.id));
  const statements: D1PreparedStatement[] = [];
  removed.forEach((row) => {
    statements.push(
      env.DB.prepare(
        `UPDATE product_description_assets
         SET product_id = NULL, claimed_at = NULL, updated_at = ?
         WHERE id = ? AND product_id = ?`,
      ).bind(now, row.id, productId),
    );
  });
  imageNodes.forEach((row) => {
    const node = document
      ? getProductDescriptionImageNodes(document).find((item) => item.attrs.assetId === row.id)
      : undefined;
    statements.push(
      env.DB.prepare(
        `UPDATE product_description_assets
         SET product_id = ?, ${pageAssetSchema ? "content_page_slug = NULL, " : ""}claimed_at = ?, alt_text = ?, updated_at = ?
         WHERE id = ? AND (product_id = ? OR (product_id IS NULL AND upload_session_id = ?))`,
      ).bind(
        productId,
        now,
        node?.attrs.alt ?? row.altText,
        now,
        row.id,
        productId,
        row.uploadSessionId,
      ),
    );
  });
  return { statements, removed };
}

export async function deleteProductDescriptionAssets(
  env: Env,
  rows: ProductDescriptionAssetRow[],
) {
  if (!rows.length) return;
  try {
    await env.PRODUCT_IMAGES.delete(rows.map((row) => row.r2Key));
  } catch {
    return;
  }
  const placeholders = assetPlaceholders(rows.map((row) => row.id));
  await env.DB.prepare(
    `DELETE FROM product_description_assets
     WHERE id IN (${placeholders}) AND claimed_at IS NULL`,
  )
    .bind(...rows.map((row) => row.id))
    .run()
    .catch(() => undefined);
}

export async function cleanupOrphanedProductDescriptionAssets(
  env: Env,
  now = new Date(),
) {
  if (!(await hasProductDescriptionSchema(env))) return { count: 0 };
  const pageAssetSchema = await hasContentPageAssetSchema(env);
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    `SELECT id, product_id AS productId, upload_session_id AS uploadSessionId,
      r2_key AS r2Key, alt_text AS altText, claimed_at AS claimedAt,
      created_at AS createdAt, updated_at AS updatedAt
     FROM product_description_assets
     WHERE product_id IS NULL${pageAssetSchema ? " AND content_page_slug IS NULL" : ""}
       AND claimed_at IS NULL AND updated_at < ?
     ORDER BY updated_at, id LIMIT 100`,
  )
    .bind(cutoff)
    .all<ProductDescriptionAssetRow>();
  if (!result.results.length) return { count: 0 };
  await deleteProductDescriptionAssets(env, result.results);
  return { count: result.results.length };
}

export function imageUploadErrorStatus(error: ProductDescriptionAssetError | ImageUploadError) {
  if (error instanceof ImageUploadError) {
    if (error.code === "UNSUPPORTED_TYPE") return 415;
    if (error.code === "TOO_LARGE") return 413;
    if (error.code === "KEY_COLLISION") return 409;
    return 422;
  }
  if (error.code === "PRODUCT_NOT_FOUND") return 404;
  if (error.code === "CONTENT_PAGE_NOT_FOUND") return 404;
  if (error.code === "ASSET_OWNERSHIP") return 403;
  if (error.code === "DESCRIPTION_SCHEMA_UNAVAILABLE") return 409;
  return 422;
}
