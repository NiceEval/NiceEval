/**
 * docs/ 正文的可读性检查:行宽与禁词库。
 *
 * 规矩写在 docs/README.md「写给人读」,数据在 docs/writing-rules.json,
 * 现存命中数的台账在 docs/writing-baseline.json。
 *
 *   pnpm docs:lint              检查(有回归时退出码 1)
 *   pnpm docs:lint --update     把当前命中数写回台账(只在确实改善或新增规则后用)
 *
 * 同一份逻辑被 test/docs/docs-writing.test.ts 复用,所以 `pnpm test:docs` 也拦回归——
 * 台账里的数字只许变小:降到 0 的文件从台账里消失,新写的正文一次命中都不许有。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const RULES_FILE = "docs/writing-rules.json";
const BASELINE_FILE = "docs/writing-baseline.json";

export interface BannedTerm {
  /** 禁用的字面写法。纯 ASCII 的词按词边界、忽略大小写匹配。 */
  term: string;
  /** 改用什么——命中时原样打印给作者。 */
  use: string;
  /** 为什么禁——命中时原样打印,作者不必回来翻文档。 */
  why: string;
  /** 可选:豁免的路径前缀(如 `docs/roadmap/`)。 */
  exempt?: string[];
  /**
   * 可选:包含该词但语义无关的更长词(如「选集」之于「候选集合」)。中文没有词边界,
   * 短词会被更长的合法词整段命中;落在这些词里的匹配不计。每一项都必须含 `term` 本身。
   */
  allowIn?: string[];
}

interface WritingRules {
  lineWidth: { max: number; cjkColumns: number };
  bannedTerms: BannedTerm[];
}

/** 台账:文件 → 命中数。行宽一个数字,禁词按词分开记。 */
export interface Baseline {
  lineWidth: Record<string, number>;
  bannedTerms: Record<string, Record<string, number>>;
}

/** 一条命中,带上打印所需的全部信息——调用方不必再回查规则。 */
export interface Hit {
  file: string;
  line: number;
  /** 行宽命中写 `"lineWidth"`,禁词命中写那个词。 */
  rule: string;
  message: string;
}

export interface LintReport {
  hits: Hit[];
  /** 当前实测的台账形态,可直接写回 docs/writing-baseline.json。 */
  actual: Baseline;
  /** 相对台账的回归(数字变大或出现新条目)。 */
  regressions: string[];
  /** 台账比实测宽松的条目——已经改好了,该收紧。 */
  stale: string[];
}

// 东亚宽字符占两列:中日韩、全角标点、假名。行宽按列算而不是按字符数算,
// 否则同样 80 字符的中英文行在编辑器里宽度差一倍。
const WIDE_CHAR =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/;

export function visualWidth(line: string, cjkColumns: number): number {
  let width = 0;
  for (const ch of line) width += WIDE_CHAR.test(ch) ? cjkColumns : 1;
  return width;
}

function walkMarkdown(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return walkMarkdown(rel);
    return name.endsWith(".md") ? [rel] : [];
  });
}

/** 行内代码与代码块里的同名标识符不算命中:`钩子` 可能正是某个字段或输出示例。 */
function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, "");
}

const isTableRow = (line: string) => line.trimStart().startsWith("|");

/**
 * 行宽豁免:行里有一个塞不下的 token(长 URL、长路径、长标识符)时,换行也救不了。
 * 中文没有空格,一整段中文会被 split 当成一个巨长 token——含宽字符的 token 不算豁免,
 * 否则这条规矩对中文正文完全失效,而中文正文正是它要治的对象。
 */
function hasUnbreakableToken(line: string, limit: number, cjkColumns: number): boolean {
  return line
    .trim()
    .split(/\s+/)
    .some((token) => !WIDE_CHAR.test(token) && visualWidth(token, cjkColumns) > limit);
}

