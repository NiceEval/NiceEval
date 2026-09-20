import { resolve } from "node:path";
import { Effect, Result, Schema } from "effect";

import { decodeAnnotatedCases, type AnnotatedCase } from "../docs/test-case/annotations.js";
import { PrTestRelationInvalid } from "./errors.js";
import { PrFileSystem, PrGit } from "./services.js";

const SourcePath = Schema.String.check(
  Schema.isPattern(/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))e2e\/[^\\\0\r\n]+\.(?:[cm]?[jt]sx?)$/u),
);
const Revision = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u));

export const readPrTestDeclarations = Effect.fn("readPrTestDeclarations")(function*(
  root: string,
  selector: string,
  head?: string,
) {
  const git = yield* PrGit;
  const fileSystem = yield* PrFileSystem;
  if (head !== undefined) yield* Schema.decodeUnknownEffect(Revision)(head).pipe(
    Effect.mapError(() => new PrTestRelationInvalid({ selector, message: "test source revision must be an exact commit ID" })),
  );
  const listed = yield* git.run(head === undefined
    ? ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "e2e"]
    : ["ls-tree", "-r", "--name-only", "-z", head, "--", "e2e"]);
  const candidates = [...new Set(listed.split("\0").filter(path => /\.(?:[cm]?[jt]sx?)$/u.test(path) && path !== "e2e/concord-history.ts"))].sort();
  const paths = yield* Schema.decodeUnknownEffect(Schema.Array(SourcePath))(candidates).pipe(
    Effect.mapError(() => new PrTestRelationInvalid({ selector, message: "test source inventory contains a noncanonical path" })),
  );
  const declarations: AnnotatedCase[] = [];
  const identities = new Map<string, string>();
  const inputFiles: string[] = [];
  for (const path of paths) {
    if (head === undefined && !(yield* fileSystem.exists(resolve(root, path)))) continue;
    const source = head === undefined
      ? yield* fileSystem.readText(resolve(root, path))
      : yield* git.readBlob(head, path);
    const decoded = decodeAnnotatedCases(path, source);
    if (Result.isFailure(decoded)) return yield* new PrTestRelationInvalid({ selector, message: `${decoded.failure.path}: ${decoded.failure.message}` });
    for (const declaration of decoded.success) {
      const previous = identities.get(declaration.caseId);
      if (previous !== undefined) return yield* new PrTestRelationInvalid({ selector, message: `${declaration.caseId} is declared by both ${previous} and ${path}` });
      identities.set(declaration.caseId, path);
    }
    declarations.push(...decoded.success);
    inputFiles.push(path);
  }
  return { declarations, inputFiles };
});
