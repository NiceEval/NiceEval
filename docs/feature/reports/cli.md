# Reports CLI

`show` 是单目标读取命令；`view` 与 `view --out` 是全站 SSG 命令。三者先以相同 selector 形成固定 Sample，但不会因此拥有
相同的 Page 执行范围。

```text
show / show --json
  selection → fixed Sample → selected Page only → text or target-execution JSON

view / view --out
  selection → fixed Sample → all Page instances → ClosedSiteRevision → serve or write
```

## 共同选择项

```sh
niceeval show [selection] [report options]
niceeval view [selection] [report options]
niceeval view [selection] [report options] --out <directory>
```

| 选项 | 含义 |
|---|---|
| `--record <root>` | 选择实际 Record root；省略时使用 `<cwd>/.niceeval/record`。 |
| `@<locator>` | 精确选择一个 immutable Attempt。 |
| `--run <run-id>` | 可重复；精确选择历史 Run。 |
| `--experiment <selector>` | 可重复；使用与 `niceeval exp <selector>` 相同的实验选择规则收窄当前项目；目录 selector 会选择其下全部 Experiments。 |
| `--report <module>` | 选择内建 Report 或受信任的 Report module。 |
| `--page <route>` | `show` 的唯一目标 route，或 `view` 的初始浏览 route。 |
| `--port <port>` | `view` 监听端口；省略时由操作系统分配空闲端口。 |
| `--host <address>` | `view` 监听地址；省略时为 `127.0.0.1`。 |
| `--no-open` | 阻止 `view` 自动打开浏览器。 |
| `--json` | 让 `show` 输出机器文档。 |
| `--out <directory>` | 写入完整静态站，不启动 watcher 或长期 server。 |

不带 locator、`--run` 或 `--experiment` 时，命令按当前项目身份形成 Sample。它选择所有匹配的 published Run，不按时间缩成
一个 Run，也不写回 Record。没有匹配结果仍形成空 Sample；度量用自己的 state、samples、total 与 issues 表示结果。

`--experiment` 不能与 locator 或 `--run` 合用。它沿用 `exp` 的精确 ID、目录与同目录文件名前缀选择规则；例如 `--experiment classic` 选择 `classic/` 下的整组 Experiments。未知 Run、零命中的 Experiment selector、未知 route、参数 route 的非规范 key 和缺少默认 route 都是用法错误。

## `niceeval show`

```sh
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527 --page /overview
niceeval show --experiment compare
niceeval show @1K1P0VJAPVJ12 --page /attempt/1K1P0VJAPVJ12
```

`show` 从 ReportDefinition 选择一个 route。省略 `--page` 时选择定义的默认 route；带 `--page` 时只执行这个精确 route。它打开
Sample 后，只运行该 Page 的 `load`、`render`、组合组件和显示组件，然后生成 terminal text 并关闭 Sample。

普通 Page 不触发其它 Page。参数 Page 按 `decode(key)`、`encode(params)`、`load()`、`render()` 的次序执行；encode 的结果必须与请求
key 完全相同。`show` 不调用 `enumerate()`，却要求 `PageLoadContext` 与每个公开 DomainView 验证该 params 值属于当前 Sample。
不属于 Sample 的 locator、identity 或 key 返回类型化错误，而不是执行其它 Page 寻找成员资格。

`show` 不形成 `ClosedSiteRevision`，不分配全站 route 集，也不产生 revision identity。它只交付这次目标 Page 的关闭 text 或机器文档。
构建阶段的阶段反馈写入 stderr；人读输出写入 stdout。Broken pipe 是正常 CLI 退出，其它失败保持类型化错误。

人读 text 在 Page 关闭时同时保留固定 80 列 plain projection 与本次 stdout 能力对应的 projection。stdout 是 TTY 且终端足够宽时，
`Section` 显示区域框，`Grid` 与 `Table` 显示数据格线；非 TTY 或过窄终端选择 plain projection，组件、数据状态与顺序不变。
`NO_COLOR` 只禁用颜色，不删除表达组件边界的结构框。`show --json` 的 `renderedText` 始终读取固定 80 列 plain projection，不继承 TTY。

