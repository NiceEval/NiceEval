# Agent Install Eval：安装效果评估

[agent-docs 机制](README.md)的全部价值建立在一个假设上：coding agent 读了 `INIT.zh.md` 与随包 `INDEX.md`，就能把 niceeval 正确接入一个真实项目，并写出合格的 adapter / experiment / eval。
这个假设需要证据，不能靠感觉维护。
本篇是一个**独立评估仓库**的总体设计：用 niceeval 自己评「正在安装 niceeval 的 coding agent」，量化安装链路与文档路由的真实效果，为文档文案的每次改版提供回归面。

要回答的三个问题：

1. **装得上吗**——agent 能否自主走完安装链（读 `INIT.zh.md` → 探测项目 → 安装 → `init` → 切换到随包 `INDEX.md`），最终跑通一次 experiment。
2. **写得好吗**——装完写出的三件套质量如何：adapter 是否守住架构硬规则、eval 是否贴宿主项目的真实功能、experiment 是否保持一文件一个配置并明确选择 eval。
3. **文档起作用了吗**——安装后 agent 是否真的以随包 `INDEX.md` 为路由入口、读对了与项目形态匹配的页面，而不是凭训练记忆现编 API。

## 仓库形态

评估仓库是独立仓库，不进 niceeval workspace——自治边界与理由同 [E2E CI 的独立测试仓库](../testing/e2e/README.md)。
它同时是一个正常的 niceeval 用户项目：被测对象是 coding agent CLI（claude-code、codex 等），跑在 sandbox 隔离 workspace 里，任务输入是「把 niceeval 接入这个项目」。
niceeval 评估自己的安装体验，本身就是 sandbox-agent 能力的一次完整使用。

仓库的核心资产是 **fixture 宿主项目矩阵**：每个 fixture 是一个签入的最小真实项目，对应 `INIT.zh.md` 第 2 步的一个判断分支，让评估涵盖不同的接入路径：

| fixture 形态 | 涵盖的接入路径 |
|---|---|
| Vercel AI SDK 应用（`useChat` 后端） | 内置 `uiMessageStreamAgent`，零映射 |
| 自研 HTTP agent loop | 手写 `send` 与事件映射 |
| coding agent 的 Skill / MCP server | sandbox 路径，agent 本体进隔离 workspace |
| 非 JS 项目（如 Python 服务） | 「宿主不是 TS 项目、就地新建 `package.json`」分支 |

每次运行把 fixture 复制进隔离 workspace，注入候选 niceeval tarball（注入模型同 [E2E 的候选包注入](../testing/e2e/README.md)）与安装前文档出处，agent 从零开始自主执行；workspace 结束即弃，不把上一次的产出带进下一次。

## 一条 eval 的形状

- **输入**：fixture 项目 + 一句安装指令（指向 `INIT.zh.md` 的安装前入口）。
- **执行**：agent 在 sandbox 内自主完成探测、安装、写三件套、跑通验证，中途不注入人工提示。
- **断言**：结束后对 workspace 落盘输出和 agent transcript 两个面做断言，分三层评分（见下）。

## 评分维度

三层维度对应开头的三个问题，从精确断言到 judge 逐层放宽：

1. **机制层（精确断言）**：安装链的客观事实——依赖装上且定位到候选包、`niceeval.config.ts` 与托管指引区块存在、typecheck 通过、niceeval 能发现 agent 写出的 eval、experiment 跑通且退出码符合预期。
2. **产出质量层（rubric / judge）**：三件套是否符合公开文档声明的契约——adapter 不做进程内直调、不代管被测进程；eval 输入贴 fixture 的真实功能而不是「你好」式占位；每个 experiment 文件只声明一个配置并用 `evals` 选择任务；judge 模型与被测模型分离。
   评分依据就是随包文档里写给用户的规则，评的是「文档里的契约有没有被读懂并执行」。
3. **路由层（transcript 断言）**：安装完成后 agent 的文档读取行为——是否切换到 `node_modules/niceeval/INDEX.md` 并由它路由，读的页面与 fixture 形态是否匹配，有没有退回官网 `main` 或训练记忆里的旧 API。

## Experiment 维度

对比轴按「回答归因问题」来设：

- **coding agent × 模型档**：同一 fixture 在不同 agent（claude-code / codex）与不同模型档位上的通过率，区分「文档问题」和「模型能力问题」。
- **有无随包文档的对照组**：同一 fixture 一组给完整文档链，一组只给包名只安装包（凭训练数据）。
  两组差值就是 agent-docs 机制本身带来的增量，这是这套机制最直接的价值证明。
- **文档改版回归**：`INIT.zh.md`、`INDEX.template.md` 导语或关键 docs-site 页面改版前后各跑一轮，文案迭代从「感觉更清楚了」变成有分数的回归。

成本与时长由各 experiment 的档位（模型、runs、budget、timeout）控制，不构成设计约束——同 E2E 的立场。

## 结果如何反哺

评估结果的消费方是 niceeval 仓库的文档面，失败按层归位：

- **路由层失败**（agent 不走 `INDEX.md`、路由到错误页面）→ 按 [agent-docs README](README.md) 的边界裁决处理：这是「以有证据的策展补一张小表」或修改 `INDEX.template.md` 导语的触发证据。
- **产出质量层失败**（契约没被执行）→ 定位到没被读懂的那一页 docs-site，按 `docs-site/AGENTS.md` 改写该页。
- **机制层失败**（链路走不通）→ 修订 `INIT.zh.md` 对应步骤或 `init` 的行为。

## 边界

- **评文档链，不评 agent 编码能力**。
  coding agent 与模型是测量仪器，不是被改进对象；对照组设计用于把模型能力从归因中剥离。
- **不与 E2E CI 混同**。
  E2E 验证 niceeval 功能在真实协议下的正确性，本仓库评估文档对 AI 的效果；功能回归不在本仓库的职责内，本仓库变红也不阻塞发版。
- **只评从零接入**。
  已接入项目里的结果查询与诊断链路由 [`agent-debug-eval.md`](agent-debug-eval.md) 评估，两组评估共仓库、fixture 与题面独立。
- **不追求涵盖全部文档页面**。
  fixture 矩阵按接入路径的判断分支组织，一条路径一个 fixture；页面级的文案质量由产出质量层的失败归因倒查，不为每页文档造一个场景。
