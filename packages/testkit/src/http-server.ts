import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";

export type HttpServerHandle = {
  readonly url: string;
};

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

async function toWebRequest(
  req: IncomingMessage,
  origin: string,
): Promise<Request> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else {
      headers.set(key, value);
    }
  }

  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    const body = await readRequestBody(req);
    // Uint8Array is a valid BodyInit; Buffer is not under strict DOM lib typings.
    init.body = new Uint8Array(body);
    // Node fetch requires duplex when a body is present on certain methods.
    (init as RequestInit & { duplex?: string }).duplex = "half";
  }

  return new Request(url, init);
}

async function writeWebResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    // node may set content-length itself from body write
    if (key.toLowerCase() === "content-encoding") {
      res.setHeader(key, value);
      return;
    }
    res.setHeader(key, value);
  });

  if (response.body === null) {
    res.end();
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

function listen(
  server: Server,
  hostname: string,
  port: number,
): Promise<{ hostname: string; port: number }> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, hostname, () => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("server address unavailable after listen"));
        return;
      }
      resolve({ hostname: address.address, port: address.port });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/**
 * Probe that the given host:port can be bound again after our listener closed.
 * Fails the test when the port is still occupied.
 */
function assertPortReleased(hostname: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    const onError = (error: Error) => {
      probe.off("error", onError);
      reject(
        new Error(
          `port ${hostname}:${port} still occupied after withHttpServer close: ${error.message}`,
          { cause: error },
        ),
      );
    };
    probe.once("error", onError);
    probe.listen(port, hostname, () => {
      probe.off("error", onError);
      probe.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve();
      });
    });
  });
}

/**
 * Serve `handler` on 127.0.0.1:0 by default, expose the actual origin as `url`,
 * and always close the listener after the body (success or failure).
 * Fails when the port remains occupied after close.
 */
export async function withHttpServer<T>(
  handler: (request: Request) => Response | Promise<Response>,
  body: (server: HttpServerHandle) => Promise<T>,
  options?: { hostname?: string; port?: number },
): Promise<T> {
  const hostname = options?.hostname ?? "127.0.0.1";
  const port = options?.port ?? 0;

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const address = server.address();
        if (address === null || typeof address === "string") {
          res.statusCode = 500;
          res.end("server address unavailable");
          return;
        }
        const origin = `http://${address.address}:${address.port}`;
        const request = await toWebRequest(req, origin);
        const response = await handler(request);
        await writeWebResponse(res, response);
      } catch (error) {
        if (!res.headersSent) {
          res.statusCode = 500;
        }
        res.end(
          error instanceof Error ? error.message : "handler failed",
        );
      }
    })();
  });

  const bound = await listen(server, hostname, port);
  const url = `http://${bound.hostname}:${bound.port}`;

  let bodyError: unknown;
  let result!: T;
  let bodyFailed = false;

  try {
    result = await body({ url });
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
  }

  try {
    await closeServer(server);
    await assertPortReleased(bound.hostname, bound.port);
  } catch (cleanupError) {
    if (bodyFailed) {
      throw new AggregateError([bodyError, cleanupError], "body and cleanup failed", {
        cause: bodyError,
      });
    }
    throw cleanupError;
  }

  if (bodyFailed) {
    throw bodyError;
  }
  return result;
}
