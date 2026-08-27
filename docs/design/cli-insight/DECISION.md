**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md)

# Decision

## 状态

选择 [PLAN-3](PLAN-3/README.md)：fixed Inspection operations 由 machine `query`、human terminal `show`
与 runtime browser `view` 消费。独立只读 re-grill 已针对原修正版 PLAN-3/A 给出最终 `PASS`；
其中删除 `show` 的子决策被本裁决翻案。此裁决仍以 source/selection 正交、sealed-only Snapshot、
各 consumer 私有呈现层及 lifecycle-only View JSON 为前提。

## 已定边界

- 公开 query 命令只有 `discover`、`explain`、`run`；全部是 `niceeval.query/v1` machine-only protocol。
- 终端人读入口是只调用固定 Inspection operation 的 `niceeval show`。
- 浏览器人读入口是 `niceeval view [@locator | --run <id>...] [--record <RecordSnapshot>]`，
  另接受 `--no-open`、`--port <port>` 与 `--json`。
- Snapshot 只由 `niceeval record snapshot --output <snapshot>` 导出。
  它带 artifact kind、revision、content identity、export provenance、logical closure identity 与 exact Seal。
- 无 `--record` 时 Host 定位 operational Store，仅读 sealed cutoff，且 View 可以 refresh；有 `--record` 时只读 Snapshot，绝不 refresh 或 watch。
- `show --json`、`show --report`、history/stats/free statistics、`insight`、`view --out`、静态
  Preview、静态 export、匿名 URL 和兼容别名全部移除。`show` 不恢复 Page、theme、component
  或 renderer 作者面，也不接受旧显示位置 handle。

## 依据

固定 operation catalog 把选择、分母、partial、missing、issues、Evidence 与 comparison 留在唯一业务 owner。
query、show 与 View 因而只需要各自编码或显示闭合结果，不能把 terminal 与浏览器的
实现细节伪装为共享抽象。恢复 show 是因为固定的快速终端审阅不能由 machine JSON 或启动浏览器
合理取代；它不恢复旧 Report 作者树。

source 与 selection 分离避免把“从哪里读”误写为“看哪些 Run”。operational Store 是 Host 发现的可刷新本地能力；Snapshot 是带 exact Seal 的可移植内容 artifact。二者都只向 Inspection 提供同一种 sealed facts，不共享 runtime lifecycle。

静态 export 会把服务、页面资产和离线使用承诺成另一条长期产品面。此方案只支持把 Snapshot 交给兼容 NiceEval runtime 后再启动 View，因而不需要维护静态 writer、URL 托管或浏览器离线兼容性。

## 后果

- 新的运行后问题必须新增具名 operation 或扩展其穷尽 union，不能注册通用公式、SQL、Page 或 renderer。
- `view --json` 是进程协调信号而不是 Inspection result；只能发 `ready`、`closed`、`failed`。`ready` 交付带一次性
  fragment credential 的 loopback URL，CI 必须脱敏且不能上传原始 stdout；终态事件不交付可复用 session material。
- Snapshot 验证、密封 cutoff 与 migration 错误是 Record Host 的责任；Inspection 既不修复也不迁移输入。
- 存储层 sanitization 只约束 artifact 中哪些 bytes 可存在，不等同于业务脱敏；分享者仍须判断自己的 Record 事实能否交给接收者。

## 未选方案

[PLAN-1](PLAN-1/README.md) 把 query 与浏览器绑定到作者 Page。[PLAN-2](PLAN-2/README.md) 仍把通用
Analysis recipe、旧 show 宽表面与 Insight 作为长期面。恢复一个受限的 fixed-operation renderer
不采用 PLAN-2 的通用作者能力或自由统计边界。
