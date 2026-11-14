import { z } from "zod";
import { publicBlocks, PUBLIC_EXPLANATION_VERSION, approvedPublicQuestion } from "./public-evidence";
export const assistantRequestSchema = z.object({ schemaVersion: z.literal("1.0"), publicAIOptIn: z.literal(true), question: z.string().trim().min(3).max(1200).refine(approvedPublicQuestion,"Choose a reviewed public question"), evidenceIds: z.array(z.string().max(100)).min(1).max(8), previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().refine(r => new Set(r.evidenceIds).size === r.evidenceIds.length && publicBlocks(r.evidenceIds).length === r.evidenceIds.length, "Choose reviewed public evidence only");
export function assistantPayload(question: string, evidenceIds: string[]) {
  return { explanationVersion: PUBLIC_EXPLANATION_VERSION, question: question.trim(), evidence: publicBlocks(evidenceIds).map(b => ({ id: b.evidenceId, blockId: b.id, title: b.title, hook:b.hook, focusTarget:b.focusTarget, type: b.type, text: b.text, url: b.url, limitations: b.limitations })) };
}
export async function assistantPreviewHash(question: string, evidenceIds: string[]) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(assistantPayload(question, evidenceIds))));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export function validateAssistantSelection(value: unknown, evidenceIds: string[]) {
  const selection = z.object({ abstain: z.boolean(), blockIds: z.array(z.string()).max(4) }).strict().parse(value);
  const approved = new Set(publicBlocks(evidenceIds).map(b => b.id));
  if (new Set(selection.blockIds).size !== selection.blockIds.length || selection.blockIds.some(id => !approved.has(id)) || (selection.abstain && selection.blockIds.length) || (!selection.abstain && !selection.blockIds.length)) throw new Error("Unsupported assistant answer");
  return selection;
}
