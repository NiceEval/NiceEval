// 数据集与判据文件加载器:结构化数据读成 YAML / JSON,配 .map(row => defineEval(...)) 扇出;
// 非结构化的判据文件读成原文;一整棵判据树只登记不读入(loadCriteria,流式哈希)。
// 经这里读入或登记的文件都进读它那条 eval 的指纹。
// 单文件路径两种写法等价:项目根相对字符串,或 eval 文件相对的 `file:` URL。
// glob 不能塞进 URL(`?` 会变 query、`{}` 会编码),所以相对 glob 把 pattern 与基准 URL 分开传。
// 登记只在发现期的模块求值里成立,所以 capture 不在场时直接报错,不静默漏登记。

import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../i18n/index.ts";
import { compilePatterns, enumerationBases, includedByPatterns, unmatchedIncludes, type CompiledPattern } from "./glob.ts";

/**
 * 一次发现期求值的登记表:
 * - data:读入即登记的数据文件(内容已在内存)
 * - criteria:只登记不读入的判据树(verifier)
 * - private:只登记不读入、永不上传的隐藏文件
 * 三格分开是因为指纹与泄题门口径不同。
 */
interface LoaderCapture {
  readonly data: Set<string>;
  readonly criteria: Set<string>;
  readonly private: Set<string>;
  /** Source module -> registrations made while that module was evaluated. */
  readonly origins: Map<string, LoaderCaptureBuckets>;
  /** No usable caller frame: discovery conservatively attributes these to all entries. */
  readonly unattributed: LoaderCaptureBuckets;
}

interface LoaderCaptureBuckets {
  readonly data: Set<string>;
  readonly criteria: Set<string>;
  readonly private: Set<string>;
}

type LoaderCaptureBucketName = "data" | "criteria" | "private";

/**
 * Internal discovery provenance. A shared helper is evaluated only once in a
 * fresh module graph, so discovery uses its source module to copy these paths
 * to every Eval entry that statically imports that helper.
 */
export interface LoaderCaptureOrigin {
  readonly sourcePath: string;
  readonly paths: readonly string[];
  readonly criteriaPaths: readonly string[];
  readonly privatePaths: readonly string[];
}

export interface LoaderCapturePaths {
  readonly paths: readonly string[];
  readonly criteriaPaths: readonly string[];
  readonly privatePaths: readonly string[];
}

let activeCapture: LoaderCapture | undefined;

/**
 * 发现期包住一个 eval 模块的求值，记录它经公开 loader 读取的数据文件（`paths`）、
 * 经 `loadCriteria` 登记的判据树（`criteriaPaths`）、经 `loadPrivate` 登记的永不上传路径
 * （`privatePaths`）。三格分开是因为指纹与泄题门口径不同:
 * data 哈希已读进内存的内容;criteria / private 按内容流式哈希,且 private 另进泄题门。
 */
export async function captureLoadedFiles<T>(
  load: () => Promise<T>,
): Promise<{
  value: T;
  paths: string[];
  criteriaPaths: string[];
  privatePaths: string[];
  origins: readonly LoaderCaptureOrigin[];
  unattributed: LoaderCapturePaths;
}> {
  const previous = activeCapture;
  const capture: LoaderCapture = {
    data: new Set<string>(),
    criteria: new Set<string>(),
    private: new Set<string>(),
    origins: new Map<string, LoaderCaptureBuckets>(),
    unattributed: newBuckets(),
  };
  activeCapture = capture;
  try {
    const value = await load();
    return {
      value,
      paths: [...capture.data].sort(),
      criteriaPaths: [...capture.criteria].sort(),
      privatePaths: [...capture.private].sort(),
      origins: Object.freeze([...capture.origins.entries()]
        .map(([sourcePath, buckets]) => Object.freeze({
          sourcePath,
          paths: Object.freeze([...buckets.data].sort()),
          criteriaPaths: Object.freeze([...buckets.criteria].sort()),
          privatePaths: Object.freeze([...buckets.private].sort()),
        }))
        .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))),
      unattributed: Object.freeze({
        paths: Object.freeze([...capture.unattributed.data].sort()),
        criteriaPaths: Object.freeze([...capture.unattributed.criteria].sort()),
        privatePaths: Object.freeze([...capture.unattributed.private].sort()),
      }),
    };
  } finally {
    activeCapture = previous;
  }
}

