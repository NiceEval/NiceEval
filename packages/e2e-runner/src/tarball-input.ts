// The package embeds its input identity so distributed run/takeover jobs do
// not need a checkout-local sidecar to recover candidate provenance.
import { gunzipSync } from "node:zlib";
import * as tar from "tar-stream";
import { Effect, Schema } from "effect";

const Metadata = Schema.Struct({
  niceevalCandidateInputDigest: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
});

export const tarballInputDigest = (bytes: Uint8Array) =>
  Effect.callback<string | undefined, Error>((resume) => {
    const extractor = tar.extract();
    let digest: string | undefined;
    let seen = false;
    let settled = false;
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      resume(Effect.fail(cause instanceof Error ? cause : new Error(String(cause))));
      extractor.destroy();
    };
    extractor.on("error", fail);
    extractor.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      const metadata = header.type === "file" && header.name === "package/package.json";
      let size = 0;
      stream.on("error", fail);
      stream.on("data", (chunk: unknown) => {
        if (!metadata) return;
        if (!Buffer.isBuffer(chunk)) {
          fail(new Error("tar entry emitted non-buffer data"));
          return;
        }
        size += chunk.length;
        if (size > 1024 * 1024) {
          fail(new Error("candidate package.json exceeds 1 MiB"));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => {
        if (metadata) {
          try {
            if (seen) throw new Error("duplicate candidate package.json");
            seen = true;
            digest = Schema.decodeUnknownSync(Metadata)(
              JSON.parse(Buffer.concat(chunks).toString("utf8")),
            ).niceevalCandidateInputDigest;
          } catch (cause) {
            fail(cause);
            return;
          }
        }
        next();
      });
    });
    extractor.on("finish", () => {
      if (settled) return;
      settled = true;
      resume(seen ? Effect.succeed(digest) : Effect.fail(new Error("candidate has no package.json")));
    });
    try {
      extractor.end(gunzipSync(bytes));
    } catch (cause) {
      fail(cause);
    }
    return Effect.sync(() => {
      settled = true;
      extractor.destroy();
    });
  });
