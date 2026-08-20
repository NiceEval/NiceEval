# 功能域 · Reports 公开读面

本域验证安装后的候选包完成 `exp → show / view / export` Journey。Record 目录是 CLI 产生的 opaque 产品资产；测试不 import
Record reader / writer，不扫描物理布局，也不复制 selection、decoder、Analysis 或 Report Host 作为第二套真相。

它由 `e2e/report/` 承担，manifest repo ID 是 `report`。Repo 用小而稳定的真实 Experiment fixture 产生本轮结果，
再只通过 CLI、HTTP、浏览器、导出的站点文件与 `niceeval/report` 作者 DSL 观察。

## 公开验收计划

### 1. 真实运行与公开选择

- `exp` 完成后取得公开 receipt / locator；测试不把目录项当成功收据。
- 不带 locator 或 `--run` 的 `show` 读取全部 project-current 结果；`show --run` 与精确 Attempt locator 读取具名历史事实。
- 当前身份变化后，旧结果从不带选择项的 `show` 消失，但仍能通过完整 Run ID 读取。
- 未完成、损坏或需要迁移的 Record 只有在 CLI 能稳定制造并返回公开诊断时才自动化。
- 机器调用方用 `show --json` 读回，不直接打开 `.niceeval/` 文件。

### 2. Report 作者面

- 自定义 Report 只从 `niceeval/report` 导入 `defineReport`、`defineComponent`、中立组件、`aggregate()`、
  具名投影与必要的纯值类型。作者用标准 React JSX，不设置专属 JSX 入口或通用 semantic author model。
- fixture 不使用或假造 public `Download`；当前作者 manifest 明确不发布 generic Download API。
- 作者不能 import `niceeval/record`、`niceeval/report/host` 或 host/node。作者也看不到 reader、root、Effect Scope、Effect、
  path、raw family value、owner lookup 或查询执行器。
- Page 与组件只拿 Host-issued Sample。组合组件通过 `ctx.scope` 调用 `aggregate()`，再与具名投影的 ClosedRows、领域视图和
  完整 `MetricValue` 组合；它们不能读取或构造持久事实。
- Page 与组件可以产生受支持 JSX/React element。公开观察只来自关闭后的交付内容，不能来自浏览器的作者 callback。
- 双面 `defineComponent()` 在 Page 执行时最多调用一次 `resolve()` 取得关闭输入；同步的 `text()` 与 `web()` 只消费这一个值。
- `head` 声明结构化 `meta`、`link`、`style` 与 `script`。本地 asset、内联 script bytes 与属性进入站点闭包；脚本不能成为
  正文、导航、Evidence 或机器文档的唯一入口。
- 参数化 Page 必须定义 `params.encode`、`params.decode`、`params.enumerate`、load 和 render。详情 route 来自同一规范 key。

### 3. `show` 的单目标 oracle

报告 fixture 固定为两个 sealed Run、五个 logical Slot、一个 partial `MetricValue`、一个参数化详情 Page、一个 Source Page 和
一个 Diff Page。每个可读 Page 使用独特、可见的文本 marker；fixture 小到可以稳定重跑，却保留完整度与成员资格边界。

每个 `show` case 只选择一个 route，并只观察该目标的公开结果：

- 普通 Page 的 `show` 只执行这个 Page；参数 Page 按 `decode()`、canonical `encode()`、`load()`、`render()` 读取给定 key。
- 参数化 `show` 不调用 `enumerate()`。不属于当前 Sample 的 locator、identity 或 key 以类型化错误结束，而不是通过其它 Page 查找成员。
- 自定义 `show --json` 只断言 target-execution manifest 的 format、选中 route、标题、rendered text、空下载摘要与问题表。
  它没有 revision identity、全路由集合或其它 Page 的作者数据。
- 内建 `show --json` 只断言选中 Page 的 Host-owned 领域文档。它不从 text、HTML 或一个通用作者树推断机器数据。

`show --json` 不是全站 route 或 revision oracle。这个 oracle 只断言公开 text 或单目标 JSON，不读 Host 内存、调用次数、私有
cache key 或 `ResolvedPage`。

