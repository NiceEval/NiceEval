export function only<T>(items: readonly T[], predicate: (item: T) => boolean, diagnostic: string): T {
  const matches = items.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`预期恰好一条匹配，实际 ${matches.length} 条。\n${diagnostic}`);
  }
  return matches[0]!;
}
