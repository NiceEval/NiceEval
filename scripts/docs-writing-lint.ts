/**
 * docs/ 正文的可读性检查:句长、段长与禁词库。
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
const CONCEPTS_FILE = "docs/concepts.md";
// 判「这个词有没有人用」要连中文站一起看:词在 docs-site/zh 用着、只是设计文档里没提,
// 那不是死词。反过来两边都不出现,才说明立了词没人用。
const USAGE_DIRS = ["docs", "docs-site"];

export interface BannedTerm {
  /** 禁用的字面写法。纯 ASCII 的词按词边界、忽略大小写匹配。 */
  term: string;
  /** 改用什么——命中时原样打印给作者。 */
  use: string;
  /** 为什么禁——命中时原样打印,作者不必回来翻文档。 */
  why: string;
  /**
   * 可选:豁免的路径前缀。留给「立词的那一页自己要写出被淘汰的写法」这一种情形——
   * 概念表并列列出同义词是它的职责。正文里的命中一律改文字,不加路径豁免:
   * 豁免一加就是整个目录长期免检,而它挡住的往往正是该改的那几句。
   */
  exempt?: string[];
  /**
   * 可选:包含该词但语义无关的更长词(如「选集」之于「候选集合」)。中文没有词边界,
   * 短词会被更长的合法词整段命中;落在这些词里的匹配不计。每一项都必须含 `term` 本身。
   */
  allowIn?: string[];
}

interface WritingRules {
  sentenceLength: { max: number };
  paragraphLength: { max: number };
  bannedTerms: BannedTerm[];
}

/** 按文件计数的两条长度规则。禁词另记,因为要按词分开。 */
const LENGTH_RULES = [
  { key: "sentenceLength", label: "超长句" },
  { key: "paragraphLength", label: "超长段" },
] as const;

type LengthRule = (typeof LENGTH_RULES)[number]["key"];

/**
 * 台账:文件 → 命中数。两条长度规则各一个数字,禁词按词分开记。
 * 死词记成词表而不是数字——换一个词死掉、原来的活过来,数字不变但问题换了一个,
 * 计数拦不住这种等量替换。
 */
export type Baseline = Record<LengthRule, Record<string, number>> & {
  bannedTerms: Record<string, Record<string, number>>;
  deadTerms: string[];
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
  /**
   * 有行级回归的文件。死词回归不落在具体某一行,不进这里——否则详报会把
   * 概念表已入账的旧命中全倒出来,把真正要改的那几行淹掉。
   */
  regressionFiles: string[];
  /** 概念表里立了、正文一次没用过的词条。 */
  deadTerms: string[];
}

/** 概念表的一行:一个词条的全部写法,以及并列同义词里的首选裁决。 */
export interface ConceptTerm {
  line: number;
  /** 这一行声明的全部写法——中文名、English 名、API 标识都算。 */
  writings: string[];
  /** 同一格里并列的同义写法中用粗体标出的那个;没有并列同义词时为空。 */
  preferred?: string;
  /** 被首选写法压过的其它写法,正文里出现即提示改用首选。 */
  deprecated: string[];
}

/** 概念表里承载「写法」的列。其余列(分类、含义、主展示单位)是说明,不是词。 */
const NAME_COLUMNS = new Set(["中文", "English", "API"]);

const tableCells = (row: string): string[] =>
  row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

