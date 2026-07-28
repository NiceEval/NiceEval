// show 专属的可复制命令拼装:页索引 / 组索引共用的携带规则(docs/feature/reports/show/reports.md
// 「索引命令携带完整上下文」)。这不是两宿主共用的报告 runtime 部分——view 走网页路由,不生成
// 终端命令——所以住在 show 自己这一侧,不进 src/report/runtime/host.ts。

import type { HostCommandContext } from "../report/runtime/host.ts";

/** 按上下文拼一条可复制的 show 命令(页索引 / 组索引共用的携带规则)。 */
export function showCommand(ctx: HostCommandContext, extra: string[] = []): string {
  const parts = ["niceeval show", ...ctx.patterns];
  if (ctx.experiment !== undefined) {
    for (const exp of Array.isArray(ctx.experiment) ? ctx.experiment : [ctx.experiment]) parts.push(`--exp ${exp}`);
  }
  if (ctx.record !== undefined) parts.push(`--record ${ctx.record}`);
  if (ctx.report !== undefined) parts.push(`--report ${ctx.report}`);
  if (ctx.page !== undefined) parts.push(`--page ${ctx.page}`);
  parts.push(...extra);
  return parts.join(" ");
}
