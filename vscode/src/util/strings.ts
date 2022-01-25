export function pad(s: string, before: number = 0, after: number = 0, padding: string = "\u00a0") {
  if (before === 0 && after === 0) return s;

  return `${before === 0 ? "" : padding.repeat(before)}${s}${
    after === 0 ? "" : padding.repeat(after)
  }`;
}
