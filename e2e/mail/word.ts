// A word of its own for each run, so a rerun meets none of the last run's rows.
// Lower-case letters only: the AI gateway hides an "x" next to four digits as a
// masked card number, and a base-36 time often holds one; some flows also
// change the case of a name.
export function uniqueWord(): string {
  return Date.now()
    .toString(36)
    .replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
}
