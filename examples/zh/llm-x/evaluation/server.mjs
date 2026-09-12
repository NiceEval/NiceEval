import { createServer } from "node:http";
import next from "next";

// Serve the same production Route Handlers as `next start`, on an OS-assigned port.
const app = next({ dev: false, dir: process.cwd() });
const handle = app.getRequestHandler();
const server = createServer((request, response) => handle(request, response));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 5_000);
  deadline.unref();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
// If the runner disappears, its backend must not keep serving an orphan world.
process.on("disconnect", close);
await app.prepare();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.send?.({ port: address.port });
});
