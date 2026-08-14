import { Stack, Table, Text } from "niceeval/report";

const marker = "INDIRECT_FIRST";

/** A static import whose closed semantic nodes prove closure hot reload. */
export function configReloadContent(slotCount: number) {
  return Stack({
    children: [
      Text({ value: marker }),
      Table({
        caption: "Selected slots",
        columns: [
          { key: "metric", label: "Metric" },
          { key: "value", label: "Value", align: "end" },
          { key: "unit", label: "Unit" },
        ],
        rows: [{ metric: "Selected slots", value: slotCount, unit: "SLOTS" }],
      }),
      Text({ value: `SLOTS_${slotCount}` }),
    ],
  });
}
