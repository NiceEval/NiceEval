import { Schema } from "effect";
import { AssertionEntryIdSchema } from "../assertions/record/codec.ts";
import type { JudgeUsageAttachment, JudgeUsageCall } from "../record/family/judge-usage/schema.ts";
import type { PriceOverride } from "../runner/types.ts";
import { normalizeJudgeUsageResponse } from "./judge-usage-receipt.ts";
import { createJudgeCallPriceReceipts } from "./judge-call-price.ts";

type TransmissionInput = Pick<
  JudgeUsageCall,
  "logicalOrdinal" | "transmissionOrdinal" | "operation" | "requestModel" | "transportProvider"
>;
export interface JudgeUsageTransmission {
  headers(status: number): void;
  body(body: string, succeeded?: boolean): void;
  fail(reason: "response-unavailable" | "response-too-large"): void;
  cancel(): void;
  trackCleanup(work: Promise<unknown>, deadlineAt: number): void;
}
export interface JudgeUsageEntry {
  begin(input: TransmissionInput): JudgeUsageTransmission | undefined;
  close(): void;
}
interface PendingCall {
  call: JudgeUsageCall;
  open: boolean;
}
const placeholderEntryId = Schema.decodeUnknownSync(AssertionEntryIdSchema)("ae_00000000000000000000");
const emptyReceipt: JudgeUsageCall["receipt"] = {
  state: "unavailable",
  reason: "response-unavailable",
  responseDigest: null,
  fields: [],
};
const completeCollection = { state: "complete" as const, limitations: [] as const };

/** One Attempt owns admission, receipt cuts and all transport cleanup promises. */
export class JudgeUsageCollector {
  private readonly rows: PendingCall[] = [];
  private readonly callIds = new Set<string>();
  private readonly entries = new Map<number, { closed: boolean; rows: PendingCall[] }>();
  private readonly cleanups = new Set<Promise<void>>();
  private closed = false;
  private cleanupIncomplete = false;
  private readonly pricing: Readonly<Record<string, PriceOverride>> | undefined;
  private readonly onAbort = () => this.close();

  private readonly signal: AbortSignal | undefined;
  private readonly onCleanupIncomplete: (() => void) | undefined;
  constructor(
    pricing: Readonly<Record<string, PriceOverride>> | undefined,
    signal?: AbortSignal,
    onCleanupIncomplete?: () => void,
  ) {
    this.signal = signal;
    this.onCleanupIncomplete = onCleanupIncomplete;
    this.pricing = pricing === undefined ? undefined : structuredClone(pricing);
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
    return {
      begin: (input: TransmissionInput) => {
        if (this.closed || entry.closed || this.signal?.aborted) return undefined;
        const call: JudgeUsageCall = {
          ...input,
          entryIndex,
          entryId: placeholderEntryId,
          callId: `judge:${entryIndex}:${input.logicalOrdinal}:${input.transmissionOrdinal}`,
          provider: null,
          model: null,
          status: "unknown",
          httpStatus: null,
          inputTokens: null,
          inputTotalTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          cost: null,
          receipt: emptyReceipt,
        };
        if (this.callIds.has(call.callId)) throw new Error("Duplicate Judge physical call identity");
        const row: PendingCall = { call, open: true };
        this.callIds.add(call.callId);
        this.rows.push(row);
        entry.rows.push(row);
        const terminal = (status: JudgeUsageCall["status"], reason: JudgeUsageCall["receipt"]["reason"]): void => {
          if (!row.open) return;
          row.open = false;
          row.call = { ...row.call, status, receipt: { ...emptyReceipt, reason } };
        };
        return {
          headers: (status: number) => {
            if (row.open && Number.isInteger(status) && status >= 100 && status <= 599)
              row.call = { ...row.call, httpStatus: status };
          },
          body: (body: string, succeeded?: boolean) => {
            if (!row.open) return;
            // No await may separate the receipt cut and its immutable contribution.
            const receipt = normalizeJudgeUsageResponse(input.transportProvider, body);
            row.open = false;
            row.call = {
              ...row.call,
              ...receipt,
              status:
                (succeeded ?? (row.call.httpStatus !== null && row.call.httpStatus >= 200 && row.call.httpStatus < 300))
                  ? "succeeded"
                  : "failed",
            };
          },
          fail: (reason: "response-unavailable" | "response-too-large") => terminal("failed", reason),
          cancel: () => terminal("cancelled", "cancelled"),
          trackCleanup: (work: Promise<unknown>, deadlineAt: number) => this.trackCleanup(work, deadlineAt),
        };
      },
      close: () => {
        entry.closed = true;
        for (const row of entry.rows) this.cancelRow(row);
      },
    };
  }

  private cancelRow(row: PendingCall): void {
    if (!row.open) return;
    row.open = false;
    row.call = {
      ...row.call,
      status: "cancelled",
      receipt: { ...emptyReceipt, reason: "cancelled" },
    };
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
    const calls = this.rows.map((row) => row.call);
    return {
      collection: completeCollection,
      calls,
      priceReceipts: createJudgeCallPriceReceipts(calls, this.pricing),
    };
  }

  private trackCleanup(work: Promise<unknown>, deadlineAt: number): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = work.then(
      () => true,
      () => false,
    );
    const expired = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), Math.max(0, Math.min(1_000, deadlineAt - Date.now())));
    });
    const bounded = Promise.race([settled, expired]).then((ok) => {
      if (timer !== undefined) clearTimeout(timer);
      if (!ok && !this.cleanupIncomplete) {
        this.cleanupIncomplete = true;
        this.onCleanupIncomplete?.();
      }
    });
    this.cleanups.add(bounded);
    void bounded.then(() => this.cleanups.delete(bounded));
  }
}
