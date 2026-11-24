import type { TaskItem } from "@nucleus/protocol";

export interface PresetContractFile {
  relativePath: string;
  initialContent: string;
}

export interface RoomPreset {
  id: string;
  name: string;
  description: string;
  defaultLanes: string[];
  bannerTitle: string;
  contracts: PresetContractFile[];
  initialTasks: (topic?: string) => TaskItem[];
  peersTemplate?: string;
  sampleInviteGuidance?: (inviteCommand: (lane: string, hostUrl?: string) => string, hostUrl?: string) => string[];
}
