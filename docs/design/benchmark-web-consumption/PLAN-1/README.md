# PLAN-1：Data-first

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [DECISION](../DECISION.md)

## 稳定公共面

NiceEval 发布 framework-neutral 的 closed data definition、materialization 与 reader contract。网页组件、DOM、CSS、router、chart、a11y 与 i18n 全部由用户拥有。

```text
trusted build/server → NiceEval data materialization → closed public data
                                                        ↓
                                     user React/Vue/Astro/chart/HTML
```

候选 API 形状：

```ts
const definition = defineBenchmarkData({
  resources: {
    comparison: frames({ sets, measures, alignment }),
    attempt: domainView({ view: attemptEvidence, locator: parameter("locator") }),
  },
});

const snapshot = await materializeBenchmarkData({ definition, selection, parameters });
```

名字与精确 wire schema 只属于本候选；在本主题定案前不进入 `CONTEXT.md` 或 Feature。

## Static / dynamic

Static build 在受信任进程中 materialize 完整关闭的数据，再交给用户站点 build。Dynamic 由用户 server 完成鉴权、selection 与 materialization，再向 browser 返回 closed data。

本候选倾向让两条路径使用相同版本化数据 schema，但是否采用同一文件 transport、内容身份、分页或公共 server 仍需通过 W3–W6 证明。

## Cases 与代价

- W1、W8 最强：任何 framework 与 DOM 都直接消费数据。
- W2、W7 较弱：每个项目要自己实现 loading、revision、MetricValue 状态、Evidence 交互、a11y 与 i18n。
- W3–W6 要把 schema、identity、corruption、budget 与大型材料变成长期公共协议。
- 用户仍能误用 side-by-side scalar；NiceEval 只能保留 comparability，不能控制用户图表。

## 重新裁决触发器

若真实 React / Astro dogfood 的大部分代码都在重复相同的状态与无障碍适配，data-only 可能没有足够产品 DX。
