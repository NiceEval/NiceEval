# 功能域 · Reports 公开读面

本域验证安装后的候选包完成 `exp → show / view / export` Journey。Record 目录是 CLI 产生的 opaque 产品资产；测试不 import
Record reader / writer，不扫描物理布局，也不复制 selection、decoder、Analysis 或 Report Host 作为第二套真相。

它由 `e2e/report/` 承担，manifest repo ID 是 `report`。Repo 用最小真实 Experiment 产生本轮结果，再只通过 CLI、HTTP、
浏览器、导出的站点文件与 `niceeval/report` 作者 DSL 观察。

## 公开验收计划

### 1. 真实运行与公开选择

- `exp` 完成后取得公开 receipt / locator；测试不把目录项当成功收据。
- 不带 locator 或 `--run` 的 `show` 读取全部 project-current 结果；`show --run` 与精确 Attempt locator 读取具名历史事实。
- 当前身份变化后，旧结果从不带选择项的 `show` 消失，但仍能通过完整 Run ID 读取。
- 未完成、损坏或需要迁移的 Record 只有在 CLI 能稳定制造并返回公开诊断时才自动化。
- 机器调用方用 `show --json` 读回，不直接打开 `.niceeval/` 文件。

### 2. Report 作者面

- 自定义 Report 只从 `niceeval/report` 导入 `defineReport`、`defineComponent`、中立组件、Download、v0.12 计算、
  投影与必要的纯值类型。
- 作者不能 import `niceeval/record`、`niceeval/report/host` 或 host/node。作者也看不到 reader、root、Scope、Effect、
  path、raw family value、owner lookup 或查询执行器。
- Page 与组件只拿 Host-issued Sample，调用 `aggregate()`、`rollup()` 与 `to*` 投影后消费 ClosedRows、领域视图与完整
  MetricValue。它们不能读取或构造持久事实。
- Page 与组件可以产生受支持 JSX/React element。公开观察只来自关闭后的站点内容，不能来自浏览器的作者 callback。
- `head` 只保留非执行 metadata，`<Style>` 只保留 inline CSS，本地静态文件必须可写入 revision。script、功能性网络依赖、
  raw HTML 与浏览器副作用不属于作者面。
- 参数化 Page 必须定义 `params.encode`、`params.decode`、`params.enumerate`、load 和 render。详情 route 来自同一规范 key。

### 3. SSG-first 功能 oracle

报告 fixture 至少包含一个普通 Page、一个参数化详情 Page、一个 Source Page、一个 Trace Page、一个 Diff Page 和一个
Download。每个页面写独特、可见的文本 marker；参数页面由 Report 自己的 `enumerate(sample)` 决定。

对任一 selector 和任一 `--page`，E2E 从 `show --json` 观察以下事实：

- JSON 含固定 revision identity、Sample identity、Report identity 与 renderer identity。
- JSON 的页面集合包含 fixture 的全部普通和参数实例，而非只有 `--page` 指定的 route。
- 每个 marker、route、关闭数据状态、下载 metadata 与问题 ID 都来自同一个 revision。
- 选中 route 只改变用户阅读目标，不能少掉详情、Source、Trace、Diff 或 Download 的构建结果。

这个 oracle 只断言公开 JSON 与页面文字。它不读 Host 内存、调用次数、私有 cache key 或 Report 的中间树。

### 4. static 与 view 的字节 oracle

用同一个 selector 与同一个 Report 分别运行：

```text
niceeval view --report <fixture> --out <directory>
niceeval view --report <fixture> --no-open
```

测试从 JSON 列出的每个 route 请求 view，再读取导出目录中该 route 对应的页面文件。每对 response body 与文件 body 必须
逐字节相同。对每个 Download 也比较 HTTP body 与导出文件 bytes。

浏览器在断网且禁用 JavaScript 时打开根页、参数页、Source、Trace 和 Diff。它仍能读取 marker、正文、导航、完整度、
问题与下载链接。测试拦截外部网络请求；任何为补读 Analysis、Source 详情或页面数据发出的请求都是失败。

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

