/** BIOS versions come in many shapes ("1.30", "F15", "7D75v1.A0", "3003"): compare token by token, numbers numerically. */
function tokens(version: string): string[] {
  return (
    version
      .trim()
      .toLowerCase()
      .match(/\d+|[a-z]+/g) ?? []
  );
}

/** Negative when `a` is older than `b`, positive when newer, 0 when equal. Digits sort before letters. */
export function compareVersions(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  const n = Math.max(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d/.test(x);
    const yNum = /^\d/.test(y);
    if (xNum && yNum) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
