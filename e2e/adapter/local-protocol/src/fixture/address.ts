export const FIXTURE_BASE_URL_ENV = "NICEEVAL_LOCAL_PROTOCOL_BASE_URL";

/** The test injects the dynamically allocated fixture address into each CLI child. */
export function fixtureBaseUrl(): string {
  const value = process.env[FIXTURE_BASE_URL_ENV];
  if (value === undefined || value.length === 0) {
    throw new Error(`${FIXTURE_BASE_URL_ENV} is required by the local-protocol fixture experiment`);
  }
  return value;
}
