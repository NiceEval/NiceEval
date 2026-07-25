# 从终端做跨条件归因

## 解决什么问题

同批 eval 跑了 baseline 与一个或多个处理条件(加记忆、换 prompt、开联网),你要回答三层递进的问题:整体差多少、哪些题翻转了、翻转的那道题里 agent 具体做对/做错了什么。全程只用 `niceeval show`,不写解析脚本、不翻 `.niceeval/` 原始文件。

## 全流程

1. **整体与逐题对照**:`niceeval show --exp memory/claude-baseline --exp memory/claude-mempal` 输出[对照矩阵](../show/compare.md)——逐 eval 一行、`⇄` 标出判定翻转的行、尾部对基准的通过率 / tokens / 成本差值。第一个 `--exp` 是基准。
2. **确认计划条件与实际观测**:先核对 experiment 的 flags / model / agent / sandbox 配置确实构成对照，再看 [facts](../../record/architecture.md#facts运行事实)（如 `memory.notes=73`）确认实际起步状态。facts 是运行后审计值、不参与缓存；外部状态变过而配置未变时先 `--rerun all`，不能拿携带结果上的旧 fact 当当前条件。
3. **效率归因**:`--usage` 换到[用量切片](../show/usage.md),逐题看 `uncached in` 与 `cache read` 的拆分——协议逐轮重发上下文时,膨胀多在 cache read,这层拆分决定「贵在哪」的结论。
4. **行为归因**:对翻转的题,`niceeval show pr-6058 --exp A --exp B --json` 收窄后从各条件 cell 的 `attempts` 拿两侧 locator(text 矩阵是聚合视图,不逐格展开 locator),再各自 `--execution` 通读;横跨整个条件的行为问题(「每个 attempt 都 search 了吗、查了什么词」)用 [`--execution --grep`](../show/execution.md#范围化跨-attempt-扫描与---grep) 一次扫完,命中卡片被截断时按尾巴里的 `--expand` 句柄展开全文。
5. **先排除环境与题目本身**:归因翻转前,`niceeval show --stats` 看[稳定性矩阵](../show/stats.md)——`never ✓` 的题先审题目质量,`!`(执行错误)扎堆的列先修 provider 限流/并发,两者都不该记到条件头上。
6. **交给脚本或后续 agent**:以上任何一步加 [`--json`](../show/json.md) 得到同一选择范围的结构化数据超集,拼趋势、进 CI、喂给下一个分析步骤。

## 边界

- 单点翻转先对方差:同条件两次 run 的 pass 数波动可能大于条件间差值,结论要建立在矩阵的整体位移上,不建立在单题翻转上。
- 要发布可分享的对照报告时,用报告库的 [`DeltaTable`](measure-ab-delta.md) 走 `view` / 静态站;CLI 矩阵服务终端里的即时归因。
- 需要比 show 视图更自由的读取(自定义聚合、跨记录根拼接)时,消费 [`niceeval/record` 库读取面](../../record/library.md),仍然不直接碰磁盘布局。
