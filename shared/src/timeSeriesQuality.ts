export type ConsecutiveSuspectOptions = {
  suspectValues?: ReadonlyArray<number | null>;
  consecutiveCount?: number;
};

export function invalidateConsecutiveSuspectValues(
  values: ReadonlyArray<number | null | undefined>,
  options: ConsecutiveSuspectOptions = {},
): Array<number | null> {
  const suspectValues = options.suspectValues ?? [0, 1000, 2000, 3000, 4000, 5000, null];
  const consecutiveCount = Math.max(2, Math.floor(options.consecutiveCount ?? 2));
  const suspect = values.map((value) => suspectValues.some((candidate) => candidate === (value ?? null)));
  const output = values.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null));

  let runStart = -1;
  for (let index = 0; index <= suspect.length; index += 1) {
    if (index < suspect.length && suspect[index]) {
      if (runStart === -1) runStart = index;
      continue;
    }

    if (runStart !== -1 && index - runStart >= consecutiveCount) {
      for (let runIndex = runStart; runIndex < index; runIndex += 1) {
        output[runIndex] = null;
      }
    }
    runStart = -1;
  }

  return output;
}
