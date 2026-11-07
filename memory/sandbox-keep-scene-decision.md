# sandbox-keep-scene-decision

设计裁决（2026-07-14）：debug 沙箱环境的路线是 **opt-in 留存现场**（`--keep-sandbox` + `niceeval sandbox list/stop`），不是加大 artifact 采集，也不是暂停态。

- **裁决**：默认契约不动（跑完销毁）；`--keep-sandbox` 是 `niceeval exp` 的纯布尔运行 flag（failed/errored 才留存），在 verdict 定稿的收尾点提交留存。Effect 边界必须是 Scope 在外、工作 timeout 在内,使超时先变成 `errored` draft 而不是先触发 stop finalizer；登记采用 `.niceeval/sandboxes/` 逐条目原子文件,严格先落盘成功、再把 lease disposition 切到 keep 并移出内存清理集合,失败回退 stop。「不留孤儿沙箱」不变量精化为「不留**无主**沙箱」；事后生命周期由 `niceeval sandbox list` / `stop` 收口。契约落在 `docs/feature/sandbox/cli.md` 与 `architecture.md`「留存(keep)与注册表」。
- **必要性依据**：artifact 路线三个结构性缺口——① 环境类 `errored` 证据最薄（agent 没跑，events/trace 不存在，results 契约明写「沙箱创建发生在 telemetry 之前」）；② git diff 只覆盖 workdir 基线，全局安装 / `$HOME` / PATH 是盲区；③ 复现是分钟级冷启动，留现场把 debug 循环压到秒级。
- **曾选方案与否决理由**：
  - *把非 git 状态也捞进 artifact* —— 否决：采集范围无边界，且捞不出「交互式试命令」这个动作本身。
  - *`niceeval debug <attempt>` 按 artifact 重建环境* —— 否决：环境起不来正是要 debug 的对象，重建路线被环境类失败天然否定，且慢。
  - *`Sandbox` 接口加 pause/detach/keep* —— 否决:「留下」是 runner 的调度决定,不是沙箱能力;接口保持只有 `stop()`。
  - *不做 `niceeval sandbox` 命令组、只打印 docker 一行清理命令* —— 被用户推翻（2026-07-14）：没有停掉命令就不是完整生命周期；云 provider 也需要统一入口。
  - *Ctrl+C 时也按策略留存* —— 否决：中断时刻无 verdict，留存授予只发生在正常收尾点，中断路径保持一条、不加策略分支。
  - *`--keep-sandbox=always` 全收档* —— 被用户砍（2026-07-14）：通过的现场没有要排查的问题；调 setup 钩子想看环境，让一条 eval 失败即可拿到现场。砍掉后 flag 回归纯布尔，也免去把 `--diff` 的 `=value` 预扫例外扩成通用机制。初稿还写过 `niceeval <eval> --agent claude --keep-sandbox` 这种独立命令形态的示例，同样为误——运行入口只有 `niceeval exp`（且 `exp` 拒绝 `--agent`），flag 挂在 exp 上。
- **相关约束**：keep 与跨 case 复用互斥（现场必须属于单个 attempt）；teardown 钩子照常跑（只跳过 stop）；`sandboxId` 无条件落 `result.json`（此前接口注释声称它用于排查、结果里却没有的缺口一并补上）。
- **实现前复核追加裁决**：fresh locator 在调度前生成,让注册表与结果无需事后补写；`sandbox` 是可选增量字段,不升级 results schemaVersion；自定义 `defineSandbox` 不支持 keep——事后命令不加载项目代码,无法跨进程找回函数,而“只删记录、提示手工清理”会直接制造无主资源。Docker 创建期标签改叫 `niceeval.keep-candidate`,不把尚未定 verdict 的容器谎称为 kept。
