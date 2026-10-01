import { Result, Schema } from "effect";
import { AssertionEntryIdSchema } from "../assertions/record/codec.ts";
import { canonicalizeRecordValue } from "../record/definition/canonical.ts";
import { RecordAttachmentEncodingLimits } from "../record/attachment/protocol.ts";
import type { JudgeUsageAttachment, JudgeUsageCall } from "../record/family/judge-usage/schema.ts";
import type { PriceOverride } from "../runner/types.ts";
import { normalizeJudgeUsageResponse } from "./judge-usage-receipt.ts";
import { createJudgeCallPriceReceipts } from "./judge-call-price.ts";

type TransmissionInput = Pick<JudgeUsageCall, "logicalOrdinal" | "transmissionOrdinal" | "operation" | "requestModel" | "transportProvider">;
export interface JudgeUsageTransmission {
  headers(status: number): void;
  body(body: string): void;
  fail(reason: "response-unavailable" | "response-too-large"): void;
  cancel(): void;
  trackCleanup(work: Promise<unknown>, deadlineAt: number): void;
}
export interface JudgeUsageEntry {
  begin(input: TransmissionInput): JudgeUsageTransmission | undefined;
  close(): void;
}
interface PendingCall { call: JudgeUsageCall; open: boolean }
const placeholderEntryId = Schema.decodeUnknownSync(AssertionEntryIdSchema)("ae_00000000000000000000");
const emptyReceipt: JudgeUsageCall["receipt"] = Object.freeze({
  state: "unavailable", reason: "response-unavailable", responseDigest: null, fields: Object.freeze([]),
});
const completeCollection = Object.freeze({ state: "complete" as const, limitations: Object.freeze([] as const) });

/** One Attempt owns admission, receipt cuts and all transport cleanup promises. */
export class JudgeUsageCollector {
  private readonly rows: PendingCall[] = [];
  private readonly entries = new Map<number, { closed: boolean; rows: PendingCall[] }>();
  private readonly cleanups = new Set<Promise<void>>();
  private closed = false;
  private cleanupIncomplete = false;
  private readonly pricing: Readonly<Record<string, PriceOverride>> | undefined;
  private readonly onAbort = () => this.close();

  constructor(pricing: Readonly<Record<string, PriceOverride>> | undefined, private readonly signal?: AbortSignal, private readonly onCleanupIncomplete?: () => void) {
    this.pricing = pricing === undefined ? undefined : freeze(structuredClone(pricing));
    signal?.addEventListener("abort", this.onAbort, { once: true });
    if (signal?.aborted) this.close();
  }

  forEntry(entryIndex: number): JudgeUsageEntry {
    const previous = this.entries.get(entryIndex);
    if (!Number.isSafeInteger(entryIndex) || entryIndex < 0 || (previous !== undefined && previous.rows.length > 0)) {
      throw new Error("Judge usage requires one capability per Assertion entry");
    }
    if (previous !== undefined) previous.closed = true;
    const entry = { closed: this.closed, rows: [] as PendingCall[] };
    this.entries.set(entryIndex, entry);
    return Object.freeze({
      begin: (input: TransmissionInput) => {
        if (this.closed || entry.closed || this.signal?.aborted || this.rows.length >= 4_000) return undefined;
        const call: JudgeUsageCall = Object.freeze({
          ...input, entryIndex, entryId: placeholderEntryId,
          callId: `judge:${entryIndex}:${input.logicalOrdinal}:${input.transmissionOrdinal}`,
          provider: null, model: null, status: "unknown", httpStatus: null,
          inputTokens: null, inputTotalTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
          cost: null, receipt: emptyReceipt,
        });
        if (this.rows.some((row) => row.call.callId === call.callId)) throw new Error("Duplicate Judge physical call identity");
        const row: PendingCall = { call, open: true };
        if (!this.canReserve(row)) return undefined;
        this.rows.push(row); entry.rows.push(row);
        const terminal = (status: JudgeUsageCall["status"], reason: JudgeUsageCall["receipt"]["reason"]): void => {
          if (!row.open) return;
          row.open = false;
          row.call = Object.freeze({ ...row.call, status, receipt: Object.freeze({ ...emptyReceipt, reason }) });
        };
        return Object.freeze({
          headers: (status: number) => {
            if (row.open && Number.isInteger(status) && status >= 100 && status <= 599) row.call = Object.freeze({ ...row.call, httpStatus: status });
          },
          body: (body: string) => {
            if (!row.open) return;
            // No await may separate the receipt cut and its immutable contribution.
            const receipt = normalizeJudgeUsageResponse(input.transportProvider, body);
            row.open = false;
            row.call = freeze({ ...row.call, ...receipt, status: row.call.httpStatus !== null && row.call.httpStatus >= 200 && row.call.httpStatus < 300 ? "succeeded" : "failed" });
          },
          fail: (reason: "response-unavailable" | "response-too-large") => terminal("failed", reason),
          cancel: () => terminal("cancelled", "cancelled"),
          trackCleanup: (work: Promise<unknown>, deadlineAt: number) => this.trackCleanup(work, deadlineAt),
        });
      },
      close: () => {
        entry.closed = true;
        for (const row of entry.rows) this.cancelRow(row);
      },
    });
  }

