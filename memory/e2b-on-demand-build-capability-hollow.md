# E2B 按需构建是空壳:类型齐全,无 build provider

**现象**:按需构建单 Dockerfile 的 caseKind、类型与能力矩阵都已存在,但没有任何 provider 实现这条构建路——docker 与 E2B 都只有 Compose 一条路能真构建。单容器题在 E2B 无法物化,MemoryBench 的 3 个 `*-e2b` 实验只能停用(逐题 template 覆盖表为空,启动即说明跑不了)(2026-07-31)。

**根因**:契约与类型先行,build provider 未落地。

**修法**:未修。补上 E2B 的按需构建 provider 后,MemoryBench 241 题可整体上云并行;在此之前单容器题只能跑本机 Docker。
