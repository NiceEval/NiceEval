import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Result } from "effect";
import { decodeInspectionRequest, QUERY_PROTOCOL } from "niceeval/inspection";
import { withTempDir } from "./temp.js";

/**
 * Creates one complete public Inspection request for the duration of a caller-owned command.
 *
 * Testkit owns only the temporary request file. The E2E body retains the candidate's
 * `niceeval query run --request` argv, process options, and product assertions.
 */
export async function withInspectionRequest<T>(
  operation: unknown,
  body: (requestPath: string) => Promise<T>,
): Promise<T> {
  return await withTempDir("niceeval-query-", async (directory) => {
    const requestPath = join(directory, "request.json");
    const decoded = decodeInspectionRequest({ protocol: QUERY_PROTOCOL, operation });
    if (Result.isFailure(decoded)) {
      throw new Error(`withInspectionRequest(): invalid niceeval.query/v1 request: ${decoded.failure.reason}`);
    }
    const request = decoded.success;
    await writeFile(requestPath, `${JSON.stringify(request)}\n`, "utf8");
    return await body(requestPath);
  });
}
