/** int8 quantisation with one scale per vector: 1 byte a dimension instead of 4. */
export interface QuantisedVector {
  values: Int8Array;
  /** original ≈ values * scale */
  scale: number;
}

export function quantise(v: Float32Array): QuantisedVector {
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  const scale = max / 127;
  const values = new Int8Array(v.length);
  if (scale > 0) for (let i = 0; i < v.length; i++) values[i] = Math.round((v[i] ?? 0) / scale);
  return { values, scale };
}

export function dequantise(q: QuantisedVector): Float32Array {
  const out = new Float32Array(q.values.length);
  for (let i = 0; i < out.length; i++) out[i] = (q.values[i] ?? 0) * q.scale;
  return out;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
