# 固定场景

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3（未采用）](PLAN-3/README.md) · [DECISION](DECISION.md)

这些 Case 固定共同问题与验收结果。
候选方案可以使用不同文件和命令，但不能缩小结果。

| Case | 场景 | 验收结果 |
| --- | --- | --- |
| S1 | Terminal-Bench 现有 238 条原生 NiceEval Eval | 发布仓库零共享协议改动；消费方可用独立远程 Eval 文件逐道引用，不复制或重写单题 |
| S2 | 新项目使用一条 Terminal-Bench Eval | 安装直接依赖并添加远程 Eval 文件后，`niceeval list` 显示消费项目的 id，Experiment 可按同一个 id 选题 |
| S3 | 私有团队通过 Git 使用外部 Eval | 项目依赖 lockfile 固定 commit；普通运行不访问远端 |
| S4 | 项目同时有本地 Eval 与多个远程 Eval 文件 | 它们进入同一发现结果；id、选择器与 Attempt 语义一致 |
| S5 | 已安装但未登记的 package | `niceeval list` 与 Experiment catalog 均不显示该 package 中的 Eval |
| S6 | 外部 package identity 升级 | 所有引用该 package 的远程 Eval 失去携带资格并 fresh run；逐题跨版本 transfer 不作保证 |
| S7 | 上游 package 新增、删除或重排其它 Eval | 消费项目只有对应远程 Eval 文件时才看到那一道；package 的目录内容不会自动扩张 catalog |
| S8 | 本地 Eval 与远程 Eval 文件形成同一项目 id | 本地发现阶段拒绝运行，一次列出冲突文件和可执行修法 |
| S9 | 安装内容漏掉被引用的 Eval、Fixture 或测试文件 | `niceeval exp` 在运行前报告缺失或越界路径；不增加专用校验协议 |
| S10 | 本地 workspace 的发布项目装有另一版 NiceEval | Node >=22.15 的装载矩阵中，owner 内 NiceEval import 绑定消费运行时，不产生品牌或 Sandbox 双实例错误 |
| S11 | 外部 Eval 使用了消费版本没有的 NiceEval API | linker 可识别时指出 package、文件和缺失 export；其它访问保留带 origin 的普通错误 |
| S12 | 两个项目引用同一道上游 Eval | 各项目的远程 Eval 文件路径分别形成 id；Run 都保留共同 package provenance |
| S13 | Eval 在 `test(t)` 中上传 folder-local tests | fresh Attempt 保留运行输入与 owner 边界；package identity 改变后不跨版本携带 |
| S14 | Git package 的 `version` 不变但 commit 升级 | Record 区分 definition/execution origin，历史结果不会被伪装成由新 commit 执行 |

## Terminal-Bench 输入

S1 使用现有 NiceEval Terminal-Bench 仓库作为固定输入：

```text
package.json
niceeval.config.ts
evals/terminal-bench/<task-id>/eval.ts
evals/terminal-bench/<task-id>/fixture/**
evals/terminal-bench/<task-id>/tests/**
lib/**
experiments/**
```

发布仓库不增加 `suite.ts` 或 NiceEval 共享 metadata。
消费项目为要使用的 `<task-id>` 添加自己的 `.eval.ts` 引用文件；发布项目的配置与 Experiment 即使随 package 存在也不会被装载。

其中 10 条 Compose Eval 在 discovery 时生成随机运行身份。
它们可以被远程引用并运行；跨 package identity 的携带与其它题一样全部重新运行。
