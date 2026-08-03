# E2E 验收 DSL —— Architecture

本篇定义公开媒介怎样进入领域读面、`Observed<T>` 怎样携带证据，以及 matcher 怎样产生可归因的 Outcome Assertion。
Behavior、Recipe、World 与调度归 [NiceEval 测试体系重构](../e2e-acceptance-testing/architecture.md)。

## 模块边界

```text
真实公开入口
  │
  ├── process result ──▶ process adapter ─┐
  ├── stdout / PTY ────▶ report adapter ──┤
  ├── JSON / JUnit ────▶ machine adapter ─┼──▶ Domain View ──▶ Observed<T> ──▶ Matcher
  ├── static HTML ─────▶ html adapter ────┤
  └── Chromium page ───▶ browser adapter ─┘

World reader ──提供候选身份、路径、locator 与 target───────────────┘
```

DSL 分成五组模块：

- process adapter 执行真实子进程，保存 argv、cwd、流、exit 和 signal。
- medium adapter 解析一种公开媒介，不跨媒介猜测缺失事实。
- domain view 用 Report、Attempt、Table、Chart、Target 等公开身份寻址。
- `Observed<T>` 把值、来源、提取路径和对象身份绑定为一个不可伪造观察。
- matcher 比较独立预期并产出带证据的 Outcome Assertion。

## 通用内核与产品 dialect

浏览器验收不在“全通用”与“全部 NiceEval 专用”之间二选一。DSL 分成三层：

| 层 | 可以通用的能力 | 不拥有 |
|---|---|---|
| acceptance kernel | BrowserContext / Page 生命周期、web-first 等待、ActionTrace、Observed、截图、网络与 console evidence、失败阶段 | Attempt、SourceView、`t.send`、AssertionResult |
| medium adapter protocol | 可访问语义寻址、展开 / 关闭 / hover 等动作协议、HTML 与 browser evidence 接口 | 产品对象身份与预期 |
| NiceEval dialect | Report、Attempt、source drive / assertion 调用、返回 Turn / AssertionResult、Conversation、tool identity | CSS selector、DOM class、固定 sleep |

Behavior 只调用 NiceEval dialect。dialect 内部把 `drive.expand()` 翻译成 kernel 的浏览器点击并记录 action；测试正文
不调用 `click(selector)`。组件从 `<details>` 换成 button 时只改 adapter，用户 Behavior 不改。

通用库只抽前两层，而且必须等至少两个自治验收仓库出现相同协议后再发布。NiceEval dialect 留在 report E2E
支持包；不能为了复用把 `t.send` 或 Attempt 并入中立内核，也不能为了中立让场景退化为 DOM 操作脚本。

## World reader

World reader 只消费测试方案发布的 manifest：

```ts
interface WorldReader {
  readonly id: string;
  readonly recipeId: string;
  readonly candidateDigest: string;
  readonly resultsRoot: string;
  exportDir(name: string): string;
  artifact(name: string): string;
  consumerDir(name: string): string;
  process(name: string): ProcessResultView;
  locator(name: string): string;
  target(name: string): { pageId: string; key: string };
  clone(name: string): Promise<MutableWorldReader>;
}
```

构造时先校验 Behavior execution binding、recipe identity、candidate digest 和权限。
World reader 不运行 producer，不寻找“最近”的结果根，也不依赖进程全局 cwd。

## Observation 数据模型

`Observed<T>` 的值只由 matcher 读取。测试不能剥掉证据后对失去来源的普通值使用普通 matcher。

```ts
interface EvidenceRef {
  medium:
    | "process-result"
    | "stdout"
    | "pty-screen"
    | "ndjson-events"
    | "json"
    | "junit"
    | "html"
    | "browser-a11y";
  artifact: string;
  digest: string;
  locator?: string;
}

interface ObservationIdentity {
  kind: string;
  value: string;
}

interface ObservationPath {
  root: string;
  segments: readonly string[];
}

declare const observedValue: unique symbol;

interface Observed<T> {
  readonly [observedValue]: T;
  readonly evidence: readonly EvidenceRef[];
  readonly path: ObservationPath;
  readonly identities: readonly ObservationIdentity[];
}
```

