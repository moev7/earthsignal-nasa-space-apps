"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Compass, Database, MapPin, Search, Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { REGIONS } from "@/features/catalog/domain";
import { searchEntries } from "./search-index";
import { observationSearchEntries, workspaceCommandEntries, searchResultGroups, type WorkspaceSearchEntry, type WorkspaceSearchTarget } from "./workspace-search";
import { searchShortcut } from "./search-navigation";
import type { ScienceModel } from "./use-science";

const subscribePlatform = () => () => {};
const platformShortcut = () => /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
const serverShortcut = () => "Ctrl K";

export function UniversalSearch({ model, entries = [], onNavigate }: {
  model: ScienceModel; entries?: WorkspaceSearchEntry[]; onNavigate: (target: WorkspaceSearchTarget) => void;
}) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState(""), [limit, setLimit] = useState(40);
  const shortcut = useSyncExternalStore(subscribePlatform, platformShortcut, serverShortcut);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = Boolean(target?.closest("input,textarea,select,[contenteditable]:not([contenteditable='false'])"));
      const action = searchShortcut(event, typing);
      if (!action) return;
      event.preventDefault();
      setOpen(value => action === "toggle" ? !value : true);
    };
    const clear = () => { setOpen(false); setSearch(""); setLimit(40); };
    window.addEventListener("keydown", listener);
    window.addEventListener("earthsignal-auth-changed", clear);
    return () => { window.removeEventListener("keydown", listener); window.removeEventListener("earthsignal-auth-changed", clear); };
  }, []);
  const index = useMemo(() => [
    ...observationSearchEntries(model.searchRecords, model.catalog.query.region, model.saved, model.catalog.query.point),
    ...entries, ...workspaceCommandEntries(model.selected),
  ], [model.searchRecords, model.catalog.query.region, model.catalog.query.point, model.saved, model.selected, entries]);
  const matches = useMemo(() => searchEntries(index, search, limit), [index, search, limit]);
  const groups = searchResultGroups(matches.items, search);
  const pick = (target: WorkspaceSearchTarget) => {
    setOpen(false); setSearch(""); setLimit(40);
    onNavigate(target);
  };
  return <>
    <Button className="universal-search-button" variant="outline" onClick={() => setOpen(true)} aria-label="Open universal search" aria-keyshortcuts="Meta+K Control+K /">
      <Search size={16} /><span>Search observations, evidence, places…</span><kbd>{shortcut}</kbd>
    </Button>
    <CommandDialog open={open} onOpenChange={value => { setOpen(value); if (!value) { setSearch(""); setLimit(40); } }}
      title="Search Earthsignal" description="Search the loaded catalog, completed radar comparisons and your account’s loaded scientific work. Place lookup is a separate explicit action."
      className="science-command" commandProps={{ shouldFilter: false, vimBindings: false }}>
      <CommandInput value={search} maxLength={512} onValueChange={value => { setSearch(value); setLimit(40); }} placeholder="A product ID, finding, or track:85 product:GCOV…" aria-label="Universal search" aria-describedby="search-scope" />
      <div id="search-scope" className="search-scope">
        <span>{model.catalog.query.point ? "Your confirmed location" : REGIONS[model.catalog.query.region].label} · {model.catalog.query.product} · {model.catalog.query.start} → {model.catalog.query.end}</span>
        <span>{model.searchRecords.length} observations & comparisons · {entries.length} scientific entries</span>
      </div>
      <CommandList>
        {matches.error ? <p id="search-feedback" className="search-feedback" role="status">{matches.error}</p> : <>
          {!matches.total && <p id="search-feedback" className="search-feedback" role="status">No matching loaded evidence. Try a product ID, <code>track:85</code>, or <code>source:usgs-daily</code>.</p>}
          {groups.map(group => <CommandGroup key={group.heading} heading={group.heading}>
            {group.items.map(item => <CommandItem key={item.id} value={item.id} onSelect={() => pick(item.target)}>
              {item.target.kind === "record" ? <Satellite size={17} /> : item.target.kind === "region" || item.target.kind === "place-search" ? <MapPin size={17} /> : item.target.kind === "assessment" || item.target.kind === "snapshot" ? <Database size={17} /> : <Compass size={17} />}
              <span className="search-item-copy"><span>{item.title}</span><small>{search.trim() ? `${item.group} · ` : ""}{item.subtitle}</small></span>
            </CommandItem>)}
          </CommandGroup>)}
          {matches.total > matches.items.length && <CommandItem value="search:more" onSelect={() => setLimit(value => value + 40)}><Search size={17} />Show more · {matches.total - matches.items.length} remaining</CommandItem>}
        </>}
      </CommandList>
      <div className="search-help">Exact fields: product, track, frame, direction, polarization, maturity, date, source, kind, saved. <code>saved:true</code>
        <button type="button" className="search-place-link" onClick={() => pick({ kind: "place-search", query: !search.includes(":") && search.trim().length <= 160 ? search.trim() : undefined })}>Find a named place →</button>
      </div>
      <div className="command-footer"><span role="status" aria-live="polite">{matches.error ? "Check your query" : `${matches.items.length} of ${matches.total} matches`}</span><span><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open <kbd>esc</kbd> close</span></div>
    </CommandDialog>
  </>;
}
