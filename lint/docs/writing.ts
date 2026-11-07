/** NiceEval-specific API-example and SVG guards; prose is checked by Concord. */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const RULES_FILE = "lint/docs/public-api-examples.json";
const WRITING_FILE = "docs/writing.md";
// SVG 标签可以引用设计文档、公开站正文或概念目录中的正式写法。
const USAGE_DIRS = ["docs", "apps/docs-site"];

export interface BannedTerm {
  /** 禁用的字面写法。纯 ASCII 的词按词边界、忽略大小写匹配。 */
  term: string;
  /** 改用什么——命中时原样打印给作者。 */
  use: string;
  /** 为什么禁——命中时原样打印,作者不必回来翻文档。 */
  why: string;
  /** 只在这些目录或文件生效；省略时适用于整个检查范围。 */
  roots?: string[];
  /**
   * 可选:包含该词但语义无关的更长词(如「选集」之于「候选集合」)。中文没有词边界,
   * 短词会被更长的合法词整段命中;落在这些词里的匹配不计。每一项都必须含 `term` 本身。
   */
  allowIn?: string[];
}

interface WritingRules {
  publicApiExamples: { calledToolContract: CalledToolContract };
}

interface CalledToolContract {
  roots: string[];
  methods: {
    positive: string;
    negative: string;
  };
  command: {
    matcher: string;
    forbidInlineRegexOrPredicate: boolean;
  };
}

/** 一条命中,带上打印所需的全部信息——调用方不必再回查规则。 */
export interface Hit {
  file: string;
  line: number;
  /** 长度命中写规则名(`"sentenceLength"` 等),禁词命中写那个词。 */
  rule: string;
  message: string;
}

/** 判「图里这个词有没有出处」的语料:正文含 docs/concepts.md——在概念表立过的词就是有出处。 */
function termCorpus(): string {
  return USAGE_DIRS.flatMap((dir) => walkDocs(dir, [".md", ".mdx"]))
    .map((file) => readFileSync(join(ROOT, file), "utf8"))
    .join("\n");
}

function walkDocs(dir: string, extensions: string[] = [".md"]): string[] {
  return readdirSync(join(ROOT, dir)).sort().flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return walkDocs(rel, extensions);
    return extensions.some((ext) => name.endsWith(ext)) ? [rel] : [];
  });
}

function filesAt(root: string): string[] {
  const absolute = join(ROOT, root);
  return statSync(absolute).isDirectory() ? walkDocs(root, [".md", ".mdx"]) : [root];
}

function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function balancedEnd(text: string, opening: number): number | undefined {
  let depth = 0;
  let quote: "'" | '"' | "`" | undefined;

  for (let index = opening; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== undefined) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char !== ")") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return undefined;
}

