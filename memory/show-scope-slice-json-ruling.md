# 裁决:show 重设计为「范围 × 切片 × 形态」三正交轴(2026-07-23)

**裁决**:`niceeval show` 的 CLI 模型定稿为三条正交轴——范围(前缀 / `@locator` / `--exp` 可重复 / `--fresh` / `--results`)× 切片(缺省 / source / execution / timing / usage / diff / history)× 形态(text / `--json`)。落 docs:`docs/feature/reports/show.md` 及新分篇 `show/compare.md`、`show/usage.md`、`show/json.md`;同批定稿 `Usage` 落盘形状与 `ctx.fact()` 通道(`docs/feature/results/architecture.md`)。实现 TODO 在 `plan/show-scope-slice-json.md`。

**起因(实测代价数据)**:MemoryBench 三条件对照归因(baseline / mempal / nowledge,30 eval × 3)中,「同题跨条件 pass 翻转 + token delta」这张核心表在纯 `show` 组合调用下要 **93 次调用、122 秒、两段解析脚本**(3 次 `show '' --exp` 抓 locator + 90 次 `show @loc` 正则抠 usage 行);证据覆盖已近乎完备,缺的是输出契约与调用正交性。另实测 usage 失真:21 次工具调用的 codex session 落盘 `requests: 1`;记忆库起步状态(mempal 73 条笔记)只能从 agent 的 ingest 输出侧推。

**曾选方案与否决理由**:

- 独立 `niceeval compare <expA> <expB>` 子命令——否决:对照是「范围含多个条件」时缺省切片的自然形态,独立命令会复制范围/切片的全部组合语义。
- 让 agent 直接读 `.niceeval/` 原始 JSON——否决(用户明令禁止):脚本自扫目录必然复刻第二套不一致的选择/去重/时效口径;`--json` + 库读取面是唯一出口。
- `--expand` 按全局事件 id 寻址——否决:`t<N>.c<M>` 按轮内卡片序派生,人在 text 面数得出来、脚本从 `--json` 拿得到,同一份 artifact 恒定。
- turns / toolCalls 塞进 `Usage` 落盘——否决:行为计数是 events 派生事实(与 o11y 同源),落两处必漂移;show 展示层从两处组装,口径单源在 `show/usage.md`。

**关联**:效度问题另记——真实 PR 题 + 沙箱不禁网时 agent 可 curl 上游已合入修复,pass 归因被污染(见 MemoryBench 侧记录);facts 通道让「起步库状态」成为一等**运行后观测**，但不参与 fingerprint。计划内条件仍必须进入 flags / agent / model / sandbox 配置；外部状态变化后要 `--force`，否则 carry 会在 setup 与 fact 上报之前复用旧结果。
