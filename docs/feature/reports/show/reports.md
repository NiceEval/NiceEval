# `--report`：单页与多页的终端操作

`--report <file>` 用报告文件替换默认榜单，文件的默认导出恒为 `defineReport` 产物（[树或配置对象形态](../library/shell.md)）；`--history` 与 `--report` 互斥。attempt locator 的下钻命令不随 `--report` 改变。本页按 case 列出操作步骤；页与外壳的字段契约见 [Library · 外壳与多页](../library/shell.md)。

**索引命令携带完整上下文。** `show` 输出的每一条可复制命令（页索引、可比组索引）都保留当前的 `--results`、`--report`、`--page` 与位置参数——复制即可精确复现下一层视图，不需要用户自己补参数。

## Case 1：单页文件——直接渲染

树形态与 `content:` 缩写形态都是单页，不输出页索引（索引的价值是下钻命令，只有一页时直接渲染就是答案）：

```sh
$ niceeval show --report reports/frontier.tsx            # 直接渲染该页 text 面
$ niceeval show --report reports/frontier.tsx --page report
                                                         # 等价：单页的 id 是缩写展开的 report
$ niceeval show --report reports/frontier.tsx --page typo
error: page "typo" not found in reports/frontier.tsx. Available pages: report
```

## Case 2：多页文件——先索引，后进页

多页且未传 `--page` 时只输出页索引与可复制的单页命令——与可比组索引同一模式，不把全部页倾倒进终端：

```sh
$ niceeval show --report reports/site.tsx
记忆能力评测 · 2 页

  overview   总览      niceeval show --report reports/site.tsx --page overview
  exam       成绩单    niceeval show --report reports/site.tsx --page exam
```

复制索引里的命令进页：

```sh
$ niceeval show --report reports/site.tsx --page exam    # 渲染成绩单页的 text 面
$ niceeval show --report reports/site.tsx --page typo
error: page "typo" not found in reports/site.tsx. Available pages: overview, exam
```

## Case 3：进页后再遇多可比组——两层索引，各给下一步

页内报告按可比组分区（如内建报告的 `ExperimentComparison`）且 Scope 命中多个组时，进页看到的是组索引；组索引的命令带着 `--report` / `--page` 上下文，再复制一次就到组内详情：

```sh
$ niceeval show --report reports/site.tsx --page overview

实验组                  实验   Eval   端到端成功率   Eval 结果         成本      最后运行
compare                    2     12          75.0%   9 通过 / 3 失败      $1.42   2026-07-12 18:08
dev-e2b                    3     16          61.1%   11 通过 / 5 失败     $0.31   2026-07-12 18:09

查看组内详情：
  niceeval show --experiment compare --report reports/site.tsx --page overview
  niceeval show --experiment dev-e2b --report reports/site.tsx --page overview

$ niceeval show --experiment dev-e2b --report reports/site.tsx --page overview
# 单组：直接输出该组的散点与实验列表
```

每一层索引都终结于一条可执行命令：页索引 → 组索引 → 组内详情 → attempt locator，任何一层都不倾倒下层全量内容。

## Case 4：范围收窄与页选择正交

位置参数（eval id 前缀）与 `--experiment` 先收窄 Scope，`--page` 再选页；[全部页共享同一份收窄后的 Scope](../library/shell.md#行为约束)：

```sh
$ niceeval show memory/swelancer --report reports/site.tsx --page exam
                                        # 只统计 memory/swelancer 前缀的 eval，再渲染成绩单页
$ niceeval show --results tmp/published-results --report reports/site.tsx
                                        # 换结果根后输出页索引；索引命令同样带 --results
```

## Case 5：attempt 下钻不受 `--report` 影响

榜单换成任何自定义报告后，locator 下钻链保持不变——报告只是换了「怎么看」，证据入口是宿主的：

```sh
$ niceeval show --report reports/site.tsx --page exam    # 页里出现 @1qrdcfq8
$ niceeval show @1qrdcfq8                                # 诊断首页照常打开
$ niceeval show @1qrdcfq8 --diff                         # 证据切面照常可用
```

## Case 6：内建等价文件

裸 `niceeval show` 与 `--report` 一个内容只有 `export default defineReport(<ExperimentComparison />)` 的文件完全等价（见 [Library · 内建报告](../library/built-in.md)）；因此上面每个 case 对内建报告同样成立——裸 `show` 命中多组时的组索引，就是 Case 3 在默认上下文里的样子。

## 外壳字段在终端

配置对象形态的外壳里，`show` 只消费 `title`（页索引的标题行）与 `pages`；`links`、`footer`、`scripts`、`styles` 是 web 面属性，`Powered by niceeval` 行同样只属于 web 面页脚，`show` 不打印。页内的 `Tabs` 在 text 面按声明序全量输出、不折成索引——tab 没有选择器，索引是死路；内容长到终端读不动，是把 tab 升级成页的信号（见 [Library · Tabs](../library/layout.md#tabs)）。

## 相关阅读

- [Library · 外壳与多页](../library/shell.md) —— 页与外壳的字段穷尽。
- [Library · 内建报告](../library/built-in.md) —— 裸 `show` 装载的定义本体。
- [裸 `show` 的默认榜单](default-report.md) —— 组索引与单组详情的完整契约。
- [View](../view.md) —— 同一份文件在网页宿主的路由（`#/page/<id>`、`--page` 定初始页）。
