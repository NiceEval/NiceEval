# `--report` / `--page`:show 与 view 共用同一份自定义报告

## 解决什么问题

内建报告是通用榜单,汇报口径常常是自己的:一张固定题集的成绩单页、一套带品牌外壳的多页站。`--report <file>` 用报告文件替换整份 pages;官方组件都有 web 和 text 两个渲染面,同一份文件交给 `view` 得到网页、交给 `show` 得到终端输出,同一张 page 在两个宿主保持相同数据口径([契约](../view.md#自定义报告与外壳))。

## 全流程

1. 写报告文件,默认导出恒为 `defineReport` 产物:树形态展开为单张 scope-input page,配置对象形态声明外壳与多张 page(写法见 [Library](../library.md#交给-show-view-渲染))。
2. 浏览器面:

   ```bash
   niceeval view --report reports/exam.tsx
   niceeval view --report reports/site.tsx --page exam   # 多页报告，指定初始页
   ```

   view 只把 `navigation !== false` 的 pages 列进导航,按声明顺序排列。

3. 同一份文件交给终端:多页时渲染初始页(`--page` 指定的页,缺省第一页),尾部附其余页的索引与可复制命令;每一条索引命令都保留当前的 `--results`、`--report` 与位置参数:

   ```bash
   niceeval show --report reports/site.tsx
   niceeval show --report reports/site.tsx --page exam
   ```

4. 范围收窄与页选择正交:位置参数(eval id 前缀)与 `--exp` 先收窄 Scope,`--page` 再选页,全部页共享同一份收窄后的 Scope:

   ```bash
   niceeval show memory/swelancer --report reports/site.tsx --page exam
   ```

5. attempt 下钻用同一份定义:报告声明了 attempt-input page 时,view 的 locator URL 与 `niceeval show @1qrdcfq8 --report reports/site.tsx` 打开的都是这张 page——前者渲染 web 面,后者渲染 text 面。

## 边界

- `--page <id>` 未命中按完整用户反馈报错并列出可用页:`error: page "typo" not found in reports/frontier.tsx. Available pages: report`。
- 报告没声明 attempt-input page 时 locator 只是文本,不生成一条会悄悄落回内建详情的命令;要沿用官方详情,显式 `extends: standard`,或把 `standardAttemptPage` 放进自己的 pages([契约](../show/reports.md))。
- `--history` 与 `--report` 互斥,两者都占据主输出。
- 外壳的 `links`、`footer`、`theme`、`head`、`scripts`、`styles` 是 web 面属性,`show` 只消费 `title` 与 `pages`。

## 相关阅读

- [`--report` 的单页与多页](../show/reports.md) —— 终端侧逐 case 的操作步骤。
- [View · 自定义报告与外壳](../view.md#自定义报告与外壳) —— 网页侧路由与外壳消费。
- [Library · 外壳与多页](../library/shell.md) —— page 与外壳的字段穷尽。
