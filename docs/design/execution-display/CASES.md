**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [DECISION](DECISION.md)

# Cases

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| C1 | 游戏应用里 NPC 说了什么 | 自定义 Adapter 在一次 Attempt 中写入 3 条 NPC 台词事件，payload 含 `npcId`、`line`、`mood` | `show @x --execution` 每条事件显示说话者与完整台词（outline 内超长时有界预览并可展开）；View 显示同样内容；JSON 只在展开时出现 |
| C2 | 外部 HTTP 应用的一次调用发生了什么 | 事件 payload 含 method、path、status、latency；完整响应体是 JSON 附件 | outline 显示 method、path、status、latency 的键值；展开后可经 evidence 读取完整响应体 |
| C3 | 生图应用生成了什么图 | 一张 PNG 经 `ctx.attach` 接纳，事件引用它 | View 内联显示图片与替代文本；终端显示替代文本、媒体类型、大小与可复制的读取命令 |
| C4 | 别人拿到 Snapshot 能看懂吗 | C1 的 Record 导出为 Snapshot，在没有项目源码的另一台机器用同版本 NiceEval 打开 | `show` 与 View 显示与原机相同的展示，不报 Adapter 缺失 |
| C5 | Agent 与自定义应用混在一个实验 | 同一 Experiment 中一个 Eval 用 Codex，一个 Eval 用 C1 的游戏 Adapter；另有一个 Agent Adapter 同时 `recordTrace` | 两者 outline 都可读；每个 Attempt 都按 Events、Conversation、Commands、Diagnostics 顺序显示各自状态；renderer 无 Adapter 名分支 |
| C6 | 老结果还能看吗 | 本决策前写入、没有展示信息的 Record | 照常显示 summary 与 JSON，不报错，不生成展示 |
| C7 | 恶意或超大展示内容 | 事件文本含 ANSI 转义、`<script>`、NUL，或超过展示预算 | 写入时拒绝整份快照并登记采集失败，或在明确上限内截断并标注；终端不执行转义，浏览器不解释 HTML |
| C8 | 原来的 Agent 调试体验还在吗 | `e2e/inspection/test/show-cli.test.ts` 现行 fixture：一个 Agent Attempt 有 conversation、tool occurrence 与 command | `--execution` 仍含 `Conversation · <state>`、`Commands ·`、`Stable identities`、tool input 与 result；`--expand` 接受 `itemId`、`toolOccurrenceId`、`commandId` 并返回专用 detail；`t1.c1`、`cmd1` 仍被拒绝。现有断言无需修改 |
| C9 | 轨迹保存在应用自己的系统里 | RPG 游戏服务器保存完整对局轨迹；Adapter 只知道对局 ID `run_8f2c` 与查询命令 `rpg-cli trace show run_8f2c` | `show @x --execution` 显示一句说明与可复制的查询命令；Events section 标为 partial 并说明完整轨迹在外部；命令中不含 token 或其它 secret |
