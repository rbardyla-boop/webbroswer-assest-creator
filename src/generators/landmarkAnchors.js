// Landmark anchor helpers (Stage 18B). The connective generators link generated
// clusters by referencing their world anchor points. A generator instance's anchor
// is its config.origin (the center every cluster generator places around). These
// helpers read ONLY the WorldDocument's generators block — pure data, no scene
// access — so resolving an anchor is deterministic and side-effect-free.

// Resolve a generator instance id to its {x,z} world anchor point, or null if the
// instance is unknown or has no origin (e.g. a connector instance has from/to, not
// an origin, so it is never itself a connectable anchor).
export function resolveAnchorPoint(document, instanceId) {
  if (!instanceId) return null;
  const inst = (document?.generators?.instances ?? []).find((i) => i && i.id === instanceId);
  const o = inst?.config?.origin;
  if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.z)) return null;
  return { x: o.x, z: o.z };
}

// List the generator instances that can serve as connector anchors (those with an
// origin), optionally excluding one id (the connector instance itself).
export function listAnchorInstances(document, excludeId = null) {
  return (document?.generators?.instances ?? [])
    .filter((i) => i && i.id && i.id !== excludeId && i.config?.origin && Number.isFinite(i.config.origin.x))
    .map((i) => ({ id: i.id, label: `${i.type} (${i.id})` }));
}
