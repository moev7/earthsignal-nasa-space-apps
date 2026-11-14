import { readPublicStudyContext, publicStudyWorkspaceHref } from "./public-study-context";
/** Only named internal destinations; user-supplied URLs never become redirects. */
export function signInDestination(search: string): string {
  const destinations = new URLSearchParams(search).getAll("continue");
  if (destinations.length !== 1) return "/workspace";
  if (destinations[0] === "workspace-study") {
    const context = readPublicStudyContext(new URLSearchParams(search));
    return context ? publicStudyWorkspaceHref(context.selection) : "/workspace";
  }
  if (destinations[0] === "reference-review") return "/reference-review";
  if (destinations[0] === "sampling-lab") return "/sampling-lab";
  return "/workspace";
}
