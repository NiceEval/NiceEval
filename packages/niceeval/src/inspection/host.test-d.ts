import { expectTypeOf } from "vitest";
import { withInspectionQuery } from "./host.ts";
import type { InspectionQuery, InspectionSuccessDocumentFor } from "./public.ts";

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
export function inspectionHostTypes(cwd: string) {
  expectTypeOf(withInspectionQuery({ cwd }, () => 1 as const)).toEqualTypeOf<Promise<1>>();
  expectTypeOf(
    withInspectionQuery({ cwd, recordPath: "external.sqlite" }, (query) => {
      expectTypeOf(query).toEqualTypeOf<InspectionQuery>();
      // @ts-expect-error A locator belongs to the selected operation's request.
      void query.inspect<"run.list">({ kind: "run.list", locator: "@123" });
      return query.inspect<"run.list">({ kind: "run.list" });
    }),
  ).toEqualTypeOf<Promise<InspectionSuccessDocumentFor<"run.list">>>();
}
