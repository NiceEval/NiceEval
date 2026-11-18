import { parseAllDocuments } from "yaml";

export function parsePnpmLockfile(text: string): unknown {
  const documents = parseAllDocuments(text);
  for (const document of documents) {
    if (document.errors[0]) throw document.errors[0];
  }

  // pnpm 12 can put package manager and config dependencies in a leading document.
  if (
    documents.length === 2 &&
    (documents[0]!.hasIn(["importers", ".", "packageManagerDependencies"]) ||
      documents[0]!.hasIn(["importers", ".", "configDependencies"]))
  ) {
    return documents[1]!.toJS();
  }
  if (documents.length === 1) return documents[0]!.toJS();
  throw new Error("Unsupported pnpm lockfile document layout");
}
