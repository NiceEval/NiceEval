# `--json`(AI 循环):让 coding agent 驱动「跑→读失败→改→重跑」

## 解决什么问题

让 Claude Code / Codex 这类 coding agent 替你修 eval 失败:它自己跑 niceeval、读失败证据、改代码、再跑。human live 面板对它全是噪音——原地重绘、spinner、框线和 ANSI 都要浪费上下文去解析,整份 transcript 塞进去更是灾难。它真正需要三样:退出码、失败的稳定身份(locator)、按需下钻的证据入口。运行流加 `--json` 得到可直接解析的 NDJSON 事件;深读证据一律交给 [`niceeval show`](../../reports/show.md)(要结构化就同样加 [`--json`](../../reports/show/json.md))。

## 全流程

1. agent 先 `--dry --json` 看将运行什么,确认选择没扩大(单 JSON 文档,不是流):

   ```sh
   niceeval exp compare memory/commit0 --dry --json
   ```

2. 实跑。`stdout` 只追加低频事件:`start` 一行;失败、错误立即一条;连续 30 秒没有永久事件才补一条 `progress` 心跳。普通状态变化不触发输出(事件词表单源见 [CLI · 机器怎么读](../cli.md#机器怎么读--json)):

   ```sh
   niceeval exp compare memory/commit0 --json
   ```

   ```json
   {"format":"niceeval.exp","schemaVersion":1,"event":"start","total":5,"configs":5,"concurrency":4,"reused":1}
   {"event":"failure","locator":"@17m2k9pq","evalId":"memory/commit0-cachetool","experimentId":"compare/bub-e2b","severity":"gate","assertion":"cache tool is invoked","matcher":"calledTool(\"cache\")","received":"0 tool calls"}
   {"event":"result","status":"failed","passed":4,"failed":1,"errored":0,"reused":1,"completion":"complete","snapshots":[".niceeval/compare/bub-e2b/<run>"]}
   ```

3. 用 locator 只展开所需证据,不整段拉 transcript:

   ```sh
   niceeval show @17m2k9pq
   niceeval show @17m2k9pq --execution
   ```

4. 修复后只重跑受影响项;正常依赖指纹缓存,通过项不重付(怀疑缓存口径时才配 [`--rerun all`](rerun.md)):

   ```sh
   niceeval exp compare/bub-e2b memory/commit0-cachetool --json
   ```

5. 收工前全量验证,退出码 `0` 才算完成——agent 不靠自然语言猜成败。

## 边界

- 事件流不是另一份结果 schema;权威数据是 Run 与 attempt artifacts,批量分析走 [`show --json`](../../reports/show/json.md) 或 [Results](../../record/README.md) 读取面。
- 不解析运行流也完全可行:跑默认人读文本、只看退出码,失败后直接 `niceeval show`。`--json` 是需要程序化消费运行事件(计数、看板、并行编排)时的入口。
- `failure` 事件只带主失败断言的有界字段;完整 assertions、源码、execution、diff 按需 `show` 下钻。

## 相关阅读

- [CLI · 机器怎么读](../cli.md#机器怎么读--json) —— 事件词表、心跳节奏与 `result` 事件的单源。
- [`--json`(CI 门禁)](json-ci-gate.md) —— 同一形态的另一类消费者。
