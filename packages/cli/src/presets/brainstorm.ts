import type { RoomPreset } from "./types.js";
import type { TaskItem } from "@nucleus/protocol";

export const brainstormPreset: RoomPreset = {
  id: "brainstorm",
  name: "Product Strategy & Architecture Brainstorm",
  description: "Collaborative design and strategy between Vision, Skeptic, Market Intel, and Systems Architect.",
  defaultLanes: ["vision", "skeptic", "market", "systems"],
  bannerTitle: "💡 NUCLEUS BRAINSTORM ROOM",
  contracts: [
    {
      relativePath: "PRD.md",
      initialContent: `# Product Requirements Document (PRD)

## 1. Problem Statement
(Define the core customer pain point)

## 2. Target Personas
(Define primary user archetypes)

## 3. Core Value Proposition
(The single sentence describing why this must exist)
`
    },
    {
      relativePath: "decisions.md",
      initialContent: `# Architecture & Strategy Decision Records (ADRs)

Frozen decisions agreed by the team.

- [ADR 0]: Initial problem scope is defined in CONTRACT/PRD.md.
`
    }
  ],
  initialTasks: (topic?: string): TaskItem[] => {
    const focus = topic ? `for "${topic}"` : "";
    return [
      {
        id: "task-vision-01",
        title: `Draft core problem statement and target persona ${focus}`.trim(),
        lane: "vision",
        status: "unassigned",
        assigned_to: null,
        depends_on_contracts: ["CONTRACT/PRD.md"]
      },
      {
        id: "task-skeptic-01",
        title: "Red-team product thesis and identify top 3 failure modes",
        lane: "skeptic",
        status: "unassigned",
        assigned_to: null,
        depends_on_contracts: ["CONTRACT/PRD.md"]
      },
      {
        id: "task-market-01",
        title: "Benchmark competitive moat and alternative solutions",
        lane: "market",
        status: "unassigned",
        assigned_to: null,
        depends_on_contracts: ["CONTRACT/PRD.md"]
      },
      {
        id: "task-systems-01",
        title: "Assess technical architecture feasibility and operational constraints",
        lane: "systems",
        status: "unassigned",
        assigned_to: null,
        depends_on_contracts: ["CONTRACT/decisions.md"]
      }
    ];
  },
  peersTemplate: `
### Brainstorming Protocol
- Work asynchronously across designated lanes.
- Inspect active working notes in \`.nucleus/shadows/\`.
- When consensus is reached on an architectural or product decision, record it in \`CONTRACT/decisions.md\`.
`,
  sampleInviteGuidance: (inviteCommand, hostUrl) => [
    `    Vision / PM       :  ${inviteCommand("vision", hostUrl)}`,
    `    Skeptic / Redteam :  ${inviteCommand("skeptic", hostUrl)}`,
    `    Market Intel      :  ${inviteCommand("market", hostUrl)}`,
    `    Systems Architect :  ${inviteCommand("systems", hostUrl)}`
  ]
};
