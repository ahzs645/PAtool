export function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function nowUtcInput(): string {
  const date = new Date();
  date.setUTCMinutes(0, 0, 0);
  date.setUTCHours(date.getUTCHours() - 3);
  return date.toISOString().slice(0, 16);
}

function inputToDate(value: string): Date {
  return new Date(`${value}:00Z`);
}

export function shiftUtcInput(value: string, hours: number): string {
  const date = inputToDate(value);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString().slice(0, 16);
}

export function utcParts(value: string) {
  const date = inputToDate(value);
  return {
    yyyy: date.getUTCFullYear().toString(),
    mm: pad2(date.getUTCMonth() + 1),
    dd: pad2(date.getUTCDate()),
    hh: pad2(date.getUTCHours()),
  };
}

export function timestampLabel(value: string): string {
  const { yyyy, mm, dd, hh } = utcParts(value);
  return `${yyyy}-${mm}-${dd} ${hh}:00Z`;
}
