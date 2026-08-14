# Report 架构

Report 把固定 Sample 与 Report 定义执行为 immutable、self-contained 的 ReportExecution。它不拥有 Record、事实迁移、总体选择或统计口径。

## 依赖方向

```text
Record
  │ persistent facts
  ▼
Analysis
  │ Sample + rows / domain views / MetricValue
  ▼
Report callback
  │ Page + component composition
  ▼
ClosedReportTree
  ├─ terminal
  ├─ Web revision
  └─ static site
```

Record 保存发生过的事。Analysis 固定总体、分母、缺失、归并和 Evidence。Report 只把闭合结果组织为页面。renderer 只读取 ClosedReportTree，不能回到前两层。

## 一份 execution 的时序

```text
select target route or static all-pages target
  │
  ├─ validate Report definition and known paths
  │
  ├─ run Page load / render
  │     └─ aggregate() or query() closes local Analysis dependencies
  │
  ├─ resolve component instances
  │
  ├─ validate and close every semantic node
  │
  └─ collect routes, downloads and problem table
        ▼
   immutable ReportExecution
```

普通 show 不带 --page 时执行全部普通 Page。带 --page 的 show 和 view 只执行目标 route；参数化 Page 只 decode、load 和 render 请求的一个实例。静态目标总是执行全部普通 Page，并为每个参数化 Page 调用 enumerate(sample) 后执行全部列出的实例。

这三种 target 都不会 dry-run 作者 callback。静态目标不是浏览器逐页补读的快捷写法，而是在一次 execution 中形成完整路由和下载 closure。

## 局部数据闭合与缓存

Report 使用 async callback，因此依赖在每次 aggregate() 或 query() 调用时局部闭合。Host 在事实读取前验证该调用所需的有限 Analysis 依赖；cycle、Population mismatch 和字段 identity conflict 在读取前返回 Analysis error。

Host 以 frozen Sample identity 与字段依赖 identity 缓存结果。不同 Page 可以复用同一读数；同一个 Page instance 的 load、render、复合组件和原语 `resolve()` 最多各运行一次。缓存只属于当前 ReportExecution，不跨 CLI 命令、Web rebuild 或静态导出共享。

callback 可以依照已经取得的 rows 决定下一段 UI，或发起另一组 aggregate()。它不能把 rows 变成新总体、读取 raw facts、延长 Sample 生命周期或把事实读取能力传给 renderer。

## ClosedReportTree 与验证

ReportNode 是作者返回的语义组件树；ClosedReportTree 是 Host 执行后唯一可交给 renderer 的值。关闭树前，Host 逐层验证 props、已求值数据、row identity、links、downloads 和固定限额。

验证范围至少包括：

- 非有限 number、坏 Unicode scalar、cycle、过深或过宽树；
- Table 的列、row、MetricValue 和 Evidence 形状；
- 图形 channel、series 长度、标签、状态与文字降级数据；
- 参数 key 的规范往返和已枚举实例的 route；
- route、download、host 文件和 manifest 的跨平台冲突；
- 内联链接只指向本 execution 已闭合的 route 或下载项。

HTML 由 Host 按上下文 escape。terminal 把控制字符变成可见文本。未知节点和坏 props 不会进入 renderer，而是产生 semantic-tree-invalid execution problem。

## 数据问题与执行问题

Analysis issue 与 execution problem 的边界固定：

| 情况 | 位置 | show / view | static export |
|---|---|---|---|
| partial、empty、unsupported 或 failed 的 MetricValue | 数据值及不可关闭问题面 | 显示状态、issues 和 refs。 | 成功写出并显示。 |
| 参数、load、render、组件或树验证失败 | Page execution problem | 隔离该 Page，保留其它成功 Page。 | fail closed。 |
| route 或下载冲突 | execution problem | 显示问题，保留不冲突 Page。 | fail closed。 |
| 定义无效、Analysis 全局 error 或超过限额 | typed error | 不形成 execution。 | 不形成 execution。 |
| interruption | Effect Cause | 传播并运行 finalizer。 | 传播并运行 finalizer。 |

Host 在树关闭前汇总 Analysis issue，在 callback 边界追加 execution problem。problemTable 是 canonical、稳定排序的去重表；页面和下载结果只保留 problem ID。作者不画问题节点、过滤 rows 或返回空数组，都不能移除内建问题面。

## 热重载

niceeval view 的每次 rebuild 都创建新的 fixed ReportExecution。

```text
file or Record change
  │
  ▼
load exact Report / config / theme closure
  │
  ▼
select + execute once
  │
  ├─ succeeds -> atomically publish a new current revision
  └─ fails    -> retain last-good revision and show bounded rebuild problem
```

每个成功 revision 都固定包含 Report、config、theme 的内容快照、Sample 摘要和 immutable ReportExecution。HTTP request、页面打开或浏览器刷新不会额外读取事实。

Record、Report 或影响 selection 的 config 变化会产生新的 execution。仅 theme 变化可以复用已有 execution，但仍发布新的 view revision。watch 输入闭集是 Record root、Report module、其项目内静态 import、Theme module 和 niceeval.config.ts；loader、watcher、ESM cache 和 server 的具体实现属于 Node host。

## Static export

静态站只写一份完成的静态 execution 的结果。export 在写入前检查全部 Page、参数实例、闭合树、下载、路径、限额和 execution problem。

```text
preflight complete closure
  │
  ▼
prepare a previously nonexistent output directory once
  │
  ▼
write pages, host-data, downloads, manifest and built-in runtime
  │
  ▼
write zero-byte complete marker last
  │
  ▼
sync directory and return receipt
```

任一 execution problem 阻止发布。数据 issue 不阻止发布，因为它们已进入闭合树和问题面。目标已存在时不会删除或替换。失败或中断后缺少 complete marker 的目录也不能重用。Host 提示用户删除该目录后重试，但不承诺原子目录发布。

浏览器在断网且禁 JavaScript 时仍只能读取目录内文件。它不打开 Record、不发起网络请求，也不执行作者 callback。

## 不变量

- Report 作者只处理 Sample 交出的闭合值，不拥有统计口径或事实读取。
- 同一 execution 内每个 Page instance 与组件实例最多执行一次。
- 所有面从同一 ClosedReportTree 读取，不各自重算或改变 MetricValue。
- 参数化 Page 的静态 export 穷尽 enumerate(sample) 的全部实例。
- 路由、下载和 Host 输出使用同一 collision set。
- 数据 issue、execution problem、typed error 与 interruption 永远分开。
- 热重载发布新 execution，不偷偷修改旧 execution。
- 静态站必须自包含，且 complete marker 是完成的唯一目录内证据。

## 相关阅读

- [Report Library](library.md)：公开形状、树验证和 error union。
- [Reports CLI](cli.md)：命令、路由和 export 行为。
- [数值与显示语义](calculations.md)：MetricValue 与分母。
- [分享静态报告站](use-case/分享静态报告站.md)：全页导出的用户路径。
