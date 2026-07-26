# Reading —— 用例手册

四个读取任务,每篇从「我想干什么」走到「照着敲什么」。契约单源仍在三层各自的文档里,用例只做
串联与判据,不复制字段全集、flag 表或选择算法。

## 决定看哪些数据

- [收窄读取范围](narrow-what-you-read.md) —— 只看某几个实验、某几道题、只看最新一次跑的;
  命令行收窄与 `publish` 构根的分界在哪。

## 在两个宿主里看

- [跟着运行看](watch-while-running.md) —— 实验正在跑的时候开着 `view`,结果一条条长出来;
  改报告或组件文件同样重建。
- [导出与发布](export-a-site.md) —— 把这批结果发成静态站点:直接 `--out`,还是先 `publish`
  构一个瘦身发布根。

## 在自己的代码里读

- [脚本里读结果](read-from-script.md) —— CI 门禁、自定义指标、导出到别的系统。

## 相关阅读

- [Reading](../README.md) —— 三层分工与跨层不变量。
- [Record Lib](../../record/library.md) / [Sample Lib](../../sample/library.md) ——
  两层各自的 API 契约。
- [Show](../../reports/show.md) / [View](../../reports/view.md) —— 两个宿主的 CLI 契约。
