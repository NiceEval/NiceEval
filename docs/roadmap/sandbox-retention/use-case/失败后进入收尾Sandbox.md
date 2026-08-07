# 失败后进入收尾 Sandbox

一条使用 bounded managed Provider 的 Eval 在本地运行失败。
用户不需要在运行前猜中失败，也不需要带留存 flag：

```bash
niceeval exp local onboarding/tool-first
```

运行开头先显示求值策略与 Provider 能力：

```text
SANDBOX RETENTION  retain failed · release auto · idle 24h
  vercel  suspend, provider expiry 24h
```

Attempt 完成后，Runner 先写完 Verdict 证据，再执行 Agent teardown、cleanup 与 Sandbox lifecycle teardown。
Provider 随后停驻 Sandbox，摘要只显示数量和管理入口：

```text
1 sandbox suspended for post-teardown inspection — niceeval sandbox list
```

用户先核对 checkpoint：

```bash
niceeval sandbox list
```

```text
rtn_8f3a  vercel  dormant  fresh post-teardown · cleanup complete · @1x7f  in 23h
```

再进入 Sandbox：

```bash
niceeval sandbox enter rtn_8f3a
```

CLI 在 shell 前再次说明它不是 Verdict 瞬间快照：

```text
checkpoint: fresh post-teardown · @1x7f · cleanup complete
guarantee: filesystem only · active until 2026-08-08T10:00:00Z
```

用户可以检查 workdir 外安装、忽略文件和最终 PATH，也可以手工重跑准备命令。
shell 退出后 Sandbox 重新停驻，Provider 到期时间从本次使用刷新。

Verdict 时的 Agent 行为、归因 diff 与命令证据仍从 Record 读取：

```bash
niceeval show @1x7f --execution
niceeval show @1x7f --diff
```

如果 cleanup 已删除目标状态，retained environment 不补造它。
Record 是判定证据，停驻 filesystem 只是额外调试面。
