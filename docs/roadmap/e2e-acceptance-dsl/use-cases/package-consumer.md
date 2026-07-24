# Use Case · 发布包消费边界:触发本设计的案例

## 场景

report 仓库的[候选包外部消费验收](../../../engineering/testing/e2e/report.md#5-渲染面):把候选 niceeval tarball 链接进临时消费方项目,在无 `tsconfig.json` / classic JSX / `react-jsx` 三种配置下从消费方 cwd 执行 `niceeval show --report`,证明 `niceeval/report/built-in` 的预编译 ESM 装载与渲染不受消费方 JSX 配置影响。**这个 case 证明的是发布包模块边界,不重复组件渲染断言**——但现行写法恰恰用组件渲染的字面输出当证据。

## 现行断言

摘自 `e2e/report/scripts/verify-package-consumer.ts`——本设计的直接起因:

```ts
assert.doesNotMatch(combined, /ReferenceError|React is not defined/);
assert.match(stdout, /tool-call/, `built-in report did not render real evidence with ${scenario.name}`);
// scatterHeading() 恒带 better 方向注解,实际标题是
// "Cost(lower is better) × Pass rate(higher is better)",不是裸的 "Cost × Pass rate"
assert.match(
  stdout,
  /Cost\(lower is better\) × Pass rate\(higher is better\)/,
  `built-in report components were not evaluated with ${scenario.name}`,
);
```

注释本身就是病灶的自白:为了让断言通过,预期从「有一张散点图」被迫加码成「散点图标题的完整措辞」——还需要**读源码**(`scatterHeading()`)才能写对。这违反了预期独立性(答案从候选实现反推),且方向注解每次改措辞,三个 scenario × 每次全红。

## 候选写法

`e2e.ts` prepare 阶段搭好三个消费方项目并把路径写进证据清单,测试只读:

```ts
// verify/package-consumer.test.ts
import { cli, evidence } from "@niceeval/verify";
import "@niceeval/verify/matchers";

const ev = evidence();
const scenarios = ["no-tsconfig", "classic-jsx", "react-jsx"] as const;

for (const scenario of scenarios) {
  test(`消费方 ${scenario}:从公开入口装载 built-in 报告并渲染真实证据`, async () => {
    const { stdout, combined } = await cli(
      `pnpm exec niceeval show --report scatter.tsx --results ${ev.resultsRoot}`,
      { cwd: ev.consumerDir(scenario) },
    );

    expect(combined).not.toMatch(/ReferenceError|React is not defined/);

    // 「组件真的被求值渲染了」的证据:图存在、真实事实进了图——不是标题的完整措辞
    await expect(stdout).toMatchTermSnapshot(`
      - heading /Cost .*× Pass rate/
      - section:
        - line /tool-call/
    `);
  });
}
```

- 断言回到这个 case 的本义:**装载成功 + 组件被求值 + 真实证据穿透**。`- heading /Cost .*× Pass rate/` 证明 scatter 组件渲染了;方向注解措辞不再入契约,`scatterHeading()` 怎么改都不红。
- 预期不再需要读源码——「有一张 Cost × Pass rate 的图」从签入的报告文件与公开文档即可写出,预期独立性恢复。
- 三种 JSX 配置从线性循环变成三个命名测试:一个配置崩了,另两个照常跑完,失败报告直接指认是哪种配置的模块边界破了;`vitest -t react-jsx` 单独重跑,不重建全部消费方项目。

## 边界

- **断言了**:公开入口装载不崩、组件被求值、真实事实进入渲染输出、三种配置行为一致。
- **不断言**:图表任何排版细节——组件渲染的逐项契约在 [render-structure](render-structure.md) 与组件 scenario 文件验收一次,本 case 不重复。
- 消费方项目的搭建(mkdtemp、写 tsconfig、pnpm link)属于 prepare 步骤,测试文件里不出现——测试只读证据,这就是[证据生命周期](../README.md#证据生命周期一次产出只读消费)的形状。
