import { createServer } from "node:http";

export interface LocalHttpServer {
  url: string;
  stop(): Promise<void>;
}

export async function startLocalHttp(handler: () => Response | Promise<Response>): Promise<LocalHttpServer> {
  const server = createServer(async (_request, response) => {
    try {
      const fixture = await handler();
      response.statusCode = fixture.status;
      fixture.headers.forEach((value, name) => response.setHeader(name, value));
      response.end(Buffer.from(await fixture.arrayBuffer()));
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("本地 fixture 没有取得 TCP 端口");
  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
