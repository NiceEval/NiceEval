# PLAN-3 —— 最小改动:外部编排 + 能力协商

**相关文档**:[README](README.md) · [GOALS](GOALS.md) ·[LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) ·[PLAN-4](PLAN-4.md) · [DECISION](DECISION.md)

---

## 实现方案 3(最小改动,是否推荐见 [DECISION](DECISION.md))

### 简述

niceeval 不接管服务:多容器环境继续走[环境预置放哪](../../feature/sandbox/library.md#环境预置放哪)的「外部编排」行(`docker compose up -d && niceeval exp …`),或写进 `ExperimentDef.setup`。
niceeval 只补两块最小语义: profile 可声明抽象需求(`requires: ["services"]` 一类的标签),provider 声明能力,缺项计划期 `skipped`;加上[Agent 进程契约](../../roadmap/agent-process-contract/README.md)。
赌注是:假 `failed` 的大头来自「环境不对等没被发现」,把它变成显式 `skipped` 就消掉了大部分危害,编排本身留给成熟的外部工具。

### 优势

- 工程量三案最小,不新增声明词汇、不碰留存与孤儿核对。
- 编排语义 100% 归 compose 等成熟工具,niceeval 零维护面。
- 能力协商与 `skipped` 语义和 PLAN-1 完全同形,做了不浪费——它是 PLAN-1 的第 3 步。

### 缺点

- **R2 / R3 / R7 不满足**:就绪门、判分时服务存活、服务日志证据都在 niceeval 视野之外;服务中途死掉仍是运行期假 `failed`,只是概率被 `skipped` 前置过滤降低。
- **R1 / R4 折半**:服务拓扑不逐 eval 声明,同一批 run 里不同题要不同服务组合时,外部编排只能起并集;服务地址经 env 传入,eval 写死 URL,provider 中性名存实亡。
- **R6 缺席**:外部服务的版本与配置不进指纹,环境变了缓存照常沿用——与[缓存契约](../../feature/experiments/cache.md)的「计划内自变量必须进指纹」直接矛盾,只能靠用户自觉 `--rerun all`。
- **R9 缺席**:强杀路径下外部服务的清理完全靠用户。
- 云 provider 形态残缺:外部编排起在宿主机,E2B / Vercel 的 VM 里 agent 访问不到宿主机的 compose 网络,只能再打隧道——恰是 MemoryBench 里连接错误重灾区的形状。

---

### 架构 / 数据流

```text
用户: docker compose up -d
 → niceeval exp(解析期: requires × capabilities → skipped 或派发)
   → attempt 照现有生命周期跑,服务地址经 env 进入 agent / eval
 → 用户: docker compose down
```

---

### 落地路线

1. profile 的 `requires` 标签 + provider 能力元数据 +`skipped` 语义(与 PLAN-1 第 3 步同一份工程)。
2. 文档把外部编排的组合写成指引(env 传址、清理责任、指纹盲区的 `--rerun all` 义务)。

---

### 验收 / Definition of Done

1. **R5**:声明 `requires` 的 eval 在无能力 provider 上计划期 `skipped`,零沙箱创建。
2. **文档指引**:外部编排用例页含 env 传址与清理责任声明。

**反指标**:

- `skipped` 让分母变小被误读成分数提升。
- 服务半死不活时仍产出 `failed` 并进缓存——本方案对此无机制防御,只能事后人工识别。

---

### 和其它方案的关系

- **vs PLAN-1**:本方案 = PLAN-1 的能力协商切片 + 现状外部编排;PLAN-1 落地后本方案的 `requires` 标签被 profile 推导取代。
- **vs PLAN-2**:不解析 compose,只把 compose 的存在当用户侧事实。