const cleanWriting = (raw: string): string => raw.replace(/\*\*/g, "").replace(/`/g, "").trim();

/**
 * 解析 docs/concepts.md 的术语总表。表格列数不固定(三列的总表、五列的报告组件表),
 * 所以按表头认列而不是按位置认列——加一列不会让这里静默错位。
 */
export function parseConcepts(content?: string): ConceptTerm[] {
  const lines = (content ?? readFileSync(join(ROOT, CONCEPTS_FILE), "utf8")).split("\n");
  const terms: ConceptTerm[] = [];
  let columns: (string | null)[] | null = null;

  for (const [index, line] of lines.entries()) {
    if (!line.trimStart().startsWith("|")) {
      // 标题结束一张表:下一张表要重新认表头,不能沿用上一张的列。
      if (line.startsWith("#")) columns = null;
      continue;
    }
    const cells = tableCells(line);
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    if (!columns) {
      columns = cells.map((head) => (NAME_COLUMNS.has(head) ? head : null));
      continue;
    }

    const writings: string[] = [];
    const deprecated: string[] = [];
    let preferred: string | undefined;
    for (const [column, kind] of columns.entries()) {
      const cell = cells[column];
      if (!kind || !cell || cell === "—" || cell === "-") continue;
      const parts = cell.split(/\s*\/\s*/).filter(Boolean);
      const bold = parts.filter((part) => part.trim().startsWith("**"));
      for (const part of parts) {
        const writing = cleanWriting(part);
        if (!writing) continue;
        writings.push(writing);
        // 表头声明「代码标识与标准术语不同时,英文列把代码标识放在括号里」——
        // 括号里那个是独立的一种写法,正文用它同样算这个词有人在用。
        const parenthesized = writing.match(/^(.+?)\s*\((.+)\)$/);
        if (parenthesized) writings.push(parenthesized[1].trim(), parenthesized[2].trim());
        // 一格里并列多个写法、其中恰好一个加粗 = 这是同义词组,粗体那个是首选。
        // 没有粗体的多写法格(报告组件表把七个组件挤在一行)不是同义词,不产生裁决。
        if (parts.length > 1 && bold.length === 1) {
          if (part === bold[0]) preferred = writing;
          else deprecated.push(writing);
        }
      }
    }
    if (writings.length > 0) terms.push({ line: index + 1, writings, preferred, deprecated });
  }
  return terms;
}

/**
 * 把概念表的首选裁决翻译成禁词条目——术语只在概念表里裁决一次,
 * `writing-rules.json` 不再手抄一份同义词对照,两处不会各说各话。
 */
export function synonymBans(terms: ConceptTerm[]): BannedTerm[] {
  return terms.flatMap((term) =>
    term.preferred
      ? term.deprecated.map((writing) => ({
          term: writing,
          use: `「${term.preferred}」`,
          why: `${CONCEPTS_FILE} 的术语总表把「${term.preferred}」定为首选写法(第 ${term.line} 行)`,
          // 概念表自己要并列列出同义词,不算命中。
          exempt: [CONCEPTS_FILE],
        }))
      : [],
  );
}

/** 正文语料:判一个词有没有人用。概念表自己不算——它只负责立词。 */
function usageCorpus(): string {
  return USAGE_DIRS.flatMap((dir) => walkDocs(dir, [".md", ".mdx"]))
    .filter((file) => file !== CONCEPTS_FILE)
    .map((file) => readFileSync(join(ROOT, file), "utf8"))
    .join("\n");
}

/** 判「图里这个词有没有出处」的语料:正文加概念表——在概念表立过的词就是有出处。 */
function termCorpus(): string {
  return USAGE_DIRS.flatMap((dir) => walkDocs(dir, [".md", ".mdx"]))
    .map((file) => readFileSync(join(ROOT, file), "utf8"))
    .join("\n");
}

/** 立了词、正文一次没用过:要么删掉这一行,要么正文该有人用它。 */
export function deadConceptTerms(terms: ConceptTerm[]): string[] {
  const corpus = usageCorpus();
  return terms
    .filter((term) => !term.writings.some((writing) => corpus.includes(writing)))
    .map((term) => term.writings.join(" / "))
    .sort();
}

function walkDocs(dir: string, extensions: string[] = [".md"]): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return walkDocs(rel, extensions);
    return extensions.some((ext) => name.endsWith(ext)) ? [rel] : [];
  });
}

/** 行内代码与代码块里的同名标识符不算命中:`钩子` 可能正是某个字段或输出示例。 */
function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, "");
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

/** 手写禁词 + 概念表首选裁决自动生成的那批,正文与图共用同一份。 */
function bannedMatchers(rules: WritingRules): Array<BannedTerm & { re: RegExp }> {
  return [...rules.bannedTerms, ...synonymBans(parseConcepts())].map((t) => ({
    ...t,
    re: termMatcher(t.term),
  }));
}

export function lintDocsWriting(): LintReport {
  const rules: WritingRules = JSON.parse(readFileSync(join(ROOT, RULES_FILE), "utf8"));
  const baseline: Baseline = JSON.parse(readFileSync(join(ROOT, BASELINE_FILE), "utf8"));
  const concepts = parseConcepts();
  const matchers = bannedMatchers(rules);

  const hits: Hit[] = [];
  const deadTerms = deadConceptTerms(concepts);
  const actual: Baseline = {
    sentenceLength: {},
    paragraphLength: {},
    bannedTerms: {},
    deadTerms,
  };
  const count = (rule: LengthRule, file: string) => {
    actual[rule][file] = (actual[rule][file] ?? 0) + 1;
  };

  for (const file of walkDocs("docs")) {
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

  const regressionFiles = [...new Set(regressions.map((r) => r.split(":")[0]))];

  // 死词按词判,不按数量判:台账里没有的死词就是新死的,哪怕总数没变。
  const known = new Set(baseline.deadTerms ?? []);
  for (const term of deadTerms) {
    if (!known.has(term)) {
      regressions.push(
        `${CONCEPTS_FILE}: 「${term}」立了词但 docs/ 与 docs-site/ 正文一次没用过——删掉这一行,或者正文该改用它`,
      );
    }
  }

  return { hits, actual, regressions, regressionFiles, deadTerms };
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
    const [, tag, attributes, inner] = match;
    const classes = (/class="([^"]*)"/.exec(attributes)?.[1] ?? "").split(/\s+/).filter(Boolean);
    const text = inner
      // 不带定位的 tspan 只是同一行里换个颜色,直接拼:「已<tspan>受理</tspan>」是一个词,
      // 中间塞个空格两个半截都不成词,查不到出处就成了假命中。带 x / dy 的 tspan 是
      // 另起一行或移位,那才是词的边界。
      .replace(/<tspan\b(?![^>]*\s(?:x|y|dx|dy)=)[^>]*>|<\/tspan>/g, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => XML_ENTITIES[e])
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
 * 图里的用语检查。两条,都不设台账——图是新的,一次命中都不许有:
 *
 * 1. **不立新词。** `.label` 里的每个中文词都要在 `docs/` 或 `docs-site/` 正文
 *    (含概念表)里出现过。图最容易长出只此一处的自造词:画的人为了摆得下
 *    造个简称,读的人在正文里查不到它,而正文与图从此各说各话。
 * 2. **禁用写法照样管。** 正文那份禁词库与概念表的首选裁决,对图里的每个字同样生效。
 */
export function lintSvgTerms(): Hit[] {
  const rules: WritingRules = JSON.parse(readFileSync(join(ROOT, RULES_FILE), "utf8"));
  const matchers = bannedMatchers(rules);
  const corpus = termCorpus();
  const hits: Hit[] = [];

  for (const file of walkDocs("docs", [".svg"])) {
    for (const node of svgTexts(readFileSync(join(ROOT, file), "utf8"))) {
      for (const term of matchers) {
        if (countTermHits(node.text, term.re, term.allowIn) === 0) continue;
        hits.push({
          file,
          line: node.line,
          rule: term.term,
          message: `图里的禁用写法「${term.term}」——改用${term.use};${term.why}`,
        });
      }
      if (!node.classes.includes(TERM_SLOT)) continue;
      for (const run of node.text.match(HAN_RUN) ?? []) {
        if (corpus.includes(run)) continue;
        hits.push({
          file,
          line: node.line,
          rule: "svgTerm",
          message:
            `图里的「${run}」在 docs/ 与 docs-site/ 正文里一次没出现——` +
            `图不立新词:改用正文已有的说法,或者这个词该先在正文里立起来`,
        });
      }
    }
  }
  return hits;
}

/**
 * 回归的详报:哪一行、超了多少、禁词该改用什么。只打回归文件里的命中——
 * 台账里的旧命中不是这次要改的,混进来会把该改的那几行淹掉。
 */
export function formatRegressionHits(report: LintReport): string {
  if (report.regressions.length === 0) return "";
  const files = new Set(report.regressionFiles);
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
    sentenceLength: sortKeys(actual.sentenceLength),
    paragraphLength: sortKeys(actual.paragraphLength),
    bannedTerms: sortKeys(
      Object.fromEntries(Object.entries(actual.bannedTerms).map(([f, t]) => [f, sortKeys(t)])),
    ),
    deadTerms: [...actual.deadTerms].sort(),
  };
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
