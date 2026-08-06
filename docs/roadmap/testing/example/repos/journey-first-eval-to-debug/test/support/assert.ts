/** 机械断言辅助：只负责把「找到」变成类型事实，不产生任何 expected 值。 */

export function defined<T>(value: T | undefined | null, diagnostic: string): T {
  if (value == null) {
    throw new Error(`预期存在值，实际缺失。\n${diagnostic}`);
  }
  return value;
}

/** 在集合里按稳定谓词找唯一匹配；找不到或匹配多个都算测试失败。 */
export function only<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
  diagnostic: string,
): T {
  const matches = items.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`预期恰好一条匹配，实际 ${matches.length} 条。\n${diagnostic}`);
  }
  return matches[0]!;
}
