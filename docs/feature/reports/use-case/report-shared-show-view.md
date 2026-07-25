# `--report` / `--page`:show 与 view 共用同一份自定义报告

## 解决什么问题

内建报告是通用榜单,汇报口径常常是自己的:一张固定题集的成绩单页、一套带品牌外壳的多页站。`--report` 用自己的报告替换整份 pages;官方组件都有 web 和 text 两个渲染面,同一份文件交给 `view` 得到网页、交给 `show` 得到终端输出,同一张 page 在两个宿主保持相同数据口径([契约](../view.md#自定义报告与外壳))。

自定义报告一旦定型,再要求团队每次敲 `--report` 就是重复劳动:把它设成项目默认(下面第 6 步),裸 `show` / `view` 直接是自己的口径,`--report` 退回成「本次换一份」的临时开关。

## 全流程

1. 写报告文件,默认导出恒为 `defineReport` 产物:树形态展开为单张 sample-input page,配置对象形态声明外壳与多张 page(写法见 [Library](../library.md#交给-show-view-渲染))。
2. 浏览器面:

   ```bash
   niceeval view --report reports/exam.tsx
   niceeval view --report reports/site.tsx --page exam   # 多页报告，指定初始页
   ```

   view 只把 `navigation !== false` 的 pages 列进导航,按声明顺序排列。

3. 同一份文件交给终端:多页时渲染初始页(`--page` 指定的页,缺省第一页),尾部附其余页的索引与可复制命令;每一条索引命令都保留当前的 `--record`、`--report` 与位置参数:

   ```bash
   niceeval show --report reports/site.tsx
   niceeval show --report reports/site.tsx --page exam
   ```

4. 范围收窄与页选择正交:位置参数(eval id 前缀)与 `--exp` 先收窄 Sample,`--page` 再选页,全部页共享同一份收窄后的 Sample:

   ```bash
   niceeval show memory/swelancer --report reports/site.tsx --page exam
   ```

5. attempt 下钻用同一份定义:报告声明了 attempt-input page 时,view 的 locator URL 与 `niceeval show @1qrdcfq8 --report reports/site.tsx` 打开的都是这张 page——前者渲染 web 面,后者渲染 text 面。

6. 定型后设成项目默认,把 `defineReport` 产物填进配置的 `report` 字段(收产物本身,不是路径字符串):

   ```ts
   // niceeval.config.ts
   import { defineConfig } from "niceeval";
   import site from "./reports/site";

   export default defineConfig({
     report: site,
   });
   ```

   之后裸 `niceeval show` 与 `niceeval view` 都装载这份定义,`--page`、位置参数收窄、locator 下钻全部照旧:

   ```bash
   niceeval show                    # 自己的报告,不必再写 --report
   niceeval view --page exam
   niceeval show @1qrdcfq8          # 自定义 attempt-input page 的 text 面
   ```

7. 排查「是报告写错还是数据不对」时按次回到内建榜单,不改配置:

   ```bash
   niceeval show --report standard
   niceeval view --report standard
   ```

## 边界

- `--page <id>` 未命中按完整用户反馈报错并列出可用页:`error: page "typo" not found in reports/frontier.tsx. Available pages: report`。
- `--report` 的裸词一律查内建视图名表,不回落到文件探测:想装载文件就写成带路径形(`./reports/site.tsx`),未命中的裸词按完整用户反馈报错并列出可用名字。
- 配置里的 `report` 只影响读面:`niceeval exp` 不装载报告树,报告定义也不进 Run,换报告不必重跑。
- 报告没声明 attempt-input page 时 locator 只是文本,不生成一条会悄悄落回内建详情的命令;要沿用官方详情,显式 `extends: standard`,或把 `standardAttemptPage` 放进自己的 pages([契约](../show/reports.md))。
- `--history` 与 `--report` 互斥,两者都占据主输出。
- 外壳的 `links`、`footer`、`theme`、`seriesPins`、`head`、`scripts`、`styles` 是 web 面属性,`show` 只消费 `title` 与 `pages`;`--theme` 同理只在 `view` 上成立。

## 相关阅读

- [`--report` 的单页与多页](../show/reports.md) —— 终端侧逐 case 的操作步骤。
- [View · 自定义报告与外壳](../view.md#自定义报告与外壳) —— 网页侧路由与外壳消费。
- [Library · 外壳与多页](../library/shell.md) —— page 与外壳的字段穷尽。