function termMatcher(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 纯 ASCII 的词(dual-face、TODO)按词边界匹配,免得 `TODOS` 之类误伤;
  // 中文没有词边界概念,直接子串匹配。
  return /^[\x20-\x7E]+$/.test(term)
    ? new RegExp(`\\b${escaped}\\b`, "gi")
    : new RegExp(escaped, "g");
}

/** 数命中,跳过落在 allowIn 更长词里的那些。allowIn 为空时就是普通计数。 */
function countTermHits(prose: string, re: RegExp, allowIn?: string[]): number {
  re.lastIndex = 0;
  const allowed: Array<[number, number]> = [];
  for (const word of allowIn ?? []) {
    for (let at = prose.indexOf(word); at !== -1; at = prose.indexOf(word, at + 1)) {
      allowed.push([at, at + word.length]);
    }
  }
  let count = 0;
  for (const m of prose.matchAll(re)) {
    const start = m.index;
    const end = start + m[0].length;
    if (allowed.some(([s, e]) => start >= s && end <= e)) continue;
    count += 1;
  }
  return count;
}

export function lintDocsWriting(): LintReport {
  const rules: WritingRules = JSON.parse(readFileSync(join(ROOT, RULES_FILE), "utf8"));
  const baseline: Baseline = JSON.parse(readFileSync(join(ROOT, BASELINE_FILE), "utf8"));
  const matchers = rules.bannedTerms.map((t) => ({ ...t, re: termMatcher(t.term) }));

  const hits: Hit[] = [];
  const actual: Baseline = { lineWidth: {}, bannedTerms: {} };

  for (const file of walkMarkdown("docs")) {
    const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
    let inFence = false;
    for (const [index, raw] of lines.entries()) {
      if (raw.trimStart().startsWith("```")) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const lineNumber = index + 1;

      const width = visualWidth(raw, rules.lineWidth.cjkColumns);
      if (
        width > rules.lineWidth.max &&
        !isTableRow(raw) &&
        !hasUnbreakableToken(raw, rules.lineWidth.max, rules.lineWidth.cjkColumns)
      ) {
        actual.lineWidth[file] = (actual.lineWidth[file] ?? 0) + 1;
        hits.push({
          file,
          line: lineNumber,
          rule: "lineWidth",
          message: `${width} 列,超出 ${rules.lineWidth.max} 列——在句子或分句边界换行`,
        });
      }

      const prose = stripInlineCode(raw);
      for (const term of matchers) {
        if (term.exempt?.some((prefix) => file.startsWith(prefix))) continue;
        const count = countTermHits(prose, term.re, term.allowIn);
        if (count === 0) continue;
        const perFile = (actual.bannedTerms[file] ??= {});
        perFile[term.term] = (perFile[term.term] ?? 0) + count;
        hits.push({
          file,
          line: lineNumber,
          rule: term.term,
          message: `禁用写法「${term.term}」——改用${term.use};${term.why}`,
        });
      }
    }
  }

  const regressions: string[] = [];
  const stale: string[] = [];

  for (const file of new Set([...Object.keys(actual.lineWidth), ...Object.keys(baseline.lineWidth)])) {
    const now = actual.lineWidth[file] ?? 0;
    const allowed = baseline.lineWidth[file] ?? 0;
    if (now > allowed) {
      regressions.push(`${file}: 超宽行 ${allowed} → ${now}`);
    } else if (now < allowed) {
      stale.push(`${file}: 超宽行 ${allowed} → ${now}`);
    }
  }

  const termFiles = new Set([...Object.keys(actual.bannedTerms), ...Object.keys(baseline.bannedTerms)]);
  for (const file of termFiles) {
    const nowTerms = actual.bannedTerms[file] ?? {};
    const allowedTerms = baseline.bannedTerms[file] ?? {};
    for (const term of new Set([...Object.keys(nowTerms), ...Object.keys(allowedTerms)])) {
      const now = nowTerms[term] ?? 0;
      const allowed = allowedTerms[term] ?? 0;
      if (now > allowed) regressions.push(`${file}: 「${term}」${allowed} → ${now}`);
      else if (now < allowed) stale.push(`${file}: 「${term}」${allowed} → ${now}`);
    }
  }

  return { hits, actual, regressions, stale };
}

