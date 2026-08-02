# Use Case · 发布包消费边界:触发本设计的案例

## 场景

report 仓库的[候选包外部消费验收](../../../engineering/testing/e2e/report.md#5-渲染面)会把候选 niceeval tarball 链接进临时消费方项目。
消费方分别使用无 `tsconfig.json`、classic JSX 与 `react-jsx` 三种配置,并从自己的 cwd 执行 `niceeval show --report`。
这条验收证明 `niceeval/report/built-in` 的预编译 ESM 装载与渲染不受消费方 JSX 配置影响。
**这个 case 证明的是发布包模块边界,不重复组件渲染断言**——但现行写法恰恰用组件渲染的字面输出当证据。

## 现行断言

摘自 `e2e/report/scripts/verify-package-consumer.ts`——本设计的直接起因:

```ts
assert.doesNotMatch(combined, /ReferenceError|React is not defined/);
assert.match(stdout, /tool-call/, `built-in report did not render real evidence with ${scenario.name}`);
// scatterHeading() 恒带 better 方向注解,实际标题是
// "Cost(lower is better) × Pass rate(higher is better)",不是直接 "Cost × Pass rate"
assert.match(
  stdout,
  /Cost\(lower is better\) × Pass rate\(higher is better\)/,
  `built-in report components were not evaluated with ${scenario.name}`,
);
```

注释本身就是病灶的自白:为了让断言通过,预期从「有一张散点图」被迫加码成「散点图标题的完整措辞」——还需要**读源码**(`scatterHeading()`)才能写对。
这违反了预期独立性(答案从候选实现反推),且方向注解每次改措辞,三个 scenario 每次全红。

## 候选写法

prepare 搭好三个消费方项目并写进 world manifest,Behavior 只读:

```ts
// Behavior 声明(id / task / contract / primary / execution)的字段形状见 PLAN-2;这里只看正文。
for (const scenario of ["no-tsconfig", "classic-jsx", "react-jsx"] as const) {
  reportBehavior(loadsBuiltInReport(scenario), async () => {
    const { stdout, combined } = await cli(
      `pnpm exec niceeval show --report scatter.tsx --record ${w.resultsRoot}`,
      { cwd: w.consumerDir(scenario) },
    );
    expect(combined).not.toMatch(/ReferenceError|React is not defined/);

    const report = reportView(stdout);
    // 「组件真的被求值渲染了」的证据:图存在、真实事实进了图——不是标题的完整措辞
    expectObserved(report.chart({ x: "Cost", y: "Pass rate" }).seriesIds()).toHaveSeries(["main"]);
    expectObserved(report.table("Attempts").rowIds()).toShowRows(["tool-call"]);
  });
}
```

- 断言回到这个 case 的本义:**装载成功、组件被求值、真实证据穿透**。
  `report.chart({ x: "Cost", y: "Pass rate" })` 按两轴的公开维度名寻址,方向注解措辞不进契约,`scatterHeading()` 怎么改都不红。
- 预期不再需要读源码——「有一张 Cost × Pass rate 的图」从签入的报告文件与公开文档即可写出,预期独立性恢复。
- 三种 JSX 配置从线性循环变成三个 Behavior。
  一个配置崩了,另两个照常跑完,失败报告直接指认是哪种配置的模块边界破了。
  `pnpm e2e -- verify --world … --behavior …` 可以单独重跑,不重建全部消费方项目。

## 回归剧本

| 真实踩坑 | 现象 | 新写法在哪一步红 |
|---|---|---|
| [跨项目 cwd 装载报告文件](../../../../memory/report-load-foreign-cwd-jsx-runtime.md) | 宿主 cwd 的 tsconfig 决定 JSX runtime,报告文件编译成 `React.createElement` 后报 `React is not defined` | invoke 阶段:`cli()` 的非零退出带命令原文与 stderr 尾部,三个 scenario 各自成败,红的那个就是缺 `react-jsx` 的那种配置 |
| [用 HEAD 的 bin 渲染他仓报告文件](../../../../memory/e2e-report-file-cross-package-module-split.md) | 两份 `dist/report` 各持一份模块级状态,locator 深链静默退化成纯文本,不报错不崩溃 | declaration 阶段:producer symbol closure 与 producer 环境各自摘要,混用入口产出的 world 与 recipe 身份不符,`verify --world` 直接拒绝,不进断言 |

第二条是这套设计最省时间的一处。
现行流程里它表现为「渲染面断言莫名全绿又全错」,排查半天才定位到用错本地入口;身份摘要把它前移成一句「world 身份不匹配」。

## 边界

- **断言了**:公开入口装载不崩、组件被求值、真实事实进入渲染输出、三种配置行为一致。
- **不断言**:图表任何排版细节——组件渲染的逐项契约在 [render-structure](render-structure.md) 与组件 scenario 文件验收一次,本 case 不重复。
- 消费方项目的搭建(mkdtemp、写 tsconfig、安装候选 tarball)属于 prepare 步骤,Behavior 正文里不出现——测试只读证据；生命周期与权限见[测试方案的 Evidence world](../../e2e-acceptance-testing/README.md#evidence-world-与衔接)。
</content>
