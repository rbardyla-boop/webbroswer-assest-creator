export function shortHash(hash: string): string {
  if (!hash || hash === "0") return "0";
  return hash.slice(0, 8).toUpperCase();
}

export const HEALTH_LABELS = [
  ["integrity", "Integrity"],
  ["coherence", "Coherence"],
  ["trust", "Trust"],
  ["energy", "Energy"],
  ["time", "Time"],
  ["resources", "Resources"],
  ["security", "Security"],
  ["knowledge", "Knowledge"],
  ["mission", "Mission"],
] as const;

export function healthTone(n: number): "ok" | "warn" | "bad" {
  if (n >= 55) return "ok";
  if (n >= 30) return "warn";
  return "bad";
}
