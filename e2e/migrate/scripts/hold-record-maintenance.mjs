import { Effect, Either } from "effect";
import {
  makeRecordRoot,
  NodeRecordLive,
  recordHost,
} from "niceeval/record";

const root = makeRecordRoot(process.argv[2]);
if (Either.isLeft(root)) {
  throw new Error("Record root is invalid");
}

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  yield* recordHost.maintenance.open({ root: root.right });
  process.stdout.write("maintenance-ready\n");
  yield* Effect.never;
}).pipe(Effect.provide(NodeRecordLive))));
