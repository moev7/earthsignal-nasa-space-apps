export function searchShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "repeat" | "isComposing" | "defaultPrevented">, typing: boolean): "toggle" | "open" | null {
  if (event.repeat || event.isComposing || event.defaultPrevented || event.altKey) return null;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") return "toggle";
  return event.key === "/" && !typing && !event.metaKey && !event.ctrlKey ? "open" : null;
}

export function currentSearchEpoch(expected: number, actual: number) { return expected === actual; }

export function focusSearchTarget(id: string) {
  const target = document.getElementById(id);
  if (!target) return false;
  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    if (element instanceof HTMLDetailsElement) element.open = true;
  }
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.scrollIntoView({ block: "start" });
  target.focus({ preventScroll: true });
  return true;
}
