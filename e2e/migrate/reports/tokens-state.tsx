import { Col, Text, aggregate, defineComponent, defineReport, tokens } from "niceeval/report";

const TokensState = defineComponent(async (_props: {}, ctx) => {
  const [overall] = await aggregate(ctx.scope, {
    by: {},
    values: { tokens },
  });
  return (
    <Col>
      <Text>{`tokens:${overall.tokens.state}:${overall.tokens.samples}/${overall.tokens.total}`}</Text>
    </Col>
  );
});

export default defineReport({
  title: "Migration and missing tokens state",
  pages: [{
    id: "tokens-state",
    path: "/tokens-state",
    title: "Tokens state",
    render: () => <TokensState />,
  }],
});
