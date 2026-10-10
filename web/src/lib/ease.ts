const FALLBACK: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** The shared entrance easing, read from the `--ease-enter` token in index.css (the only definition). */
function readEnter(): [number, number, number, number] {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--ease-enter");
    const m = v.match(/cubic-bezier\(([^)]+)\)/);
    const n = m ? m[1].split(",").map(Number) : [];
    if (n.length === 4 && n.every(Number.isFinite)) return n as [number, number, number, number];
  } catch {
    /* no DOM yet: use the token's value */
  }
  return FALLBACK;
}

export const EASE_ENTER = readEnter();
