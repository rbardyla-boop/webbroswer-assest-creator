import { EVENT_TYPES, PERMISSIONS } from './dna.mjs';
import { applyEvent } from './projector.mjs';
import { IntentRejected } from './authority.mjs';

function uniqueSourceEvents(ledger, source, target) {
  const targetHashes = new Set(ledger.eventsForBranch(target).map(e => e.event_hash));
  return ledger.eventsForBranch(source).filter(event =>
    !targetHashes.has(event.event_hash) &&
    event.type !== EVENT_TYPES.BRANCH_CREATED &&
    event.type !== EVENT_TYPES.BRANCH_MERGED
  );
}

export function mergeBranch(authority, {
  source,
  target = 'main',
  actor,
  base_hash
}) {
  if (source === target) throw new IntentRejected('BAD_MERGE', 'Source and target branch must differ');
  const ledger = authority.ledger;
  const sourceVerify = ledger.verifyBranch(source);
  const targetVerify = ledger.verifyBranch(target);
  if (!sourceVerify.ok || !targetVerify.ok) throw new IntentRejected('LEDGER_INVALID', 'Cannot merge an invalid ledger branch');
  if (ledger.head(target) !== base_hash) {
    const error = new IntentRejected('STALE_BASE', 'Target branch moved; refresh before merge', { current_head: ledger.head(target) });
    error.currentHead = ledger.head(target);
    throw error;
  }

  const targetState = authority.state(target);
  const permissions = authority.actorPermissions(targetState, actor);
  if (!permissions.has(PERMISSIONS.MERGE)) throw new IntentRejected('FORBIDDEN', 'Actor cannot merge branches');

  const candidates = uniqueSourceEvents(ledger, source, target);
  let preview = structuredClone(targetState);
  let previewIndex = 0;

  for (const sourceEvent of candidates) {
    const proposed = {
      branch: target,
      actor: sourceEvent.actor,
      type: sourceEvent.type,
      payload: structuredClone(sourceEvent.payload || {})
    };
    authority.validate(proposed, preview);
    const virtual = {
      ...sourceEvent,
      branch: target,
      seq: -1,
      event_hash: `PREVIEW-${++previewIndex}`,
      prev_hash: preview.head,
      base_hash: preview.head
    };
    preview = applyEvent(preview, virtual);
  }

  const mergedEvents = [];
  for (const sourceEvent of candidates) {
    const event = ledger.append({
      branch: target,
      actor: sourceEvent.actor,
      type: sourceEvent.type,
      payload: structuredClone(sourceEvent.payload || {}),
      base_hash: ledger.head(target),
      meta: {
        ...(sourceEvent.meta || {}),
        merged_from: source,
        merged_source_hash: sourceEvent.event_hash,
        merged_by: actor
      }
    });
    mergedEvents.push(event);
    authority.onAccepted?.(event, authority.state(target));
  }

  const summary = ledger.append({
    branch: target,
    actor,
    type: EVENT_TYPES.BRANCH_MERGED,
    base_hash: ledger.head(target),
    payload: {
      source_branch: source,
      source_head: ledger.head(source),
      merged_event_count: mergedEvents.length,
      merged_event_hashes: mergedEvents.map(e => e.event_hash)
    }
  });
  authority.onAccepted?.(summary, authority.state(target));

  return { summary, merged_events: mergedEvents, state: authority.state(target) };
}
