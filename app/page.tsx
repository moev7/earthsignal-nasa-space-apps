import { PublicStory } from "@/features/public-story/PublicStory";
import { LegacyWorkspaceLinks } from "@/features/ground-truth/components/story/LegacyWorkspaceLinks";
import { storyExperience } from "@/lib/story-experience";
export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const params = await searchParams;
  return (
    <>
      <LegacyWorkspaceLinks />
      <PublicStory mode={storyExperience(params?.mode)} />
    </>
  );
}
