import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const HOSTNAME = "0.0.0.0";
const PREFERRED_PORT = 5174;
const MAX_ATTEMPTS = 20;
const DEV_CACHE_DIR = ".next/dev";

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, HOSTNAME);
  });
}

async function findFreePort() {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const port = PREFERRED_PORT + i;
    if (await isPortFree(port)) return port;
  }
  throw new Error(
    `No free port found in range ${PREFERRED_PORT}-${PREFERRED_PORT + MAX_ATTEMPTS - 1}`,
  );
}

const port = await findFreePort();
if (port !== PREFERRED_PORT) {
  console.log(`Port ${PREFERRED_PORT} is in use, using ${port} instead.`);
}

rmSync(DEV_CACHE_DIR, { force: true, recursive: true });

const child = spawn(
  "next",
  ["dev", "--hostname", HOSTNAME, "--port", String(port)],
  { stdio: "inherit" },
);

child.on("exit", (code) => process.exit(code ?? 0));
