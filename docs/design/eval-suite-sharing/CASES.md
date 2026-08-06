# 固定场景

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [DECISION](DECISION.md)

这些 Case 固定共同问题与验收结果。
候选方案可以使用不同文件和命令，但不能缩小结果。

| Case | 场景 | 验收结果 |
|---|---|---|
| S1 | Terminal-Bench 现有 238 条原生 NiceEval Eval | 发布仓库零共享协议改动；不新增共享文件，不复制或重写单题，238 条都能运行 |
| S2 | 新项目使用 Terminal-Bench | 安装依赖、配置 package/root/mount 后，Experiment 可按 `terminal-bench/` 选题 |
| S3 | 私有团队通过 Git 使用外部 Eval | 项目依赖 lockfile 固定 commit；普通运行不访问远端 |
| S4 | 项目同时有本地 Eval 和两个外部根 | 三者进入同一发现结果；id、选择与 Attempt 语义一致 |
| S5 | 共享 Eval 运行结束 | 继续产生普通 Record；不增加外部题专用结果格式 |
| S6 | 依赖升级只改一条 Eval | 其它身份稳定 Eval 的 source/dependency/transfer 输入未变，历史结果继续携带；随机身份题保守重跑 |
| S7 | 发布仓库只改页面、说明或项目配置 | 所有 Eval 的运行指纹不变 |
| S8 | 本地 Eval 与外部根产出同一 id | 发现阶段拒绝运行，一次列出冲突来源和可执行修法 |
| S9 | 安装内容漏掉 Fixture 或测试文件 | 普通发现或 Eval 生命周期按现有阶段报缺失路径，不增加专用校验协议 |
| S10 | 本地 workspace 的发布项目装有另一版 NiceEval | Node >=22.15 的装载矩阵中，owner 内 NiceEval import 绑定消费运行时，不产生品牌或 Sandbox 双实例错误 |
| S11 | 外部 Eval 使用了消费版本没有的 NiceEval API | linker 可识别时指出 package、文件和缺失 export；其它访问保留带 origin 的普通错误 |
| S12 | 两个项目把同一外部 root 挂到不同前缀 | 各项目获得自己的 Eval id；Run 同时保留共同 package provenance |
| S13 | Eval 在 `test(t)` 中上传 folder-local tests | fresh Attempt 写入 transfer manifest；后续携带前重算内容，改判据会作废结果 |
| S14 | Git package 的 `version` 不变但 commit 升级 | Record 区分 definition/execution origin，携带结果不被伪装成新 commit 执行 |

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
消费项目只挂载 `evals/terminal-bench`；发布项目的配置与 Experiment 即使随 package 存在也不会被装载。

其中 10 条 Compose Eval 在 discovery 时生成随机运行身份。
它们仍满足 S1 的零共享协议运行，但第一版不满足跨进程携带；这项已知成本例外不能用忽略 env value 的方式掩盖。
