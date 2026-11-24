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

## Protocols for Engaged Debaters
1. **Natural Conversational Prose (No Sterile Headings):** Write in 1 to 2 articulate, flowing paragraphs. Never use artificial analytical headings like \`**Premise:**\`, \`**Rebuttal:**\`, or \`**Conclusion:**\`. Argue like a sharp, persuasive human intellectual in a live Oxford Union debate or deep podcast.
2. **Direct Engagement:** Speak directly to your counterpart. Use vivid analogies, real-world examples, and counter-factuals.
3. **Atomic Conciseness (100–180 Words Max):** Make one focused point per turn so the debate progresses with high cognitive density.
4. **Dynamic Open-Ended Evolution:** The debate continues round-by-round until a genuine breakthrough, middle-ground axiom, or synthesis is reached.
5. **Living Axioms:** When both sides agree on a factual point, it is locked into \`CONTRACT/axioms.md\`.
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
        title: `Round 1 (Pro): Opening Thesis for ${topicTitle} [Natural Prose, 100-180 words]`,
        lane: "pro",
        status: "unassigned",
        assigned_to: null,
        depends_on_contracts: ["CONTRACT/topic.md"],
        description: "State your core thesis naturally in 1-2 articulate paragraphs. Use a vivid real-world analogy. Avoid rigid headings."
      },
      {
        id: "round-01-contra",
        title: `Round 1 (Contra): Opening Challenge & Counter-Perspective [Natural Prose, 100-180 words]`,
        lane: "contra",
        status: "blocked",
        assigned_to: null,
        depends_on_contracts: ["round-01-pro"],
        description: "Directly challenge Pro's opening thesis with a sharp counter-analogy and alternative explanation. Write in natural conversational paragraphs without headers."
      }
    ];
  },
  peersTemplate: `
### Dialectic Collaboration & Natural Human Dialogue Rules
- **Natural Conversational Prose (No Rigid Headings)**: Write in 1 to 2 cohesive, natural paragraphs. Do NOT use artificial bullet headings like \`**Premise:**\`, \`**Rebuttal:**\`, or \`**Conclusion:**\`. Argue like an articulate thinker in a live debate.
- **Direct & Persuasive**: Speak directly to your opponent. Attack their specific claims with vivid analogies, counter-examples, and sharp reasoning (e.g. "The fundamental flaw in your point is...", "Consider this concrete example...").
- **Conciseness (100–180 Words Max)**: Keep each turn punchy. Make one clear, powerful point at a time so your opponent can engage directly.
- **Turn-Taking Floor Enforcement**: Do not claim or submit your round until the preceding round on the board is marked approved.
- **Real-Time Opponent Awareness**: Read your counterpart's live drafting in \`.nucleus/shadows/pro/\` or \`.nucleus/shadows/contra/\`.
- **Axiom Non-Contradiction**: Never contradict established truths locked in \`CONTRACT/axioms.md\`.
`,
  sampleInviteGuidance: (inviteCommand, hostUrl) => [
    `    Advocate (Pro)   :  ${inviteCommand("pro", hostUrl)}`,
    `    Opponent (Contra):  ${inviteCommand("contra", hostUrl)}`,
    `    Judge (Center)   :  ${inviteCommand("judge", hostUrl)}`
  ]
};
