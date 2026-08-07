import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const grandchild = spawn(process.execPath, [fileURLToPath(new URL("./grandchild.mjs", import.meta.url))], {
  stdio: "ignore",
});
process.stdout.write(`CHILD-PID:${grandchild.pid}\n`);
setInterval(() => {}, 1000);