/** 规则本身的自检:三个字段都不能空,否则命中时打印不出该改成什么。 */
export function validateRules(): string[] {
  const rules: WritingRules = JSON.parse(readFileSync(join(ROOT, RULES_FILE), "utf8"));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const term of rules.bannedTerms) {
    const label = term.term ?? "(空)";
    if (!term.term) problems.push("有一条禁词没写 term");
    if (!term.use?.trim()) problems.push(`「${label}」没写 use——命中时作者不知道改成什么`);
    if (!term.why?.trim()) problems.push(`「${label}」没写 why——没有理由的禁词会被当成洁癖绕过`);
    if (seen.has(term.term)) problems.push(`「${label}」重复登记`);
    seen.add(term.term);
    // allowIn 写错字时不会报错、只会静默失效(该豁免的仍然命中),所以在这里拦。
    for (const word of term.allowIn ?? []) {
      if (!word.includes(term.term)) {
        problems.push(`「${label}」的 allowIn 里「${word}」不含这个词——写错了就豁免不掉`);
      }
    }
  }
  if (typeof rules.lineWidth?.max !== "number" || rules.lineWidth.max <= 0) {
    problems.push("lineWidth.max 缺失或不是正数");
  }
  return problems;
}

export function writeBaseline(actual: Baseline): void {
  const sortKeys = <T>(obj: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
  const sorted: Baseline = {
    lineWidth: sortKeys(actual.lineWidth),
    bannedTerms: sortKeys(
      Object.fromEntries(Object.entries(actual.bannedTerms).map(([f, t]) => [f, sortKeys(t)])),
    ),
  };
  writeFileSync(join(ROOT, BASELINE_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("docs-writing-lint.ts")) {
  const problems = validateRules();
  if (problems.length > 0) {
    console.error(`${RULES_FILE} 有问题:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const report = lintDocsWriting();

  if (process.argv.includes("--update")) {
    writeBaseline(report.actual);
    const lineWidthTotal = Object.values(report.actual.lineWidth).reduce((a, b) => a + b, 0);
    const termTotal = Object.values(report.actual.bannedTerms)
      .flatMap((t) => Object.values(t))
      .reduce((a, b) => a + b, 0);
    console.log(`已写回 ${BASELINE_FILE}:超宽行 ${lineWidthTotal} 处,禁用写法 ${termTotal} 处待清理。`);
    process.exit(0);
  }

  // 先打印回归:它们是本次必须改的。台账里的旧命中另行汇总,不淹没输出。
  const regressionFiles = new Set(report.regressions.map((r) => r.split(":")[0]));
  for (const hit of report.hits) {
    if (!regressionFiles.has(hit.file)) continue;
    console.log(`${hit.file}:${hit.line}  ${hit.message}`);
  }

  if (report.regressions.length > 0) {
    console.error(`\n有 ${report.regressions.length} 项超出台账:`);
    for (const r of report.regressions) console.error(`  - ${r}`);
    console.error(`\n改掉上面打印的那几行;台账 ${BASELINE_FILE} 只许变小,不要为了变绿改它。`);
    process.exit(1);
  }

  if (report.stale.length > 0) {
    console.error(`台账比实际宽松 ${report.stale.length} 项——跑 pnpm docs:lint --update 收紧:`);
    for (const s of report.stale) console.error(`  - ${s}`);
    process.exit(1);
  }

  const remaining = report.hits.length;
  console.log(
    remaining === 0
      ? "docs/ 行宽与用词全部通过。"
      : `无回归。台账里还有 ${remaining} 处待清理(跑 --update 之外的清理请直接改正文)。`,
  );
}
