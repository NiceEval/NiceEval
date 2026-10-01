// rerun: pnpm e2e test --repo inspection -- --run test/execution-trace-portable.test.ts
import { only } from "@niceeval/testkit";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("通用轨迹随 Record 搬迁后仍可精确展开摘要之外的事件与请求证据", async () => {
  await inspectionE2E.case("execution-trace-portable", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "execution-trace", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const result = only(run.expEvalEvents(), (entry) => entry.evalId === "execution-trace", run.diagnostic());
    expect(result.verdict).toBe("passed");
    const locator = result.locator.startsWith("@") ? result.locator : `@${result.locator}`;
    const [eventId, evidenceId, missingNativeId] = (await readFile(join(projectRoot, "execution-selectors.txt"), "utf8")).split("\n");
    expect(eventId).toMatch(/\S/u);
    expect(evidenceId).toMatch(/\S/u);
    expect(new Set([eventId, evidenceId, missingNativeId]).size).toBe(3);
    const conversationRun = await niceeval.run(["exp", "conversation-trace", "--rerun", "all", "--json"]);
    expect(conversationRun.exitCode, conversationRun.diagnostic()).toBe(0);
    const conversation = only(conversationRun.expEvalEvents(), (entry) => entry.evalId === "conversation-trace", conversationRun.diagnostic());
    const portable = join(projectRoot, "portable-trace.sqlite");
    await copyFile(join(projectRoot, ".niceeval", "record.sqlite"), portable);
    await rm(join(projectRoot, ".niceeval"), { recursive: true });
    const request = join(projectRoot, "execution.request.json");

    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.trace", locator } }));
    const outline = await niceeval.run(["query", "run", "--record", portable, "--request", request]);
    expect(outline.exitCode, outline.diagnostic()).toBe(0);
    const trace = outline.querySuccess("attempt.trace").trace;
    expect(trace.execution.state).toBe("complete");
    expect(only(trace.execution.traces, () => true, outline.diagnostic()).schema).toEqual({ id: "example.simulation" });
    expect(trace.execution.events[0]).toMatchObject({ summary: "Observed event 0", actor: { id: "actor-a", label: "Courier" } });
    expect(trace.execution.events).toHaveLength(32);
    expect(trace.execution.omittedEventCount).toBe(9_971);
    expect(trace.execution.hasMore).toBe(true);
    expect(trace.execution.identityIndex.eventIds).not.toContain(eventId);
    expect(JSON.stringify(trace)).not.toContain("large input ");
    expect(Buffer.byteLength(JSON.stringify(trace))).toBeLessThan(128 * 1024);

    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.trace", locator, continuation: trace.execution.continuation } }));
    const next = await niceeval.run(["query", "run", "--record", portable, "--request", request]);
    expect(next.exitCode, next.diagnostic()).toBe(0);
    expect(next.querySuccess("attempt.trace").trace.execution.events[0]).toMatchObject({ ordinal: 32, summary: "Observed event 32" });

    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: {
      kind: "attempt.trace", locator, actorId: "actor-a", eventType: "position.observed",
    } }));
    const filtered = await niceeval.run(["query", "run", "--record", portable, "--request", request]);
    expect(filtered.exitCode, filtered.diagnostic()).toBe(0);
    const filteredPage = filtered.querySuccess("attempt.trace").trace.execution;
    expect(filteredPage.events.map((event) => event.ordinal)).toEqual(Array.from({ length: 32 }, (_, index) => 2 + index * 2));
    expect(filteredPage.events.every((event) => event.actor?.id === "actor-a" && event.type === "position.observed")).toBe(true);
    expect(filteredPage.hasMore).toBe(true);
    expect(filteredPage.continuation).toBeTypeOf("string");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: {
      kind: "attempt.trace", locator, actorId: "actor-a", eventType: "position.observed", continuation: filteredPage.continuation,
    } }));
    const filteredNext = await niceeval.run(["query", "run", "--record", portable, "--request", request]);
    expect(filteredNext.exitCode, filteredNext.diagnostic()).toBe(0);
    const filteredNextPage = filteredNext.querySuccess("attempt.trace").trace.execution;
    expect(filteredNextPage.events.map((event) => event.ordinal)).toEqual(Array.from({ length: 32 }, (_, index) => 66 + index * 2));
    expect(filteredNextPage.events.every((event) => event.actor?.id === "actor-a" && event.type === "position.observed")).toBe(true);
    expect(new Set([...filteredPage.events, ...filteredNextPage.events].map((event) => event.eventId)).size).toBe(64);

    const filteredShow = await niceeval.run(["show", locator, "--record", portable, "--execution", "--actor", "actor-a", "--type", "position.observed"]);
    expect(filteredShow.exitCode, filteredShow.diagnostic()).toBe(0);
    expect(filteredShow.stdout).toContain("Observed event 2");
    expect(filteredShow.stdout).toContain("Observed event 64");
    expect(filteredShow.stdout).toContain("Courier");
    expect(filteredShow.stdout).not.toContain("Guide");
    expect(filteredShow.stdout).not.toContain("model.request");
    for (const event of filteredPage.events) expect(filteredShow.stdout).toContain(event.eventId);

    const filteredShowNext = await niceeval.run(["show", locator, "--record", portable, "--execution", "--actor", "actor-a", "--type", "position.observed", "--continuation", filteredPage.continuation!]);
    expect(filteredShowNext.exitCode, filteredShowNext.diagnostic()).toBe(0);
    expect(filteredShowNext.stdout).toContain("Observed event 66");
    expect(filteredShowNext.stdout).toContain("Observed event 128");
    for (const event of filteredNextPage.events) expect(filteredShowNext.stdout).toContain(event.eventId);

    // A token cannot silently restart or continue under a changed type filter.
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: {
      kind: "attempt.trace", locator, actorId: "actor-a", eventType: "operation.completed", continuation: filteredPage.continuation,
    } }));
    const changedType = await niceeval.run(["query", "run", "--record", portable, "--request", request]);
    expect(changedType.exitCode, changedType.diagnostic()).toBe(2);
    expect(changedType.queryFailure()).toMatchObject({ failure: { code: "restart-required" } });
    for (const argv of [
      ["show", locator, "--record", portable, "--source", "--actor", "actor-a"],
      ["show", locator, "--record", portable, "--timing", "--type", "position.observed"],
      ["show", locator, "--record", portable, "--continuation", filteredPage.continuation!],
    ]) {
      const invalidMode = await niceeval.run(argv);
      expect(invalidMode.exitCode, invalidMode.diagnostic()).not.toBe(0);
      expect(invalidMode.stdout).toBe("");
      expect(invalidMode.stderr).toContain("--execution");
    }

    const show = await niceeval.run(["show", locator, "--record", portable, "--execution"]);
    expect(show.exitCode, show.diagnostic()).toBe(0);
    expect(show.stdout).toContain("Courier");
    expect(show.stdout).toContain(trace.execution.events[0]!.eventId);
    expect(show.stdout).toContain(trace.execution.events[0]!.evidence[0]!.evidenceId);
    expect(show.stdout).not.toContain("request-evidence-sentinel");

    const expanded = await niceeval.run(["show", locator, "--record", portable, "--execution", "--expand", eventId!]);
    expect(expanded.exitCode, expanded.diagnostic()).toBe(0);
    expect(expanded.stdout).toContain("Movement completed after measurement");
    expect(expanded.stdout).toContain("excluded");
    expect(expanded.stdout).toContain("request-evidence-sentinel");

    for (const [option, value] of [
      ["--actor", "actor-a"],
      ["--type", "position.observed"],
      ["--continuation", filteredPage.continuation!],
    ] as const) {
      const expandedWithListOption = await niceeval.run(["show", locator, "--record", portable, "--execution", "--expand", eventId!, option, value]);
      expect(expandedWithListOption.exitCode, expandedWithListOption.diagnostic()).not.toBe(0);
      expect(expandedWithListOption.stdout).toBe("");
      expect(expandedWithListOption.stderr).toContain("--expand");
      expect(expandedWithListOption.stderr).toContain(option);
    }

    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.trace.detail", locator, selector: { kind: "execution-event", eventId: missingNativeId } } }));
    const domainPayload = await niceeval.run(["query", "run", "--record", portable, "--request", request]);
    expect(domainPayload.exitCode, domainPayload.diagnostic()).toBe(0);
    expect(domainPayload.stdout).toContain('"__proto__":{"domain":"preserved"}');
    expect(domainPayload.querySuccess("attempt.trace.detail").detail).toMatchObject({
      kind: "execution-event",
      event: { key: "10001", payload: { code: "inspection-result-invalid", reason: "domain-value" } },
    });

    const evidence = await niceeval.run(["show", locator, "--record", portable, "--execution", "--expand", evidenceId!]);
    expect(evidence.exitCode, evidence.diagnostic()).toBe(0);
    expect(evidence.stdout).toContain("request-evidence-sentinel");
    expect(evidence.stdout).not.toContain("actual-movement-sentinel");

    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.trace.detail", locator, selector: { kind: "execution-evidence", evidenceId, limit: 128 } } }));
    const firstRange = await niceeval.run(["query", "run", "--record", portable, "--request", request]);
    expect(firstRange.exitCode, firstRange.diagnostic()).toBe(0);
    const firstDetail = firstRange.querySuccess("attempt.trace.detail").detail;
    expect(firstDetail.kind).toBe("execution-evidence");
    if (firstDetail.kind !== "execution-evidence") throw new Error(firstRange.diagnostic());
    expect(firstDetail).toMatchObject({ pointer: "/events/0", offset: 0, nextOffset: 128 });
    expect(Buffer.from(firstDetail.base64, "base64").byteLength).toBe(128);
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.trace.detail", locator, selector: { kind: "execution-evidence", evidenceId, offset: firstDetail.nextOffset, limit: 128 } } }));
    const secondRange = await niceeval.run(["query", "run", "--record", portable, "--request", request]);
    expect(secondRange.exitCode, secondRange.diagnostic()).toBe(0);
    expect(secondRange.querySuccess("attempt.trace.detail").detail).toMatchObject({
      kind: "execution-evidence", evidenceId, pointer: "/events/0", offset: 128, nextOffset: 256,
      targetSha256: firstDetail.targetSha256, targetByteLength: firstDetail.targetByteLength,
    });

    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: {
      kind: "attempt.trace", locator: conversation.locator, sourceId: "niceeval.agent-turns", actorId: "assistant",
    } }));
    const conversationPage = await niceeval.run(["query", "run", "--record", portable, "--request", request]);
    expect(conversationPage.exitCode, conversationPage.diagnostic()).toBe(0);
    const firstConversation = conversationPage.querySuccess("attempt.trace").trace.execution;
    expect(firstConversation.traces.every((item) => !("revision" in item.schema))).toBe(true);
    expect(firstConversation.events).toHaveLength(32);
    expect(firstConversation.hasMore).toBe(true);
    expect(firstConversation.continuation).toBeTypeOf("string");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: {
      kind: "attempt.trace", locator: conversation.locator, sourceId: "niceeval.agent-turns", actorId: "assistant", continuation: firstConversation.continuation,
    } }));
    const conversationNext = await niceeval.run(["query", "run", "--record", portable, "--request", request]);
    expect(conversationNext.exitCode, conversationNext.diagnostic()).toBe(0);
    const remaining = conversationNext.querySuccess("attempt.trace").trace.execution;
    expect(remaining.events.length).toBeGreaterThan(0);
    expect(firstConversation.events.map((event) => event.eventId)).not.toContain(remaining.events[0]!.eventId);
    const conversationEvents = [...firstConversation.events, ...remaining.events];
    let lastPage = remaining;
    for (let pageIndex = 0; lastPage.hasMore && pageIndex < 8; pageIndex += 1) {
      await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: {
        kind: "attempt.trace", locator: conversation.locator, sourceId: "niceeval.agent-turns", actorId: "assistant", continuation: lastPage.continuation,
      } }));
      const nextPage = await niceeval.run(["query", "run", "--record", portable, "--request", request]);
      expect(nextPage.exitCode, nextPage.diagnostic()).toBe(0);
      lastPage = nextPage.querySuccess("attempt.trace").trace.execution;
      conversationEvents.push(...lastPage.events);
    }
    expect(lastPage.hasMore).toBe(false);
    expect(new Set(conversationEvents.map((event) => event.eventId)).size).toBe(conversationEvents.length);
    expect(conversationEvents.filter((event) => event.type === "agent.message")).toHaveLength(20);
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: {
      kind: "attempt.trace.detail", locator: conversation.locator, selector: { kind: "execution-event", eventId: remaining.events[0]!.eventId },
    } }));
    const conversationDetail = await niceeval.run(["query", "run", "--record", portable, "--request", request]);
    expect(conversationDetail.exitCode, conversationDetail.diagnostic()).toBe(0);
    expect(conversationDetail.querySuccess("attempt.trace.detail").detail.kind).toBe("item");
    const legacyInput = await niceeval.run(["exp", "execution-trace", "--rerun", "all", "--json"], {
      env: { ...process.env, NICEEVAL_E2E_LEGACY_TRACE_REVISION: "7" },
    });
    expect(legacyInput.exitCode, legacyInput.diagnostic()).toBe(1);
    expect(legacyInput.stdout).toContain("Execution trace envelope is invalid");
  });
}, 240_000);

