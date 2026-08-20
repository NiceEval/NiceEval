# 模型价格表(成本估算)

## 现象

view / console 里 Total Cost 一律 `$0`,因为 `estimatedCostUSD` 只透传 agent 自报的
`usage.costUSD`(`o11y/parsers/bub.ts` 从 transcript 抠 `cost` 字段)。大多数 sandbox 型
agent 只能抠到 token 数、不带 cost,于是恒为 0。`types.ts` 注释早写了「价格表估算」兜底,但从没实现。

## 根因 / 数据源选型

缺一张 `model → 单价` 表。调研结论:

- bundled 的 npm 包(tokenlens 255⭐ / @helicone/cost)都有「发版即冻结」的滞后,数据不够新。
- 事实标准数据源是 **LiteLLM 的 `model_prices_and_context_window.json`**(52k⭐,per-token,key 乱)
  和 **models.dev `api.json`**(anomalyco/models.dev,5.5k⭐,TS,形状干净 `provider→model→cost:{input,output,cache_read,cache_write}` per-1M)。
- 选了 **models.dev**:覆盖全(连 `claude-opus-4-8` 都有)、形状干净、活跃。

models.dev 两个**反直觉点**(踩过):

1. **同一个 model id 横跨多个 provider,单价不同**。`claude-opus-4-8` 在 anthropic / azure /
   bedrock / venice 等 8 个 provider 下都有,venice 是 6/30 的离群 reseller 价,anthropic 才是
   官方 5/25。**必须按第一方 provider 优先取价**,不能随便拿一个。
2. **npm 上的 `models.dev` 包是 version `0.0.0` 占位/构建产物,不能 import**。正经用法是直接吃
   `https://models.dev/api.json`(GeoIP 模式:vendor 进仓 + sync 脚本)。

## 修法

- 价格表 `src/o11y/prices.json`(per-1M USD,随 `files:["src"]` 发布,运行时只读)。
- `src/o11y/cost.ts` `estimateCost(model, usage)`:精确命中 → 去 `provider/` 前缀 → 去末尾日期版本
  做兜底归一;按 input/output/cacheRead/cacheWrite 四桶 × 单价 /1e6;cache 桶缺专门价时退回 input 价;
  无 model / 查不到 / 零用量返回 `undefined`(显示 `—` 而非假 `$0`)。
- 接入点 `runner/run.ts`:`usage.costUSD ?? estimateCost(run.model, usage)` —— 实测优先、估算兜底。

价格表是显式审查后提交的 vendored 快照，不再由 GitHub Actions bot 定时改写。人工刷新时从
`models.dev/api.json` 取数并按同一规则转换：第一方 provider 优先取价，**跳过 input/output 都为 0 的占位条目**
（否则会制造假 $0，2431→2190 条），核对 diff 后再提交 `prices.json`。仓库不保留自动提交脚本或 npm script。

**运行时零网络**：用户拿到打包进 `src/` 的 `prices.json` 快照，`cost.ts` 纯 `readFileSync`；
刷新只在维护者显式执行并审查时联网，不随包发布，也不由 bot 自动提交。

第三个**反直觉点**(jq 重写时撞到):models.dev 里不少 model 被「0/0 占位」provider 抢先(免费转发站),
TS 版按 JSON 插入序选,jq 版按字母序选,结果不同 —— 根因是这些 0/0 条目本就不该入选,必须 `input>0 or output>0` 守卫。
