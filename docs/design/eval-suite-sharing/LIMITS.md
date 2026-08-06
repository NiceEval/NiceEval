# 约束与外部对照

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [DECISION](DECISION.md)

## NiceEval 的现有边界

Eval 是可执行 TypeScript，不是只有 prompt 和答案的数据行。
一条 Eval 可以 import 项目内模块，引用本地 Fixture，声明 Sandbox，并在 Agent 返回后上传隐藏判据。

本地发现从 `evals/` 读取 `.eval.ts`、`.eval.tsx` 与目录入口 `eval.ts`。
文件路径形成 Eval id，默认导出只能是 EvalDefinition、数组或 keyed record。

现有指纹按 Eval 源码闭包、登记的数据文件、Sandbox 身份与运行配置计算。
这套逐 Eval 身份必须继续成立，不能因为来源 package 整体升级就让全部题重跑。

普通本地源码捕获以项目根为边界，`node_modules` 不进入闭包。
挂载外部 Eval 根后，来源 package root 必须成为那组 Eval 的源码捕获边界，否则 Eval 依赖的项目内模块变化不会作废结果。

## Terminal-Bench 给出的真实压力

NiceEval Terminal-Bench 仓库把 238 条题维护成 folder-local Eval。
每题已经拥有 NiceEval Sandbox、Task、官方判据与资产隔离，不存在需要再次转换的格式差异。

复制方案的问题不是 Eval 不兼容，而是消费方需要复制 238 个目录、Eval 依赖模块与后续修正。
来源升级也退化成人工目录 diff，项目无法从依赖声明回答“使用的是哪个 commit 或 package”。

## 外部框架怎样共享题

| 系统 | 共享单位 | 版本固定方式 | 对 NiceEval 的启发 |
|---|---|---|---|
| Harbor | 统一格式的 task archive 与 dataset manifest | `dataset.toml` 逐题保存 SHA-256；registry tag 可落到 revision 或 digest | 语言中立任务需要自有内容仓库；逐题 digest 适合精确身份 |
| Inspect | Python package 中注册的 Task，或带 `eval.yaml` 的 Hugging Face dataset | Python 环境 lockfile；HF 引用可附 tag 或 revision hash | 原生可执行任务最适合跟随本语言 package 分发 |
| lm-evaluation-harness | YAML TaskConfig、辅助 Python 与 Hugging Face dataset | 官方建议共享 YAML 加代码 commit；dataset 可传 revision | 只锁题面配置不够，Eval 依赖的可执行模块也必须进入同一依赖身份 |
| OpenAI Evals | Git 仓库内 registry YAML、Eval 类与 Git-LFS 数据 | Eval 名带版本，完整复现还依赖仓库 commit | 中央源码仓适合官方集合，但第三方消费要 fork 或跟随整仓 |
| WorkBuddyBench | Harbor 风格任务目录组成的四个自有 subset | Hugging Face 压缩包、版本名与 `SHA256SUMS` | 大资产可与 harness 分开交付，但校验值仍要有唯一 owner |

Harbor 的 [dataset manifest](https://www.harborframework.com/docs/datasets/publishing) 把每个 task archive 的 digest 写进 `dataset.toml`。
它的 [adapter 指南](https://www.harborframework.com/docs/datasets/adapters) 先把外部 benchmark 转成 Harbor task，再做 oracle 与 parity 验证。

Inspect 允许 Task 通过 [Python package entry point](https://inspect.aisi.org.uk/tasks.html#packaging) 注册，也允许直接运行带配置的 [Hugging Face revision](https://inspect.aisi.org.uk/tasks.html#revisions)。
它与原生 NiceEval Eval 最接近：任务代码属于语言 package，框架只负责发现。

lm-evaluation-harness 的 [Task Configuration](https://github.com/EleutherAI/lm-evaluation-harness/blob/main/docs/task_guide.md) 明确把 YAML 与代码 commit 一起视为复现输入。
OpenAI Evals 则把 [registry YAML 与数据](https://github.com/openai/evals/blob/main/docs/build-eval.md) 放在同一 Git 仓库。

WorkBuddyBench 的任务不是从其它 benchmark 直接复用。
它的 [数据说明](https://github.com/Tencent/workbuddy-bench/blob/main/datasets/README.md) 把四个自有 subset 放在 Hugging Face，下载脚本按 `SHA256SUMS` 检查压缩包。

## 为什么 NiceEval 不直接照搬 Harbor

Harbor registry 交付的是框架无关文件归档；下载后由 Harbor 自己解释任务协议。
NiceEval 外部 Eval 交付的是会 import `niceeval` 与其它 TypeScript package 的代码。

如果 NiceEval 再建立 registry 与 `eval.lock`，它还必须处理传递依赖、peer dependency、Git dependency、私有包和安装脚本。
这些能力已经由 npm、pnpm 与 Yarn 提供，第二套实现会让同一份可执行代码出现两个依赖真相。

## 零发布改造的边界

- 外部 Eval 来源是受信任代码；Eval 模块会在宿主进程执行。
- NiceEval 只扫描挂载的 Eval root，不导入来源 package 的入口或 `niceeval.config.ts`。
- Eval 内的 `niceeval` bare import 必须绑定消费运行时；其它 bare import 仍从来源 package 解析。
- 已安装内容必须包含 Eval 根、Eval 依赖模块、Fixture、测试与 Sandbox 构建输入。
- 外部 Eval 的相对路径以来源 package root 为边界，不能逃到交付内容之外。
- 项目 lockfile 必须签入；Git tag 或 semver range 只有经过 lockfile 固定后才可复现。
- 多个外部根可能给出相同内部路径，最终 id 必须由消费项目的挂载前缀隔离。

“发布方不写额外文件”不能消除版本兼容问题。
若共享 Eval 使用了消费项目 NiceEval 尚未提供的 API，发现必须明确报错；解决办法是升级消费项目，而不是让发布方改写题目或包装一层格式。
