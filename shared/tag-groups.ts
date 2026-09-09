export type TagGroupAssignmentMode = "SINGLE" | "MULTI";
export type TagGroupSelectionMode = "MULTI_OR";

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
