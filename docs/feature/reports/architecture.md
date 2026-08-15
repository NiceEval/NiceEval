# Report 架构

Report 的内部边界服务于一个简单结果：固定的 Sample 与 ReportDefinition 只构建一次完整站点，所有公开入口随后从同一
ClosedSiteRevision 读取。作者仍只写 Page、组件和 JSX；revision 是 Host 的关闭结果。

## 四个入口共享一个 builder

```text
niceeval show ────────┐
niceeval show --json ─┤
niceeval view ────────┼─ select Record ─ open fixed Sample
niceeval view --out ──┘                         │
                                                   ▼
                              ReportDefinition + Sample
                                                   │
                                                   ▼
                                      buildSiteRevision()
                                                   │
                                                   ▼
                                      ClosedSiteRevision
                         ┌─────────────────┬───────────────┬──────────────────┐
                         ▼                 ▼               ▼                  ▼
                    terminal text      canonical JSON   HTTP bytes       static files
```

`show`、`show --json`、`view` 和 `view --out` 都先走完整 builder。`--page` 只决定最终文字或初始浏览位置，
不缩小 Page 枚举、Analysis 调用、全站校验或静态文件集合。Host 没有 target-subset builder。

## 分层与所有权

```text
Record
  │ sealed facts
  ▼
Analysis
  │ fixed Sample, ClosedRows, MetricValue, domain views
  ▼
Report author
  │ defineReport, Page, defineComponent, JSX
  ▼
Report Host
  │ buildSiteRevision, validate, content-address
  ▼
ClosedSiteRevision
  │ page projections, HTML, assets, downloads
  ▼
show / JSON / view / static
```

Record 拥有持久事实。Analysis 拥有选择、分母、缺失和 Evidence。Report 作者只组织已关闭的值。Host 在 Sample 的
Scope 存活时执行作者回调，并把结果变成可以序列化的站点内容。

作者导入面不包含 Record reader、watcher、模块加载器、文件路径或 renderer。Host 也不会把这些能力留在 revision 中。

## ClosedSiteRevision

ClosedSiteRevision 是全站的不可变内容集合。每一页都同时保留关闭页面投影和最终 HTML body bytes；每个静态文件与下载
也保留最终 bytes。

```ts
interface ClosedSiteRevision {
  readonly identity: ContentAddress;
  readonly sampleIdentity: ContentAddress;
  readonly reportIdentity: ContentAddress;
  readonly rendererIdentity: ContentAddress;
  readonly pages: readonly ClosedPageProjection[];
  readonly assets: readonly ClosedAsset[];
  readonly downloads: readonly ClosedDownload[];
}

interface ClosedPageProjection {
  readonly route: string;
  readonly semanticContent: ClosedPageContent;
  readonly htmlBodyBytes: Uint8Array;
}
```

`identity` 是内容寻址值。它必须绑定 Sample、Report、renderer identity 与关闭后的全站内容，不能只按 route、文件时间或
当前浏览器状态命名。revision 不含 Sample capability、Record reader、Promise、callback、模块对象、原始 payload 或路径能力。

HTML 由 Host 按上下文转义。关闭页面内容只允许已验证的结构、普通数据、inline CSS、非执行 metadata 与本地静态文件引用。
任意 HTML、可执行 script、worker、WASM、远程字体和功能性网络请求都不能进入 revision。

## buildSiteRevision 的固定步骤

1. 校验 ReportDefinition 的静态形状、Page id、基路径和声明的安全 metadata。
2. 在固定 Sample 上调用每个参数化 Page 一次 `params.enumerate(sample)`。
3. 对全部普通 Page 和全部枚举实例执行 `load`、`render`、组件、计算与下载字节构造。
4. 关闭每个页面值，并生成每页 HTML、静态文件和下载字节。
5. 全局校验 route、链接、详情页面、Source、Trace、Diff、下载、路径冲突、限额、问题面和所有最终 bytes。
6. 以关闭内容形成 content-addressed ClosedSiteRevision，再关闭 Sample 的读取能力。

