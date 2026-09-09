import type {
  CatalogTag,
  CatalogTagGroup,
  TagGroupAssignmentMode,
} from "../shared/tag-groups";

type TagGroupDbRow = {
  groupId: string;
  groupName: string;
  groupSlug: string;
  groupSystemKey: string | null;
  displayName: string;
  groupIsActive: number;
  isFilterable: number;
  assignmentMode: TagGroupAssignmentMode;
  selectionMode: "MULTI_OR";
  groupSortOrder: number;
  tagId: string | null;
  tagName: string | null;
  tagDisplayName: string | null;
  tagSlug: string | null;
  tagSystemKey: string | null;
  tagIsActive: number | null;
  tagSortOrder: number | null;
  showBadge: number | null;
  featuredSectionKey: string | null;
};

type VariantTagDbRow = {
  variantId: string;
  tagId: string;
  tagName: string;
  tagDisplayName: string | null;
  tagSlug: string;
  groupId: string;
  groupName: string;
  groupSlug: string;
  tagSystemKey: string | null;
  groupSystemKey: string | null;
  tagIsActive: number;
  groupIsActive: number;
  tagSortOrder: number;
  showBadge: number;
  featuredSectionKey: string | null;
};

type AssignmentTagRow = {
  id: string;
  groupId: string;
  groupName: string;
  assignmentMode: TagGroupAssignmentMode;
  isActive: number;
  groupIsActive: number;
};

export type VariantTagAssignmentInput = {
  variantId: string;
  tagIds?: string[];
};

