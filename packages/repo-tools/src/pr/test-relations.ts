import { resolve } from "node:path";
import { Effect, Schema } from "effect";

import { readConcordTestList, readConcordTestListAtRevision } from "../concord-cli.js";
import { PrTestRelationInvalid } from "./errors.js";
import { PrFileSystem, PrGit } from "./services.js";

const SourcePath = Schema.String.check(
  Schema.isPattern(/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))e2e\/[^\\\0\r\n]+\.(?:[cm]?[jt]sx?)$/u),
);
const Revision = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u));

export const readPrTestDeclarations = Effect.fn("readPrTestDeclarations")(function* (
  root: string,
  selector: string,
  head?: string,
) {
  const git = yield* PrGit;
  const fileSystem = yield* PrFileSystem;
  if (head !== undefined)
    yield* Schema.decodeUnknownEffect(Revision)(head).pipe(
      Effect.mapError(
        () => new PrTestRelationInvalid({ selector, message: "test source revision must be an exact commit ID" }),
      ),
    );
  const listed = yield* git.run(
    head === undefined
      ? ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "e2e"]
      : ["ls-tree", "-r", "--name-only", "-z", head, "--", "e2e"],
  );
  const candidates = [
    ...new Set(
      listed.split("\0").filter((path) => /\.(?:[cm]?[jt]sx?)$/u.test(path) && path !== "e2e/concord-history.ts"),
    ),
  ].sort();
  const paths = yield* Schema.decodeUnknownEffect(Schema.Array(SourcePath))(candidates).pipe(
    Effect.mapError(
      () => new PrTestRelationInvalid({ selector, message: "test source inventory contains a noncanonical path" }),
    ),
  );
  const inputFiles: string[] = [];
  for (const path of paths) {
    if (head !== undefined || (yield* fileSystem.exists(resolve(root, path)))) inputFiles.push(path);
  }
  const cases = yield* (
    head === undefined ? readConcordTestList(root) : readConcordTestListAtRevision(root, head)
  ).pipe(Effect.mapError((error) => new PrTestRelationInvalid({ selector, message: String(error) })));
  const identities = new Set<string>();
  const declarations = [];
  for (const item of cases) {
    if (!inputFiles.includes(item.file) || item.status !== "active") continue;
    if (identities.has(item.id))
      return yield* new PrTestRelationInvalid({ selector, message: `${item.id} has multiple current declarations` });
    identities.add(item.id);
    declarations.push({
      caseId: item.id,
      declarationPath: item.file,
      testFile: item.file,
      contract: item.contract,
      contractKind: item.contractKind,
      issues: item.issues,
    });
  }
  return { declarations, inputFiles };
});
