# claude-code 磁盘持久记忆使 session-isolation 的口头反证失效

## 现象

e2e 沙箱矩阵首轮真跑,claude-code 的 `session-isolation` 两次尝试都挂在
`gate: excludes("小明")`:`t.newSession()` 之后的"全新会话"仍然斩钉截铁地回答
「你叫小明」。看起来像 `--resume` 泄漏(会话隔离失效),实际不是。

## 根因

第一轮 prompt 里的「帮我记住这个名字」触发了 claude CLI 的**产品级持久记忆**:
events.json 里可见它 `Write` 了
`~/.claude/projects/<project>/memory/user-name-xiaoming.md` 并更新 `MEMORY.md` 索引。
同一沙箱容器内 newSession 后的全新会话按设计重新加载 memory,于是"合法地"知道名字。
会话管线本身是好的——第三轮 transcript 只含新会话的一问一答(resumed 轮才会回放历史),
证明 `--resume` 没有被误传。

## 修法

不跟 agent 的记忆功能打架,改测 resume 管线本身:`AgentProfile` 加 `persistentMemory`
开关(claude-code 置 true),`sessionIsolation` factory 的反面半场分支为断言
「新会话该轮 `turn.events` 里没有回放第一轮的用户原文」;无持久记忆的 agent
(HTTP SDK 项目、codex)保留更强的口头反证 `excludes(...)`。落点:
`e2e/shared/evals.ts` / `e2e/shared/profile.ts` / `e2e/projects/claude-code/profile.ts`。

适用场景:任何对带磁盘记忆的 coding agent(claude-code 及未来同类)写"跨会话不该知道 X"
断言的地方——先问一句这个 agent 有没有记忆功能;有的话口头反证不成立,要改测管线级信号
(transcript 是否回放历史)。
