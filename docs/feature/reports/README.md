# Reports —— 查看与呈现结果

实验结束后有三种查看方式,它们读取同一份 [`.niceeval/` 运行产物](../record/README.md),
区别只是交互深度和定制程度。人可以在浏览器复盘,Agent 可以在终端读取同一份自定义业务口径。
报告的双面契约保证两者共享数字与证据,不要求共享几何布局:

| 需求 | 入口 | 适合场景 |
|---|---|---|
| 在终端定位失败、看源码、对话和 diff | [`niceeval show`](show.md) | AI 自主迭代、CI、快速 debug |
| 在浏览器浏览历史、图表和完整证据 | [`niceeval view`](view.md) | 人工复盘、分享静态报告 |
| 定义自己的成绩单、图表或趋势页 | [`niceeval/report`](library.md) | 产品页面、benchmark 站、定制汇报 |

完整工作流见[让人和 Agent 读取同一份自定义报告](use-case/使用宿主/让Agent读取自定义报告.md)。

`show` 和 `view` 都接受 `--report <名字|文件>` 替换同一份 page 声明。报告文件的默认导出恒为 `defineReport` 产物：传一棵报告树会展开为一张 sample-input page；传配置对象还能声明导航外壳并把内容拆成多张 page，其中 `input: "attempt"`、`navigation: false` 的 page 负责 locator 详情；`view` 渲染导航 pages，`show` 渲染初始页并在尾部附其余可导航页索引，写法见 [Library · 外壳与多页](library/shell.md)。

两个宿主装载哪份定义只有一条取值链，三档，前档缺席才落下一档：

| 档 | 取值 | 用途 |
|---|---|---|
| 1 | `--report <名字\|文件>` | 单次运行指定；裸词是[内建视图名](library/built-in.md)（`--report standard`），带路径形是报告文件 |
| 2 | `niceeval.config.ts` 的 [`report` 字段](#项目默认报告) | 项目默认报告，团队里每个人裸跑 `show` / `view` 都看这一份 |
| 3 | 内建 `standard` | 报告、Attempts、追踪三张导航页，加一张 `AttemptDetail` 参数化页（[全文](library/built-in.md)） |

三档产出同一种 `ReportDefinition`，走同一条 `装载 → resolve → validate → render` 管线。所有内容都是 page 内公开组件，没有宿主特权。

**看什么和长什么样是两份制品。** 报告说这份结果给谁看什么，[主题](library/theme.md)说它长什么样；一份主题可以套在任何报告上，一份报告也可以换任何主题。主题因此有自己的一条取值链，四档：

| 档 | 取值 | 用途 |
|---|---|---|
| 1 | `--theme <名字\|文件>` | 单次运行指定；裸词是[内建主题名](themes/README.md)（`--theme basalt`），带路径形是主题文件 |
| 2 | 报告定义的 [`theme` 外壳字段](library/shell.md#字段穷尽) | 这份报告自带的外观，随报告文件一起分发 |
| 3 | `niceeval.config.ts` 的 `theme` 字段 | 项目默认外观 |
| 4 | 内建 [`basalt`](themes/basalt.md) | NiceEval 官方主题：黑色系、零圆角、发丝分隔线 |

`--theme` 只作用于 web 面，是 `view` 的 flag；`show --theme` 报错并指向 `view`。

## 项目默认报告

自定义报告写好后不该要求每个人每次都敲 `--report`。把 `defineReport` 产物填进项目配置的 `report` 字段，裸 `show` / `view` 就装载它：

```ts
// niceeval.config.ts
import { defineConfig } from "niceeval";
import site from "./reports/site";

export default defineConfig({
  report: site,
});
```

字段收 `defineReport` 产物本身，不是路径字符串：配置文件是 TS，import 自己的报告文件即可，写错在类型检查时就暴露。想在内建报告上加外壳或改页，`defineReport({ extends: standard, … })` 的产物同样直接填进来。填了非 `defineReport` 产物（普通对象、React 组件、报告树）按完整用户反馈报错，出处点名配置文件的 `report` 字段。

这个字段只影响读面：`niceeval exp` 不装载报告树，报告定义也不进 Run。要临时回到内建报告排查「是报告写错还是数据不对」，用 `niceeval show --report standard`，不必改配置。

团队品牌同理，`theme` 字段收 `defineTheme` 产物：

```ts
// niceeval.config.ts
import { defineConfig } from "niceeval";
import { acmeTheme } from "./themes/acme";
import site from "./reports/site";

export default defineConfig({
  report: site,
  theme: acmeTheme,
});
```

报告只表达“怎么看”。原始判定、断言、事件、trace 和 diff 的事实归 [Record](../record/README.md)；运行过程中把事实写出去的回调叫 [Reporter](../../runner.md),不属于这里。

## 从哪开始

- 正在修一个失败的 eval：从 [`show`](show.md) 开始。
- 想浏览或发布完整结果站：看 [`view`](view.md)。
- 想写自己的报告：看 [Library](library.md)，先按问题选择数据源与原语，再参考完整示例。
- 想把结果发布成带品牌、外链和多页导航的站点：看 [Library · 外壳与多页](library/shell.md)。
- 想改整站强调色、状态色、图表色板、字体或进一步覆盖 CSS：看 [Library · 主题](library/theme.md)。
- 想自己写数据源或组合组件：看[扩展报告](use-case/构建报告/自定义组件/)。
- 想知道组件里能调用哪些官方函数（格式化、取实验色、文本对齐）：
  看 [Library · 格式化与呈现工具箱](library/presentation.md)。
- 想知道默认报告本身怎么写、怎么逐步改造：看 [Library · 内建报告](library/built-in.md)。
- 想知道字段从哪个文件来：看 [Record Architecture](../record/architecture.md)。
- 想理解共享 helper 中的断言怎样回到入口调用行：看[源码调用树](eval-source/README.md)。

## 相关阅读

- [Show](show.md) —— 终端中的默认报告、attempt 诊断和证据切面。
- [View](view.md) —— 本地网页、结果收窄和静态导出。
- [用例手册](use-case/README.md) —— `show` / `view` 输入与 Library 组件分别在什么真实任务中使用。
- [Library](library.md) —— 数据源、原语、组合组件与常用示例。
- [Theme](library/theme.md) —— 主题制品、四档装载链、令牌全集与完整 CSS 出口。
- [主题目录](themes/README.md) —— 内建主题一览；官方主题 [Basalt](themes/basalt.md) 的取值与主张。
- [Architecture](architecture.md) —— 两个宿主、报告树和可序列化边界。
- [Record Lib](../record/library.md) —— 结果读写库:类型的家、writer、`openRecord`、实验/Run 层次、选择器、身份键;第二档吃它的读取面。
- [Record Format](../record/architecture.md) —— 唯一持久化事实来源。
