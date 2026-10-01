import { defineAdapter, type ExecutionTraceInput } from "niceeval";
import { writeFile } from "node:fs/promises";

export const executionDisplayAdapter = defineAdapter({
  name: "execution-display-fixture",
  behaviorRevision: "1",
  create(ctx) {
    return {
      async archive() {
        const image = await ctx.attach({
          name: "gate.png", mediaType: "image/png",
          body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI1sAAAAASUVORK5CYII=", "base64"),
        });
        await ctx.recordTrace({
          traceId: "application-display", schema: { id: "example.application/v1" },
          collection: { state: "partial", limitations: [{ code: "external-trace", message: "Full trace is stored by the RPG server." }] },
          scopes: [],
          events: [
            {
              key: "npc", type: "npc.said", source: { id: "game-server" }, actor: { id: "npc:guard", label: "\u001bGuard\u202e" },
              summary: "\u001bNPC dialogue\u202e", payload: { npcId: "guard", mood: "alert" },
              display: [{ kind: "message", role: "other", speaker: "Guard", text: "Halt! Who goes there?" }],
            },
            {
              key: "http", type: "http.request", source: { id: "api" }, summary: "Created an order",
              display: [{ kind: "fields", fields: [
                { label: "method", value: "POST" }, { label: "path", value: "/v1/orders" },
                { label: "status", value: 201 }, { label: "latency", value: 83.125 },
                { label: "cached", value: false }, { label: "error", value: null },
              ] }],
            },
            {
              key: "image", type: "frame.rendered", source: { id: "renderer" }, summary: "Rendered the gate",
              display: [{ kind: "image", artifactId: image.artifactId, alt: "Guard blocks the gate at dusk" }],
            },
            {
              key: "external", type: "rpg.run", source: { id: "rpg-server", eventId: "run_8f2c" },
              summary: "Full trace stored by the RPG server: run_8f2c", payload: { runId: "run_8f2c" },
              display: [
                { kind: "text", text: "The full trace is stored by the RPG server. Query it with:" },
                { kind: "code", language: "shell", text: "rpg-cli trace show run_8f2c" },
              ],
            },
            {
              key: "long", type: "log.created", source: { id: "logger" }, summary: "Long Unicode display",
              display: [
                { kind: "text", text: "界".repeat(400) },
                { kind: "code", language: "shell", text: `printf '${"x".repeat(100)}'\n\tprintf 'tail-sentinel'  ` },
                { kind: "fields", fields: [{ label: "body", value: "😀".repeat(300) }] },
              ],
            },
          ],
        });
        return true;
      },
      async rejectInvalid() {
        const attachment = await ctx.attach({ name: "plain.txt", mediaType: "text/plain", body: "not an image" });
        const base = {
          schema: { id: "example.application/v1" }, collection: { state: "complete" as const, limitations: [] }, scopes: [],
        };
        await ctx.recordTrace({ ...base, traceId: "retained", events: [{
          key: "retained", type: "observation", source: { id: "fixture" }, summary: "Retained valid display",
          display: [{ kind: "text", text: "Still readable after rejection" }],
        }] });
        const failures: string[] = [];
        for (const [mode, display] of [
          ["escape", [{ kind: "text", text: "bad\u001b[2J" }]],
          ["empty", []],
          ["non-image", [{ kind: "image", artifactId: attachment.artifactId, alt: "Not an image" }]],
          ["unknown-kind", [{ kind: "html", text: "<b>bad</b>" }]],
          ["non-finite", [{ kind: "fields", fields: [{ label: "value", value: Infinity }] }]],
          ["unknown-field", [{ kind: "text", text: "text", extra: true }]],
          ["newline-label", [{ kind: "fields", fields: [{ label: "bad\nlabel", value: 1 }] }]],
          ["bidi", [{ kind: "message", role: "other", speaker: "Guard\u202e", text: "hello" }]],
        ] as const) {
          try {
            await ctx.recordTrace({ ...base, traceId: mode, events: [{
              key: mode, type: "invalid", source: { id: "fixture" }, summary: mode, display,
            }] } as unknown as ExecutionTraceInput);
            throw new Error(`${mode}: invalid display was accepted`);
          } catch (error) {
            if (!(error instanceof Error) || !("code" in error)) throw error;
            failures.push(`${mode}: ${String(error.code)}: ${error.message}`);
          }
        }
        await writeFile("execution-display-rejections.txt", failures.join("\n"));
        return true;
      },
    };
  },
});
