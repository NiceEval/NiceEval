# 测试组合、Owner 与退役

本篇管理“哪些测试值得存在”，不建立运行时 Registry。目标不是测试最多或覆盖率最高，而是每个会进入发布的
错误都有一个最早、稳定、可读的 owner，并且同一矩阵不在多层复制。

## 两种存在资格

| 身份 | 必须回答 | 数量规则 |
|---|---|---|
| Result / Journey | 删掉后会放走哪个稳定用户错误？为何更低层看不到真实边界？ | 每个结果一个主 owner |
| Mechanism | 哪一类错误算法会通过？为何 Result 无法稳定制造或区分？ | 每个具名风险一个矩阵 owner |

下列理由不能单独让测试存在：新增函数、分支、DTO 字段、DOM class、snapshot、line coverage，或“离实现近一点更放心”。

## 覆盖表

每个产品域在自己的 testing 文档维护一张小表，目标形状如下：

| 用户结果 / 机制风险 | 形态 | Owner | Lane | 历史 bug |
|---|---|---|---|---|
| `show --json` 经 pipe 完整交付 | Result | `e2e/cli/test/show-json-pipe.test.ts` | PR / release | `d8d5a84b` |
| CJS 项目 `init → list` | Journey | `e2e/package-cjs/test/init-list.test.ts` | PR / release | `b44420d3` |
| Codex SDK 工具事件规范化为 `shell` | Result + Unit | adapter Repo + transformer matrix | main / nightly | `060a6a05` |

表只回答 owner 和运行档，不复制 argv、fixture、expected 或步骤。执行真相仍在测试文件，lane 真相在 Repo manifest。

## 唯一矩阵 Owner

一个等价类只在一个位置完整展开。例如 fingerprint 哪些输入参与身份由 unit 表驱动穷举；真实项目“只重跑发生变化的
Eval”由一条 Result 证明接线。human、JSON、Report 和 runner 不再各复制一份 fingerprint 全矩阵。

其它层若要保留代表，必须指出它排除的不同错误实现：

- schema unit 证明编码形状；
- CLI Result 证明安装后进程与落盘接线；
- Journey 证明跨域的 locator 能继续交给 show / view；
- 三者不是因为“多测一层”，而是观察不同边界。

## Fixture 变化预算

Unit fixture 只显式填写本 case 有语义的字段；机械默认值由测试专用 builder 补齐。builder 只造输入，不计算预期。

Result / Journey 不手写内部 Run、Attempt 或 Report DTO；它们通过真实 Eval / Experiment 产生结果，再从公开 CLI、包导出、
HTTP 或浏览器读取。只有“旧 Record 兼容性”本身是契约时，才签入最小旧格式 fixture，并把 schema version 写成独立字面量。

合理的变化预算：

| 变化 | 允许修改的测试 |
|---|---|
| 内部重构、DTO 增加无关字段 | 不应修改 Result / Journey；只改真正依赖该机制的 unit |
| 公开输出新增可选字段 | 旧结果测试通常不改；新增结果需要新断言时才改 owner |
| 公开格式破坏性升版 | 对应 contract owner 与显式旧版兼容 fixture |
| 用户任务或结果改变 | 对应 Result / Journey 和产品文档 |

目标不是测试永远不改，而是测试变化与公开契约变化同范围。

## 历史 Bug 回归

Bug escape 后按顺序处理：

1. 找本应捕获它的现有 owner；
2. owner 命题正确但 fixture / 断言无区分力时，修它，不并排建第二套；
3. 只有现有 owner 无法表达独立错误算法或真实边界时，才新增测试；
4. 在测试头写 `regression: <fix commit / memory>`，标题仍描述长期结果；
5. 用 fix parent、历史 worktree 或最小逆补丁确认新测试会红；当前候选应绿；
6. 删除被替代的重复测试。

无法杀死旧实现的 case 只能叫补充覆盖，不能宣称“防住了这个历史 bug”。

## 迁移与退役

迁移一批旧测试时提交一张简短对账表：

| 旧测试 | 判定 | 新 owner / 理由 |
|---|---|---|
| 线性 CLI 大脚本的一段 | 拆分 | 原生 Result 文件，可按标题单跑 |
| 内部宿主模拟外部 cwd | 删除 | Package 场景 Repo 已从候选 tarball 证明 |
| 完整 DTO snapshot | 删除 / 收窄 | 无公开契约；独有算法留最小 unit |
| 会修改共享结果的 readback | 隔离 | 独立 Repo 或独立结果根，不靠顺序 |

新旧测试不能无限期并行。新 owner 只有通过当前候选、历史 bug kill 和本地单项重跑后才接管；接管同批删除旧 owner。

## 可读性 Review

评审测试按下面顺序读，不需要先找其它声明：

1. 标题承诺的用户结果是什么？
2. 哪一行是真实公开动作，完整 argv 在哪里？
3. expected 是否独立、是否就在附近？
4. 失败会停在哪个 prepare / invoke / observe / outcome / cleanup 阶段？
5. 它杀死哪个旧错误或排除哪个错误算法？
6. 是否已有另一层完整复制同一矩阵？
7. 内部无关字段或 CSS 重命名会不会迫使它修改？

前三项需要跨多个声明文件才能回答，或第 5 项无法回答时，先改测试设计，不扩充 helper / Registry 掩盖问题。

## 周期复核

测试跟改率用于每次大迁移前后和至少每半年一次的人工诊断，不作为 CI 红绿门禁。固定命令、历史基线和本方案如何
针对旧问题见 [新体系如何避免旧问题](history-problems.md)。

复核期待看到：内部重构不再批量触碰 Result / Journey；头部高跟改文件能解释为真实契约变化；被迁移的大脚本和 DTO
fixture 不换名字重新长回来。若仍反复修改，优先检查 layer、oracle 和共享状态，不把门槛改成“多写几个测试”。
