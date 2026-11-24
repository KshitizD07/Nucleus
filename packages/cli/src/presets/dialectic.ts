import type { RoomPreset } from "./types.js";
import type { TaskItem } from "@nucleus/protocol";

export const dialecticPreset: RoomPreset = {
  id: "dialectic",
  name: "Adversarial Dialectic & Philosophical Debate",
  description: "Structured, turn-based research and debate between Pro and Contra with real-time judicial synthesis.",
  defaultLanes: ["pro", "contra", "judge"],
  bannerTitle: "⚖️  NUCLEUS DIALECTIC ROOM",
  contracts: [
    {
      relativePath: "topic.md",
      initialContent: `# Dialectic Topic & Resolution

**Resolution:** (Topic under investigation)

## Protocols for Engaged LLM Agents
1. **Atomic Turn-Taking:** Neither side may submit an argument while the opponent's round is active.
2. **Strict Conciseness:** Maximum 150-200 words per turn. State 1 Premise, 1 Argument/Evidence, and 1 Conclusion.
3. **Deconstruct, Don't Dump:** Break complex ideas down turn by turn. Do NOT write long essays.
4. **Living Axioms:** When an argument or premise is verified by the Judge, it is locked into \`CONTRACT/axioms.md\`.
5. **Real-Time Shadow Visibility:** Inspect your opponent's live drafting in \`.nucleus/shadows/<lane>/\` to formulate counter-arguments in real time.
`
    },
    {
      relativePath: "axioms.md",
      initialContent: `# Frozen Axioms & Agreed Truths

Established premises validated by the Center / Judge. Once frozen here, neither side may retract or contradict these axioms.

- [Axiom 0]: The debate topic in CONTRACT/topic.md is binding on both participants.
`
    },
    {
      relativePath: "speaking_floor.md",
      initialContent: `# Speaking Floor Mutex

The active speaker holds the lease lock on this contract file during their turn.
`
    }
  ],
  initialTasks: (topic?: string): TaskItem[] => {
    const topicTitle = topic ? `"${topic}"` : "Assigned Resolution";
    return [
      {
        id: "round-01-pro",
        title: `Round 1 (Pro): Opening Thesis & Primary Premise for ${topicTitle} [Max 150 words]`,
        lane: "pro",
        status: "unassigned",
        assigned_to: null,
        depends_on_contracts: ["CONTRACT/topic.md"],
        description: "Present your primary thesis statement and the first foundational premise supporting the resolution. Keep strictly under 150 words."
      },
      {
        id: "round-01-contra",
        title: `Round 1 (Contra): Targeted Rebuttal & Opposing Premise [Max 150 words]`,
        lane: "contra",
        status: "blocked",
        assigned_to: null,
        depends_on_contracts: ["round-01-pro"],
        description: "Inspect Pro's argument in .nucleus/shadows/pro/. Identify flaws in Premise 1 and present your first counter-premise. Keep strictly under 150 words."
      },
      {
        id: "round-02-pro",
        title: `Round 2 (Pro): Defense, Syllogism Refinement & Secondary Premise [Max 150 words]`,
        lane: "pro",
        status: "blocked",
        assigned_to: null,
        depends_on_contracts: ["round-01-contra"],
        description: "Defend against Contra's counter-premise and advance a secondary supporting argument. Keep strictly under 150 words."
      },
      {
        id: "round-02-contra",
        title: `Round 2 (Contra): Cross-Examination & Counter-Synthesis [Max 150 words]`,
        lane: "contra",
        status: "blocked",
        assigned_to: null,
        depends_on_contracts: ["round-02-pro"],
        description: "Rebut Pro's secondary argument, summarize contradictions in their position, and conclude your case. Keep strictly under 150 words."
      },
      {
        id: "round-synthesis",
        title: `Round 3 (Judge): Judicial Verdict, Logical Evaluation & Emergent Truth`,
        lane: "judge",
        status: "blocked",
        assigned_to: null,
        depends_on_contracts: ["round-02-contra"],
        description: "Evaluate both sides line-by-line, award scores for logical validity, and document the emergent synthesis in SYNTHESIS.md."
      }
    ];
  },
  peersTemplate: `
### Dialectic Collaboration & Turn Rules
- **Atomic Conciseness (Strict 150-200 Word Limit)**: Do NOT produce long essays. Formulate exactly 1 premise + 1 argument + 1 conclusion per turn.
- **Turn-Taking Floor Enforcement**: Do not claim or submit your round until the preceding round on the board is marked approved.
- **Real-Time Shadow Inspection**: Read your counterpart's live drafting in \`.nucleus/shadows/pro/\` or \`.nucleus/shadows/contra/\`.
- **Axiom Non-Contradiction**: Never contradict established truths locked in \`CONTRACT/axioms.md\`.
`,
  sampleInviteGuidance: (inviteCommand, hostUrl) => [
    `    Advocate (Pro)   :  ${inviteCommand("pro", hostUrl)}`,
    `    Opponent (Contra):  ${inviteCommand("contra", hostUrl)}`,
    `    Judge (Center)   :  ${inviteCommand("judge", hostUrl)}`
  ]
};
