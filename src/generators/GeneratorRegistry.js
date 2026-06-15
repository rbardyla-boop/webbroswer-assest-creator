// Generator registry (Stage 18). Maps each generator type to everything the host
// needs to drive it: how to create/normalize a config, how to generate a layout,
// how to emit objects, and how the editor panel should present it (style options,
// the generic "amount" dial, and which prefab source slots apply). The
// ProceduralPanel is data-driven off this table, so adding a generator is a single
// entry plus its layout/emitter module — no panel surgery.
//
// Config-creation dispatch lives in GeneratorConfig (so the WorldDocument validator
// can normalize instances without importing THREE-touching emitters); this registry
// re-exposes those creators alongside the layout/emit functions for the editor.

import {
  createCityConfig,
  createCampConfig,
  createRuinConfig,
  createForestConfig,
  CITY_STYLES,
  CAMP_STYLES,
  RUIN_STYLES,
  FOREST_STYLES,
  GENERATOR_LIMITS,
} from "./GeneratorConfig.js";
import { generateCityLayout } from "./CityLayout.js";
import { cityLayoutToWorldObjects } from "./cityEmitter.js";
import { generateCampLayout, campLayoutToWorldObjects } from "./CampGenerator.js";
import { generateRuinLayout, ruinLayoutToWorldObjects } from "./RuinGenerator.js";
import { generateForestLayout, forestLayoutToWorldObjects } from "./ForestGenerator.js";

const SIZE_DIAL = { field: "size", label: "Size", min: GENERATOR_LIMITS.MIN_SIZE, max: GENERATOR_LIMITS.MAX_SIZE, step: 1, default: 4 };

export const GENERATORS = Object.freeze({
  city: {
    type: "city",
    label: "City",
    styles: CITY_STYLES,
    amount: { field: "blocks", label: "Blocks", min: GENERATOR_LIMITS.MIN_BLOCKS, max: GENERATOR_LIMITS.MAX_BLOCKS, step: 1, default: 4 },
    sources: [
      { key: "buildingPrefab", label: "Buildings" },
      { key: "propPrefab", label: "Props" },
    ],
    createConfig: createCityConfig,
    layout: generateCityLayout,
    emit: cityLayoutToWorldObjects,
  },
  camp: {
    type: "camp",
    label: "Camp / Outpost",
    styles: CAMP_STYLES,
    amount: SIZE_DIAL,
    sources: [
      { key: "buildingPrefab", label: "Tents" },
      { key: "propPrefab", label: "Crates" },
    ],
    createConfig: createCampConfig,
    layout: generateCampLayout,
    emit: campLayoutToWorldObjects,
  },
  ruin: {
    type: "ruin",
    label: "Ruin Cluster",
    styles: RUIN_STYLES,
    amount: SIZE_DIAL,
    sources: [{ key: "propPrefab", label: "Columns" }],
    createConfig: createRuinConfig,
    layout: generateRuinLayout,
    emit: ruinLayoutToWorldObjects,
  },
  forest: {
    type: "forest",
    label: "Forest Grove",
    styles: FOREST_STYLES,
    amount: SIZE_DIAL,
    sources: [{ key: "propPrefab", label: "Trees" }],
    createConfig: createForestConfig,
    layout: generateForestLayout,
    emit: forestLayoutToWorldObjects,
  },
});

export const GENERATOR_LIST = Object.freeze(Object.values(GENERATORS));

export function getGenerator(type) {
  // Own-property check (not truthy) so a prototype key like "constructor" can never
  // resolve to a non-generator value; unknown/hostile types fall back to city.
  return Object.hasOwn(GENERATORS, type) ? GENERATORS[type] : GENERATORS.city;
}

/**
 * One-call generate for a type: layout(config) → emit(layout, id, resolvedSources).
 * `resolvedSources` carries already-resolved prefab definitions keyed by source key
 * ({ buildingPrefab, propPrefab }); each emitter reads only the keys it uses.
 * Returns { layout, objects } so callers can report layout counts.
 */
export function generateGeneratorObjects(type, config, generatorId, resolvedSources = {}) {
  const g = getGenerator(type);
  const layout = g.layout(config);
  const objects = g.emit(layout, generatorId, resolvedSources);
  return { layout, objects };
}