### 4. view 与 static 的完整 revision 与字节 oracle

用同一个 selector 与同一个 Report 分别运行：

```text
niceeval view --report <fixture> --out <directory>
niceeval view --report <fixture> --no-open
```

测试以 fixture 的字面 route 集请求 view，再读取导出目录中对应的页面文件。完整构建必须枚举全部普通 Page 和参数 Page 实例；
每对 response body 与文件 body 必须逐字节相同；固定 Host asset 也必须来自同一 revision。下载字节合同仍属于产品契约，但这个
不发布 public Download 的代表 fixture 不为它伪造作者入口。

浏览器默认进入稳定排序的第一个实验组 Page；多组 Header 实验 selector 始终有当前值，语言也由原生 selector 切换。完整 Page router
作为一组居中，不能因当前只有一个 Page 就退化成左右栏布局。切换实验后，Hero、告警、Summary、图表与 Table 都只反映所选组。
浏览器在断网且禁用 JavaScript 时打开根页、参数页、Source 和 Diff，仍能通过 fallback 链接读取 marker、正文、导航、完整度、问题。
测试拦截外部网络请求；任何为补读 Analysis、Source 详情或页面数据发出的请求都是失败。

### 5. view 的版本 oracle

`report-config-reload` 使用带可见 revision marker 的受控 Report fixture。它只通过文件修改、HTTP 和浏览器观察下列结果：

- 一个完整成功 rebuild 才替换浏览器可见的 revision marker 与所有 route 内容。
- 构建失败后，所有 HTTP route 仍返回 last-good 的 bytes；Host 通过
  `x-niceeval-last-rebuild-problem: 1` header 暴露有界 rebuild 问题，正文不插入状态。
- 两个连续 intent 的 fixture 使较早 candidate 在较晚 candidate 后结束时，浏览器只见最后一个完整成功 marker。
- 请求开始于 revision A、发布 revision B 后完成时，响应全部是 A 或全部是 B 的公开 bytes，绝不混合两版内容。
- 刷新可取得已发布新版本，却不会触发新的作者数据读取或客户端 Analysis 请求。

并发 case 使用确定性、用户可见的 Report fixture 控制候选完成次序。测试不以固定 sleep、私有 watcher 状态或模块 cache
断言代替这些 HTTP 结果。

### 6. 构建失败与数据状态

- `MetricValue` 的 partial、empty、unsupported 和 failed 是可呈现的数据状态。它们在 Page text、view 和 static
  中保留相同的 samples、total、issues 与 refs；内建 JSON 依其具名领域 format 保留这些值。
- `show` 的目标 Page callback、参数 key 或成员资格失败时，命令返回单目标错误且从不交付 revision。
- 参数枚举、未选中 Page、路径或全站校验失败时，static 不写完整站点，view 保留 last-good；这些错误不扩大
  `show` 的执行范围。
- `view --out` 的目标已存在时失败且不替换既有目录。
- 浏览器不需要源 Record、网络或 NiceEval 安装；导出目录不泄漏 Record path 或内部文件布局。

## 功能命题与既有 owner

不按 Report 内部模块、组件文件或 renderer 类别建立 E2E。自动化产品测试处于重置期：本表只重定既有 owner 的观察，
不新增、恢复或拆分 owner；没有 `report-author-compat`、`report-json-v2` 或像素快照等新 owner。

