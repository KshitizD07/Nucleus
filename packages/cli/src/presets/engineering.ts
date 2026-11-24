import type { RoomPreset } from "./types.js";
import type { TaskItem } from "@nucleus/protocol";

export const engineeringPreset: RoomPreset = {
  id: "engineering",
  name: "Software Engineering Monorepo",
  description: "Multi-tier full-stack development across frontend, backend, database, and QA lanes.",
  defaultLanes: ["frontend", "backend", "qa"],
  bannerTitle: "⚛️  NUCLEUS ROOM HOSTED",
  contracts: [
    {
      relativePath: "api.md",
      initialContent: "# Project Living Contract: API Specifications\n\nFrozen endpoints and envelopes.\n"
    }
  ],
  initialTasks: (_topic?: string): TaskItem[] => [
    {
      id: "task-backend-01",
      title: "Implement core backend API endpoints",
      lane: "backend",
      status: "unassigned",
      assigned_to: null,
      depends_on_contracts: ["CONTRACT/api.md"]
    },
    {
      id: "task-frontend-01",
      title: "Build frontend client components",
      lane: "frontend",
      status: "unassigned",
      assigned_to: null,
      depends_on_contracts: ["CONTRACT/api.md"]
    }
  ],
  sampleInviteGuidance: (inviteCommand, hostUrl) => [
    `    Frontend :  ${inviteCommand("frontend", hostUrl)}`,
    `    Backend  :  ${inviteCommand("backend", hostUrl)}`,
    `    QA / DB  :  ${inviteCommand("qa", hostUrl)}`
  ]
};
