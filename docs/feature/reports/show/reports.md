# `--report`：单页与多页的终端操作

`--report <名字|文件>` 替换默认 pages：带路径形的值按报告文件装载，其默认导出恒为 `defineReport` 产物（[树或配置对象形态](../library/shell.md)）；裸词查[内建视图名](../library/built-in.md)。`--history` 与 `--report` 互斥。locator 详情同样是一张 page。本页按 case 列出操作步骤；page 与外壳的字段契约见 [Library · 外壳与多页](../library/shell.md)。

**索引命令携带完整上下文。** `show` 输出的每一条页索引命令都保留当前的 `--results`、`--report` 与位置参数。

## Case 1：单页文件——直接渲染

树形态与 `content:` 缩写形态都是单页，直接渲染、不附页索引（索引只列未渲染的页，单页没有）：

```sh
$ niceeval show --report reports/frontier.tsx            # 直接渲染该页 text 面
$ niceeval show --report reports/frontier.tsx --page report
                                                         # 等价：单页的 id 是缩写展开的 report
$ niceeval show --report reports/frontier.tsx --page typo
error: page "typo" not found in reports/frontier.tsx. Available pages: report
```

## Case 2：多页文件——渲染初始页，尾部附其余页索引

多页时渲染初始页（`--page` 指定的页，缺省第一页），随后附其余页的索引与可复制命令——与 `view` 打开初始页同一语义：一条命令直接给出答案，其余页只列索引、不倾倒内容：

```sh
$ niceeval show --report reports/site.tsx                # 渲染第一页（总览）的 text 面
…（总览页内容）…

其余页：
  exam   成绩单    niceeval show --report reports/site.tsx --page exam
```

复制索引里的命令进页：

```sh
$ niceeval show --report reports/site.tsx --page exam    # 渲染成绩单页的 text 面，尾部列出 overview
$ niceeval show --report reports/site.tsx --page typo
error: page "typo" not found in reports/site.tsx. Available pages: overview, exam
```

## Case 3：范围收窄与页选择正交

位置参数（eval id 前缀）与 `--exp` 先收窄 Scope，`--page` 再选页；[全部页共享同一份收窄后的 Scope](../library/shell.md#行为约束)：

```sh
$ niceeval show memory/swelancer --report reports/site.tsx --page exam
                                        # 只统计 memory/swelancer 前缀的 eval，再渲染成绩单页
$ niceeval show --results tmp/published-results --report reports/site.tsx
                                        # 换结果根后输出页索引；索引命令同样带 --results
```

## Case 5：attempt 下钻使用同一份报告定义

报告声明了 attempt-input page 时，页里的 locator 命令保留 `--results` 与 `--report`，因而打开同一张 page 的 text 面；专用证据 flag 仍直接投影同一份 Results evidence，不经 page content：

```sh
$ niceeval show --report reports/site.tsx --page exam    # 页里出现 @1qrdcfq8
$ niceeval show @1qrdcfq8 --report reports/site.tsx      # 自定义参数化 page 的 text 面
$ niceeval show @1qrdcfq8 --diff                         # 证据切面照常可用
```

报告没声明 attempt-input page 时 locator 只是文本，不生成一条会悄悄落回内建详情的命令。要沿用官方详情，显式 `extends: standard`，或把 `standardAttemptPage` 放进自己的 pages；要自定义就声明同类 page 并重组它的 content。

## Case 6：内建等价文件

没配 `config.report` 时，裸 `niceeval show` 与 `--report` 一个内容为[内建报告全文](../library/built-in.md)（三张导航 page 加一张参数化详情 page）的文件完全等价；裸 `show` 渲染报告页并在尾部只列 Attempts、追踪两张可导航页，`show @locator` 选择隐藏的详情 page。

## Case 7：项目默认报告与临时回到内建

配置里填了 `report` 字段后，裸 `show` 装载的就是它；`--report` 仍然按次覆盖，写内建视图名就回到默认榜单，不必改配置：

```sh
$ niceeval show                             # 装载 config.report
$ niceeval show --report standard           # 本次回到内建 standard
$ niceeval show --report ./reports/exam.tsx # 本次换成另一份文件
$ niceeval show --report site
error: no built-in report view named "site". Available: standard. To load a file, write a path like ./reports/site.tsx
```

裸词一律查内建视图名表、不回落到文件探测：`--report site` 不会去找 `./site.tsx`，报错直接给出两条路怎么写。

## 外壳字段在终端

配置对象形态的外壳里，`show` 只消费 `title`（页索引的标题行）与 `pages`；`links`、`footer`、`theme`、`seriesPins`、`head`、`scripts`、`styles` 是 web 面属性，`show` 不打印。同理 `--theme` 不是 `show` 的 flag：`niceeval show --theme …` 按完整用户反馈报错，说明主题只作用于 web 面，下一步是把同一份报告交给 `niceeval view --theme`。页内组件按各自 text 面输出：`Hero` 打印标题与运行 meta，[`PoweredBy` 品牌行与 `CopyFixPrompt` 的 text 面零输出](../components/site/README.md)。页内的 `Tabs` 在 text 面按声明序全量输出、不折成索引——tab 没有选择器，索引是死路；内容长到终端读不动，是把 tab 升级成页的信号（见 [Library · Tabs](../library/layout.md#tabs)）。

## 相关阅读

- [Library · 外壳与多页](../library/shell.md) —— 页与外壳的字段穷尽。
- [Library · 内建报告](../library/built-in.md) —— 裸 `show` 装载的定义本体。
- [裸 `show` 的默认报告](default-report.md) —— 当前 Scope 的摘要、散点与实验详情。
- [View](../view.md) —— 同一份文件在网页宿主的路由（`#/page/<id>`、`--page` 定初始页）。