function newBuckets(): LoaderCaptureBuckets {
  return {
    data: new Set<string>(),
    criteria: new Set<string>(),
    private: new Set<string>(),
  };
}

/** Best-effort source ownership for a public loader call, without exposing it as an API. */
function loaderCallerPath(): string | undefined {
  const stack = new Error().stack;
  if (stack === undefined) return undefined;
  const self = resolve(fileURLToPath(import.meta.url));
  for (const line of stack.split("\n").slice(1)) {
    const match = line.match(/(?:file:\/\/)?(\/.*?):\d+:\d+/);
    if (match?.[1] === undefined) continue;
    let candidate: string;
    try {
      candidate = line.includes("file://") ? fileURLToPath(`file://${match[1]}`) : match[1];
    } catch {
      continue;
    }
    const absolute = resolve(candidate);
    if (absolute !== self) return absolute;
  }
  return undefined;
}

function registerCapturePath(bucket: LoaderCaptureBucketName, absolute: string): void {
  const capture = activeCapture;
  if (capture === undefined) return;
  capture[bucket].add(absolute);
  const caller = loaderCallerPath();
  if (caller === undefined) {
    capture.unattributed[bucket].add(absolute);
    return;
  }
  const buckets = capture.origins.get(caller) ?? newBuckets();
  capture.origins.set(caller, buckets);
  buckets[bucket].add(absolute);
}

// 两种入参在这里归一成一个绝对路径,登记与指纹因此天然等价:字符串按项目根(进程 cwd)解析,
// URL 只认 `file:`。fileURLToPath 是 niceeval 内部实现,用户侧写 `new URL(p, import.meta.url)`
// 就够,不需要 import node:url。
function resolvedPath(path: string | URL): string {
  const absolute = typeof path === "string" ? resolve(process.cwd(), path) : fromFileUrl(path);
  if (!activeCapture) throw new Error(t("loaders.outsideDiscovery", { path: String(path) }));
  registerCapturePath("data", absolute);
  return absolute;
}

function fromFileUrl(url: URL): string {
  if (url.protocol !== "file:") throw new Error(t("loaders.nonFileUrl", { url: url.href, protocol: url.protocol }));
  return fileURLToPath(url);
}

/**
 * 读入一个 JSON 数据文件并解析。路径写项目根相对的字符串,或 eval 文件相对的
 * `new URL(p, import.meta.url)`。内容哈希进读它的那条 eval 的指纹。`decode` 必须在
 * 这个动态输入边界完成结构验证与归一；不提供「用泛型直接信任文件」的入口。
 */
type DecodedData<T> = unknown extends T ? never : T;

/**
 * 动态文件值到领域值的唯一出口。`unknown`（以及会把它吞掉的 `any`）不能成为解码结果；
 * decoder 必须返回一个比动态输入更窄、可供 Eval 定义直接使用的领域类型。
 */
export type DataDecoder<T> = (value: unknown) => DecodedData<T> | Promise<DecodedData<T>>;

export async function loadJson<T>(path: string | URL, decode: DataDecoder<T>): Promise<T> {
  const raw = await readFile(resolvedPath(path), "utf-8");
  const parsed: unknown = JSON.parse(raw);
  return decode(parsed);
}

/**
 * 按 utf-8 读入一个文件的原文。判据不是结构化数据时用它:隐藏测试脚本、参考实现、
 * shell 模板都是判据文件。读入即宣告「它参与判定」——文件内容哈希进读它的那条 eval
 * 的指纹,改一字节就重跑那条 eval。用 `fs` 自行读入的文件不进指纹。
 * 路径写项目根相对的字符串,或 eval 文件相对的 `new URL(p, import.meta.url)`。
 */
