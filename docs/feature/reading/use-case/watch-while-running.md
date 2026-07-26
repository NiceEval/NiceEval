# 跟着运行看

一个实验要跑半小时。你不想等它结束再看结果,也不想每隔两分钟重开一次命令。

开着 `view` 就行 —— 它是[挂着 watch 的 build](../../reports/view.md#持续重建):建一次站点、起本地
server,然后盯着输入持续重建。

```sh
# 终端 A
niceeval exp compare/codex

# 终端 B
niceeval view --exp compare/codex
```

每写完一个 attempt,页面上就多一行。不需要刷新,重建完成后页面自己重载,并且停在你正在看的那一页
或那个 attempt 上。

## 看到的一定是完整记录

盯着一个正在写的目录看,直觉上会担心读到半份数据。这件事由记录格式担保,不靠 view 自己防抖:

- `result.json` 一次原子写成,所以站点要么看不见这个 attempt,要么看见它的完整判定。
- Run 还没补 `completedAt` 是这个场景的常态。它按[未收尾 Run](../../record/architecture.md#读取规则)
  如实读出,附一条结构化警告,而不是等收尾才肯显示。

那条警告在跑的过程中出现是正常的,收尾后自行消失。

## 改报告和组件也重建

同一条 watch 还盯着报告文件的整棵项目内 import 图。所以调自定义组件的写法是:

```sh
niceeval view --report reports/site.tsx
# 另一个窗口里改 reports/components/scoreboard.tsx,存盘,浏览器里就是新样子
```

改组件文件与改报告文件没有区别 —— 报告是一棵组件树,组件写在哪个文件里都算报告的一部分。

写错了不会把站点弄没:重建失败时 server 继续服务上一份可用站点,错误推到浏览器上显示、终端也打一条,
修好保存就自动恢复。

## 什么时候改用 `show`

`view` 是给人盯着看的。要一次性的文本结论 —— CI 判红、AI 自主迭代读输出、贴进 issue ——
用 [`show`](../../reports/show.md):它渲染同一份报告定义的 text 面,跑完就退出,没有 server。

## 看完要发出去

同一份收窄换成 `--out` 就是发布产物,逐字节一致:

```sh
niceeval view --exp compare/codex --out site
```

导出与 `publish` 的分工见[导出与发布](export-a-site.md)。
