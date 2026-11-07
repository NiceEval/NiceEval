# 并行 niceeval 进程同毫秒共享 run 目录,summary.json 互相覆盖丢判决

## 现象

2026-07-11,coding-agent-memory-evals 项目里一条 shell 命令后台并行启动 3 个 `niceeval exp dev-e2b/<config> memory/repomod-hello-world-api --quiet` 进程(bub-e2b / codex-e2b / codex-e2b--mempal)。三个进程打印了**同一个**输出路径 `.niceeval/2026-07-11T07-29-54-873Z/summary.json`;跑完后该文件只剩最后收尾那个进程(codex-e2b--mempal)的 1 条结果,前两个实验的判决/断言数据永久丢失。盘上证据:该 run 目录下同时存在三个实验的 attempt artifact 子目录,但 summary 只有一份。`niceeval show` 无法恢复——判决当时只存在于 summary.json,attempt 目录里只有 events/trace/diff/o11y/sources。

## 根因

三层叠加(schemaVersion ≤3 的格式):

1. **run 目录唯一性未强制**:目录名 = 毫秒级时间戳,无 PID/随机后缀;`mkdir(dir, { recursive: true })` 对已存在目录静默成功。关键是**同时 fork 的相同进程启动耗时强相关**——同一条 shell 命令后台启动的 N 个 niceeval,走完全相同的 tsx 加载/配置解析/eval 发现流程,到达建目录时刻天然对齐到毫秒级,撞名不是独立随机事件的小概率,是相关事件的常态风险。
2. **summary.json 收尾盲写**:`finish()` 整文件 `writeFile`,last-writer-wins,无冲突检测。
3. **判决是单点数据**:verdict / assertions 只存在于 summary.json,覆盖 = 不可恢复(crash/kill 中断没写出 summary 的 run 同样全丢,读取面归 `skipped("incomplete")`)。

## 修法

不打补丁(加锁/加后缀治标),做了 Results Format 的 schemaVersion 4 重设(裁决见 [[results-per-snapshot]]):落盘单位从 run 改为快照(`.niceeval/<experiment>/<timestamp>-<rand>/`,独占 mkdir 撞名重试),判决落 attempt 级 `result.json` 每条一次写成,run 级 summary.json 消亡——并发覆盖与中断丢判决两类问题从格式上不存在。契约见 docs/results-format.md、docs/results-lib.md;实现在 `src/results/`。

适用场景教训:诊断「文件被覆盖」时先看创建时刻的唯一性来源;时间戳目录在「同命令并行 spawn」下毫秒同刻是高概率事件,不能按独立随机估。
