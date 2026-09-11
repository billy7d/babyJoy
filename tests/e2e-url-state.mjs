export function semanticUrlState(rawUrl) {
  const url = new URL(rawUrl);
  return {
    pathname: url.pathname,
    search: [...url.searchParams.entries()].sort(
      ([aKey, aValue], [bKey, bValue]) => {
        const keyOrder = aKey.localeCompare(bKey);
        return keyOrder === 0 ? aValue.localeCompare(bValue) : keyOrder;
      },
    ),
  };
}
