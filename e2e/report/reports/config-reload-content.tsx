import { Table, Text } from "niceeval/report";

const marker = "INDIRECT_FIRST";

/** A static import whose closed elements prove closure hot reload. */
export function configReloadContent(slotCount: number) {
  return (
    <>
      <Text>{marker}</Text>
      <Table
        rows={[{ key: "slots", metric: "Selected slots", value: slotCount, unit: "SLOTS" }]}
        columns={["metric", { field: "value", label: "Value" }, "unit"]}
      />
      <Text>{`SLOTS_${slotCount}`}</Text>
    </>
  );
}