`params.enumerate(sample)` 是详情集合的唯一入口。Source、Trace 和 Diff 要么是已枚举的详情 Page，要么是 revision 中的
静态文件。客户端地址、HTTP 请求和浏览器导航不能制造新的参数实例或触发 Analysis。

所有页面成功关闭并通过第 5 步，Host 才有 revision。Analysis issue 仍是可显示的数据：它留在 MetricValue、ClosedRows、
领域视图和问题面。作者回调失败、枚举失败、路径冲突、坏节点、坏字节或限额超过是全站构建失败，不能发布部分 revision。

## 静态文件与 HTTP 的字节合同

`view --out` 只把 ClosedSiteRevision 的 page、asset 与 download bytes 写入目标目录。它不重新呈现、不为导出调整数据，
也不允许只写已访问过的页面。

`view` 只托管当前 ClosedSiteRevision 的同一批 bytes。对于每个 route，HTTP 响应 body 与静态目录中的对应 body 字节相同。
Host 可添加协议 header、管理连接并发送刷新通知，但这些动作不能改变正文、页面投影或下载内容。

因此静态站在断网且禁用 JavaScript 时仍提供正文、导航、详情、问题与下载。Web 图形或刷新只能增强已关闭的文字与链接，
不能重新计算值、请求 Analysis 或加载延迟的 Source、Trace、Diff。

## view 的 build intent 与发布

```text
intent 41 ── build candidate A ─────────────┐
                                              ├─ superseded by intent 42 → abort or discard A
intent 42 ── build candidate B ── validates ─┴─ atomically publish revision B
                                              │
intent 43 ── build fails ────────────────────┴─ retain last-good revision B
```

watcher 监听 Record、Report、配置、Theme 与这些模块在项目内的静态 import。每次变化产生新的 build intent。最新 intent
拥有发布权；旧 candidate 可被中断，无法中断时其完整结果也必须被废弃。

只有最新 candidate 完整成功并通过全站校验，Host 才原子替换 current revision。失败通过有界 Host header 暴露 rebuild 问题并保留
last-good。refresh transport 只是通知浏览器尝试取得新 revision 的可失效增强，不是数据读取通道。

HTTP request 在开始时取得一个 revision 引用。该请求的所有页面、静态文件和下载字节都来自这个引用，即使下一次 revision
在响应期间发布也不混用内容。

## 全站预算与缓存边界

| 限额 | 最大值 | 计数范围 |
|---|---:|---|
| 页面数 | 20,000 | 普通 Page 与所有参数实例。 |
| 文档节点数 | 20,000 | 单个关闭页面投影。 |
| 文档深度 | 32 | 单个关闭页面投影。 |
| 下载文件数 | 1,000 | 一次 revision 的下载集合。 |
| 单个下载字节数 | 33,554,432 | 一个规范化下载文件。 |

完整枚举是正确性的成本，先于首个 route 的响应时间。Host 可以采用页面级缓存，但缓存项只能是已经完全关闭的页面值。
缓存 key 必须包含 Sample、Report、renderer、Page 与 params identity。命中不会改变 Evidence、分母、issues、
最终 bytes 或 ClosedSiteRevision identity。

## 不变量

- 每个公开入口先构建完整站点，再选择输出投影。
- 每个参数化 Page 的实例都来自一次完整的 `enumerate(sample)`。
- revision 的每个页面、静态文件和下载都有最终 bytes 与内容身份。
- `view` 与静态目录对同一 route 提供相同 body bytes。
- HTTP、导航、刷新和客户端脚本不执行作者回调或 Analysis。
- 最新完整成功 revision 才能替换 last-good；失败不会修改已经发布的版本。
- 数据 issue 可见且不伪装成构建失败；构建失败不伪装成部分站点。

## 相关阅读

- [Report Library](library.md)：作者 API、Page 枚举和中立组件输入。
- [Reports CLI](cli.md)：命令如何选择 Sample、构建和投影。
- [分享静态报告站](use-case/分享静态报告站.md)：完整目录与离线读取。
