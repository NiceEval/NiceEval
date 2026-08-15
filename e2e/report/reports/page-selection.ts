import { Either } from "effect";
import {
  definePage,
  definePageFamily,
  defineReport,
  reportComponentId,
  reportDocument,
  reportId,
  reportInstanceKey,
  reportRoute,
  type ReportDocument,
} from "niceeval/report";

export default defineReport({
  id: Either.getOrThrow(reportId("page-selection")),
  pages: [
    definePage({
      id: Either.getOrThrow(reportComponentId("root")),
      route: Either.getOrThrow(reportRoute("/")),
      render: () => emptyDocument("Page selection root"),
    }),
    repeatedFamily("attempt"),
    repeatedFamily("experiment"),
  ],
});

function repeatedFamily(id: "attempt" | "experiment") {
  return definePageFamily({
    id: Either.getOrThrow(reportComponentId(id)),
    instances: () => ["first", "second"],
    key: (instance) => Either.getOrThrow(reportInstanceKey(`${id}-${instance}`)),
    route: (instance) => Either.getOrThrow(reportRoute(`/${id}/${instance}`)),
    render: ({ instance }) => emptyDocument(`${id} ${instance} exact route`),
  });
}

function emptyDocument(title: string): ReportDocument {
  return reportDocument({ title, children: [] });
}
