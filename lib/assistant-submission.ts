import { assistantPreviewHash } from "./assistant-contract";

// Hashing yields to other UI events. Recheck consent context before sending.
export async function submitReviewedQuestion<T>(
  question: string,
  evidenceIds: string[],
  isCurrent: () => boolean,
  send: (body: {
    schemaVersion: "1.0";
    publicAIOptIn: true;
    question: string;
    evidenceIds: string[];
    previewHash: string;
  }) => Promise<T>,
  hash: typeof assistantPreviewHash = assistantPreviewHash,
): Promise<T | null> {
  const previewHash = await hash(question, evidenceIds);
  if (!isCurrent()) return null;
  return send({
    schemaVersion: "1.0",
    publicAIOptIn: true,
    question,
    evidenceIds,
    previewHash,
  });
}
