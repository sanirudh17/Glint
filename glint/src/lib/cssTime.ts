export function cssTimeMs(value: string, fallbackMs: number): number {
  const match = value.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(ms|s)$/i);
  if (!match) return fallbackMs;
  const milliseconds = Number(match[1]) * (match[2].toLowerCase() === "s" ? 1000 : 1);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : fallbackMs;
}
