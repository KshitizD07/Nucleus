import type { RoomPreset } from "./types.js";
import { engineeringPreset } from "./engineering.js";
import { dialecticPreset } from "./dialectic.js";
import { brainstormPreset } from "./brainstorm.js";

export * from "./types.js";
export { engineeringPreset, dialecticPreset, brainstormPreset };

const PRESETS: Record<string, RoomPreset> = {
  engineering: engineeringPreset,
  dialectic: dialecticPreset,
  debate: dialecticPreset,
  brainstorm: brainstormPreset,
  strategy: brainstormPreset
};

export function getPreset(presetName?: string): RoomPreset {
  if (!presetName) return engineeringPreset;
  const normalized = presetName.toLowerCase().trim();
  return PRESETS[normalized] || engineeringPreset;
}

export function listAvailablePresets(): RoomPreset[] {
  return [engineeringPreset, dialecticPreset, brainstormPreset];
}
