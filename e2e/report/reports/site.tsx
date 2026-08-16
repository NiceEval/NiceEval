// The representative Report fixture for the final v0.12 contract. It uses only
// the documented public author surface: standard React JSX (react/jsx-runtime),
// defineReport with ordinary and parameterized Pages, both defineComponent
// forms, aggregate() with complete MetricValues, and closed DomainViews. The
// tests seal two runs: `main` (four logical
// slots, including failures that make passRate partial) and `source` (captured
// Source evidence); the Diff page also proves honest `not-recorded` handling.
import {
  Grid,
  Link,
  Section,
  ExperimentScatter,
  SampleSummary,
  Stat,
  Tab,
  Table,
  Tabs,
  Text,
  aggregate,
  defineComponent,
  defineReport,
  durationMs,
  experiment,
  passRate,
  toFileChanges,
  toSources,
  type FileChangesDomainView,
  type Page,
  type PageParams,
  type Sample,
  type SourcesDomainView,
} from "niceeval/report";
import {
  standardAttemptPage,
  standardExperimentPage,
} from "niceeval/report/built-in";
import { siteCopyBlock } from "./site-copy-block.tsx";

const fixtureChartPoints = [
  { model: "North", score: 72 },
  { model: "South", score: 91 },
] as const;

type SlotParams = Readonly<{ readonly slotId: string }>;

/** One codec owns the direct detail route and every static Page enumeration. */
const slotParams: PageParams<SlotParams> = {
  encode: ({ slotId }): string => slotId,
  decode: (key: string): SlotParams => Object.freeze({ slotId: key }),
  enumerate: (sample: Sample): readonly SlotParams[] => {
    if (process.env.NICEEVAL_E2E_FAIL_UNRELATED_ENUMERATE === "1") {
      throw new Error("show must not enumerate an unrelated parameter Page");
    }
    return sample.snapshot.slots.map((slot) => Object.freeze({ slotId: slot.slotId }));
  },
};

/** Compose form: reads the Sample through ctx.scope and closes aggregate rows. */
const FixtureMetricRows = defineComponent(async (_props: {}, ctx) => {
  const rows = await aggregate(ctx.scope, {
    by: { experiment },
    values: { passRate, durationMs },
  });
  return (
    <Table
      rows={rows}
      columns={[
        "experiment",
        { field: "passRate", label: "Pass rate" },
        { field: "durationMs", label: "Duration" },
      ]}
    />
  );
});

/** Compose form: a complete MetricValue with its partial state rendered. */
const FixturePassRateState = defineComponent(async (_props: {}, ctx) => {
  const [overall] = await aggregate(ctx.scope, { by: {}, values: { passRate } });
  const metric = overall.passRate;
  return (
    <Text>
      {`Fixture pass rate is ${metric.state} (${metric.samples}/${metric.total})`}
    </Text>
  );
});

/** Dual-face form: one closed resolve, consumed synchronously by text/web. */
const FixtureSlotCount = defineComponent<
  { readonly label: string },
  { readonly label: string; readonly count: number }
>({
  resolve: (props, ctx) => {
    const count = ctx.scope.snapshot.slots.length;
    return Object.freeze({ label: props.label, count });
  },
  text: (data) => `${data.label}: ${data.count}`,
  web: (data) => <Stat label={data.label} value={data.count} />,
});

const slotDetailPage: Page<SlotParams, Sample["snapshot"]["slots"][number]> = {
  id: "slot",
  path: "/slot",
  title: "Slot fixture",
  navigation: false,
  params: slotParams,
  load: (sample, params) => {
    const slot = sample.snapshot.slots.find((candidate) => candidate.slotId === params.slotId);
    if (slot === undefined) {
      throw new Error(`Slot ${params.slotId} is not a member of this Sample`);
    }
    return slot;
  },
  render: (slot) => (
    <Section title={`Slot fixture detail ${slot.slotId}`}>
      <Link target={{ page: "source" }}>Source from slot detail</Link>
      <Table
        rows={[{ key: slot.slotId, slotId: slot.slotId, runId: slot.runId, state: slot.state }]}
        columns={[{ field: "slotId", label: "Slot" }, { field: "runId", label: "Run" }, "state"]}
      />
    </Section>
  ),
};

const sourcePage: Page<void, SourcesDomainView> = {
  id: "source",
  path: "/source",
  title: "Source fixture",
  load: (sample) => toSources(sample),
  render: (view) => (
    <Section title="Source fixture detail">
      <Link target={{ page: "diff" }}>Diff from source detail</Link>
      {view.entries.flatMap((entry) =>
        entry.state === "available"
          ? entry.detail.items.map((item) => (
            <Text key={item.sourceItemId}>
              {`${item.path}${item.content.state === "available" ? `\n${item.content.text}` : ""}`}
            </Text>
          ))
          : [<Text key={entry.attempt.locator}>{`Sources are ${entry.state}.`}</Text>],
      )}
    </Section>
  ),
};

const diffPage: Page<void, FileChangesDomainView> = {
  id: "diff",
  path: "/diff",
  title: "Diff fixture",
  load: (sample) => toFileChanges(sample),
  render: (view) => (
    <Section title="Diff fixture detail">
      <Text>{`File change paths: ${view.entries.length === 0 ? "none" : view.entries.flatMap((entry) => entry.state === "available" ? entry.detail.paths.map((path) => path.path) : []).join(", ") || "none"}`}</Text>
      {view.entries.map((entry) => (
        <Text key={entry.attempt.locator}>{`Diff entries: ${entry.state}`}</Text>
      ))}
    </Section>
  ),
};

export default defineReport({
  title: "Report fixture",
  pages: [
    {
      id: "overview",
      path: "/",
      title: "Report fixture",
      render: (sample: Sample) => (
        <Grid>
          <Section title="Fixture overview">
            <Text>{"Report fixture static site"}</Text>
            <SampleSummary />
            <ExperimentScatter />
            <FixtureSlotCount label="Selected slots" />
            <FixturePassRateState />
            <FixtureMetricRows />
          </Section>
          <Section title="Fixture model scores">
            <Table rows={fixtureChartPoints} columns={["model", "score"]} />
          </Section>
          {siteCopyBlock()}
          <Tabs>
            <Tab title="Fixture overview">
              <Text>{"Fixture overview tab content"}</Text>
            </Tab>
            <Tab title="Fixture details">
              <Text>{"Fixture details tab content"}</Text>
            </Tab>
          </Tabs>
          <Section title="Fixture details">
            <Text>{"Fixture detail links"}</Text>
            <Link target={{ page: "source" }}>Source detail</Link>
            <Link target={{ page: "diff" }}>Diff detail</Link>
            {sample.snapshot.slots.map((slot) => (
              <Link key={slot.slotId} target={{ page: "slot", params: { slotId: slot.slotId } }}>
                {`Slot detail ${slot.slotId}`}
              </Link>
            ))}
          </Section>
        </Grid>
      ),
    },
    sourcePage,
    diffPage,
    slotDetailPage,
    standardAttemptPage,
    standardExperimentPage,
  ],
});
