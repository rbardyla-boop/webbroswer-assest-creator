import { createHash } from "node:crypto";

export function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(",")}}`;
}

export function hashEntry(input: {
  seq: number;
  prevHash: string;
  eventType: string;
  actorId: string;
  target: string;
  payload: unknown;
}): string {
  const material = [
    String(input.seq),
    input.prevHash,
    input.eventType,
    input.actorId,
    input.target,
    stable(input.payload ?? {}),
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

export function shortHash(hash: string): string {
  if (!hash || hash === "0") return "0";
  return hash.slice(0, 8).toUpperCase();
}
