// Parameter placeholders are intentionally textual: all other bytes are literal.
const placeholder = /%[sidjo#%]|\$[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/gu;
export const escapeTitlePattern = (text: string): string => text.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
export function titleTemplate(title: string): { readonly parameterized: boolean; readonly pattern: RegExp; readonly filter: string } {
  const literals = title.split(placeholder);
  return { parameterized: literals.length > 1, pattern: new RegExp(`^${literals.map(escapeTitlePattern).join("[\\s\\S]*")}$`, "u"), filter: [...literals].sort((a, b) => b.length - a.length)[0] ?? "" };
}
export function titlePathPattern(path: readonly string[]): RegExp {
  const parents = path.slice(0, -1).map(escapeTitlePattern).join(" ");
  const leaf = titleTemplate(path.at(-1) ?? "").pattern.source.slice(1, -1);
  return new RegExp(`^${parents}${path.length > 1 ? " " : ""}${leaf}$`, "u");
}
export const matchesTitlePath = (template: readonly string[], actual: readonly string[]): boolean => {
  // Vitest list and JSON report flatten describe paths into a fullName.
  if (actual.length === 1) return titlePathPattern(template).test(actual[0]!);
  return template.length === actual.length && template.every((part, index) => index === template.length - 1 ? titleTemplate(part).pattern.test(actual[index]!) : part === actual[index]);
};
