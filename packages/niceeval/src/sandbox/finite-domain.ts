export type FiniteValue<Values extends readonly string[]> = Values[number];

export function isFiniteValue<const Values extends readonly string[]>(values: Values, value: string): value is FiniteValue<Values> {
  return (values as readonly string[]).includes(value);
}

/** SQLite DDL cannot bind CHECK values; this helper only performs SQL escaping. */
export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function sqlIn(values: readonly string[]): string {
  if (values.length === 0) throw new Error("finite-domain SQL set cannot be empty");
  return values.map(sqlLiteral).join(",");
}
