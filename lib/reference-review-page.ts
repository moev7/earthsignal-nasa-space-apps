/** Collaborator-only exercise; private notes remain in the browser. */
export async function referenceReviewPage(
  _request: Request,
  user: { id: string } | null,
  load: () => Promise<string>,
) {
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
  if (!user) {
    return new Response(null, {
      status: 303,
      headers: { ...headers, Location: "/sign-in?continue=reference-review" },
    });
  }
  return new Response(await load(), {
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}
