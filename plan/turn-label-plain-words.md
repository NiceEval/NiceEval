# PLAN：轮标签改自描述词（turn1 / session2/turn1）

契约与裁决：`docs/feature/scoring/library/display.md`「Turn（t.send()）的展示」（轮标签语法单点）＋ `memory/turn-label-plain-words.md`。本计划只列实现落点；标签语义（主会话 `turn<N>`、`t.newSession()` 会话 `session<K>/turn<N>`、等值对照不解析、旧快照不迁移、schemaVersion 不递增）以契约为准。

## 标签铸造（producer）

- `src/context/session.ts`：会话/轮计数处的标签铸造改新语法（主会话不带前缀；newSession 按创建序从 2 编号）；注释里的 `s<session>/t<turn>` 同步。
- `src/runner/types.ts`（`label` 字段注释）与 `src/runner/ledger.ts` 的窗口 commit 调用方：传入的窗口标签即新 token，ledger 本身把标签当不透明字符串，不应有解析逻辑要改。
- `src/scoring`：作用域断言 `name` 前缀铸造处（turn → `turn<N> · `，session → `session<K> · `）；`src/scoring/types.ts` 注释同步。
- `src/results/annotated-source.ts`：注释同步；`deriveSendAnnotations` 缺 turn 节点时的回退标签 `t<i>` → `turn<i>`。

## 展示面（consumer，只改自造记号，不改标签本体）

- `src/show/render.ts`：`--execution` 轮头行去掉 `TURN ` 记号词（首列即标签）；`--timing` turn 节点去掉 `turn ` 前缀词；注释同步。
- `src/report/components/attempt-detail/`：对话/时间树/源码标注各 face 里如有 `TURN` 记号词或自造轮次编号，一并按契约改为原样展示证据 label。
- `src/sandbox/cli-commands.ts`：usage 文案 `--window s1/t2` → `--window turn2`；`--window` 匹配保持字符串等值，未命中时报错并列出可用标签（sandbox cases.md 已登记）。

## 公开面同步义务

- `src/cli.ts` `FLAG_OPTIONS` 里 `--window` 的 JSDoc 改示例 → `pnpm docs:reference` 重新生成中英 `reference/cli.mdx` 的 GENERATED 区块（不要手改区块）。
- `src/i18n/` 两份 `--help` 速查如提及 `--window` 示例，顺手核对。
- `site/src/agent-loop.ts` landing 演示行 `s1/t1 · completed · 3.4s` → `turn1 · completed · 3.4s`，`pnpm run site:build` 验证。
- 英文 docs-site（`troubleshooting/debugging.mdx`、`tutorials/viewing-results.mdx`、`reference/cli.mdx`）由中文页翻译流程同步，不在中文侧之外单独定稿。

## 测试

- 按已登记的场景行写测：`unit-tests/eval/cases.md`（标签铸造）、`unit-tests/results/cases.md`（三处 artifact 同 token；回退 `turn<i>`）、`unit-tests/scoring/cases.md`（作用域前缀）、`unit-tests/sandbox/cases.md`（`--window` 等值命中）、`unit-tests/reports/cases.md`（各面原样展示 label）。
- 既有 fixture 里的 `"s1/t1"` 字面量：标签对消费方不透明，仅在测试断言标签**格式**或跨面**同源**处需要改；纯当作不透明字符串用的 fixture 可保留，但建议顺手换成新 token 以免示例误导。
- 验证：`pnpm run typecheck`、`pnpm test`；在真实 eval repo 里跑 `pnpm exec niceeval show @<locator> --source / --execution / --timing / --diff` 与 `niceeval sandbox history / diff --window turn2`，输出与 docs 示例一致。

## 明确不做

- 不迁移旧快照、不加读取别名：旧标签原样展示。
- 不递增 schemaVersion（理由见 memory 条目）。
