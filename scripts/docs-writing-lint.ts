/**
 * docs/ 正文的可读性检查:句长、段长、行宽与禁词库。
 *
 * 规矩写在 docs/README.md「写给人读」,数据在 docs/writing-rules.json,
 * 现存命中数的台账在 docs/writing-baseline.json。
 *
 * 这里只出规则与计数,不自带命令行:判对错与更新台账都由
 * test/docs/docs-writing.test.ts 经 `pnpm test:docs` 驱动,台账用 vitest 的
 * 文件快照写回(`pnpm test:docs -u`)。台账里的数字只许变小——降到 0 的文件
 * 从台账里消失,新写的正文一次命中都不许有。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
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
  sentenceLength: { max: number };
  paragraphLength: { max: number };
  bannedTerms: BannedTerm[];
}

/** 按文件计数的三条长度规则。禁词另记,因为要按词分开。 */
const LENGTH_RULES = [
  { key: "lineWidth", label: "超宽行" },
  { key: "sentenceLength", label: "超长句" },
  { key: "paragraphLength", label: "超长段" },
] as const;

type LengthRule = (typeof LENGTH_RULES)[number]["key"];

/** 台账:文件 → 命中数。三条长度规则各一个数字,禁词按词分开记。 */
export type Baseline = Record<LengthRule, Record<string, number>> & {
  bannedTerms: Record<string, Record<string, number>>;
};

/** 一条命中,带上打印所需的全部信息——调用方不必再回查规则。 */
export interface Hit {
  file: string;
  line: number;
  /** 长度命中写规则名(`"sentenceLength"` 等),禁词命中写那个词。 */
  rule: string;
  message: string;
}

export interface LintReport {
  hits: Hit[];
  /** 当前实测的台账形态,可直接写回 docs/writing-baseline.json。 */
  actual: Baseline;
  /** 相对台账的回归(数字变大或出现新条目)。 */
  regressions: string[];
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

/** 列表项的项目符号:`- ` `* ` `+ ` `1. ` `1) `。 */
const LIST_MARKER = /^([-*+]|\d+[.)])\s+/;

/** 一段连续正文:软换行已经拼回去了,`line` 是它在文件里的起始行。 */
interface ProseBlock {
  line: number;
  text: string;
}

/**
 * 把软换行拼回一段——句长与段长必须量在拼接之后。按单行量的话,
 * 在句子中间敲个回车就能把长难句拆过检查,而渲染出来一个字没变。
 * 空行、表格、标题、引用各自是边界;列表项各算一段,项目符号不计入长度。
 */
export function proseBlocks(lines: string[]): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let buffer: string[] = [];
  let start = 0;
  let inFence = false;

  const flush = () => {
    if (buffer.length > 0) blocks.push({ line: start, text: buffer.join(" ") });
    buffer = [];
  };

  for (const [index, raw] of lines.entries()) {
    if (raw.trimStart().startsWith("```")) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence) continue;

    const line = raw.trim();
    if (line === "" || line.startsWith("|") || line.startsWith("#") || line.startsWith(">")) {
      flush();
      continue;
    }
    if (LIST_MARKER.test(line)) {
      flush();
      start = index + 1;
      buffer.push(line.replace(LIST_MARKER, ""));
      continue;
    }
    if (buffer.length === 0) start = index + 1;
    buffer.push(line);
  }
  flush();
  return blocks;
}

/**
 * 量的是读者要读的字:图片不读,链接只读链接文本(URL 不算读者的负担),
 * 反引号与强调星号是标记不是字——但被它们包住的内容照算,标识符也要读。
 */
export function proseText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .trim();
}

