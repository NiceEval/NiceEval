# 同形的两个具名 Spec，TypeScript 拦不住互换——「类型层拒绝」不能这么承诺

**现象**:`docs/feature/adapters/coding-agent-skills-plugins.md` 的设计规则 5 曾写「`ClaudeCodePluginSpec` 不能传给 Codex，`CodexPluginSpec` 不能传给 Claude Code」。实现时发现这句做不到。

**根因**:**TypeScript 是结构类型系统**。`ClaudeCodePluginSpec` 与 `CodexPluginSpec` 的字段形状当时完全相同(`marketplace: { name, source, ref? }` + `name`),同形即互相可赋值——**给类型起两个不同的名字,本身不产生任何拒绝**。想真的拦住,只能加判别字段(各自必填 `agent: "claude-code"` / `"codex"`)或品牌化(`__brand`)。

**当前状态(2026-07-12):止血已做,最终形态待裁决——用户定于次日处理,别当成已结案。**

止血(已落地):文档不再承诺做不到的事。改成——类型层负责的是「**不支持的能力根本不存在**」(Bub Config 没有 `mcpServers` / `plugins`,Claude Code 与 Codex Config 没有 `pythonPlugins`,这类无效组合确实编译不过);类型层**不**负责拦住「把只有 Codex 能读的 Marketplace 递给 Claude Code」——那是 `source` 的**值**不合法,不是形状不合法,装不上时由该 Adapter 报错。类型本身一行没动。

**待裁决:要不要让编译器真的拦住互换?** 三个选项——

1. **维持现状**(只靠字段位置声明归属:`plugins` 写在 `claudeCodeAgent({…})` 里就是 Claude Code 的)。代价:互换编译得过,错误留到运行期。
2. **加判别字段**(各自必填 `agent: "claude-code"` / `"codex"`)。代价:用户要把同一件事写两遍(已经在 `claudeCodeAgent(…)` 里了,再声明一次是纯仪式)。
3. **品牌化**(`readonly __brand`)。代价:类型噪声,且对用户是不可见的魔法。

裁决时要先回答的问题:**互换到底会不会真的发生、发生了后果多严重?** 两个 Spec 同形,互换后数据完全一样,真正的错只会是 `marketplace.source` 指向了这家读不了的地方——而**那个错任何选项都拦不住**(值不是形状)。若答案是「拦住的只是一个不会犯、犯了也另有报错的错」,选项 1 就够。

**教训**(与裁决无关,已确定):写「无效组合在类型层拒绝」这类契约前,先分清要拦的是**形状**还是**值**。结构类型只拦形状;值的合法性(URL 指向谁、名字对不对)永远得留到运行期。**名字不同 ≠ 类型不同。**

**教训**(可复用):写「无效组合在类型层拒绝」这类契约前,先分清要拦的是**形状**还是**值**。结构类型只拦形状;值的合法性(URL 指向谁、名字对不对)永远得留到运行期。名字不同 ≠ 类型不同。
