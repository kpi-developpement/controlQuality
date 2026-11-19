import React, { useEffect, useRef, useState } from "react";

/**
 * Affiche une valeur avec un effet de compteur quand elle contient un nombre.
 * "82.5 %" → anime de l'ancienne valeur vers 82.5 en conservant le format (décimales, suffixe).
 * Les valeurs non numériques ("—", JSX…) sont affichées telles quelles.
 */
const NUM_RE = /^(\D*?)(-?\d[\d\s]*(?:[.,]\d+)?)(.*)$/s;

function parse(value) {
  if (typeof value === "number") return { prefix: "", num: value, decimals: Number.isInteger(value) ? 0 : 1, sep: ".", suffix: "" };
  if (typeof value !== "string") return null;
  const m = value.match(NUM_RE);
  if (!m) return null;
  const raw = m[2].replace(/\s/g, "");
  const sep = raw.includes(",") ? "," : ".";
  const num = Number(raw.replace(",", "."));
  if (!Number.isFinite(num)) return null;
  const dec = raw.split(/[.,]/)[1];
  return { prefix: m[1], num, decimals: dec ? dec.length : 0, sep, suffix: m[3] };
}

function format(p, n) {
  const s = n.toFixed(p.decimals);
  return p.prefix + (p.sep === "," ? s.replace(".", ",") : s) + p.suffix;
}

export default function AnimatedValue({ value, duration = 900 }) {
  const parsed = parse(value);
  const [display, setDisplay] = useState(() => (parsed ? format(parsed, 0) : value));
  const fromRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const p = parse(value);
    if (!p) { setDisplay(value); return undefined; }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    const to = p.num;
    if (reduce || from === to) { setDisplay(format(p, to)); fromRef.current = to; return undefined; }
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 4);
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(format(p, from + (to - from) * ease(t)));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); fromRef.current = to; };
  }, [value, duration]);

  return <>{display}</>;
}
