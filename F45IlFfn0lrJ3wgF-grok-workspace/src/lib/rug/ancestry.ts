import type { Entity } from "./types.ts";

/** Clone from a clone past this depth, without reread, is forbidden. */
export const MAX_DERIVATION = 2;

export type Ancestry = {
  parentId: string;
  sourceIds: string[];
  evidenceHashes: string[];
  depth: number;
  claims: string[];
  lost: string[];
  mutated: string[];
  reread: boolean;
  layer: "evidence" | "knowledge" | "interpretation";
  critical: boolean;
  canon: boolean;
  disputed: string;
};

export type TreeNode = { entity: Entity; children: TreeNode[] };

export const CLAIM_LABELS: Record<string, string> = {
  passwords_12_or_passkey: "12 characters OR a passkey",
  passkeys_preferred: "Passkeys preferred on new devices",
  lockout_5: "Lock after 5 failed attempts",
  session_12h: "Sessions expire after 12 hours",
  mfa_admin: "Admin accounts require MFA",
  reset_email_only: "Password reset is email-only",
  no_sms: "SMS codes are not allowed",
  rotate_90d: "Service accounts rotate every 90 days",
  phone_first: "Login must work on a phone",
  emergency_breakglass: "Break-glass login for on-call",
  after_review: "Deploy after security review",
  emergency_rollback: "Emergency rollback without review",
  complex_chars: "Passwords require complex characters",
  chars_8: "Passwords must be 8 characters",
  all_changes: "Every production change needs approval",
  no_change_without_approval: "Production cannot change without approval",
};

export const PRIMARY_FACTS = [
  "passwords_12_or_passkey",
  "passkeys_preferred",
  "lockout_5",
  "session_12h",
  "mfa_admin",
  "reset_email_only",
  "no_sms",
  "rotate_90d",
  "phone_first",
  "emergency_breakglass",
] as const;

export function labelClaim(id: string): string {
  return CLAIM_LABELS[id] ?? id.replaceAll("_", " ");
}

export function asStrs(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

export function ancestryOf(e: Entity | undefined): Ancestry {
  const f = e?.fields ?? {};
  const layer = f.layer === "evidence" || f.layer === "interpretation" ? f.layer : "knowledge";
  return {
    parentId: typeof f.parentId === "string" ? f.parentId : "",
    sourceIds: asStrs(f.sourceIds),
    evidenceHashes: asStrs(f.evidenceHashes),
    depth: typeof f.depth === "number" ? f.depth : 0,
    claims: asStrs(f.claims),
    lost: asStrs(f.lost),
    mutated: asStrs(f.mutated),
    reread: f.reread === true || f.reread === "true",
    layer,
    critical: f.critical === true || f.critical === "true",
    canon: f.canon === true || f.canon === "true" || e?.status === "canon",
    disputed: typeof f.disputed === "string" ? f.disputed : "",
  };
}

export function diffClaims(parent: string[], child: string[]): { lost: string[]; mutated: string[] } {
  const lost = parent.filter((c) => !child.includes(c));
  const mutated = child.filter((c) => !parent.includes(c));
  return { lost, mutated };
}

export function lineage(entities: Entity[], id: string): Entity[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const out: Entity[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    const p = ancestryOf(cur).parentId;
    cur = p ? byId.get(p) : undefined;
  }
  return out.reverse();
}

export function primaryOf(entities: Entity[], id: string): Entity | undefined {
  const chain = lineage(entities, id);
  return chain.find((e) => e.kind === "artifact") ?? chain[0];
}

export function needsReread(e: Entity): boolean {
  const a = ancestryOf(e);
  return a.depth > MAX_DERIVATION && !a.reread;
}

export function forest(entities: Entity[], rootId?: string): TreeNode[] {
  const pool = entities.filter(
    (e) => e.kind === "artifact" || e.kind === "knowledge" || e.kind === "interpretation",
  );
  const kids = new Map<string, Entity[]>();
  for (const e of pool) {
    const p = ancestryOf(e).parentId;
    if (!p) continue;
    const list = kids.get(p) ?? [];
    list.push(e);
    kids.set(p, list);
  }
  const walk = (e: Entity): TreeNode => ({
    entity: e,
    children: (kids.get(e.id) ?? []).map(walk),
  });
  if (rootId) {
    const root = pool.find((e) => e.id === rootId);
    return root ? [walk(root)] : [];
  }
  const ids = new Set(pool.map((e) => e.id));
  return pool.filter((e) => {
    const p = ancestryOf(e).parentId;
    return !p || !ids.has(p);
  }).map(walk);
}
