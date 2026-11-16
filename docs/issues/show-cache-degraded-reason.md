# show 不显示 Before cache 降级的具体原因

## 现象
NiceEval-Eval harness/v0.19.0 重跑中，`niceeval show @1D228F4WXGYHX` 的 Failure diagnostics 只给出 `sandbox.prepare · cache-degraded · Before cache is unavailable; the remaining before actions will run on the usable sandbox state.`，`--execution` 的 Diagnostics 也只有同一句摘要。
随后 agent.install 在 Instabox 上分片上传 codex.tgz，直到 Eval 900 秒超时被取消（9 格中 8 格 errored）。

## 缺口
降级的具体原因（远端快照不可用？恢复失败？容量？Agent 派生节点失败的 `agent-install-failed`？）在 CLI 任何切片都看不到，用户无法判断是重试、换后端还是调超时。
docs/feature/sandbox/architecture/remote-snapshot-cache.md 已定义降级原因枚举，但 show 没有呈现。

## 期望
overview 与 `--execution` 的 cache-degraded 诊断显示具名降级原因与受影响的 Before 节点；若原因来自远端调用，给出可展开的命令或请求 ID。
