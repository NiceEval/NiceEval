/** Preserve both ends of safe error text within a UTF-8 byte budget. */
export function boundedErrorText(value: string, maximumBytes: number): string {
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  const total = bytes(value);
  if (total <= maximumBytes) return value;
  const reserve = bytes(` … [${total} bytes omitted] … `);
  const available = Math.max(0, maximumBytes - reserve);
  const characters = Array.from(value);
  const take = (items: readonly string[], budget: number): string[] => {
    const result: string[] = [];
    let used = 0;
    for (const character of items) {
      used += bytes(character);
      if (used > budget) break;
      result.push(character);
    }
    return result;
  };
  const head = take(characters, Math.ceil(available / 2)).join("");
  const tail = take(characters.reverse(), Math.floor(available / 2))
    .reverse()
    .join("");
  return `${head} … [${total - bytes(head) - bytes(tail)} bytes omitted] … ${tail}`;
}