`standard` 只遇到一个实验组时，Overview 直接呈现该组的比较结果。遇到多个组时，`show` 默认输出实验索引和可复制的 `niceeval show --experiment <selector>` 命令，不生成跨组 leaderboard，也不引入另一套实验组 CLI 参数。具名组 Page 在唯一 `ExperimentComparisonScope` 内使用 `ExperimentTable` 呈现 Pass Eval 与 Score Eval。Pass Eval 显示通过率，Score Eval 只显示 earned score，不声明满分或百分比；两种题型分面板呈现，不互排。

Pass Eval 只有一个 Attempt 时，Eval 行不重复显示必为 `0%` 或 `100%` 的通过率，Result 直接显示 `passed`、`failed` 或
`errored` 判定。相同 Eval 有多个 Attempt 时，Eval 行显示聚合通过率与判定计票。Experiment 与 Eval group 行始终保留汇总通过率。
Attempt 行的 locator 已携带判定符，Result 不重复同一个状态。

每个 Experiment 可逐层展开到 Eval 与 Attempt，Attempt locator 链接到同一份 `standard` 显式声明的详情 Page。Analysis 的 `MetricValue` 仍完整保留 state、samples、total、issues 与 refs。

同组实验运行的 Eval ID 集合不同时，组 Page 显示具名原因、成员与实际集合，不显示排名或散点。通过制与分数制可以在同组的独立面板中呈现，不因题型不同而进入这个状态。

`ExperimentScatter` 使用同一题型判断：通过制画成本 × 通过率，分数制画成本 × 总分；同一实验比较范围同时包含两种题型时分成两张图，
不把 points 和 ratio 混在同一纵轴。通过率轴以百分比刻度显示，`ratio` 只保留为内部量纲，不进入轴标题或刻度文案。

### locale

CLI 与 Node runtime 的人读文案固定为英语。`show` 和 `show --json` 固定写 `locale: "en"`；没有 CLI locale flag、
`Config.locale`、系统 locale 探测或为读取 locale 而预加载配置。

浏览器站点的 Report chrome 提供 `en` 与 `zh-CN` 切换。它只切换浏览器拥有的词典和已交付的 LocalizedText，不重新打开 Sample、
不调用 Analysis，也不改变机器文档。view 与静态目录携带同一 client 和相同的初始 HTML。

### `niceeval show --json`

`show --json` 与人读 show 执行相同的单目标 Page。stdout 只输出 canonical UTF-8 JSON；进度和诊断仍写入 stderr。它没有第二条
Record 或 Analysis 读取路径。

内建 Report 使用 Host-owned 领域文档：

```ts
interface BuiltInShowDocument {
  readonly format: "niceeval.show";
  readonly locale: "en";
  readonly selection: ShowSelection;
  readonly report: { readonly token: BuiltInReportToken; readonly identity: ContentAddress };
  readonly page: { readonly route: string; readonly pageId: string; readonly title: LocalizedText };
  readonly data:
    | { readonly kind: "groups"; readonly groups: readonly ExperimentGroupSummary[] }
    | {
        readonly kind: "experiment-group";
        readonly group: ExperimentGroupIdentity;
        readonly comparison:
          | { readonly state: "comparable"; readonly members: readonly string[]; readonly rows: JsonValue }
          | { readonly state: "non-comparable"; readonly members: readonly string[]; readonly issues: readonly NonComparableIssue[] };
      }
    | {
        readonly kind: "run-membership";
        readonly summary: JsonValue;
        readonly members: JsonValue;
        readonly errors: JsonValue;
        readonly evidence: JsonValue;
      }
    | { readonly kind: "attempt"; readonly evidence: JsonValue; readonly observability: JsonValue; readonly fileChanges: JsonValue }
    | { readonly kind: "source"; readonly sources: JsonValue }
    | { readonly kind: "execution"; readonly execution: JsonValue }
    | { readonly kind: "timing"; readonly timing: JsonValue };
  readonly projections: ReportProjections;
  readonly problems: readonly ReportProblem[];
}
```

```ts
type ExperimentGroupIdentity =
  | { readonly kind: "named"; readonly groupId: string; readonly key: `named/${string}` }
  | { readonly kind: "singleton"; readonly experimentId: string; readonly key: `singleton/${string}` };

interface ExperimentGroupSummary {
  readonly group: ExperimentGroupIdentity;
  readonly members: readonly string[];
  readonly href: string;
}
```

