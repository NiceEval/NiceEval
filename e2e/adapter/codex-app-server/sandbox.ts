import { localSandbox } from "niceeval/sandbox";
import { join } from "node:path";

export const sandbox = localSandbox({
  dir: process.cwd(),
  pathPrepend: [join(process.cwd(), "fixtures", "bin")],
});
