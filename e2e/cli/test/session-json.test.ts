import { decodeSessionListDocument, decodeSessionShowDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

// @feature docs/feature/experiments/README.md
test.concurrent("脚本按 Invocation identity 严格读取完成状态", async () => {
  await cliE2E.case("session-json", async ({ commands: { niceeval } }) => {
    const completed = await niceeval.run(["exp", "normal", "greet", "--rerun", "all", "--json"]);
    expect(completed.exitCode, completed.diagnostic()).toBe(0);
    const invocationId = completed.expReceipt().invocationId;

    const listed = await niceeval.run(["invocation", "list", "--all", "--json"]);
    expect(listed.exitCode, listed.diagnostic()).toBe(0);
    const list = decodeSessionListDocument(listed.json<unknown>());
    expect(Object.keys(list).sort()).toEqual(["expired", "sessions"]);
    expect(list.sessions).toContainEqual(expect.objectContaining({ sessionId: invocationId, status: "completed" }));

    const shown = await niceeval.run(["invocation", "show", invocationId, "--json"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    const detail = decodeSessionShowDocument(shown.json<unknown>());
    expect(Object.keys(detail)).toEqual(["session"]);
    expect(detail.session).toMatchObject({ sessionId: invocationId, status: "completed" });
    expect(() => decodeSessionShowDocument({ ...detail, format: "niceeval.session" })).toThrow();
  });
});