export async function loadText(path: string | URL): Promise<string> {
  return readFile(resolvedPath(path), "utf-8");
}

/** eval 文件相对的 glob；pattern 与 URL 分开，避免 URL parser 改写 glob 字符。 */
export interface RelativeCriteriaPattern {
  readonly pattern: string;
  readonly relativeTo: URL;
}

export type CriteriaPattern = string | RelativeCriteriaPattern;

/**
 * 登记一棵判据树进这条 eval 的指纹,不把内容读进内存。判分标准是一整棵树(隐藏测试目录、
 * 参考实现、跑测脚本)、内容只经 `t.sandbox.uploadDirectory` 整体送进沙箱时用它:
 * 发现期展开 glob、把每个匹配文件流式哈希进指纹,返回排序后的项目根相对路径清单。
 * 树里改一字节、增一个文件、删一个文件,都作废引用这棵树的那条 eval;权限位与修改时间不进哈希,
 * 重新 clone 一份工作树不作废。单个文件、且内容要写进沙箱时用 `loadText`。
 *
 * pattern 是项目根相对的 glob(`**` 跨层、`*` / `?` 段内、`[...]` 字符类、`{a,b}` 分支),
 * `!` 前缀为排除;按声明顺序求值,后写的覆盖先写的。匹配集按文件系统枚举、不看 git:
 * 新写的判据没 `git add` 也照样进指纹,代价是本地跑测冒出的生成物同样被盖到,用 `!` 排除。
 *
 * 只能在 eval 文件的模块顶层调用(发现期求值那一刻),`test(t)` 运行期调用直接报错——
 * 携带决策发生在任何 attempt 执行之前,那时才登记已经来不及。
 *
 * 两种用法错误直接抛:某个 include pattern 一个文件都没匹配到(或命中的都被 `!` 排除了)——
 * 多半是写错了或文件搬走了,别的 pattern 有命中也不放过,静默放过等于判据悄悄变窄;
 * 以及匹配落到项目根外(符号链接穿出根)。`!` 排除 pattern 不受「必须有命中」这条约束。
 *
 * @param patterns 项目根相对 glob,或 `{ pattern, relativeTo: import.meta.url }`;`!` 排除只收字符串。
 * @returns 匹配集的项目根相对路径,排序后(正斜杠分隔),不含内容。
 */
export async function loadCriteria(...patterns: CriteriaPattern[]): Promise<string[]> {
  if (!activeCapture) {
    const path = patterns
      .map((pattern) =>
        typeof pattern === "string" ? pattern : `${pattern.pattern} relative to ${pattern.relativeTo.href}`,
      )
      .join(" ");
    throw new Error(t("loaders.outsideDiscovery", { path }));
  }
  return registerGlobPatterns(patterns.map(normalizeCriteriaPattern), "criteria");
}

function normalizeCriteriaPattern(pattern: CriteriaPattern): string {
  if (typeof pattern === "string") return pattern;
  if (pattern.pattern.startsWith("!")) {
    throw new Error(
      "loadCriteria exclusions must be project-root-relative strings; " +
        "put the relative include in { pattern, relativeTo } and pass the exclusion separately",
    );
  }
  const baseDir = dirname(fromFileUrl(pattern.relativeTo));
  return relative(process.cwd(), resolve(baseDir, pattern.pattern)).split(sep).join("/");
}

/**
 * 登记永不上传的 private 路径进这条 eval 的判据指纹与泄题门,不把内容读进内存。
 * solution、生成器、参考答案必须与 eval 共址时用它:发现期与全部 build context /
 * bind mount 交叉检查,任何阶段都不得进入 Agent 可见面(见 docs/feature/sandbox/case.md「泄题门」)。
 *
 * pattern 语法、发现期约束、空匹配与穿出项目根的报错与 `loadCriteria` 同形。
 *
 * @param patterns 一个或多个项目根相对 glob,`!` 前缀为排除。
 * @returns 匹配集的项目根相对路径,排序后(正斜杠分隔),不含内容。
 */
export async function loadPrivate(...patterns: string[]): Promise<string[]> {
  return registerGlobPatterns(patterns, "private");
}

