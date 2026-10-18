// Region codes like A1, A2 … A99, B1 …

export function nextRegionCode(existing: Iterable<string>): string {
  const taken = new Set([...existing].map((c) => c.toUpperCase()));
  for (let letter = 0; letter < 26; letter++) {
    for (let n = 1; n <= 99; n++) {
      const code = `${String.fromCharCode(65 + letter)}${n}`;
      if (!taken.has(code)) return code;
    }
  }
  let n = 1;
  while (taken.has(`R${n}`)) n++;
  return `R${n}`;
}

/** Spreads new nodes over a grid where they don't overlap existing ones (fractions of the map). */
export function gridPositions(count: number, occupied: { x: number; y: number }[], minGap = 0.04): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const cols = Math.max(4, Math.ceil(Math.sqrt(count + occupied.length) * 1.4));
  const step = 0.9 / cols;
  const all = [...occupied];
  for (let i = 0; out.length < count && i < 10000; i++) {
    const x = 0.05 + (i % cols) * step + step / 2;
    const y = 0.05 + Math.floor(i / cols) * step + step / 2;
    if (y > 0.98) break;
    if (all.some((p) => Math.hypot(p.x - x, p.y - y) < minGap)) continue;
    out.push({ x, y });
    all.push({ x, y });
  }
  while (out.length < count) out.push({ x: 0.5, y: 0.5 });
  return out;
}
