import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(new URL("../../../../packages/niceeval/package.json", import.meta.url));
export const { Clock, Duration, Effect } =
  require("effect") as typeof import("../../../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } =
  require("niceeval/run/host") as typeof import("../../../../packages/niceeval/src/run/host/index.ts");
const { openInspectionSource, operationalInspectionSource, selectInspectionOperation } =
  require("./src/inspection/index.ts") as typeof import("../../../../packages/niceeval/src/inspection/index.ts");

export { selectInspectionOperation };

type Facts = import("../../../../packages/niceeval/src/inspection/index.ts").InspectionFactSource;

/** A temporary NiceEval project whose files are written by the test and removed afterwards. */
export interface FixtureProject {
  readonly cwd: string;
  dispose(): Promise<void>;
}

export async function createFixtureProject(
  prefix: string,
  files: Readonly<Record<string, string>>,
): Promise<FixtureProject> {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), `${prefix}-`));
  await writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" }));
  for (const [relative, body] of Object.entries(files)) {
    const target = join(cwd, relative);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, body);
  }
  return { cwd, dispose: () => rm(cwd, { recursive: true, force: true }) };
}

/** Runs one Experiment with a forced rerun and returns the published Attempt locator of its only slot. */
export async function runSingleAttempt(
  cwd: string,
  experimentSelector: string,
  clock?: typeof Clock.Clock.Service,
): Promise<string> {
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector,
      config: { maxConcurrency: 1 },
      overrides: { rerun: "all" },
    }),
  );
  if (planned.status !== "ready") throw new Error(`Could not plan ${experimentSelector}: ${JSON.stringify(planned)}`);
  const execute = experimentHost.invocation.run({ plan: planned.plan });
  const result = await Effect.runPromise(clock ? Effect.provideService(execute, Clock.Clock, clock) : execute);
  const detail = await Effect.runPromise(runHost.get({ cwd, runId: result.receipt.createdRunIds[0]! }));
  const slot = detail.run.slots[0]!;
  if (slot.publication.state !== "published") throw new Error(`Slot for ${experimentSelector} was not published`);
  return slot.publication.attemptLocator;
}

export function withOperational<A>(cwd: string, run: (facts: Facts) => A): Promise<A> {
  return Effect.runPromise(Effect.scoped(openInspectionSource(operationalInspectionSource(cwd)).pipe(Effect.map(run))));
}

export async function readJson<T>(cwd: string, name: string): Promise<T> {
  return JSON.parse(await readFile(join(cwd, name), "utf8")) as T;
}

export async function writeJson(cwd: string, name: string, value: unknown): Promise<void> {
  await writeFile(join(cwd, name), JSON.stringify(value));
}
