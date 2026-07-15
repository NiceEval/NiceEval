// 证据覆盖的解析与折叠:Agent 级默认 + Turn 级降级 → attempt 级聚合
// (见 docs/feature/adapters/architecture/evidence.md「覆盖声明」)。
// 消费规则(正/负断言的三值折叠)在 scoped.ts;这里只管状态代数:
// unknown/unavailable < partial < complete,Turn 只能降级、聚合取最差。

import type { CoverageDeclaration, CoverageStatus, EvidenceCoverage } from "../agents/types.ts";

/** 证据通道全集(EvidenceCoverage 的键)。 */
export const COVERAGE_CHANNELS = ["events", "actions", "messages", "usage", "status", "data"] as const;
export type CoverageChannel = (typeof COVERAGE_CHANNELS)[number];

/**
 * 解析后的通道状态:未声明按 "unknown" 落地(不是 complete)。unknown 与 unavailable 在
 * 消费侧同样保守;区别只在展示(unknown =「Adapter 没说」,unavailable =「Adapter 说了拿不到」)。
 */
export type ResolvedCoverageStatus = CoverageStatus | "unknown";

/** 解析后的单通道声明。 */
export interface ResolvedCoverageChannel {
  status: ResolvedCoverageStatus;
  reason?: string;
}

/** 全通道解析后的覆盖:每个通道必有一个状态(缺省 unknown)。 */
export type ResolvedCoverage = Readonly<Record<CoverageChannel, ResolvedCoverageChannel>>;

/**
 * 官方 SDK 适配器用的「全通道 complete」常量:完整事件流、完整 steps/output、经过生命周期
 * fixture 验证的 transcript 才可以声明它(见 docs/feature/adapters/architecture/evidence.md)。
 */
export const completeCoverage: EvidenceCoverage = Object.freeze<EvidenceCoverage>({
  events: { status: "complete" },
  actions: { status: "complete" },
  messages: { status: "complete" },
  usage: { status: "complete" },
  status: { status: "complete" },
  data: { status: "complete" },
});

// 状态序:折叠一律取最差。unknown 与 unavailable 保守程度相同,并列最差;
// 并列时取「有声明的那一个」(unavailable 带 reason,信息量更大)。
const RANK: Record<ResolvedCoverageStatus, number> = {
  complete: 3,
  partial: 2,
  unavailable: 1,
  unknown: 1,
};

function worseOf(a: ResolvedCoverageChannel, b: ResolvedCoverageChannel): ResolvedCoverageChannel {
  const ra = RANK[a.status];
  const rb = RANK[b.status];
  if (ra < rb) return a;
  if (rb < ra) return b;
  // 并列:优先「Adapter 说了拿不到」(unavailable / 带 reason)而不是「没说」。
  if (a.status === "unknown" && b.status !== "unknown") return b;
  if (b.status === "unknown" && a.status !== "unknown") return a;
  return a.reason !== undefined ? a : b;
}

/** Agent 级声明 → 全通道解析(未声明通道 = unknown)。 */
export function resolveAgentCoverage(declared: EvidenceCoverage | undefined): ResolvedCoverage {
  const out = {} as Record<CoverageChannel, ResolvedCoverageChannel>;
  for (const ch of COVERAGE_CHANNELS) {
    const d: CoverageDeclaration | undefined = declared?.[ch];
    out[ch] = d ? { status: d.status, ...(d.reason !== undefined ? { reason: d.reason } : {}) } : { status: "unknown" };
  }
  return out;
}

/**
 * Turn 级降级:相对 base(Agent 默认)只能变差,不能升格——Turn 声明比 base 更好的状态
 * 直接被 base 压住(min 语义天然满足「不能把 Agent 未声明的通道升格成 complete」)。
 */
export function downgradeCoverage(base: ResolvedCoverage, turn: EvidenceCoverage | undefined): ResolvedCoverage {
  if (!turn) return base;
  const out = {} as Record<CoverageChannel, ResolvedCoverageChannel>;
  for (const ch of COVERAGE_CHANNELS) {
    const d = turn[ch];
    out[ch] = d ? worseOf(base[ch], { status: d.status, ...(d.reason !== undefined ? { reason: d.reason } : {}) }) : base[ch];
  }
  return out;
}

/** attempt / session 级聚合:各 turn 的最差值(unknown/unavailable < partial < complete)。 */
export function worstCoverage(list: readonly ResolvedCoverage[]): ResolvedCoverage {
  if (list.length === 0) return resolveAgentCoverage(undefined);
  let acc = list[0]!;
  for (let i = 1; i < list.length; i++) {
    const next = list[i]!;
    const out = {} as Record<CoverageChannel, ResolvedCoverageChannel>;
    for (const ch of COVERAGE_CHANNELS) out[ch] = worseOf(acc[ch], next[ch]);
    acc = out;
  }
  return acc;
}
