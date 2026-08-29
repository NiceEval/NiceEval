import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { QUERY_PROTOCOL, type InspectionOperation, type InspectionRequest } from "niceeval/inspection";
import { withTempDir } from "./temp.js";

/**
 * Creates one complete public Inspection request for the duration of a caller-owned command.
 *
 * Testkit owns only the temporary request file. The E2E body retains the candidate's
 * `niceeval query run --request` argv, process options, and product assertions.
 */
export async function withInspectionRequest<T>(
  operation: InspectionOperation,
  body: (requestPath: string) => Promise<T>,
): Promise<T> {
  return await withTempDir("niceeval-query-", async (directory) => {
    const requestPath = join(directory, "request.json");
    const request = { protocol: QUERY_PROTOCOL, operation } satisfies InspectionRequest;
    await writeFile(requestPath, `${JSON.stringify(request)}\n`, "utf8");
    return await body(requestPath);
  });
}