/**
 * 只有句末标点算断句。分号、破折号、顿号串起来的分句仍算同一句:
 * 长难句正是这么长起来的,把它们算作断句等于让这条规则放过要治的对象。
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
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
  const actual: Baseline = { lineWidth: {}, sentenceLength: {}, paragraphLength: {}, bannedTerms: {} };
  const count = (rule: LengthRule, file: string) => {
    actual[rule][file] = (actual[rule][file] ?? 0) + 1;
  };

  for (const file of walkMarkdown("docs")) {
    const lines = readFileSync(join(ROOT, file), "utf8").split("\n");

    for (const block of proseBlocks(lines)) {
      const text = proseText(block.text);
      if (text.length > rules.paragraphLength.max) {
        count("paragraphLength", file);
        hits.push({
          file,
          line: block.line,
          rule: "paragraphLength",
          message: `一段 ${text.length} 字,超出 ${rules.paragraphLength.max} 字——一段只说一件事,罗列改用列表或表格`,
        });
      }
      for (const [order, sentence] of splitSentences(text).entries()) {
        if (sentence.length <= rules.sentenceLength.max) continue;
        count("sentenceLength", file);
        hits.push({
          file,
          line: block.line,
          rule: "sentenceLength",
          message: `第 ${order + 1} 句 ${sentence.length} 字,超出 ${rules.sentenceLength.max} 字——拆成两句,或把并列内容改写成列表 / 表格`,
        });
      }
    }

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
        count("lineWidth", file);
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

  // 只判「变大」。变小不在这里报:台账收紧由 actual 与 docs/writing-baseline.json
  // 的文件快照比对负责,`pnpm test:docs -u` 一步写回。
  const regressions: string[] = [];

  for (const { key, label } of LENGTH_RULES) {
    for (const file of new Set([...Object.keys(actual[key]), ...Object.keys(baseline[key] ?? {})])) {
      const now = actual[key][file] ?? 0;
      const allowed = baseline[key]?.[file] ?? 0;
      if (now > allowed) regressions.push(`${file}: ${label} ${allowed} → ${now}`);
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
    }
  }

  return { hits, actual, regressions };
}

/**
 * 回归的详报:哪一行、超了多少、禁词该改用什么。只打回归文件里的命中——
 * 台账里的旧命中不是这次要改的,混进来会把该改的那几行淹掉。
 */
export function formatRegressionHits(report: LintReport): string {
  if (report.regressions.length === 0) return "";
  const files = new Set(report.regressions.map((r) => r.split(":")[0]));
  const lines = report.hits
    .filter((hit) => files.has(hit.file))
    .map((hit) => `${hit.file}:${hit.line}  ${hit.message}`);
  return [
    ...lines,
    "",
    `有 ${report.regressions.length} 项超出 ${BASELINE_FILE}:`,
    ...report.regressions.map((r) => `  - ${r}`),
    "",
    `改掉上面打印的那几行;台账只许变小,不要为了变绿去动 ${BASELINE_FILE}。`,
  ].join("\n");
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
  for (const { key } of LENGTH_RULES) {
    const max = (rules as unknown as Record<string, { max?: number }>)[key]?.max;
    if (typeof max !== "number" || max <= 0) problems.push(`${key}.max 缺失或不是正数`);
  }
  if (rules.paragraphLength?.max < rules.sentenceLength?.max) {
    problems.push("paragraphLength.max 小于 sentenceLength.max——合法的单句会被段长规则判死,没法改");
  }
  return problems;
}

/**
 * 台账的落盘形态。文件快照按整串比对,所以键序必须稳定——否则同一份实测
 * 换个遍历顺序就"不一致",`-u` 会来回改写同一个文件。
 */
export function serializeBaseline(actual: Baseline): string {
  const sortKeys = <T>(obj: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
  const sorted: Baseline = {
    lineWidth: sortKeys(actual.lineWidth),
    sentenceLength: sortKeys(actual.sentenceLength),
    paragraphLength: sortKeys(actual.paragraphLength),
    bannedTerms: sortKeys(
      Object.fromEntries(Object.entries(actual.bannedTerms).map(([f, t]) => [f, sortKeys(t)])),
    ),
  };
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
