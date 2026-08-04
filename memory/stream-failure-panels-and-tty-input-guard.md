# 裁决:失败收进 live 面板分节 + 结束按形态聚合 + 键盘接管(2026-08-04)

## 现象

terminal-bench dogfooding(用户 2026-08-04 反馈,三连):

1. `exp` 运行中按一次回车后 live 面板永久错位,旧帧残片混进 scrollback,画面「不刷新、难阅读」,退出后残留一串 `➜➜➜➜` 提示符。
2. 流式失败行无框、多行 expected/received 在窄终端硬折行,与面板残片混排,连续失败分不清边界。
3. 结束反馈「脱缰」:205 条失败的 FAILURES 面板逐条展开 4 行同质细节(全是 `commandSucceeded() · expected exit 0 · received exit N · pytest 尾巴`),7 条 `lock-taken-over` 诊断逐 case 各刷两行。

## 根因

1. **键盘回显是第三种绕过 renderer 的终端写入者。** live 面板用 `\x1B[nA` 相对回跳原地重绘,行数记账假设 renderer 是唯一写入者;终端处于 canonical + echo 模式,回车回显把光标顶下一行,记账与物理屏幕永久失同步。与 [live-overflow-redraw-appends-frames](live-overflow-redraw-appends-frames.md)、[live-raw-stderr-write-desyncs-redraw](live-raw-stderr-write-desyncs-redraw.md) 同一失同步类别,来源换成用户键盘;「同帧不写」优化让静止期没有自愈机会。
2. **反馈契约缺「数量多」的状态分档。** FAILURES 无论 1 条还是 205 条都逐条铺多行细节;断言摘要行预算是固定 100 字符(为 `--json` 设的),与终端宽无关且按 char 不按显示列,窄终端硬折行。诊断折叠按含身份的 dedupeKey,同 `code` 跨 case 不聚合,逐 case 刷屏。

## 裁决

1. **live 面板期间接管键盘**:stdin 为 TTY 时进 raw mode 不回显;回车 = 清除 + 整帧重绘(绕过同帧不写),兼作外部干扰后的自愈手势;`\x03` 走 SIGINT 同路径、`\x1a` 转发挂起并在恢复后重绘;一切退出路径恢复终端模式;stdin 非 TTY 不读不接管。契约在 `docs/feature/experiments/cli.md`「键盘输入与画面自愈」。
2. **失败收进框里,单行投影**:TTY 下失败不进 scrollback 流,以单行(`✗ @loc evalId [who] 单行压缩摘要`)滚动显示在 live 面板内嵌 `FAILURES` 横隔分节(最近 5 条 + 累计数);非 TTY 单流逐条追加同一投影。多行 expected/received 全部退给 `show`。用户点名「有框隔离好读」——分节在框内,同时 scrollback 零失败刷屏。
3. **结束按失败形态聚合**:FAILURES 组 key = failed 的断言标题+matcher / errored 的 `phase · code`;size>1 组一行(`×N` + 形态 + 代表 locator),size=1 组两行(完整身份+摘要)——「数量少展开、数量多聚合」由组大小自然区分,不设第二套开关。诊断人读面同 `code` 只完整打印首条,结束 `WARNINGS` 面板按 code 汇总次数。
4. **摘要行预算由渲染面给**:按显示列量;`--json` 与非 TTY 固定 100。契约在 `docs/feature/assertions/library/display.md`。

曾选方案(同日被用户故事推翻两轮):给每条失败画独立紧凑面板(否决——运行中没人逐条读多行证据,10 条×6 行仍是刷屏);失败保持 scrollback 无框单行流(否决——用户点名有框隔离更好读,且与面板残片混排);FAILURES 逐条展开上限 10(否决——205 条同质失败该聚合成形态行,细节归 `show`/`view`)。