async function registerGlobPatterns(
  patterns: string[],
  bucket: "criteria" | "private",
): Promise<string[]> {
  const capture = activeCapture;
  if (!capture) throw new Error(t("loaders.outsideDiscovery", { path: patterns.join(" ") }));
  const root = process.cwd();
  const compiled = compilePatterns(patterns);
  const matched = new Set<string>();
  for (const base of enumerationBases(compiled)) {
    await collectCriteria(root, base, compiled, matched);
  }
  const relativePaths = [...matched].sort();
  // 逐条 include pattern 判空,不是整次调用判空:三条 pattern 里搬走了一条对应的文件时,
  // 别的两条有命中会让整体放行,判据悄悄变窄——正是「该重跑的没重跑」那个方向。
  const missing = unmatchedIncludes(compiled, relativePaths);
  if (missing.length > 0) {
    const key = bucket === "private" ? "loaders.privateNoMatch" : "loaders.criteriaNoMatch";
    throw new Error(t(key, { patterns: missing.join(" "), root }));
  }
  for (const path of relativePaths) registerCapturePath(bucket, resolve(root, path));
  return relativePaths;
}

/** 从一个枚举起点往下走,把命中 pattern 集的文件按项目根相对路径收进 out。 */
async function collectCriteria(root: string, base: string, compiled: readonly CompiledPattern[], out: Set<string>): Promise<void> {
  // pattern 自己就指到根外(`../`、绝对路径)时在起点上先报,不用等枚举。
  await assertInsideRoot(root, resolve(root, base), base || ".");
  // 符号链接可以指回树内,realpath 去重防环。
  const visited = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    const real = await realpath(dir).catch(() => undefined);
    if (real === undefined || visited.has(real)) return;
    visited.add(real);
    // 起点不存在 / 不是目录时不在这里报:交给「匹配集为空」统一给下一步。
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
    if (entries === undefined) return;
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        const target = await stat(absolute).catch(() => undefined);
        if (target === undefined) continue; // 断链按不存在处理
        isDirectory = target.isDirectory();
        isFile = target.isFile();
      }
      if (isDirectory) {
        await walk(absolute);
        continue;
      }
      if (!isFile) continue;
      const relativePath = relative(root, absolute).split(sep).join("/");
      if (!includedByPatterns(relativePath, compiled)) continue;
      await assertInsideRoot(root, absolute, relativePath);
      out.add(relativePath);
    }
  };
  await walk(resolve(root, base));
}

async function assertInsideRoot(root: string, absolute: string, shown: string): Promise<void> {
  const real = await realpath(absolute).catch(() => absolute);
  if (real !== root && !real.startsWith(`${root}${sep}`)) {
    throw new Error(t("loaders.criteriaOutsideRoot", { path: shown, resolved: real, root }));
  }
}

/**
 * 读入一个 YAML 数据文件并解析,需要项目里装了 `yaml`。路径写项目根相对的字符串,
 * 或 eval 文件相对的 `new URL(p, import.meta.url)`。内容哈希进读它的那条 eval 的指纹。解析结果与
 * JSON 一样必须立即经 `decode` 验证，不让未证明的动态值进入 Eval 定义。
 */
export async function loadYaml<T>(path: string | URL, decode: DataDecoder<T>): Promise<T> {
  const raw = await readFile(resolvedPath(path), "utf-8");
  // yaml 是可选依赖:用变量 specifier 避免 tsc 静态解析。装了就用真解析器;
  // 没装直接报错并给出下一步 —— 不再退回手写的「极简 YAML」:它对嵌套 / 多行 /
  // 锚点会静默解析出错误数据,让 eval 拿着错的 case 跑起来比直接失败更糟。
  const yamlPkg = "yaml";
  let parse: (s: string) => unknown;
  try {
    ({ parse } = (await import(yamlPkg)) as { parse(s: string): unknown });
  } catch {
    throw new Error(t("loaders.yamlMissing", { path: String(path) }));
  }
  return decode(parse(raw));
}
