// Stands in for the generated JSON beside it when type-checking, so the
// compiler does not parse and infer a type for megabytes of fixture data.
// fixtures.ts asserts the real shape; bundlers still load the JSON itself.
declare const fixture: unknown;
export default fixture;