内建 `data` 是具名闭合领域数据，不从 React、HTML 或 terminal text 推断。它可以随对应 `kind` 拥有上表的精确字段，不能含任意作者
对象或完整站点页面集合。

自定义 Report 使用单目标执行 manifest：

```ts
interface CustomTargetExecutionManifest {
  readonly format: "niceeval.report-target-execution/v1";
  readonly locale: "en";
  readonly selection: ShowSelection;
  readonly report: { readonly identity: ContentAddress; readonly title: LocalizedText };
  readonly page: {
    readonly route: string;
    readonly pageId: string;
    readonly title: LocalizedText;
    readonly renderedText: string;
  };
  readonly downloads: readonly { readonly path: string; readonly mediaType: string; readonly bytes: number }[];
  readonly projections: ReportProjections;
  readonly problems: readonly ReportProblem[];
}
```

`projections` 在内建 v2 与自定义 target-execution v1 中是完全相同的顶层对象。它的 closed Profile、cost entry、target-Page 范围和排除项由
[Report 成本投影 CLI](cost-projections/cli.md) 定义；`report.identity` 标识加载的作者定义，不标识站点版本。

`renderedText` 固定取该 Page 已关闭的英语 text projection，宽度固定为 80 个 display columns。它不读取 TTY 或浏览器宽度，
也不为 JSON 再次运行组件、执行 Analysis 或读取 Record。

`project-current` 的默认 Page 以固定 Sample 中的组数决定关闭数据：恰好一组时产生 `experiment-group`，两组或更多时产生 `groups`。
`--experiment <selector>` 先按 `exp` 的同一规则收窄当前项目；收窄后只有一组时直接产生该组的 `experiment-group`。
一个或多个 `--run` 始终选择 `run-membership` Page；即使这些 Run 只含一个实验组，也不会转成实验比较。

`ShowSelection` 是固定 selector 的机器形状：

```ts
type ShowSelection =
  | { readonly kind: "project-current"; readonly sampleIdentity: ContentAddress; readonly experimentIds: readonly string[] }
  | { readonly kind: "explicit-runs"; readonly sampleIdentity: ContentAddress; readonly runIds: readonly string[] }
  | { readonly kind: "attempt-locator"; readonly sampleIdentity: ContentAddress; readonly locator: string };
```

`selection` 只说明固定 Sample 的选择；`page` 是唯一的 Page 选择，恰好含一个 `route` 与一个 `pageId`。两类机器文档都没有全站
pages 数组或 site identity。

`ContentAddress` 与 `BuiltInReportToken` 都是非空 string。两类机器文档共用下列问题形状：

```ts
interface ReportProblem {
  readonly code: string;
  readonly path: readonly string[];
  readonly refs: readonly string[];
  readonly summary?: string;
}
```

canonical JSON 的规则固定如下：

- object key 按 UTF-8 bytes 升序写入；不写空白；非有限数值拒绝，`-0` 写成 `0`；
- `selection.experimentIds` 与 `selection.runIds` 去重后按 UTF-8 bytes 升序；attempt locator 是单个 canonical 值；
- custom `downloads` 按 `path`、`mediaType`、`bytes` 依次排序；
- 成本 projection 的 canonical 顺序、typed conflict 与非有限值约束由
  [Report 成本投影 CLI](cost-projections/cli.md) 定义；
- `problems` 按 `code`、逐段 `path`、`refs`、`summary` 排序；每个 `refs` 去重后按 UTF-8 bytes 升序，`path` 的段序保留；
- 内建 `data` 是对应具名 producer 给出的关闭领域 JSON。数组不经通用 renderer 排序；每个 producer 必须在写入前按自己领域的 stable identity 固定顺序。

因此相同的固定 Sample、Report、目标 route 与关闭值总是产生相同 JSON bytes。`show --json` 只选择一个 Page，不借全站枚举获得
数组顺序或成员资格；成本 closure 的精确范围由 [Report 成本投影 CLI](cost-projections/cli.md) 定义。

## `niceeval view`

```sh
niceeval view --report ./reports/summary.ts --port 4400
niceeval view --host 192.168.0.199
niceeval view --run 01H... --page /attempt/attempt-01h... --no-open
```

