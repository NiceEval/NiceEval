import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Each test gets a fully independent consumer and result root. The source
 * project itself is never used as evidence input: retained evidence is omitted
 * from every next copy and exists solely for runner artifact collection.
 */
export const evalProjectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-eval-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

export async function retainEvidence(root: string, caseName: string): Promise<void> {
  const destination = join(process.cwd(), ".niceeval", "e2e-artifacts", caseName);
  await rm(destination, { recursive: true, force: true });

  const evidence = join(root, ".niceeval");
  if (!existsSync(evidence)) return;

  await mkdir(dirname(destination), { recursive: true });
  await cp(evidence, destination, { recursive: true });
}
