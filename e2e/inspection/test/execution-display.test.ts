// rerun: pnpm e2e test --repo inspection -- --run test/execution-display.test.ts
import { only } from "@niceeval/testkit";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("读者从事件展示块读懂应用结果并展开外部轨迹指引与图片附件", async () => {
  await inspectionE2E.case("execution-display", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "execution-display", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const result = only(run.expEvalEvents(), (entry) => entry.evalId === "execution-display", run.diagnostic());
    expect(result.verdict).toBe("passed");
    const locator = result.locator.startsWith("@") ? result.locator : `@${result.locator}`;
    const request = join(projectRoot, "display.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.trace", locator } }));
    const query = await niceeval.run(["query", "run", "--request", request]);
    expect(query.exitCode, query.diagnostic()).toBe(0);
    const execution = query.querySuccess("attempt.trace").trace.execution;
    expect(execution.events).toHaveLength(5);
    expect(only(execution.traces, () => true, query.diagnostic()).collection).toEqual({
      state: "partial", limitations: [{ code: "external-trace", message: "Full trace is stored by the RPG server." }],
    });
    const npc = only(execution.events, (event) => event.type === "npc.said", query.diagnostic());
    expect(npc.summary).toBe("\u001bNPC dialogue\u202e");
    expect(npc.actor?.label).toBe("\u001bGuard\u202e");
    expect(npc.display).toEqual({ state: "present", blocks: [{ kind: "message", role: "other", speaker: "Guard", text: { preview: "Halt! Who goes there?", omittedBytes: 0 } }] });
    const http = only(execution.events, (event) => event.type === "http.request", query.diagnostic());
    expect(http.display).toEqual({ state: "present", blocks: [{ kind: "fields", fields: [
      { label: "method", value: { preview: "POST", omittedBytes: 0 } },
      { label: "path", value: { preview: "/v1/orders", omittedBytes: 0 } },
      { label: "status", value: 201 }, { label: "latency", value: 83.125 },
      { label: "cached", value: false }, { label: "error", value: null },
    ] }] });
    const long = only(execution.events, (event) => event.type === "log.created", query.diagnostic());
    expect(long.display).toMatchObject({ state: "present", blocks: [
      { kind: "text", text: { preview: "界".repeat(341), omittedBytes: 177 } },
      { kind: "code", language: "shell", text: { omittedBytes: 0 } },
      { kind: "fields", fields: [{ label: "body", value: { preview: "😀".repeat(256), omittedBytes: 176 } }] },
    ] });
    for (const event of execution.events) expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThanOrEqual(8 * 1024);

    const imageEvent = only(execution.events, (event) => event.type === "frame.rendered", query.diagnostic());
    if (imageEvent.display.state !== "present") throw new Error("Expected image display");
    const image = only(imageEvent.display.blocks, (block) => block.kind === "image", query.diagnostic());
    if (image.kind !== "image") throw new Error("Expected image block");
    const expectedImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI1sAAAAASUVORK5CYII=", "base64");
    expect(image).toMatchObject({ alt: "Guard blocks the gate at dusk", mediaType: "image/png", byteLength: expectedImage.byteLength, sha256: createHash("sha256").update(expectedImage).digest("hex") });

    const show = await niceeval.run(["show", locator, "--execution"]);
    expect(show.exitCode, show.diagnostic()).toBe(0);
    const visible = show.stdout.replace(/\s+/gu, " ");
    for (const text of ["Generic execution traces", "Conversation · not-recorded", "Commands · not-recorded", "Diagnostics · complete", "partial", "external-trace", "Full trace is stored by the RPG server.", "Guard: Halt! Who goes there?", "[image] Guard blocks the gate at dusk", "image/png", `${expectedImage.byteLength} bytes`, image.artifactId]) {
      expect(visible).toContain(text);
    }
    for (const [label, value] of [["method", "POST"], ["path", "/v1/orders"], ["status", "201"], ["latency", "83.125"], ["cached", "false"], ["error", "null"]]) expect(visible).toContain(`${label} ${value}`);
    expect(visible).toContain(`… (177 more bytes, --expand ${long.eventId})`);
    expect(visible).toContain(`… (176 more bytes, --expand ${long.eventId})`);
    expect(show.stdout).not.toContain("\u001b");
    expect(show.stdout).not.toContain("\u202e");
    expect(show.stdout).toMatch(/printf 'x+…\n/u);
    expect(show.stdout).not.toContain("x".repeat(100));

    const external = only(execution.events, (event) => event.type === "rpg.run", query.diagnostic());
    const expanded = await niceeval.run(["show", locator, "--execution", "--expand", external.eventId]);
    expect(expanded.exitCode, expanded.diagnostic()).toBe(0);
    expect(expanded.stdout.split("\n")).toContain("rpg-cli trace show run_8f2c");
    expect(expanded.stdout.indexOf("rpg-cli trace show run_8f2c")).toBeLessThan(expanded.stdout.indexOf('"payload"'));

    const full = await niceeval.run(["show", locator, "--execution", "--expand", long.eventId]);
    expect(full.exitCode, full.diagnostic()).toBe(0);
    expect(full.stdout.replace(/\s+/gu, "")).toContain("界".repeat(400));
    expect(full.stdout.split("\n")).toContain(`printf '${"x".repeat(100)}'`);
    expect(full.stdout.split("\n")).toContain("\tprintf 'tail-sentinel'  ");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.trace.detail", locator, selector: { kind: "execution-event", eventId: long.eventId } } }));
    const detail = await niceeval.run(["query", "run", "--request", request]);
    expect(detail.exitCode, detail.diagnostic()).toBe(0);
    expect(detail.querySuccess("attempt.trace.detail").detail).toMatchObject({ kind: "execution-event", event: { display: [
      { kind: "text", text: "界".repeat(400) },
      { kind: "code", language: "shell", text: `printf '${"x".repeat(100)}'\n\tprintf 'tail-sentinel'  ` },
      { kind: "fields", fields: [{ label: "body", value: "😀".repeat(300) }] },
    ] } });

    const imageDetail = await niceeval.run(["show", locator, "--execution", "--expand", imageEvent.eventId]);
    expect(imageDetail.exitCode, imageDetail.diagnostic()).toBe(0);
    expect(imageDetail.stdout).toContain("niceeval query run --request -");
    const requestLine = only(imageDetail.stdout.split("\n"), (line) => line.startsWith('{"protocol":"niceeval.query/v1","operation":{"kind":"attempt.artifact"'), imageDetail.diagnostic());
    await writeFile(request, requestLine);
    const bytes = await niceeval.run(["query", "run", "--request", request]);
    expect(bytes.exitCode, bytes.diagnostic()).toBe(0);
    const artifact = bytes.querySuccess("attempt.artifact").artifact;
    expect(artifact).toMatchObject({ state: "available", artifactId: image.artifactId, mediaType: "image/png", byteLength: expectedImage.byteLength, sha256: image.sha256, offset: 0, nextOffset: null });
    if (artifact.state !== "available") throw new Error("Expected image artifact bytes");
    expect(Buffer.from(artifact.base64, "base64")).toEqual(expectedImage);
  });
});
