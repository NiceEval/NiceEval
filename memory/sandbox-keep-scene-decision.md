# sandbox-keep-scene-decision

设计裁决（2026-07-14）：debug 沙箱环境的路线是 **opt-in 留存现场**（`--keep-sandbox` + `niceeval sandbox list/stop`），不是加大 artifact 采集，也不是暂停态。

- **裁决**：默认契约不动（跑完销毁）；`--keep-sandbox`（裸 = failed/errored，`=always` 全收）在 verdict 定稿的收尾点跳过 `stop()`，沙箱移出清理集合、登记 `.niceeval/sandboxes.json`；「不留孤儿沙箱」不变量精化为「不留**无主**沙箱」（要么在清理集合、要么在注册表，无第三态）。事后生命周期由 `niceeval sandbox list` / `stop` 收口——用户明确要求补停掉命令，构成完整闭环。契约落在 `docs/feature/sandbox/cli.md` 与 `architecture.md`「留存(keep)与注册表」。
- **必要性依据**：artifact 路线三个结构性缺口——① 环境类 `errored` 证据最薄（agent 没跑，events/trace 不存在，results 契约明写「沙箱创建发生在 telemetry 之前」）；② git diff 只覆盖 workdir 基线，全局安装 / `$HOME` / PATH 是盲区；③ 复现是分钟级冷启动，留现场把 debug 循环压到秒级。
- **曾选方案与否决理由**：
  - *把非 git 状态也捞进 artifact* —— 否决：采集范围无边界，且捞不出「交互式试命令」这个动作本身。
  - *`niceeval debug <attempt>` 按 artifact 重建环境* —— 否决：环境起不来正是要 debug 的对象，重建路线被环境类失败天然否定，且慢。
  - *`Sandbox` 接口加 pause/detach/keep* —— 否决:「留下」是 runner 的调度决定,不是沙箱能力;接口保持只有 `stop()`。
  - *不做 `niceeval sandbox` 命令组、只打印 docker 一行清理命令* —— 被用户推翻（2026-07-14）：没有停掉命令就不是完整生命周期；云 provider 也需要统一入口。
  - *Ctrl+C 时也按策略留存* —— 否决：中断时刻无 verdict，留存授予只发生在正常收尾点，中断路径保持一条、不加策略分支。
- **相关约束**：keep 与跨 case 复用互斥（现场必须属于单个 attempt）；teardown 钩子照常跑（只跳过 stop）；`sandboxId` 无条件落 `result.json`（此前接口注释声称它用于排查、结果里却没有的缺口一并补上）。
