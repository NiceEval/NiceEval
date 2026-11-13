# 用一句话完成安装与首次运行

## 用户目标

项目维护者想给自己的系统接上评估，但不想先读一遍 NiceEval 的文档。
他希望把一句话交给项目里的 coding agent，最后看到一条对真实系统跑过的结果。

## 起始状态

仓库里还没有 NiceEval。这台机器能安装 Node 依赖并运行 Node 命令，agent 能读取公网 URL。
被测系统可以是任何语言；它需要的凭据、数据库或模型服务由用户提供。
本篇是预期用法，输出均为预期结果。

## 完整路径

1. 用户从官网复制这句话，发给 agent。 {#paste}

   ```text
   READ https://niceeval.com/INIT.md and install niceeval for this repo.
   ```

   预期结果：agent 读取 `INIT.md`，把其中的清单转成自己的待办，并说明完成标准是“跑通一条真实评估”，不是“装上依赖”。

2. agent 判断依赖归属，安装并初始化。 {#install}

   ```sh
   pnpm add -D niceeval
   pnpm exec niceeval init
   ```

   预期结果：依赖进入仓库现有的工具项目与锁文件；`init` 生成配置与 `evals/`，并写入项目指引。
   agent 在仓库根目录用交付给用户的那条命令运行 `--version` 与 `list`，确认本地 CLI 可用。
   包管理器不是 pnpm 时，agent 使用仓库已有的那一个。

3. agent 转入随包文档。 {#handoff}

   ```sh
   test -f node_modules/niceeval/INDEX.md
   ```

   预期结果：agent 读 `INDEX.md`，选中“Coding Agent 从零接入项目”这一页，此后的每一步都照随包页面做。
   从这一步起它不再读官网或 GitHub `main` 来判断 API。

4. agent 探索项目，把接入计划告诉用户。 {#plan}

   预期结果：agent 说明它找到的核心用户任务、要连接的入口与协议、服务怎样启动与就绪、凭据放在哪里。
   只有缺少会改变被测目标、凭据边界或费用的决定时，它才向用户提问；用户回答后继续。

5. agent 写出 Adapter、Experiment 与 Eval，并真实运行一次。 {#run}

   ```sh
   pnpm exec niceeval exp <experiment> --dry
   pnpm exec niceeval exp <experiment>
   ```

   预期结果：`--dry` 列出将要运行的评估与次数；真实运行结束后得到 receipt 与 Run ID。
   至少一条 Attempt 是 `passed`、`failed` 或带得分，而不是 `errored`。

6. agent 交接。 {#report}

   ```sh
   pnpm exec niceeval show --run <run-id>
   ```

   预期结果：agent 列出新增与修改的文件、实际运行的命令、Run ID 与每条结果，并给出上面这条可以由用户自己执行的查看命令。
   合法的业务失败按 `failed` 如实报告；没有对真实系统运行时，交接明确写出“尚未对真实系统运行”。

## 结果

用户在仓库里看到 `niceeval.config.ts`、Adapter、Experiment、Eval 与项目指引，并能用交接里的命令复现结果。
验收失败的情形：只安装了依赖就宣称完成；用占位题或 mock 服务代替真实入口；把 `--dry` 说成已经跑通。

| 情形 | 用户看到的结果与下一步 |
|---|---|
| agent 无法读取公网 URL | agent 说明读不到 `INIT.md` 并停止；用户改为粘贴文件内容，或允许联网 |
| 机器不能安装或运行 Node | agent 如实说明并停止，等待用户决定 |
| 仓库已经装过 NiceEval | agent 核实本地包与 CLI 后直接进入第 3 步，不重复 `init` 生成的文件 |
| 被测系统启动不了 | agent 在已有授权内修复并重试；缺凭据、数据库或模型服务时点名缺什么 |
| 安装后没有 `INDEX.md` | agent 报告安装不完整并重新安装，不改用官网文档 |

## 相关契约

- [Format](../format.md)：`INIT.md` 与项目指引的结构。
- [Architecture](../architecture.md)：每一跳的归属与版本规则。
- [Experiments CLI](../../experiments/cli/README.md)：`exp`、`--dry` 与 receipt。
- [Inspection CLI](../../inspection/cli.md)：`show --run` 的输出。
