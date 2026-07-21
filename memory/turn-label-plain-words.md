# 设计裁决：轮/窗口标签改为自描述词（turn1 / session2/turn1）

- **日期**：2026-07-21
- **裁决**：贯穿全部证据面的轮标签（`--source` send 标注、`--execution` 轮头、`--timing` turn 节点、`--diff` 与 `diff.json` 的 `windows`、`sandbox history` / `diff --window`、作用域断言 `name` 前缀）改为自描述词：主会话（`t.send`）第 N 轮记 `turn<N>`；`t.newSession()` 会话按创建序编号（主会话为 1，新会话从 2 起），其轮记 `session<K>/turn<N>`，轮次在各自会话内计数。语法单点在 `docs/feature/scoring/library/display.md`「Turn（t.send()）的展示」。同批调整：`--execution` 轮头行不再冠 `TURN` 记号词（首列就是标签）；`--timing` 的 turn 节点不再写 `turn` 前缀词（标签自带词义）；`deriveSendAnnotations` 缺 turn 节点时的回退标签从 `t<i>` 改为 `turn<i>`；session 断言前缀从 `s2` 改为 `session2`。
- **曾选方案**：`s<session>/t<turn>`（`s1/t1`）。**否决理由**：缩写需要图例，第一次读输出的用户不知道 s/t 指什么；而绝大多数 eval 只有主会话，`s1/` 是常量噪音。
- **同场评估并否决**：
  - 跨 session 全局连号 `turn<N>`——并行 session（`Promise.all` 驱动多会话）下按时序连号有竞态，身份不稳定；
  - 恒带前缀 `session1/turn2`——主会话前缀是常量噪音，且与「`t.send()` 是主线、`t.newSession()` 是支线」的 API 形态不对应；
  - 展示用带空格形态（`turn 2`）、机器面用无空格 token 双拼——复制进 `--window` 还要改写，一枚标签两种拼法徒增契约面。
- **schemaVersion 不递增**：标签是不透明同源字符串，全部消费方按字符串等值对照、不解析内部结构（契约里已写明），值语法变化不破坏兼容读取；旧快照的旧标签原样展示，不迁移——与 Results「不做兼容机制」一致。
- **落点**：docs 契约已按新语法重写（display.md 单点 + show 四切面 + sandbox/cli.md + results architecture/library + attempt-detail / metrics / benchmark 提及处 + docs-site/zh 的 debugging / viewing-results）；场景行已登记（eval / results / scoring / sandbox / reports 五份 cases.md）；实现清单见 `plan/turn-label-plain-words.md`（含 `src/cli.ts` `--window` JSDoc → `pnpm docs:reference` 的生成区同步）。
