import { authenticatedUser } from "@/lib/local-auth";
import { referenceReviewPage } from "@/lib/reference-review-page";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return referenceReviewPage(request, await authenticatedUser(request), async () => {
    const { OPTICAL_REVIEW_HTML } = await import("@/lib/reference-review.generated");
    return OPTICAL_REVIEW_HTML;
  });
}
