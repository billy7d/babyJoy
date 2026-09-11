export type TagGroupAssignmentMode = "SINGLE" | "MULTI";
export type TagGroupSelectionMode = "MULTI_OR";

/** Các collection merchandising được gắn trên chính variant, không phải product cha. */
export const FEATURED_COLLECTIONS = {
  "best-seller": "best_seller",
  "must-try": "must_try",
} as const;

export type FeaturedCollection = keyof typeof FEATURED_COLLECTIONS;
export type FeaturedCollectionSystemKey =
  (typeof FEATURED_COLLECTIONS)[FeaturedCollection];

export function isFeaturedCollection(
  value: string,
): value is FeaturedCollection {
  return Object.prototype.hasOwnProperty.call(FEATURED_COLLECTIONS, value);
}

export type CatalogTag = {
  id: string;
  name: string;
  displayName?: string | null;
  slug: string;
  groupId: string;
  groupSlug?: string;
  groupName?: string;
  systemKey?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  showBadge?: boolean;
  featuredSectionKey?: string | null;
};

export type CatalogTagGroup = {
  id: string;
  name: string;
  slug: string;
  systemKey?: string | null;
  displayName: string;
  isActive: boolean;
  isFilterable: boolean;
  assignmentMode: TagGroupAssignmentMode;
  selectionMode: TagGroupSelectionMode;
  sortOrder: number;
  tags: CatalogTag[];
};
