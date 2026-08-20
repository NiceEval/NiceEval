import type { SourceNavigationDomainView } from "niceeval/analysis";
import { Text, defineReport, toSourceNavigation } from "niceeval/report";

export default defineReport({
  title: "Migration source navigation",
  pages: [{
    id: "source-navigation",
    path: "/source-navigation",
    title: "Source navigation migration state",
    load: (sample) => toSourceNavigation(sample),
    render: (view: SourceNavigationDomainView) => (
      <Text>{`source-navigation:${view.entries.map((entry) => entry.state).join(",")}`}</Text>
    ),
  }],
});
