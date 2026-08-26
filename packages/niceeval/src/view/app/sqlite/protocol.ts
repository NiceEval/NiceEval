import type { ViewQueryInput, ViewQueryName, ViewQueryOutput } from "../../query.ts";

type NamedQueryRequest = {
  readonly [Name in ViewQueryName]: {
    readonly id: number;
    readonly kind: "query";
    readonly name: Name;
    readonly input: ViewQueryInput<Name>;
  };
}[ViewQueryName];

export type WorkerRequest =
  | { readonly id: number; readonly kind: "open"; readonly bytes: ArrayBuffer }
  | NamedQueryRequest;

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly kind: "ready" }
  | { readonly id: number; readonly ok: true; readonly kind: "result"; readonly name: ViewQueryName; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

export function queryRequest<Name extends ViewQueryName>(
  id: number,
  name: Name,
  input: ViewQueryInput<Name>,
): WorkerRequest {
  return { id, kind: "query", name, input } as NamedQueryRequest;
}

export function queryResult<Name extends ViewQueryName>(name: Name, response: WorkerResponse): ViewQueryOutput<Name> {
  if (!response.ok) throw new Error(response.error);
  if (response.kind !== "result") throw new Error("SQLite Worker returned no query result.");
  if (response.name !== name) throw new Error(`SQLite Worker returned ${response.name} for ${name}.`);
  return response.result as ViewQueryOutput<Name>;
}