`observedValue` 是 adapter 与 matcher 共享的私有 symbol，不从测试支持包导出。测试作者不能直接解包观察值。
关系 matcher 接收多个 `Observed` 时，单个 assertion 同时记录全部 evidence。

观察结果需要成为下一条用户动作的输入时使用 `shellArg(observed)`。
这个桥接器返回可插入 shell literal 的稳定身份，同时把来源 observation 记入 action 轨迹；普通解包 API 不存在。

## Adapter 协议

每种媒介有独立构造函数，不提供自动降级链：

```ts
const process = await cli("pnpm exec niceeval show --json", {
  cwd: w.consumerDir("commonjs"),
  pipe: true,
});
const report = reportView(process.stdout);
const events = ndjsonEvents(process.stdout);
const summary = jsonSummary(readFileSync("summary.json", "utf8"));
const junit = junitReport(readFileSync("junit.xml", "utf8"));
const site = siteExport(w.exportDir("site"));
const document = await targetDoc(w, w.target("failed-attempt"), {
  hosting: "file-url",
});
const browser = await openSite(w.exportDir("site"), {
  hosting: "clean-url-subpath",
});
```

stdout 与 PTY 是两个媒介。stdout adapter 读取语义结构；PTY adapter 读取终态 cell grid、scrollback、raw ANSI、resize 与退出信息。
HTML adapter 使用禁用 JavaScript 的真实 Chromium。Browser adapter 使用启用 JavaScript 的独立 BrowserContext 和 Page。

Adapter 只解析公开输出。它不能 import 候选包的 renderer、schema、计算函数或内部类型来生成观察或预期。

## Domain View

Domain View 只提供公开概念和稳定身份：

```ts
const report = reportView(stdout);
const table = report.table("Experiments");
const row = table.row("main");
const chart = report.chart({ x: "Cost", y: "Pass rate" });
const attempt = report.attempt(w.locator("tool-call"));
```

`section`、`line`、CSS selector、DOM position 和正则属于 adapter 内部实现，不能出现在 Behavior 正文。
找不到身份时列出实际候选和最近似项；不支持的观察直接失败，不回退到字符串包含。

Report 下钻统一使用 `{ pageId, key }`：

```ts
const target = w.target("failed-attempt");
await ui.expectTargetDoc(target);
await ui.targetLink(target).click();
await expect(ui.dialog()).toBeVisible();
```

attempt、experiment 与自定义参数化页不产生平行 API。DSL 只观察一个已声明 target；全量 target census 和代表矩阵归测试方案。

## Matcher 与失败传播

Matcher 分三类：

- 值 matcher：`toEqualValue()` 比较独立常量。
- 集合 matcher：`toShowRows()` 忽略非契约额外项，`toShowExactRows()` 比较完整有序集合。
- 关系 matcher：`toEqualObserved()` 比较两个媒介提取的显式值并保留两侧证据。

逐字 golden 只用于公开承诺的短文本。JSON、JUnit、Report 页面和终端大面按结构比较。

失败类型固定为：

```ts
type ObservationFailure =
  | { kind: "world-identity"; expected: string; actual: string }
  | { kind: "unsupported-observation"; medium: string; operation: string }
  | { kind: "parse"; medium: string; evidence: EvidenceRef; detail: string }
  | { kind: "identity-not-found"; requested: string; candidates: readonly string[] }
  | { kind: "assertion"; path: ObservationPath; expected: unknown; actual: unknown };
```

每个领域动作追加步骤轨迹。浏览器等待使用 web-first assertion 或等待具体状态，不使用固定 sleep。

## 自治与自测

DSL 实现签入所属 E2E 仓库，不发布公共包，也不从根仓注入运行时代码。两个自治消费者出现相同且稳定的实现需求后，才评审共享包。

每个 adapter 必须自测：

- 合法公开输出产生正确身份与路径；
- malformed 输出显式 parse failure；
- 缺失身份列出候选；
- unsupported observation 不降级；
- read-only world 越权失败；
- parser 与 matcher 的非契约扰动不会改变 Outcome。

完整测试文件见 [Use Cases](use-case/README.md)。
