# `--report`：在终端选择已计划页面

`--report <名称|文件>` 选择一个冻结的 `ReportDefinition`。
带路径的值装载报告模块；不带路径的名称查[内建报告](../library/built-in.md)。无论模块来自何处，show 都先固定一个 `RecordGraphRef`、materialize 一份单 source Sample、校验参数并运行一次 `plan()`；不会让终端页面临时读取 Record。

报告参数由定义的 schema 校验、填入默认值并按 JCS 规范化。模块图、Sample identity、参数和 target 共同确定本次 ReportPlan。

## 单页与多页

单页定义也在 `plan()` 中返回一项 page instance：

```sh
$ niceeval show --report ./reports/frontier.tsx
$ niceeval show --report ./reports/frontier.tsx --page report
```

多页定义的计划顺序就是导航顺序。show 渲染 `--page` 指定的 instance；未指定时渲染首个导航页，并列出同一 Plan 内其余可导航页的复制命令：

```sh
$ niceeval show --report ./reports/site.tsx
…（overview 的 text 面）…

其余页：
  exam   成绩单    niceeval show --report ./reports/site.tsx --page exam

$ niceeval show --report ./reports/site.tsx --page typo
error: page "typo" is not in this ReportPlan. Available pages: overview, exam
```

索引命令保留 `--record`、`--report`、位置参数和 schema 已接受的参数，因此再次执行时仍能形成同一类输入，而不是依赖终端状态。

## 范围与 target 各自负责一件事

位置参数、`--exp` 与 `--run` 只形成 Sample selection；`--page` 只选择已经计划的 page instance。所有页面共享同一份固定 Sample：

```sh
$ niceeval show memory/swelancer --report ./reports/site.tsx --page exam
$ niceeval show --record tmp/shared-record --report ./reports/site.tsx
```

若要改变成员，先在 Sample 层做 `narrowSample()` 或 `unionSamples()`，再运行定义。页面不能按 URL、locator、时间或配置摘要重选 Run contribution。

## Attempt 参数化页

详情页由 `plan()` 按 Sample membership 枚举，而不是由 URL 触发任意取数：

```tsx
export default defineReport({
  plan({ sample }) {
    return {
      pages: [overviewPage, ...attemptDetailPages(sample, { projector: attemptDetails })],
    };
  },
});
```

在固定 Sample 中存在且已由该定义枚举的 locator 可指向对应 instance：

```sh
$ niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E --report ./reports/site.tsx
```

定义没有枚举该 instance 时，show 明确报错；不会回落到另一张官方页面，也不会让 renderer 补发 Projector request。要沿用官方详情，复用 `attemptDetailPages()`；要自定义，改写 instance 的 data 与 `render(data)`，保持它们都在 plan 中可见。

## 默认报告与显示面

项目默认报告与 `--report standard` 都是 ReportDefinition 的选择方式。单 locator 的官方诊断入口仍可由标准定义提供，但显式 `--report` 要求所选定义对该 target 负责。

text 面只消费 executor 已交付的 ReportData 和不可变页面树。`Hero`、`PoweredBy`、`Tabs`、主题和外壳继续保留各自的显示职责；它们不改变 Sample、Calculation、MetricValue 或 evidence。

`--theme` 仍属于 web 面；需要网页主题时，用同一份定义运行 `niceeval view --theme …`。

## 边界

- `--history` 与 `--report` 互斥，因为两者选择不同的主 target。
- 未知页面、不可达 instance、无效参数或不能形成计划时，show 非零退出并指出输入。
- text、web 与导出共享同一次 plan；不能因切换页面而产生额外 Calculation 或 Projector 读取。

## 相关阅读

- [外壳与多页](../library/shell.md) —— page instance、导航与静态外壳。
- [Library · 参数化页](../library.md#参数化页attempt-与-experiment-详情) —— Attempt 与 Experiment 详情的枚举方式。
- [Show](../show.md) —— 固定 Record source、Sample 与内建 target。
- [View](../view.md) —— 同一份定义的 web 和静态交付路径。
