// loadCriteria 的 pattern 编译:项目根相对 glob → 正则 + 枚举起点。
// 判据 pattern 用到的语法只有这几种(`**` 跨层、`*` / `?` 段内、`[...]` 字符类、`{a,b}` 分支),
// 自带这一份比为它加一个 glob 运行时依赖划算(niceeval 的运行时依赖表里没有 glob 库)。

/** 段里出现这些字符就不再是字面段,枚举起点到此为止。 */
const MAGIC = /[*?[\]{}]/;

export interface CompiledPattern {
  /** `!` 前缀:命中即把这个文件踢出匹配集。 */
  readonly exclude: boolean;
  /** 项目根相对的字面前缀目录,文件系统枚举从这里开始;pattern 首段就带 magic 时是 ""。 */
  readonly base: string;
  /** 拿项目根相对路径(正斜杠)去 test。 */
  readonly regex: RegExp;
  /** 用户写下的原样 pattern,报错时点名用。 */
  readonly source: string;
  /** 同一条用户 pattern 的 `{a,b}` 展开共享一个组号:判「这条 pattern 有没有贡献」按组算。 */
  readonly group: number;
}

/** 按声明顺序编译;`{a,b}` 展开成同一 exclude 语义的相邻多条,组内先后不影响判定。 */
export function compilePatterns(patterns: readonly string[]): CompiledPattern[] {
  const out: CompiledPattern[] = [];
  patterns.forEach((raw, group) => {
    const exclude = raw.startsWith("!");
    const body = exclude ? raw.slice(1) : raw;
    for (const expanded of expandBraces(body)) {
      out.push({ exclude, base: literalBase(expanded), regex: compileGlob(expanded), source: raw, group });
    }
  });
  return out;
}

/**
 * 逐条判「这个 include pattern 对匹配集有没有贡献」,返回零贡献的那几条(用户原样写法)。
 * 零贡献有两种:一个文件都没命中,或命中的文件全被后写的 `!` 排除掉——两种都等于这条
 * pattern 白写,判据比声明的窄,必须报出来而不是靠别的 pattern 有命中蒙过去。
 * `!` 排除 pattern 不受这条约束(排除本来就常写成宽口径的防御)。
 */
export function unmatchedIncludes(compiled: readonly CompiledPattern[], matched: readonly string[]): string[] {
  const contributing = new Set<number>();
  for (const path of matched) {
    for (const pattern of compiled) {
      if (!pattern.exclude && pattern.regex.test(path)) contributing.add(pattern.group);
    }
  }
  const missing: string[] = [];
  for (const pattern of compiled) {
    if (pattern.exclude || contributing.has(pattern.group) || missing.includes(pattern.source)) continue;
    missing.push(pattern.source);
  }
  return missing;
}

/**
 * 按声明顺序求值、后写覆盖先写:最后一个命中的 pattern 决定这个文件进不进匹配集。
 * 一个 pattern 都不命中 = 不进(不是「默认全收再按 `!` 减」)。
 */
export function includedByPatterns(relativePath: string, compiled: readonly CompiledPattern[]): boolean {
  let included = false;
  for (const pattern of compiled) {
    if (pattern.regex.test(relativePath)) included = !pattern.exclude;
  }
  return included;
}

/** 枚举起点:include pattern 的字面前缀目录,去掉被别人包住的那些(避免同一棵树走两遍)。 */
export function enumerationBases(compiled: readonly CompiledPattern[]): string[] {
  const bases = [...new Set(compiled.filter((p) => !p.exclude).map((p) => p.base))].sort();
  return bases.filter((base, i) => !bases.some((other, j) => j !== i && isUnder(base, other)));
}

function isUnder(candidate: string, ancestor: string): boolean {
  if (ancestor === candidate) return false;
  return ancestor === "" || candidate.startsWith(`${ancestor}/`);
}

function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];
  const parts: string[] = [];
  let depth = 0;
  let start = open + 1;
  let close = -1;
  for (let i = open; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        parts.push(pattern.slice(start, i));
        close = i;
        break;
      }
    } else if (char === "," && depth === 1) {
      parts.push(pattern.slice(start, i));
      start = i + 1;
    }
  }
  // 不成对的 `{` 按字面字符处理:pattern 写错时交给「匹配集为空」报,不在这里猜意图。
  if (close === -1) return [pattern];
  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  return parts.flatMap((part) => expandBraces(`${prefix}${part}${suffix}`));
}

function literalBase(pattern: string): string {
  const segments = pattern.split("/");
  const literal: string[] = [];
  for (const segment of segments) {
    if (MAGIC.test(segment)) break;
    literal.push(segment);
  }
  // 整条 pattern 都是字面(指向单个文件)时,枚举起点取它的父目录,最终判定仍走 regex。
  if (literal.length === segments.length) literal.pop();
  return literal.filter((segment) => segment !== "" && segment !== ".").join("/");
}

function compileGlob(pattern: string): RegExp {
  const segments = pattern.split("/");
  let body = "";
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    // `**` 独占一段才是跨层通配:末段收下面所有层级的文件,中段收零个或多个层级。
    if (segment === "**") body += last ? ".+" : "(?:[^/]+/)*";
    else body += segmentRegex(segment) + (last ? "" : "/");
  });
  return new RegExp(`^${body}$`);
}

function segmentRegex(segment: string): string {
  let body = "";
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i]!;
    if (char === "*") body += "[^/]*";
    else if (char === "?") body += "[^/]";
    else if (char === "[") {
      const close = segment.indexOf("]", i + 1);
      if (close === -1) {
        body += "\\[";
      } else {
        const raw = segment.slice(i + 1, close);
        body += `[${raw.startsWith("!") ? `^${raw.slice(1)}` : raw}]`;
        i = close;
      }
    } else body += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return body;
}
