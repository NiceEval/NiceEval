// 证据覆盖的解析与折叠:Agent 级默认 + Turn 级降级 → attempt 级聚合
// (见 docs/feature/adapters/architecture/evidence.md「覆盖声明」)。
// 消费规则(正/负断言的三值折叠)在 scoped.ts;这里只管状态代数:
// unavailable < partial < complete,Turn 只能降级、聚合取最差。

import type {
  EvidenceCoverage,
  EvidenceCoverageEntry,
  EvidenceCoverageStatus,
  TurnEvidenceCoverage,
} from "../agents/types.ts";

/** 证据通道全集(EvidenceCoverage 的键)。 */
export const EVIDENCE_COVERAGE_CHANNELS = ["events", "actions", "messages", "usage", "status", "data"] as const;
export type EvidenceCoverageChannel = (typeof EVIDENCE_COVERAGE_CHANNELS)[number];

/**
 * 解析后的通道状态:未声明按 "unknown" 落地(不是 complete)。unknown 与 unavailable 在
 * 消费侧同样保守;区别只在展示(unknown =「Adapter 没说」,unavailable =「Adapter 说了拿不到」)。
 */
export type ResolvedEvidenceCoverageStatus = EvidenceCoverageStatus;

/** 解析后的单通道声明。 */
export type ResolvedEvidenceCoverageEntry = EvidenceCoverageEntry;

/** 全通道解析后的覆盖:每个通道必有一个状态(缺省 unknown)。 */
export type ResolvedEvidenceCoverage = EvidenceCoverage;

/**
 * 官方 SDK 适配器用的「全通道 complete」常量:完整事件流、完整 steps/output、经过生命周期
 * fixture 验证的 transcript 才可以声明它(见 docs/feature/adapters/architecture/evidence.md)。
 */
const COMPLETE_ENTRY = Object.freeze({ status: "complete" as const });
export const completeEvidenceCoverage: EvidenceCoverage = Object.freeze<EvidenceCoverage>({
  events: COMPLETE_ENTRY,
  actions: COMPLETE_ENTRY,
  messages: COMPLETE_ENTRY,
  usage: COMPLETE_ENTRY,
  status: COMPLETE_ENTRY,
  data: COMPLETE_ENTRY,
});

const RANK: globalThis.Record<ResolvedEvidenceCoverageStatus, number> = {
  complete: 3,
  partial: 2,
  unavailable: 1,
};

function worseOf(a: ResolvedEvidenceCoverageEntry, b: ResolvedEvidenceCoverageEntry): ResolvedEvidenceCoverageEntry {
  const ra = RANK[a.status];
  const rb = RANK[b.status];
  if (ra < rb) return a;
  if (rb < ra) return b;
  return a;
}

function assertEvidenceCoverageEntry(value: unknown, path: string): asserts value is EvidenceCoverageEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an evidence coverage entry.`);
  }
  const entry = value as { status?: unknown; reason?: unknown };
  if (entry.status !== "complete" && entry.status !== "partial" && entry.status !== "unavailable") {
    throw new Error(`${path}.status must be complete, partial, or unavailable.`);
  }
  if (entry.status === "complete") {
    if (entry.reason !== undefined) {
      throw new Error(`${path} cannot include reason when status is complete.`);
    }
  } else if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
    throw new Error(`${path} requires a non-empty reason when status is ${entry.status}.`);
  }
}

/** JavaScript 调用同样必须在 Agent 构造期兑现六通道与 reason 契约。 */
export function assertEvidenceCoverage(value: unknown, owner: string): asserts value is EvidenceCoverage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${owner} requires evidenceCoverage with all six evidence channels.`);
  }
  const coverage = value as globalThis.Record<string, unknown>;
  for (const channel of EVIDENCE_COVERAGE_CHANNELS) {
    const raw = coverage[channel];
    if (raw === undefined) {
      throw new Error(`${owner} requires evidenceCoverage.${channel}.`);
    }
    assertEvidenceCoverageEntry(raw, `${owner} evidenceCoverage.${channel}`);
  }
}

/**
 * Turn 级降级:相对 base(Agent 默认)只能变差,不能升格——Turn 声明比 base 更好的状态
 * 直接被 base 压住(min 语义天然满足「不能把 Agent 未声明的通道升格成 complete」)。
 */
export function downgradeEvidenceCoverage(
  base: ResolvedEvidenceCoverage,
  turn: TurnEvidenceCoverage | undefined,
): ResolvedEvidenceCoverage {
  if (!turn) return base;
  const out = {} as globalThis.Record<EvidenceCoverageChannel, ResolvedEvidenceCoverageEntry>;
  for (const ch of EVIDENCE_COVERAGE_CHANNELS) {
    const d = turn[ch];
    if (d !== undefined) assertEvidenceCoverageEntry(d, `Turn.evidenceCoverage.${ch}`);
    out[ch] = d ? worseOf(base[ch], d) : base[ch];
  }
  return out;
}

/** attempt / session 级聚合:各 turn 的最差值(unavailable < partial < complete)。 */
export function worstEvidenceCoverage(list: readonly ResolvedEvidenceCoverage[]): ResolvedEvidenceCoverage {
  if (list.length === 0) return completeEvidenceCoverage;
  let acc = list[0]!;
  for (let i = 1; i < list.length; i++) {
    const next = list[i]!;
    const out = {} as globalThis.Record<EvidenceCoverageChannel, ResolvedEvidenceCoverageEntry>;
    for (const ch of EVIDENCE_COVERAGE_CHANNELS) out[ch] = worseOf(acc[ch], next[ch]);
    acc = out;
  }
  return acc;
}
