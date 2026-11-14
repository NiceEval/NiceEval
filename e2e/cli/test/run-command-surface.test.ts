import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

// @feature docs/feature/run/README.md
test.concurrent("Run 生命周期命令将读取交给 show run:<id>", async () => {
  await cliE2E.case("run-command-surface", async ({ commands: { niceeval } }) => {
    const help = await niceeval.run(["run", "--help"]);
    expect(help.exitCode, help.diagnostic()).toBe(0);
    expect(help.stdout).not.toContain("run show");
    const removed = await niceeval.run(["run", "show", "--help"]);
    expect(removed.exitCode, removed.diagnostic()).not.toBe(0);
    const show = await niceeval.run(["show", "--help"]);
    expect(show.exitCode, show.diagnostic()).toBe(0);
    expect(show.stdout).toContain("run:<id>");
  });
});
