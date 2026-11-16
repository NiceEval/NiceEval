# 在新对话里继续使用

## 用户目标

项目已经接入 NiceEval。几天后用户开了一个新对话，只想说一句“跑一下评估”或“加一条评估”，
不想再解释 NiceEval 是什么，也不想再贴安装时的那句话。

## 起始状态

仓库里有 `niceeval init` 写入的项目指引，依赖已经安装。agent 是一个没有上次对话记忆的新会话。
本篇是预期用法，输出均为预期结果。

## 完整路径

1. 用户直接说任务。 {#ask}

   ```text
   我改了 prompt，帮我跑一下评估，看看有没有变差。
   ```

   预期结果：agent 在开始工作前已经读到项目指引。指引告诉它 NiceEval 不在训练数据里，先读 `node_modules/niceeval/INDEX.md`。

2. agent 读索引，按任务选页。 {#route}

   预期结果：agent 按 `INDEX.md` 的阅读规则，从生成的页面树按自述选出一到三页并读取，例如运行与复验对应的反馈循环教程。
   需要精确参数时，它再读一页 Reference 或运行 `niceeval <command> --help`。

3. agent 先看计划，再运行。 {#run}

   ```sh
   pnpm exec niceeval exp <experiment> --dry
   pnpm exec niceeval exp <experiment>
   ```

   预期结果：`--dry` 说明哪些结果会沿用、哪些会重跑。agent 保留用户已经给出的范围与预算，只在费用或范围不清时提问。

4. agent 用公开命令读结果并回答。 {#answer}

   ```sh
   pnpm exec niceeval show run:<run-id>
   ```

   预期结果：agent 报告 Run ID、通过与失败的条目，以及与上一次相比的变化，并给出用户可以复核的命令。

## 结果

用户没有提供任何 NiceEval 知识，agent 仍然按当前安装版本的写法完成了任务。
验收失败的情形：agent 凭记忆写出不存在的 API；去官网或 GitHub 找文档；或为了看结果直接读 `.niceeval/` 下的文件。

不同的话走同一条路径，只在第 2 步选到不同的页面：

| 用户的话 | agent 在索引里选的方向 |
|---|---|
| “跑一下评估” | 运行与复验 |
| “加一条评估，测一下退款流程” | 编写评估用例与判据审阅 |
| “为什么这条失败了” | 只读诊断，见[让 agent 诊断一条失败的结果](diagnose-a-failed-run.md) |
| “接一下 tracing” | 对应的接入教程 |

| 情形 | 用户看到的结果与下一步 |
|---|---|
| 刚克隆的仓库还没装依赖 | 项目指引指向的 `INDEX.md` 不存在；agent 先按仓库的包管理器安装依赖，再继续 |
| 项目指引被删掉 | agent 可能回到训练数据；重新运行 `niceeval init` 恢复 |
| agent 的运行时不读 `AGENTS.md` | 使用该运行时对应的 skill；位置见 [Format](../format.md#skill) |

## 相关契约

- [Format](../format.md)：项目指引、skill 与 `INDEX.md` 的阅读契约。
- [Experiments CLI](../../experiments/cli/README.md)：`--dry` 与结果沿用。
- [Inspection CLI](../../inspection/cli.md)：读取结果的公开命令。