- `MetricValue` 的 partial、empty、unsupported 和 failed 是可呈现的数据状态。它们在 show、JSON、view 和 static
  中保留相同的 samples、total、issues 与 refs。
- 参数枚举、Page、组件、关闭页面、路径或全站校验失败时，show 与 JSON 不交付部分 revision，static 不写完整站点，
  view 保留 last-good。
- `view --out` 的目标已存在时失败且不替换既有目录。
- 浏览器不需要源 Record、网络或 NiceEval 安装；导出目录不泄漏 Record path 或内部文件布局。

## 功能命题与既有 owner

不按 Report 内部模块、组件文件或 renderer 类别建立 E2E。每条自动化只拥有一个用户可见功能命题，并从下表所列的既有
owner 接管对应检查；没有 `report-author-compat`、`report-json-v2` 或像素快照等新 owner。

| 功能命题 | 接管的既有 owner | 保留的公开观察 |
|---|---|---|
| v0.12 作者源码以固定 Sample 构建完整站点。 | `report-execution-evidence` | 近原样 classic 作者源码可构建；show JSON 枚举 built-in Attempt 和 Experiment 参数页；overview 有 Hero HTTPS anchor、KPI/图表/层级文字、详情 href，且不暴露 raw Attempt DTO。 |
| show 是独立的终端阅读面。 | `report-show` 与 `report-project-current` | selector、阅读 route、文字、完整 MetricValue 与 project-current 身份。 |
| JSON 是完整 revision 的机器阅读面。 | `report-show-json` | canonical order、全路由集合、identity、metadata 与 problem table。 |
| view 是同一 revision 的本机 HTTP 面。 | `report-config-reload` 与 `report-browser-journey` | last-good、最新 intent、固定响应、HTTP 边界和可访问内容。 |
| static 是同一 revision 的离线文件面。 | `report-static-export` | 全部页面 closure、view 字节等价、existing-target 保护和无 JavaScript 阅读。 |
| Source、Trace、Diff 和运行证据来自本次构建。 | `report-source-snapshot` 与 `report-execution-evidence` | 已生成页面或文件、`--source`、`--execution` 与 `--timing` 不从工作树或私有文件补造。 |

固定 world（固定世界）的真实浏览器人工验收补足视觉判断。它使用相同候选 tarball、签入 fixture、viewport、主题、
浏览器版本和 route 集合，逐页核对文字层级、表格可读性、图形标签、状态、链接和无 JavaScript 阅读。

它不做像素比较、截图 diff 或私有 class 断言。自动化 browser Journey 只断言稳定 URL、HTTP、可访问身份、字节等价和
可见结果。

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

`report-execution.test.ts` 通过 `show --execution` 与 `show --timing` 验证已停稳构建证据。它也接管 v0.12 作者模块
在固定 Sample 上构建全站、再把关闭 revision 交给各产品面的功能命题。classic 全站命题要求 built-in Attempt 和
Experiment 详情页在 show JSON 中枚举参数实例。overview 保留 Hero HTTPS anchor、KPI、图表与原生层级文字，
提供实际详情 href，且正文不序列化 raw Attempt DTO。

### report-static-export

`report-export.test.ts` 验证 `view --out` 的完整文件集合、与 view 的 body bytes 等价，以及已存在目标保护。

### report-show-json

`report-show.test.ts` 验证 locator、project-current、human 与 JSON 公开读回。它拥有 JSON 中的全路由 revision oracle。

### report-source-snapshot

`report-source.test.ts` 验证 `show --source` 使用运行时快照，不读取后来修改的工作树内容，并作为已生成页面或文件交付。

### report-browser-journey

`report.browser.spec.ts` 通过真实 href、HTTP、可访问身份、可见内容和断网禁用 JavaScript 的 route 阅读验证浏览器 Journey。
经典旅程通过真实浏览器完成筛选、原生 `details` 展开、Attempt href 下钻与中文切换。它只锁 role、text、href 和
原生标签语义，不锁 CSS class、像素或精确颜色。
