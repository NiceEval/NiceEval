import { rmSync } from "node:fs";
import { beforeEach, expect, test } from "vitest";
import { command, defined, only } from "./api.ts";

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: { sections: Array<{ evalId: string; attempts: Array<{ locator: string }> }> };
}

interface AttemptDocument {
  format: "niceeval.show";
  view: "attempt";
  data: {
    assertions: {
      attention: Array<{ expected?: string; received?: string }>;
      passedGroups: Array<{ items: Array<{ expected?: string; received?: string }> }>;
    } | null;
  };
}

beforeEach(() => rmSync(".niceeval", { recursive: true, force: true }));

// regression: d8d5a84b
test("show --json 经 pipe 仍包含尾部 sentinel", async () => {
  const seeded = await niceeval.run(["exp", "large-show", "--rerun", "all", "--json"]);
  expect(seeded.exitCode, seeded.diagnostic()).toBe(1);

  const history = await niceeval.run([
    "show", "large-output/payload", "--history", "--json",
  ]);
  expect(history.exitCode, history.diagnostic()).toBe(0);
  const section = only(
    history.json<HistoryDocument>().data.sections,
    (item) => item.evalId === "large-output/payload",
    () => history.diagnostic(),
  );
  const locator = defined(section.attempts.at(-1)?.locator, () => history.diagnostic());

  const receipt = await niceeval.run(["show", locator, "--json"]);

  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(Buffer.byteLength(receipt.stdout)).toBeGreaterThan(128 * 1024);

  const document = receipt.json<AttemptDocument>();
  expect(document).toMatchObject({ format: "niceeval.show", view: "attempt" });
  const assertions = defined(document.data.assertions, () => receipt.diagnostic());
  const rows = [
    ...assertions.attention,
    ...assertions.passedGroups.flatMap((group) => group.items),
  ];
  expect(rows).toContainEqual({
    expected: '"tail-sentinel"',
    received: '"actual-4999"',
  });
});