function splitTopLevelArguments(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parens = 0;
  let braces = 0;
  let brackets = 0;
  let quote: "'" | '"' | "`" | undefined;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== undefined) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") parens += 1;
    else if (char === ")") parens -= 1;
    else if (char === "{") braces += 1;
    else if (char === "}") braces -= 1;
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets -= 1;
    else if (char === "," && parens === 0 && braces === 0 && brackets === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

/**
 * 作者示例的 calledTool 契约不靠逐页命中名单维护。规则数据来自 public-api-examples.json，
 * 这里仅把「两个方法都只接收一个参数」「命令匹配不内联正则或 predicate」翻成对代码片段的检查。
 */
export function lintCalledToolContractText(
  file: string,
  content: string,
  contract: CalledToolContract,
): Hit[] {
  const hits: Hit[] = [];
  const methodPattern = new RegExp(`\\b(${contract.methods.positive}|${contract.methods.negative})\\s*\\(`, "g");

  for (const match of content.matchAll(methodPattern)) {
    const method = match[1];
    const start = match.index ?? 0;
    const opening = start + match[0].lastIndexOf("(");
    const end = balancedEnd(content, opening);
    if (end === undefined) continue;
    // 多行调用的尾逗号会切出空串，它不是第二个参数。
    const args = splitTopLevelArguments(content.slice(opening + 1, end)).filter((arg) => arg !== "");
    if (args[1] === undefined) continue;
    hits.push({
      file,
      line: lineAt(content, start),
      rule: "calledToolContract",
      message: `${method} 只接收一个 ToolMatch 或工具名；input、output、status 与次数都写在 toolMatch 上`,
    });
  }

  if (contract.command.forbidInlineRegexOrPredicate) {
    const inlineCommandMatcher = /\bcommand\s*:\s*\//g;
    const inlineCommandPredicate = /\bcommand\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g;
    for (const pattern of [inlineCommandMatcher, inlineCommandPredicate]) {
      for (const match of content.matchAll(pattern)) {
        hits.push({
          file,
          line: lineAt(content, match.index ?? 0),
          rule: "calledToolContract",
          message: `命令匹配使用 ${contract.command.matcher}，不在 JSON 片段内写正则或 predicate`,
        });
      }
    }
  }

  return hits;
}

export function lintCalledToolContract(): Hit[] {
  const rules: WritingRules = JSON.parse(readFileSync(join(ROOT, RULES_FILE), "utf8"));
  const contract = rules.publicApiExamples.calledToolContract;
  return contract.roots.flatMap((root) =>
    filesAt(root).flatMap((file) =>
      lintCalledToolContractText(file, readFileSync(join(ROOT, file), "utf8"), contract),
    ),
  );
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

export interface ConcordWriting {
  state: string;
  diagnostic?: string;
  policy: { roots?: string[]; bannedTerms: BannedTerm[] } | null;
  derived: Array<BannedTerm & { scope: string }>;
}

function concordWriting(): ConcordWriting {
  try {
    const writing: ConcordWriting = JSON.parse(execFileSync(
      "concord",
      ["writing", "show", "--path", WRITING_FILE, "--json"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 },
    ));
    if (writing.state !== "valid" || writing.policy === null) {
      throw new Error(writing.diagnostic ?? `writing policy state: ${writing.state}`);
    }
    return writing;
  } catch (cause) {
    throw new Error(`SVG writing check requires concord writing show --path ${WRITING_FILE} --json`, { cause });
  }
}

function withinRoots(file: string, roots?: string[]): boolean {
  return roots === undefined || roots.some((root) => file === root || file.startsWith(`${root}/`));
}

/** SVG is outside Concord's Markdown/MDX scan. Reuse its parsed policy and derived old spellings. */
export function svgBannedMatchers(file: string, writing: ConcordWriting): Array<BannedTerm & { re: RegExp }> {
  const policy = writing.policy;
  if (policy === null || !withinRoots(file, policy.roots)) return [];
  const terms = [
    ...policy.bannedTerms,
    ...writing.derived.map((term) => ({ ...term, roots: [term.scope] })),
  ];
  return terms.filter((term) => withinRoots(file, term.roots))
    .map((term) => ({ ...term, re: termMatcher(term.term) }));
}

/** 图里的一个文本节点:`<text>` / `<tspan>` 拼平之后的一句,连同它挂的 class。 */
export interface SvgText {
  line: number;
  classes: string[];
  text: string;
}

/**
 * SVG 里承载「名字」的槽位(见 docs/SVG-DESIGN.md 的 class 表:盒标题、泳道名)。
 * 只有这一格按词判。`.title` 是一句话、`.note` 与无 class 的 `text` 是说明句,
 * 它们本来就是为这张图现写的句子,拿「正文里出现过」去量会把每一句都判红。
 */
const TERM_SLOT = "label";

/** 图里的中文词按连续汉字段切——中文标点、空格、英文标识符都是边界。 */
const HAN_RUN = /[㐀-䶿一-鿿]+/g;

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/**
 * 取出图里全部可读文本。`<tspan>` 拼进父节点:一行里用 tspan 分色的
 * 「passed / failed」是同一句话,拆开会把词切断。`<title>` / `<desc>` 也算——
 * 读屏用户只拿得到它们,禁用写法藏在那里同样要报。
 */
export function svgTexts(svg: string): SvgText[] {
  const texts: SvgText[] = [];
  for (const match of svg.matchAll(/<(text|title|desc)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const tag = match[1];
    const attributes = match[2];
    const inner = match[3];
    if (tag === undefined || attributes === undefined || inner === undefined) continue;
    const classes = (/class="([^"]*)"/.exec(attributes)?.[1] ?? "").split(/\s+/).filter(Boolean);
    const text = inner
      // 不带定位的 tspan 只是同一行里换个颜色,直接拼:「已<tspan>受理</tspan>」是一个词,
      // 中间塞个空格两个半截都不成词,查不到出处就成了假命中。带 x / dy 的 tspan 是
      // 另起一行或移位,那才是词的边界。
      .replace(/<tspan\b(?![^>]*\s(?:x|y|dx|dy)=)[^>]*>|<\/tspan>/g, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => XML_ENTITIES[entity] ?? entity)
      .replace(/\s+/g, " ")
      .trim();
    texts.push({
      line: svg.slice(0, match.index).split("\n").length,
      classes: tag === "text" ? classes : [tag],
      text,
    });
  }
  return texts;
}

/**
 * 图里的用语检查。两条规则都要求一次命中都不许有:
 *
 * 1. **不立新词。** `.label` 里的每个中文词都要在 `docs/` 或 `apps/docs-site/` 正文
 *    (含概念表)里出现过。图最容易长出只此一处的自造词:画的人为了摆得下
 *    造个简称,读的人在正文里查不到它,而正文与图从此各说各话。
 * 2. **禁用写法照样管。** 正文那份禁词库与概念表的首选裁决,对图里的每个字同样生效。
 */
export function lintSvgTerms(): Hit[] {
  const writing = concordWriting();
  const corpus = termCorpus();
  const hits: Hit[] = [];

  for (const file of walkDocs("docs", [".svg"])) {
    const matchers = svgBannedMatchers(file, writing);
    for (const node of svgTexts(readFileSync(join(ROOT, file), "utf8"))) {
      for (const term of matchers) {
        const count = countTermHits(node.text, term.re, term.allowIn);
        if (count === 0) continue;
        for (let occurrence = 1; occurrence <= count; occurrence += 1) {
          hits.push({
            file,
            line: node.line,
            rule: term.term,
            message:
              `图里的禁用写法「${term.term}」(该文本第 ${occurrence}/${count} 处)——` +
              `改用${term.use};${term.why}`,
          });
        }
      }
      if (!node.classes.includes(TERM_SLOT)) continue;
      for (const run of node.text.match(HAN_RUN) ?? []) {
        if (corpus.includes(run)) continue;
        hits.push({
          file,
          line: node.line,
          rule: "svgTerm",
          message:
            `图里的「${run}」在 docs/ 与 apps/docs-site/ 正文里一次没出现——` +
            `图不立新词:改用正文已有的说法,或者这个词该先在正文里立起来`,
        });
      }
    }
  }
  return hits;
}

/** 零容忍守护的完整诊断:不筛选历史命中,每一条实际命中都要修复。 */
export function formatLintHits(hits: readonly Hit[]): string {
  if (hits.length === 0) return "";
  return [
    ...hits.map((hit) => `${hit.file}:${hit.line}  ${hit.message}`),
    "",
    `共 ${hits.length} 条实际命中。文档写作守护是零容忍的:改掉全部命中后重跑 pnpm lint:docs。`,
  ].join("\n");
}
