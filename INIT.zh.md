# niceeval 安装向导（给 AI 读的执行步骤）

你正在被要求把 [niceeval](https://github.com/CorrectRoadH/niceeval) 接入**当前打开的这个仓库**（不是 niceeval 自己的源码仓库）。用用户的语言与用户交流。不要凭训练记忆里的旧 API 现编。

本文件只负责一件事：把包装进项目。接入流程本身（探索项目、与用户确认路径、写 adapter / experiment / eval、跑通）全部住在随包文档里，与安装版本一起发布——所以本文件不含任何线上文档链接，装完以 `node_modules/niceeval/INDEX.md` 的路由为准。随包文档目前只有中文；不要为了找英文版去抓官网或 GitHub——那里可能是另一个版本的 API。

## 先列一个 TODO：装包只是第一步

用户说「安装 niceeval」，完成标准**不是**「加了依赖」，而是**在这个仓库里对它的被测系统跑通至少一条真实评估、并能用 `niceeval show` 看到结果**。开始前先把下面这份清单落成一个可勾选的 TODO 逐项跟踪，别装完包就收工：

- [ ] 装包并 `init`（第 1–2 步）
- [ ] 读 `node_modules/niceeval/INDEX.md` 并挑「从零接入」教程页；从这一步起每一步都照随包文档做（第 3 步）
- [ ] 探索这个仓库：被测系统是什么、该怎么连它
- [ ] 动手写代码前**停下来问**——与用户确认接入方案：(a) 你打算怎么连被测系统（把你探到的端点 / 协议 / 请求-响应形状摆出来请用户核对）、(b) 要不要复用或接上它已有的 tracing / OTel、(c) 要不要把配置变体暴露成 experiment flags、(d) 目标接入等级选哪档——先读随包文档里的接入等级页，把三档都摆给用户挑。等用户答复再动手（除非任务明确说明没人可确认，才自行拍板并继续）
- [ ] 写出 adapter / experiment / eval 三件套
- [ ] 真跑一次并跑通，用 `niceeval show` 确认结果可见——只写了文件没跑过不算数
- [ ] 按教程页的清单收尾自检，再问用户要不要往更深的接入等级走

清单没逐项勾完，这个任务就还没完成。

## 第 0 步：四条心智模型

niceeval 是一个 TypeScript evals 库：用声明式 API 定义"什么是好结果"，再施加到 coding agent、已部署的 agent/服务、或一个纯函数上。记住四条就够安装决策用：

1. 三个文件各管一件事——**adapter**（怎么连被测对象）、**experiment**（评谁、用什么配置跑几次）、**eval**（发什么输入、断言什么）。
2. niceeval **不定义任何 agent 协议**。连你自己的服务，adapter 里就是发一个普通 HTTP 请求；URL、鉴权是 adapter 的工厂参数，不是 niceeval 的配置项。
3. CLI 位置参数只用来筛"跑哪些 eval"（按 id 前缀）。选"对着哪个 agent/model 跑"永远是 flag 或 experiment 文件，不要把 URL、agent 名塞进位置参数。
4. **「跑通」不是完成标准。** eval 的输入要让被测系统干它的核心活（不是问它「你是什么/你能做什么」这类关于它自己的元问题）；断言要在被测系统胡编时会变红——不要断言输入里本来就有的词，那被测方复读题目就能通过；能写就写一条负例（喂一个它应该答不了的输入，断言它明确说做不到而不是编造）。收尾自检清单在随包教程页里。

## 第 1 步：确认前置条件

- 被测对象可以是任何语言/平台（iOS、Python 服务、别的什么都行）——niceeval 只要求本机有 Node，能跑 `npx`/`pnpm exec` 这类命令；adapter/experiment/eval 这三件套本身是 TS 文件，但不要求整个仓库是 TS/JS 项目，不用因为宿主项目是别的语言就停下。
- 真正的前提只有：本机能装 Node 依赖、能跑 Node 命令。如果确认连这个都不满足，才如实告诉用户并停下来等决定。
- 检查是否已经装过：有没有 `niceeval.config.ts`、`evals/` 目录、`package.json` 里的 `niceeval` 依赖。已经装过的话跳过安装，直接进第 3 步读随包文档，按现有结构补文件，不要重复 `init`。
- **先定评估工作区放哪，再探测包管理器。** 仓库根自己的 `package.json` 就是被测系统本体（JS/TS 宿主项目）时，装在根目录当 dev 依赖。否则——Python 等其它语言宿主、或仓库只是*包含*一些 JS 子项目（`web/`、`frontend/`、文档站）——新建一个干净子目录（如 `niceeval/`），配全新的 `package.json`，装在那里。**绝不要装进宿主已有子项目的 `package.json`**：那份 lockfile 和工具链属于被测系统，把评估设施混进去可能让 niceeval CLI 直接跑不起来（宿主 `node_modules` 里的旧加载器解析不了它），还会把宿主自己的类型错误卷进你的 typecheck。
- 只按**选定安装位置**的 lockfile 探测包管理器（`pnpm-lock.yaml` / `package-lock.json` / `yarn.lock`），后面所有命令都用它。宿主子项目深处的 lockfile 不算数；全新子目录里用本机现成的包管理器即可，有 lockfile 时不要默认 npm。

## 第 2 步：安装

安装是加一个 dev 依赖，廉价且可逆——不需要先探明整个项目才动手，探索项目属于装完之后的接入流程：

```sh
<你探测到的包管理器> add -D niceeval
<你探测到的包管理器> exec niceeval init
```

`init` 会生成 `niceeval.config.ts` 和 `evals/`，并在项目的 `AGENTS.md`（或只有 `CLAUDE.md` 时写入该文件）加入托管区块，提醒后续 coding agent 读取随包文档。不要删除或手改标记内的内容；升级 niceeval 后重新运行 `init` 刷新它。

## 第 3 步：交接给随包文档

先确认随包文档存在：

```sh
test -f node_modules/niceeval/INDEX.md
```

然后读取 `node_modules/niceeval/INDEX.md`。索引里每页一行自述，按任务挑页读；从零接入选「Coding Agent 从零接入」教程页，按它完成剩下的全部工作：探索项目并与用户确认路径、配置 judge、写三件套、跑通验证、收尾总结、和用户确认要不要往深接。

随包文档与当前安装版本一起发布；官网或 GitHub `main` 分支可能对应另一个版本，从这一步起不要再用它们判断 API。
