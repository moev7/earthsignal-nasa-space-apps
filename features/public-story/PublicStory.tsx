"use client";
import { PublicFrame } from "./PublicShell";
import { MissionProvider } from "./missions/StoryMissions";
import { GameExperience } from "./quest/GameExperience";
import { LivingStory } from "./discovery/LivingStory";
import { DiscoverySound } from "./discovery/DiscoverySound";
import type { StoryExperience } from "@/lib/story-experience";
export { AquiferExperiment } from "./AquiferExperiment";

export function PublicStory({ mode = "story" }: { mode?: StoryExperience }) {
  const game = mode === "game";
  const story = (
    <PublicFrame page="story" playback game={game}>
      <DiscoverySound>
        {game ? <GameExperience /> : <LivingStory />}
      </DiscoverySound>
    </PublicFrame>
  );
  return game ? <MissionProvider>{story}</MissionProvider> : story;
}
