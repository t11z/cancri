// Sparkline projection — 148×32 viewport, 4px pad, normalised to series min/max.
// Ported verbatim from the handover reference build.

export interface SparkGeometry {
  pts: string;
  area: string;
  hx: number;
  hy: number;
}

const W = 148;
const H = 32;
const P = 4;

export function spark(series: readonly number[]): SparkGeometry {
  const n = series.length;
  if (n === 0) return { pts: "", area: "", hx: P, hy: H - P };

  let mn = Math.min(...series);
  let mx = Math.max(...series);
  if (mx - mn < 1e-9) mx = mn + 1;

  const X = (i: number): number => (n > 1 ? P + (i * (W - 2 * P)) / (n - 1) : P);
  const Y = (v: number): number => H - P - ((v - mn) / (mx - mn)) * (H - 2 * P);

  let pts = "";
  for (let i = 0; i < n; i++) {
    pts += X(i).toFixed(1) + "," + Y(series[i] as number).toFixed(1) + " ";
  }
  const area = P + "," + (H - P) + " " + pts + (W - P) + "," + (H - P);
  return {
    pts: pts.trim(),
    area: area.trim(),
    hx: X(n - 1),
    hy: Y(series[n - 1] as number),
  };
}

/** Seed a gently-wandering series so a freshly-mounted sparkline looks alive. */
export function seedSeries(previousClose: number, current: number, n: number): number[] {
  const out: number[] = [];
  let v = previousClose * (1 + (Math.random() - 0.5) * 0.01);
  for (let i = 0; i < n; i++) {
    v = v * (1 + (Math.random() - 0.5) * 0.004);
    out.push(v);
  }
  out[n - 1] = current;
  return out;
}
