// Sanitizer for placed-object interaction metadata. Invalid input is repaired or
// dropped, never fatal. Pure and Node-safe.
//
// SECURITY / NO-CODE GUARANTEE: each role builds ONLY the allowlisted fields
// from the input. Unknown keys (e.g. `script`, `code`, `onEnter`, `fn`) are never
// read, copied, or stored — so a hostile world/mod cannot smuggle executable
// data through an interaction. Events are equality-matched strings, not code.

import {
  TRIGGER_SHAPES,
  DEFAULT_RADIUS,
  MIN_RADIUS,
  MAX_RADIUS,
  DEFAULT_DURATION,
  MIN_DURATION,
  MAX_DURATION,
  boolOr,
  clamp,
  sanitizeChannel,
  sanitizeEventList,
  sanitizeToken,
  sanitizeVec3,
  sanitizeText,
  MAX_NAME_LEN,
} from "./InteractionTypes.js";

/**
 * Sanitize a placed-object interaction. Returns the role-specific object, or
 * null when there is no (valid) interaction — callers must tolerate null.
 */
export function sanitizeInteraction(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  switch (input.role) {
    case "trigger":
      return sanitizeTrigger(input);
    case "door":
      return sanitizeDoor(input);
    case "sign":
      return sanitizeSign(input);
    case "pickup":
      return sanitizePickup(input);
    case "spawn":
      return sanitizeSpawn(input);
    default:
      return null; // "none"/unknown → no interaction
  }
}

function sanitizeTrigger(input) {
  const trigger = {
    role: "trigger",
    channel: sanitizeChannel(input.channel),
    shape: TRIGGER_SHAPES.includes(input.shape) ? input.shape : "sphere",
    radius: clamp(input.radius, MIN_RADIUS, MAX_RADIUS, DEFAULT_RADIUS),
    emitOnEnter: sanitizeEventList(input.emitOnEnter),
    emitOnExit: sanitizeEventList(input.emitOnExit),
    once: boolOr(input.once, false),
  };
  // Optional: a trigger may teleport the player to a named spawn on enter.
  const teleportTo = sanitizeToken(input.teleportTo, MAX_NAME_LEN);
  if (teleportTo) trigger.teleportTo = teleportTo;
  return trigger;
}

function sanitizeDoor(input) {
  return {
    role: "door",
    channel: sanitizeChannel(input.channel),
    listenOpen: sanitizeEventList(input.listenOpen),
    listenClose: sanitizeEventList(input.listenClose),
    move: sanitizeVec3(input.move),
    rotate: sanitizeVec3(input.rotate),
    duration: clamp(input.duration, MIN_DURATION, MAX_DURATION, DEFAULT_DURATION),
    startOpen: boolOr(input.startOpen, false),
  };
}

function sanitizeSign(input) {
  return {
    role: "sign",
    text: sanitizeText(input.text),
    showRadius: clamp(input.showRadius, MIN_RADIUS, MAX_RADIUS, DEFAULT_RADIUS),
  };
}

function sanitizePickup(input) {
  return {
    role: "pickup",
    channel: sanitizeChannel(input.channel),
    emitOnCollect: sanitizeEventList(input.emitOnCollect),
    radius: clamp(input.radius, MIN_RADIUS, MAX_RADIUS, DEFAULT_RADIUS),
    respawn: boolOr(input.respawn, false),
  };
}

function sanitizeSpawn(input) {
  return {
    role: "spawn",
    name: sanitizeToken(input.name, MAX_NAME_LEN) ?? "spawn",
  };
}
