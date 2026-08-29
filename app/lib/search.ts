import type { Category, Product } from "./catalog";

export function normalizeSearchText(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ");
}

function editDistance(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return 2;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function fieldScore(value: string, query: string, base: number) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return Number.POSITIVE_INFINITY;
  if (normalized.startsWith(query)) return base;
  if (normalized.includes(query)) return base + 4;
  if (query.length < 3) return Number.POSITIVE_INFINITY;
  const fuzzy = normalized
    .split(/[^a-z0-9]+/)
    .some((word) => word.length >= 3 && editDistance(word, query) <= 1);
  return fuzzy ? 60 + base : Number.POSITIVE_INFINITY;
}

export type CatalogSearchResults = {
  products: Product[];
  categories: Category[];
};

export function searchCatalog(
  products: Product[],
  categories: Category[],
  rawQuery: string,
): CatalogSearchResults {
  const query = normalizeSearchText(rawQuery);
  if (!query) return { products: [], categories };
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));
  const rankedProducts = products
    .map((product, index) => {
      const categoryName = (product.categories ?? [product.category])
        .map((slug) => categoryBySlug.get(slug)?.name ?? "")
        .join(" ");
      const score = Math.min(
        fieldScore(product.name, query, 0),
        fieldScore(categoryName, query, 20),
        fieldScore(product.brand, query, 40),
        fieldScore(product.tags.join(" "), query, 45),
        fieldScore(`${product.shortDescription} ${product.description}`, query, 50),
      );
      return { product, score, index };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((entry) => entry.product);
  const rankedCategories = categories
    .map((category, index) => ({
      category,
      score: fieldScore(category.name, query, 0),
      index,
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((entry) => entry.category);
  return { products: rankedProducts, categories: rankedCategories };
}