| 功能命题 | 接管的既有 owner | 保留的公开观察 |
|---|---|---|
| 标准 React JSX 作者源码以固定 Sample 构建完整站点。 | `report-execution-evidence` | 安装后的 `.tsx` Report 可由 `view` / `view --out` 枚举普通与参数 Page；overview 有 Hero HTTPS anchor、KPI/图表/层级文字、详情 href，且不暴露 raw Attempt DTO。 |
| show 是独立的单目标终端阅读面。 | `report-show` 与 `report-project-current` | selector、选中 route、文字、完整 MetricValue、参数 key 成员资格与 project-current 身份。 |
| JSON 是单目标机器阅读面。 | `report-show-json` | target format、canonical order、选中 route、metadata、下载摘要与 problem table；不含全路由 revision oracle。 |
| view 是同一 revision 的本机 HTTP 面。 | `report-config-reload` 与 `report-browser-journey` | last-good、最新 intent、固定响应、HTTP 边界和可访问内容。 |
| static 是同一 revision 的离线文件面。 | `report-static-export` | 全部页面 closure、view 字节等价、existing-target 保护和无 JavaScript 阅读。 |
| Source、Diff 和运行证据来自本次构建。 | `report-source-snapshot` 与 `report-execution-evidence` | 已生成页面或文件不从工作树或私有文件补造。 |

固定 world（固定世界）的真实浏览器人工验收补足视觉判断。它使用相同候选 tarball、签入 fixture、viewport、主题、
浏览器版本和 route 集合，逐页核对文字层级、表格可读性、图形标签、状态、链接和无 JavaScript 阅读。

它不做像素比较、截图 diff 或私有 class 断言。自动化 browser Journey 只断言稳定 URL、HTTP、可访问身份、字节等价和
可见结果。

### 候选包 dogfood

完整 MemoryBench 只用于候选包 dogfood。它在隔离 consumer 安装同一 candidate 后，经公开 `show`、`view` 与 static 路径做
人工阅读；它不是仓库 E2E fixture、全路由 oracle 或既有 owner 的替代品。

## 验收边界

- 测试断言用户拿到的公开结果，不断言内部文件名、Host 内存、schema registry、lock、reader 类型或 cache 实现。
- feature 文档声明目标契约；实现任务负责交付，测试不能用手写 fixture 伪造为已完成。
- 模型输出质量不做确定性断言；只断言可重复的身份、状态、字段、route、body bytes 与 Host 一致性。
- 渲染颜色、像素与私有 class 不属于契约；可访问文字、语义结构、离线路由和下载属于契约。

## E2E owner anchors

### report-project-current

`report-project-current.test.ts` 验证不带选择项的 `show` 累积全部身份仍匹配的 Run。Eval source 改变后，旧结果从
当前 Sample 消失；下一次 `exp` 产生匹配的新结果。验收只走公开 receipt / show，并确认 `--latest` 已移除。

### report-config-reload

`report-config-reload.test.ts` 验证 Config、Report 与 Theme 的受控重建。它拥有 latest-intent-wins、last-good、
固定 HTTP revision 与刷新不读取数据的公开观察。

### report-execution-evidence

`report-execution.test.ts` 先让标准 React JSX 作者模块通过安装候选包的公开声明 typecheck。
随后它在固定 Sample 上完成站点构建。
该 fixture 同时锁定 package export manifest 与 v0.12 `HeadTag` 的普通数组推断。
随后它通过 `view` 或 static 的完整路线闭包观察普通 Page、参数详情页、Hero HTTPS anchor、KPI、图表、层级文字和实际详情 href。
正文不序列化 raw Attempt DTO。
它不借 `show --json` 枚举参数实例。

### report-static-export

`report-export.test.ts` 验证 `view --out` 的完整文件集合、与 view 的 body bytes 等价，以及已存在目标保护。

### report-show-json

`report-show.test.ts` 验证 locator、project-current、human 与 JSON 的单目标公开读回。它只断言选中 route 的 format 与内容，
不拥有全路由或 revision oracle。fixture 会让无关参数 Page 的 `enumerate()` 失败，并证明两种 show 都不受影响。

### report-source-snapshot

`report-source.test.ts` 验证选中 Source Page 使用运行时快照，不读取后来修改的工作树内容，并作为已生成页面或文件交付。

### report-browser-journey

`report.browser.spec.ts` 通过真实 href、HTTP、可访问身份、可见内容和断网禁用 JavaScript 的 route 阅读验证浏览器 Journey。
经典旅程通过真实浏览器完成筛选、原生 `details` 展开、Attempt href 下钻与中文切换。它只锁 role、text、href 和
原生标签语义，不锁 CSS class、像素或精确颜色。
