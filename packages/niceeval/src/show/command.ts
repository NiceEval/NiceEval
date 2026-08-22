/**
 * Terminal-only command composition. It is deliberately data-only: a fixed
 * ReportExecution is rendered by `niceeval/report/host`, not reconstructed by
 * a copied command line or legacy Record lookup.
 */
export interface ShowCommandContext {
  readonly patterns: readonly string[];
  readonly record?: string;
  readonly experiment?: string | readonly string[];
  readonly report?: string;
  readonly page?: string;
}

export function showCommand(ctx: ShowCommandContext, extra: readonly string[] = []): string {
  const parts = ["niceeval show", ...ctx.patterns];
  if (ctx.experiment !== undefined) {
    for (const experiment of Array.isArray(ctx.experiment) ? ctx.experiment : [ctx.experiment]) {
      parts.push(`--experiment ${experiment}`);
    }
  }
  if (ctx.record !== undefined) parts.push(`--record ${ctx.record}`);
  if (ctx.report !== undefined) parts.push(`--report ${ctx.report}`);
  if (ctx.page !== undefined) parts.push(`--page ${ctx.page}`);
  parts.push(...extra);
  return parts.join(" ");
}
