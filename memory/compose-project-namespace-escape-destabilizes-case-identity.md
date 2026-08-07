# Compose 运行 nonce 进入声明身份，CaseKey 每次规划漂移

**现象**（2026-08-07）：Terminal-Bench 的 12 个 Compose Eval 中有 10 个在连续两次 `--dry` 时改变 CaseKey、template private identity 与 provider private identity，BuildKey 保持不变。`accept` 重锚后下一次规划仍立即 stale。

**根因**：这 10 题共用的 `harborComposeEnv()` 每次模块加载生成随机 `T_BENCH_TASK_DOCKER_CLIENT_CONTAINER_NAME`，再插值到 `services.client.container_name`。普通 Compose `env` 的完整值有意进入 template 与 Provider identity，并经 `caseParams` 进入 CaseKey；逐次运行 nonce 因此被错误建模成可携带声明输入。其余两题没有该随机 env，所以身份稳定。

显式 `container_name` 还绕开 Compose project namespace。两个并发 Case 会在 Docker 宿主争用全局容器名，遗留容器也会阻断下一次启动。同类逃逸还包括受管 network、volume、config 与 secret 的固定全局 `name`。

**修法**：Docker Compose physical planning 用两个不同哨兵 project 求值 Compose 有效模型。任一 service 的 `container_name` 都拒绝；非 external 受管资源必须随哨兵分别派生为 `<project>_<logical-key>`。顶层 `include` 与任意 `extends.file` 因第二文件入口未进入 CaseKey 输入闭包而拒绝。同文件 anchor、merge、插值与不带 `file` 的 service extends 由 Compose 自己展开，避免极简 YAML inspection 被语法旁路。

Terminal-Bench 删除 10 份活动 Compose 的 `container_name` 与 helper 中的随机容器名字段。题目脚本只按 Compose service DNS 寻址，NiceEval 也按 project 与 service 查询主容器，因此删除字段不改变题目语义。

**回归判据**：核心测试必须让只扫描原始 service 节点、只检查 `container_name` 或只用一个固定规划 project 的实现失败。下游连续两次 `--dry` 必须得到相同身份；历史 Luna attempt 由用户授权用 locator 重锚，不运行新的付费 attempt。

`COMPOSE_MATERIALIZER_REVISION` 不递增。新增校验只把破坏所有权不变量的输入改为规划失败，不改变任何成功输入的构建字节、物理计划或身份；递增反而会无故改变全部 Compose BuildKey。
