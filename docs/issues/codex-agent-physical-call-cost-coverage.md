# 官方 codexAgent 缺少可核对全部模型请求的逐调用成本证据

## 期望工作流

用官方 `codexAgent()` 评估允许自主修复、多轮工具调用和重试的 coding agent 时，需要审计全部模型调用的用量、缓存与可取得的费用，并区分完整、部分和未记录。没有上游账单或可追溯价格依据时，金额应保持未知；不要求从 token 猜实际账单。

## 当前公开观察

NiceEval-Eval 的真实安装评估通过 `niceeval query` 查询后，存在轮级 token observation，但没有物理调用 identity：

```json
{
  "modelGroups": {
    "basis": "reported-sends",
    "state": "unavailable",
    "reason": "physical-call-identity-not-recorded"
  },
  "totalCosts": {
    "state": "unavailable",
    "missingSources": ["application", "judge"],
    "values": []
  }
}
```

例如 Attempt `@1CAKJ10309G3Q`（Run `a5fcf6f4-2ba0-4fb9-9700-92e0786de094`）有两条 send 的 request observation；公开记录不足以将其解释为 coding agent 的全部物理模型请求数，也不足以核对多轮工具循环、重试与缓存的总成本。不能把 send 次数当成模型请求次数。

同一 Attempt 的 Judge 另有 31 次 physical-transmissions，输入 228040 / 输出 4790 token，`cost` 为 null、`priceReceipts` 为空。这只说明该记录没有金额凭据，不据此指控 Judge 丢失账单；也不能让 Judge token 代表 coding agent 的开销。

## 公开入口与复查

在拥有该下游记录的项目中：

```sh
pnpm --silent exec niceeval query discover
pnpm --silent exec niceeval query run --request - <<'JSON'
{"protocol":"niceeval.query/v2","operation":{"kind":"attempt.usage","locator":"@1CAKJ10309G3Q"}}
JSON
```

查询成功，issues 为空，modelGroups 返回上述 reason。记录没有随 Issue 上传，locator 仅在源项目可解析。独立复验可使用官方 `codexAgent()` 执行至少包含两次模型请求的工具循环，再以该次实际 locator 查询；此 Issue 没有宣称已完成独立 synthetic 最小复现或确定内部根因。

## 影响与验收目标

- 无法按“所有尝试，包括失败、取消与重试”比较 coding agent 成本。
- 官方 Adapter 应提供实际可取得的逐调用证据，或明确指出源协议缺少哪些数据、完整性边界与可用接入方式。
- 聚合结果应区分 send / turn 与物理模型调用；缓存 token、重试和不可得费用不能被静默省略或补零。
- 修复验收应覆盖多工具循环、失败/取消和重试；公开 query 必须可核对分母及缺失项。
- 如源协议无法提供，应明确记录限制，不虚构物理调用。

## 范围与查重

这是官方 Codex Adapter 的成本证据覆盖问题，不是要求核心自动追踪任意子进程/目标应用。下游目标应用代理自身未登记用量另行跟踪。也不同于 #292：后者是已经完整 recordUsage 后 exp JSON 汇总显示零；本问题是缺少可核对的物理调用证据。

建议分类：enhancement / area:adapter（主要）/ area:record / needs-triage。

## 环境与来源

- Source repository: github.com/niceeval/niceeval-eval
- Stable origin ID: codex-agent-physical-call-cost-coverage
- 来源：agent-assisted downstream dogfood，2026-10-23 的真实运行及随后只读公开 Query 复查。
- 外层 NiceEval：`0.0.0-development` 本地安装候选，tarball SHA-256 `21ebcc8e00897576056fe2a723fa08499fe01b2a15684c00826a95a8344f5d38`。
- Linux、Node v24.19.0、pnpm 11.12.0，官方 codexAgent，Incus 临时 VM。
- 不包含凭据、私有端点、原始对话或漏洞细节。
