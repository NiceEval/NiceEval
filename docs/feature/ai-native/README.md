# AI-native：由 Coding Agent 完成接入与日常使用

NiceEval 的第一位使用者通常是用户项目里的 coding agent。用户只说一句话，agent 负责安装、接入、运行和读结果。
这个功能定义这条路径上的每一跳：agent 从哪里读到什么，读到的内容为什么一定与安装的版本一致。

## 谁会用它

- **项目维护者**：不想学一套新 API，只想让手头的 agent 把评估接进来，并在以后的对话里继续用。
- **Coding agent**：训练数据里没有当前版本的 NiceEval，需要一条不靠记忆也走得通的阅读路径。

## 你可以做什么

- 从官网复制一句话交给 agent，得到一条对真实被测系统跑过的评估。
- 隔几天开一个新对话，直接说“跑一下评估”或“为什么这条失败了”，agent 不需要你重新解释 NiceEval。
- 升级 NiceEval 后，agent 读到的文档随之换成新版本，不混入旧版本或官网上的另一版内容。
- 让 agent 只用公开命令读结果，它的归因可以由你用同一条命令复核。

## 上手

把下面这句话原样发给项目里的 coding agent：

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

预期结果：agent 读取 `INIT.md`，在项目现有的包管理器里安装 `niceeval` 并运行 `niceeval init`。
随后它读取 `node_modules/niceeval/INDEX.md`，按随包教程探索项目、写出 Adapter、Experiment 与 Eval，并真实运行一次。
结束时它报告改了哪些文件、运行了什么命令、Run ID 与每条结果，并给出你可以自己执行的查看命令。

## 怎样工作

整条路径只有静态文件和本地命令，没有需要联网查询的服务。每一跳只指向下一跳，不复述下一跳的内容。

```mermaid
flowchart LR
  S["官网的一句话"] --> I["INIT.md<br/>安装前读，来自稳定版"]
  I --> P["niceeval 安装进项目<br/>niceeval init"]
  P --> G["项目指引<br/>AGENTS.md 托管区块与 skill"]
  G --> X["node_modules/niceeval/INDEX.md"]
  X --> D["随包页面<br/>docs-site/zh/**"]
  D --> C["本地命令<br/>--help、show、query、view"]
```

| 跳 | agent 在这里得到什么 | 谁保证它与安装版本一致 |
|---|---|---|
| 一句话 | 一个固定 URL 和一个任务 | URL 不随版本变化 |
| `INIT.md` | 完成标准、五条核心想法、安装位置的判断方法、安装命令 | 只写安装前就能定稿的内容，不含线上文档链接 |
| 项目指引 | “先读随包索引”这一条规则 | 由 `niceeval init` 写入并刷新 |
| `INDEX.md` | 按任务选页的路由和全部随包页面的一句话自述 | 打包时从同一版本的页面生成 |
| 随包页面 | 教程、概念、参考与排查 | 与包在同一个 tarball 里发布 |
| 本地命令与类型声明 | 精确的参数、字段和每个公开 API 的一句用法说明 | 就是已安装的那份程序 |

项目指引是这条路径里唯一留在用户仓库的部分。它让以后的每个新对话都能回到 `INDEX.md`，不依赖用户记得再贴一次那句话。

## 范围与验收

这个功能包含 `INIT.md`、`niceeval init` 写入的项目指引、`INDEX.md` 的阅读契约，以及随包页面必须满足的版本规则。
它不包含各教程页面的正文，也不规定 agent 的模型或提示词。

验收看 agent 的实际行为，不看文档是否写得完整：

- 新仓库里只给那一句话，agent 在不读官网和 GitHub `main` 的情况下跑出一条非 `errored` 的 Attempt。
- 已接入的仓库里开新对话，agent 的第一批读取落在项目指引和 `INDEX.md` 上，随后才读具体页面。
- agent 没有为了弄清 API 去读 `node_modules/niceeval/dist` 或 `src` 下的实现。
- agent 没有直接读取 `.niceeval/` 下的文件。

这四条由独立的评估仓库对每个发布版本测量，机制见 [Architecture](architecture.md#效果由评估给出)。

## 用户路径

- 第一次接入：[用一句话完成安装与首次运行](use-case/install-from-one-sentence.md)。
- 之后的对话：[在新对话里继续使用](use-case/continue-in-a-new-session.md)、[让 agent 诊断一条失败的结果](use-case/diagnose-a-failed-run.md)。
- 版本变化：[升级后刷新项目指引](use-case/upgrade-and-refresh.md)。

## 细节

- [Format](format.md)：`INIT.md`、项目指引、skill 与 `INDEX.md` 的路径、结构和校验。
- [Architecture](architecture.md)：每份文件的归属、不变量与效果评估。
- [Use Cases](use-case/README.md)：按目标选择路径。