  private cancelRow(row: PendingCall): void {
    if (!row.open) return;
    row.open = false;
    row.call = Object.freeze({ ...row.call, status: "cancelled", receipt: Object.freeze({ ...emptyReceipt, reason: "cancelled" }) });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.signal?.removeEventListener("abort", this.onAbort);
    for (const entry of this.entries.values()) entry.closed = true;
    for (const row of this.rows) this.cancelRow(row);
  }

  async closeAndDrain(): Promise<void> {
    this.close();
    while (this.cleanups.size > 0) await Promise.all([...this.cleanups]);
  }

  snapshot(): JudgeUsageAttachment {
    if (!this.closed) throw new Error("Judge usage must close before publication");
    const calls = Object.freeze(this.rows.map((row) => row.call));
    return freeze({
      collection: completeCollection,
      calls,
      priceReceipts: createJudgeCallPriceReceipts(calls, this.pricing),
    });
  }

  private trackCleanup(work: Promise<unknown>, deadlineAt: number): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = work.then(() => true, () => false);
    const expired = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), Math.max(0, Math.min(1_000, deadlineAt - Date.now()))); });
    const bounded = Promise.race([settled, expired]).then((ok) => {
      if (timer !== undefined) clearTimeout(timer);
      if (!ok && !this.cleanupIncomplete) { this.cleanupIncomplete = true; this.onCleanupIncomplete?.(); }
    });
    this.cleanups.add(bounded);
    void bounded.then(() => this.cleanups.delete(bounded));
  }

  private canReserve(next: PendingCall): boolean {
    const rows = [...this.rows, next];
    const terminalCalls = rows.filter((row) => !row.open).map((row) => row.call);
    // Receipt padding bounds canonical bytes; scalar rows additionally bound nodes,
    // keys and depth. Price padding includes both legal 8 KiB model selectors.
    const calls = rows.map((row) => row.open ? {
      ...row.call, entryId: "a".repeat(256), provider: '"'.repeat(256), model: '"'.repeat(8192),
      cost: { amount: "1".repeat(512), currency: "A".repeat(256), source: { kind: "reported", id: '"'.repeat(256) } },
      receipt: { state: "available", reason: "invalid-usage", responseDigest: "0".repeat(71),
        fields: Array.from({ length: 24 }, (_, index) => ({ path: String(index).padEnd(128, "p"), value: null })),
        reservedCanonicalBytes: "x".repeat(32 * 1024) },
    } : row.call);
    const priceReceipts: unknown[] = [...createJudgeCallPriceReceipts(terminalCalls, this.pricing)];
    if (this.pricing !== undefined) for (const row of rows) if (row.open) priceReceipts.push({
      callId: row.call.callId, requestModel: row.call.requestModel,
      reservedCanonicalBytes: "x".repeat(64 * 1024),
      reservedNodes: Array.from({ length: 256 }, () => ({ value: null })),
    });
    return Result.isSuccess(canonicalizeRecordValue({ collection: completeCollection, calls, priceReceipts }, RecordAttachmentEncodingLimits));
  }
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