// @feature docs/feature/inspection/README.md
// @regression memory/execution-producer-partial-hidden.md
test.concurrent("producer partial 轨迹在空事件、非空事件与分页完成后仍保留采集原因", async () => {
  for (const { label, eventCount, firstPageCount, omittedEventCount } of [
    { label: "空事件", eventCount: 0, firstPageCount: 0, omittedEventCount: 0 },
    { label: "非空事件", eventCount: 1, firstPageCount: 1, omittedEventCount: 0 },
    { label: "分页事件", eventCount: 33, firstPageCount: 32, omittedEventCount: 1 },
  ]) {
    await inspectionE2E.case(`execution-trace-partial-${eventCount}`, { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "partial-execution-trace", "--rerun", "all", "--json"], {
        env: { NICEEVAL_E2E_PARTIAL_TRACE_EVENT_COUNT: String(eventCount) },
      });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const result = only(run.expEvalEvents(), (entry) => entry.evalId === "partial-execution-trace", run.diagnostic());
      expect(result.verdict).toBe("passed");
      const locator = result.locator.startsWith("@") ? result.locator : `@${result.locator}`;
      const request = join(projectRoot, "partial-trace.request.json");
      await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.trace", locator } }));
      const outline = await niceeval.run(["query", "run", "--request", request]);
      expect(outline.exitCode, outline.diagnostic()).toBe(0);
      const execution = outline.querySuccess("attempt.trace").trace.execution;
      // Capture, producer collection and paging are independent public facts.
      expect(execution.state).toBe("complete");
      expect(execution.limitations).toEqual([]);
      const header = only(execution.traces, () => true, outline.diagnostic());
      expect(header).toMatchObject({
        sourceTraceId: "partial-journal",
        schema: { id: "example.telemetry" },
        collection: {
          state: "partial",
          limitations: [{ code: "producer-stream-interrupted", message: "Upstream journal ended before final acknowledgement." }],
        },
        eventCount,
      });
      expect(execution.events).toHaveLength(firstPageCount);
      expect(execution.hasMore).toBe(omittedEventCount > 0);
      expect(execution.omittedEventCount).toBe(omittedEventCount);
      if (omittedEventCount > 0) {
        expect(execution.continuation).toBeTypeOf("string");
        await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: {
          kind: "attempt.trace", locator, continuation: execution.continuation,
        } }));
        const next = await niceeval.run(["query", "run", "--request", request]);
        expect(next.exitCode, next.diagnostic()).toBe(0);
        const lastPage = next.querySuccess("attempt.trace").trace.execution;
        expect(lastPage.state).toBe("complete");
        expect(lastPage.events).toHaveLength(1);
        expect(lastPage.events[0]).toMatchObject({ ordinal: 32, summary: "Retained observation 32" });
        expect(lastPage.hasMore).toBe(false);
        expect(lastPage.omittedEventCount).toBe(0);
        expect(lastPage.continuation).toBeUndefined();
        expect(only(lastPage.traces, () => true, next.diagnostic()).collection).toEqual({
          state: "partial",
          limitations: [{ code: "producer-stream-interrupted", message: "Upstream journal ended before final acknowledgement." }],
        });
        expect(execution.events.map((event) => event.eventId)).not.toContain(lastPage.events[0]!.eventId);
      } else {
        expect(execution.continuation).toBeUndefined();
      }

      const show = await niceeval.run(["show", locator, "--execution"]);
      expect(show.exitCode, show.diagnostic()).toBe(0);
      const visible = show.stdout.replace(/\s+/gu, " ");
      expect(visible, `${label}: ${show.diagnostic()}`).toContain("partial");
      expect(visible).toContain("producer-stream-interrupted");
      expect(visible).toContain("Upstream journal ended before final acknowledgement.");
      if (eventCount > 0) {
        expect(visible).toContain("Retained observation 0");
        expect(visible).toContain("Observer");
        expect(visible).toContain("observation.recorded");
        expect(visible).toContain(execution.events[0]!.eventId);
      }
      if (eventCount === 1) {
        for (const { actorId, eventType } of [
          { actorId: "absent-actor", eventType: "observation.recorded" },
          { actorId: "observer", eventType: "absent.event" },
        ]) {
          await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: {
            kind: "attempt.trace", locator, traceId: header.traceId, actorId, eventType,
          } }));
          const zeroMatch = await niceeval.run(["query", "run", "--request", request]);
          expect(zeroMatch.exitCode, zeroMatch.diagnostic()).toBe(0);
          const emptyPage = zeroMatch.querySuccess("attempt.trace").trace.execution;
          expect(emptyPage.state).toBe("complete");
          expect(emptyPage.events).toEqual([]);
          expect(emptyPage.hasMore).toBe(false);
          expect(emptyPage.omittedEventCount).toBe(0);
          expect(emptyPage.continuation).toBeUndefined();
          expect(only(emptyPage.traces, () => true, zeroMatch.diagnostic())).toMatchObject({
            traceId: header.traceId,
            sourceTraceId: "partial-journal",
            eventCount: 1,
            collection: {
              state: "partial",
              limitations: [{ code: "producer-stream-interrupted", message: "Upstream journal ended before final acknowledgement." }],
            },
          });
          const zeroMatchShow = await niceeval.run(["show", locator, "--execution", "--actor", actorId, "--type", eventType]);
          expect(zeroMatchShow.exitCode, zeroMatchShow.diagnostic()).toBe(0);
          const emptyVisible = zeroMatchShow.stdout.replace(/\s+/gu, " ");
          expect(emptyVisible).toContain("partial");
          expect(emptyVisible).toContain("producer-stream-interrupted");
          expect(emptyVisible).toContain("Upstream journal ended before final acknowledgement.");
          expect(emptyVisible).not.toContain("Retained observation 0");
        }
      }
    });
  }
});
