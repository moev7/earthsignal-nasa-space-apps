import { notFound, redirect } from "next/navigation";
import { publicStudy } from "@/lib/public-study-registry";
import { PublishedSarStudy } from "@/features/science/published-sar-study";
export default async function StudyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ revision?: string | string[] }> }) {
  const { id } = await params, query = await searchParams;
  if (Array.isArray(query.revision)) notFound();
  const study = publicStudy(id, query.revision);
  if (!study) notFound();
  if (!study.manifestUrl.startsWith("/data/sar/")) redirect(study.href);
  return <PublishedSarStudy key={study.manifestSha256} study={study} />;
}
