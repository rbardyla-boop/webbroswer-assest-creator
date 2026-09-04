const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function nid(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36).slice(-4);
  return `${prefix}_${rand}${t}`;
}

export function makeWorldCode(): string {
  let s = "";
  for (let i = 0; i < 6; i += 1) s += ALPHA[Math.floor(Math.random() * ALPHA.length)]!;
  return s;
}

export function hueFor(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i += 1) h = (h * 33 + userId.charCodeAt(i)) >>> 0;
  return h % 6;
}

export const DEMO_CODE = "RUG001";
export const GENESIS_HASH = "0";
export const PROTOCOL = 1;