view 在启动 server 前完整构建 `ClosedSiteRevision`。它对每个参数 Page 恰好调用一次 `enumerate(sample)`，执行全体普通 Page 与
枚举实例，并校验全站路径、链接、download、asset、Source、Diff、问题表、`_niceeval/data/projections.json` 与预算。该文件捕获所有
显式声明 Page 的 projection closure；浏览器不重新计算成本。

`--page` 只决定浏览器初始打开的已存在 route；不会缩小构建、枚举或验证。未给 `--page` 且存在实验组 Page 时，view 默认打开稳定排序的第一组；多组 Header 显示原生实验选择器，单组不显示。每个选项导航到已关闭的完整 scoped Overview，因此 Hero、通知、Summary、图表与 Table 使用同一范围。浏览器导航、刷新、Source、Trace、Diff 与下载只读取
revision bytes，不执行作者 callback、Analysis 或 Record 读取。

view 监听 Record root、Report module、项目内静态 import、theme 与配置。最新完整构建成功时原子替换 current revision；失败保留
last-good。相同 Record snapshot 的 watch 信号不会重新执行已缓存 Analysis 查询。每个 HTTP request 在开始时固定一个 revision 引用。

view 默认只监听 `127.0.0.1`。非 loopback 地址没有认证或 TLS；CLI 在 stderr 给出明确警告。HTTP 只服务 `GET` 与 `HEAD`，
其它 method 返回 `405`。

## `niceeval view --out`

```sh
niceeval view --report ./reports/summary.ts --out ./report-site
niceeval view --run 01H... --out ./shared-site --no-open
```

`--out` 不接受 `--page`。它与 view 使用同一完整 SSG 路径，完成全站校验后原样写出 revision 的页面、CSS、reload client、作者 asset、
下载文件与 `_niceeval/data/projections.json`。该 projections 文件包含全体声明 Page 的 closure，bytes 进入 revision identity。目标目录
必须不存在；存在时返回 `report-export-target-exists`，Host 不删除或替换其中的文件。

生成目录不需要 Record、NiceEval 安装或网络。reload client 找不到 view 端点时安静停用；禁用 JavaScript 后，正文、导航、详情、
完整度、问题和下载仍可读。相同 route 的目录页面 body 与 view HTTP body 相同。

## 默认 Report 与错误

| selector | 没有显式 `--report` | 有显式 `--report` |
|---|---|---|
| 不带 selector 的 `project-current` | `niceeval.config.ts` 的 `report`；没有配置时使用 `standard` | 显式 Report |
| 一个或多个 `--run` | `run-membership-overview` | 显式 Report |
| 精确 `@<locator>` | `attempt-overview` | 显式 Report |

| 情况 | 命令结果 |
|---|---|
| `show` 的 Page callback、参数 key 或成员资格失败 | 返回单目标执行错误，不形成 revision。 |
| 全站 Page、枚举、路径、asset 或预算失败 | view 保留 last-good；static 不创建完整目录。 |
| MetricValue 是 partial、empty、unsupported 或 failed | 成功呈现状态、issues 与 refs。 |
| 实验组结构不可比 | 成功呈现 `non-comparable`、成员、原因与 Evidence，不生成排名或散点。 |
| 比较组件收到多组输入 | 返回 `analysis-comparison-group-mismatch`，不降级成 `non-comparable`。 |
| 未知或非规范 route | 用法错误，说明可用 route 或参数格式。 |
| 输出目录已存在 | 返回 `report-export-target-exists`，不改动目录。 |
| 静态写入失败 | 返回 `report-export-write-failed`，不泄露任意系统路径或内部 cause。 |

表中的内建 Report ID 用于选择实现，不作为 Human 标题或列名。默认 `show --run` 使用 Experiment、Eval、
`Attempt #N`、结果、历史 Attempt locator 和 `details:` 命令表达同一事实。

`Membership`、`Slot`、`Relation`、`Selected run`、shared failure ID 与空 Analysis note 只保留在机器文档或
明确的高级诊断面。

## 相关阅读

- [Report Library](library.md)：作者 API、Page、组件与 export manifest。
- [Architecture](architecture.md)：单目标路径、全站 SSG、缓存与 revision 发布。
- [分享静态报告站](use-case/分享静态报告站.md)：团队分享的离线路径。
- [制作可访问页面](use-case/制作可访问页面.md)：text、Web 与无 JavaScript 阅读。
