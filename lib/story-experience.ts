/** The game is an explicit URL choice, never inferred from saved quiz receipts. */
export type StoryExperience = "story" | "game";
export function storyExperience(value: unknown): StoryExperience {
  return value === "game" ? "game" : "story";
}
