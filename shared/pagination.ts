export type PaginationMeta = {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

export type PaginatedResponse<T> = {
  data: T[];
  pagination: PaginationMeta;
};

export type PaginationItem = number | "ellipsis";

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 24;
export const ADMIN_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

// Chuẩn hóa primitive query để request lỗi không làm SQL hoặc pagination bị hỏng.
export function normalizePage(value: string | null | undefined) {
  const parsed = value === null || value === undefined ? NaN : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

// Page size production giữ nguyên layout hiện tại: tối đa 24 sản phẩm.
export function normalizeLimit(
  value: string | null | undefined,
  options: {
    defaultLimit?: number;
    allowedLimits?: readonly number[];
    maxLimit?: number;
  } = {},
) {
  const defaultLimit = options.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const allowedLimits = options.allowedLimits;
  const maxLimit =
    options.maxLimit ??
    (allowedLimits ? Math.max(...allowedLimits) : MAX_PAGE_SIZE);
  if (value === null || value === undefined || value.trim() === "")
    return defaultLimit;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return defaultLimit;
  if (allowedLimits && !allowedLimits.includes(parsed)) return defaultLimit;
  return Math.min(maxLimit, Math.max(1, parsed));
}

export function buildPaginationMeta({
  totalItems,
  requestedPage,
  limit,
}: {
  totalItems: number;
  requestedPage: number;
  limit: number;
}): PaginationMeta {
  const safeTotalItems = Math.max(0, Math.trunc(totalItems));
  const safeLimit = Math.max(1, Math.trunc(limit));
  const totalPages = Math.ceil(safeTotalItems / safeLimit);
  const page = totalPages === 0
    ? 1
    : Math.min(Math.max(1, Math.trunc(requestedPage)), totalPages);
  return {
    page,
    limit: safeLimit,
    totalItems: safeTotalItems,
    totalPages,
    hasPrevious: page > 1 && totalPages > 0,
    hasNext: page < totalPages,
  };
}

export function getPaginationItems(
  currentPage: number,
  totalPages: number,
): PaginationItem[] {
  if (totalPages <= 0) return [];
  const page = Math.min(Math.max(1, Math.trunc(currentPage)), totalPages);
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_, index) => index + 1);

  const visiblePages = new Set<number>([1, totalPages]);
  if (page <= 3) {
    for (let value = 1; value <= Math.min(3, totalPages); value += 1)
      visiblePages.add(value);
  } else if (page >= totalPages - 2) {
    for (let value = Math.max(1, totalPages - 2); value <= totalPages; value += 1)
      visiblePages.add(value);
  } else {
    visiblePages.add(page - 1);
    visiblePages.add(page);
    visiblePages.add(page + 1);
  }
  const sortedPages = [...visiblePages]
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((left, right) => left - right);
  const items: PaginationItem[] = [];
  sortedPages.forEach((value, index) => {
    const previous = sortedPages[index - 1];
    if (previous !== undefined && value - previous > 1) items.push("ellipsis");
    items.push(value);
  });
  return items;
}