export class VariantTagAssignmentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function hasTagGroupSchema(env: Env) {
  try {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tag_groups'",
    ).first<{ name: string }>();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function mapTag(row: TagGroupDbRow): CatalogTag | null {
  if (!row.tagId || !row.tagName || !row.tagSlug) return null;
  return {
    id: row.tagId,
    name: row.tagName,
    displayName: row.tagDisplayName ?? row.tagName,
    slug: row.tagSlug,
    groupId: row.groupId,
    groupSlug: row.groupSlug,
    groupName: row.groupName,
    systemKey: row.tagSystemKey,
    isActive: Boolean(row.tagIsActive),
    sortOrder: Number(row.tagSortOrder ?? 0),
    showBadge: Boolean(row.showBadge),
    featuredSectionKey: row.featuredSectionKey,
  };
}

function mapGroups(rows: TagGroupDbRow[]) {
  const groups = new Map<string, CatalogTagGroup>();
  for (const row of rows) {
    let group = groups.get(row.groupId);
    if (!group) {
      group = {
        id: row.groupId,
        name: row.groupName,
        slug: row.groupSlug,
        systemKey: row.groupSystemKey,
        displayName: row.displayName,
        isActive: Boolean(row.groupIsActive),
        isFilterable: Boolean(row.isFilterable),
        assignmentMode: row.assignmentMode,
        selectionMode: row.selectionMode,
        sortOrder: Number(row.groupSortOrder ?? 0),
        tags: [],
      };
      groups.set(row.groupId, group);
    }
    const tag = mapTag(row);
    if (tag) group.tags.push(tag);
  }
  return [...groups.values()];
}

export async function listTagGroups(
  env: Env,
  options: { includeInactiveGroups?: boolean; includeInactiveTags?: boolean } = {},
) {
  const groupPredicate = options.includeInactiveGroups
    ? "1 = 1"
    : "tg.is_active = 1 AND tg.is_filterable = 1";
  const tagPredicate = options.includeInactiveTags ? "1 = 1" : "t.is_active = 1";
  const result = await env.DB.prepare(
    `SELECT
       tg.id AS groupId, tg.name AS groupName, tg.slug AS groupSlug,
       tg.system_key AS groupSystemKey, tg.display_name AS displayName,
       tg.is_active AS groupIsActive, tg.is_filterable AS isFilterable,
       tg.assignment_mode AS assignmentMode, tg.selection_mode AS selectionMode,
       tg.sort_order AS groupSortOrder,
       t.id AS tagId, t.name AS tagName, t.display_name AS tagDisplayName,
       t.slug AS tagSlug, t.system_key AS tagSystemKey,
       t.is_active AS tagIsActive, t.sort_order AS tagSortOrder,
       t.show_badge AS showBadge, t.featured_section_key AS featuredSectionKey
     FROM tag_groups tg
     LEFT JOIN tags t
       ON t.group_id = tg.id
      AND ${tagPredicate}
     WHERE ${groupPredicate}
     ORDER BY tg.sort_order, tg.name, t.sort_order, t.name, t.id`,
  ).all<TagGroupDbRow>();
  return mapGroups(result.results);
}

export async function getVariantTagMap(
  env: Env,
  variantIds: string[],
  options: { includeInactive?: boolean } = {},
) {
  const map = new Map<string, CatalogTag[]>();
  if (!variantIds.length) return map;
  const placeholders = variantIds.map(() => "?").join(",");
  const activePredicate = options.includeInactive
    ? "1 = 1"
    : "t.is_active = 1 AND tg.is_active = 1";
  const result = await env.DB.prepare(
    `SELECT vt.variant_id AS variantId, t.id AS tagId, t.name AS tagName,
       t.display_name AS tagDisplayName, t.slug AS tagSlug,
       tg.id AS groupId, tg.name AS groupName, tg.slug AS groupSlug,
       t.system_key AS tagSystemKey, tg.system_key AS groupSystemKey,
       t.is_active AS tagIsActive,
       tg.is_active AS groupIsActive, t.sort_order AS tagSortOrder,
       t.show_badge AS showBadge, t.featured_section_key AS featuredSectionKey
     FROM variant_tags vt
     JOIN tags t ON t.id = vt.tag_id
     JOIN tag_groups tg ON tg.id = t.group_id
     WHERE vt.variant_id IN (${placeholders}) AND ${activePredicate}
     ORDER BY vt.variant_id, tg.sort_order, t.sort_order, t.name, t.id`,
  )
    .bind(...variantIds)
    .all<VariantTagDbRow>();
  for (const row of result.results) {
    const tags = map.get(row.variantId) ?? [];
    tags.push({
      id: row.tagId,
      name: row.tagName,
      displayName: row.tagDisplayName ?? row.tagName,
      slug: row.tagSlug,
      groupId: row.groupId,
      groupSlug: row.groupSlug,
      groupName: row.groupName,
      systemKey: row.tagSystemKey,
      isActive: Boolean(row.tagIsActive && row.groupIsActive),
      sortOrder: Number(row.tagSortOrder),
      showBadge: Boolean(row.showBadge),
      featuredSectionKey: row.featuredSectionKey,
    });
    map.set(row.variantId, tags);
  }
  return map;
}

export async function validateVariantTagAssignments(
  env: Env,
  assignments: VariantTagAssignmentInput[],
) {
  const normalized = assignments.map((assignment) => {
    const tagIds = assignment.tagIds ?? [];
    if (new Set(tagIds).size !== tagIds.length)
      throw new VariantTagAssignmentError(
        "DUPLICATE_VARIANT_TAG",
        "Một phân loại không được gắn trùng tag.",
        { variantId: assignment.variantId },
      );
    return { ...assignment, tagIds };
  });
  const tagIds = [...new Set(normalized.flatMap((assignment) => assignment.tagIds ?? []))];
  const tagRows = new Map<string, AssignmentTagRow>();
  if (tagIds.length) {
    const placeholders = tagIds.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `SELECT t.id, t.group_id AS groupId, tg.name AS groupName,
         tg.assignment_mode AS assignmentMode, t.is_active AS isActive,
         tg.is_active AS groupIsActive
       FROM tags t JOIN tag_groups tg ON tg.id = t.group_id
       WHERE t.id IN (${placeholders})`,
    )
      .bind(...tagIds)
      .all<AssignmentTagRow>();
    result.results.forEach((row) => tagRows.set(row.id, row));
  }
  const variantIds = normalized.map((assignment) => assignment.variantId);
  const existingPairs = new Set<string>();
  if (variantIds.length && tagIds.length) {
    const variantPlaceholders = variantIds.map(() => "?").join(",");
    const tagPlaceholders = tagIds.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `SELECT variant_id AS variantId, tag_id AS tagId
       FROM variant_tags
       WHERE variant_id IN (${variantPlaceholders})
         AND tag_id IN (${tagPlaceholders})`,
    )
      .bind(...variantIds, ...tagIds)
      .all<{ variantId: string; tagId: string }>();
    result.results.forEach((row) => existingPairs.add(`${row.variantId}\u0000${row.tagId}`));
  }
  const groupCounts = new Map<string, number>();
  for (const assignment of normalized) {
    for (const tagId of assignment.tagIds ?? []) {
      const row = tagRows.get(tagId);
      if (!row)
        throw new VariantTagAssignmentError(
          "INVALID_VARIANT_TAG",
          "Tag phân loại không tồn tại.",
          { variantId: assignment.variantId, tagId },
        );
      const isExisting = existingPairs.has(`${assignment.variantId}\u0000${tagId}`);
      if ((!row.isActive || !row.groupIsActive) && !isExisting)
        throw new VariantTagAssignmentError(
          "INVALID_VARIANT_TAG",
          "Tag phân loại không tồn tại hoặc đang bị ẩn.",
          { variantId: assignment.variantId, tagId },
        );
      const key = `${assignment.variantId}\u0000${row.groupId}`;
      groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
      if (row.assignmentMode === "SINGLE" && groupCounts.get(key)! > 1)
        throw new VariantTagAssignmentError(
          "SINGLE_TAG_GROUP_CONFLICT",
          `Nhóm tag "${row.groupName}" chỉ cho phép một lựa chọn trên mỗi phân loại.`,
          { variantId: assignment.variantId, groupId: row.groupId },
        );
    }
  }
  return normalized;
}
