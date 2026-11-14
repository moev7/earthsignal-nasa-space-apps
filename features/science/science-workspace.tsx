"use client";
import { SiteLink as Link } from "@/components/site-link";
import { publicStudyCatalogQuery, publicStudyRadarRequest, publicStudyExploreHref, publicStudySelectionLabel, PUBLIC_RADAR_STUDY, type PublicStudyContext } from "@/lib/public-study-context";
import { EarthsignalMark } from "@/components/earthsignal-mark";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bookmark,
  Globe2,
  Info,
  ArrowLeft,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Satellite,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { photoCatalogQuery } from "@/lib/photo-discovery";
import { DEFAULT_RECORD_FILTERS } from "./domain";
import { useScience } from "./use-science";
import { CollaboratorAccess } from "./collaborator-access";
import { ScienceFilters } from "./science-filters";
import { ScienceCard } from "./science-card";
import { RadarHistory } from "./radar-detail";
import { ScienceDetail } from "./science-detail";
import { UniversalSearch } from "./universal-search";
import { useScienceTools } from "./webmcp";
import { DecisionWorkspace } from "@/features/decisions/decision-workspace";
import type { SearchNavigation, WorkspaceSearchEntry, WorkspaceSearchTarget } from "./workspace-search";
import { currentSearchEpoch } from "./search-navigation";
export function ScienceWorkspace({ publicStudyContext = null }: { publicStudyContext?: PublicStudyContext | null }) {
  const model = useScience(publicStudyContext ? publicStudyCatalogQuery : undefined, publicStudyContext ? publicStudyRadarRequest(publicStudyContext) : null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"decisions" | "science">("decisions");
  const [investigationSeed, setInvestigationSeed] = useState<{ id: string; nonce: number } | null>(null);
  const [searchEntries, setSearchEntries] = useState<WorkspaceSearchEntry[]>([]);
  const [searchNavigation, setSearchNavigation] = useState<SearchNavigation | null>(null);
  const [searchEpoch, setSearchEpoch] = useState(0);
  const searchIdentity = useRef(0), searchNonce = useRef(0);
  const registerSearch = useCallback((entries: WorkspaceSearchEntry[], epoch: number) => {
    if (currentSearchEpoch(epoch, searchIdentity.current)) setSearchEntries(entries);
  }, []);
  useEffect(() => {
    const reset = () => {
      searchIdentity.current++;
      setSearchEpoch(searchIdentity.current);
      setSearchEntries([]);
      setSearchNavigation(null);
      setInvestigationSeed(null);
    };
    window.addEventListener("earthsignal-auth-changed", reset);
    return () => window.removeEventListener("earthsignal-auth-changed", reset);
  }, []);
  const navigateSearch = (target: WorkspaceSearchTarget) => {
    if (target.kind === "assessment" || target.kind === "snapshot" || target.kind === "place-search") {
      if (target.kind !== "place-search" && !searchEntries.some(e => e.target.kind === target.kind && "id" in e.target && e.target.id === target.id)) return;
      setSearchNavigation({ target, epoch: searchIdentity.current, nonce: ++searchNonce.current });
      setWorkspaceMode("decisions");
      return;
    }
    if (target.kind === "record") model.selectFromSearch(target.id, target.recordKind);
    else if (target.kind === "region") model.chooseRegion(target.id);
    else if (target.kind === "type") model.chooseType(target.id);
    else if (target.kind === "example") { model.reset(); model.select("opera-water-20230331"); }
    else if (target.id === "refresh") model.catalog.retry();
    else if (target.id === "saved") { model.clearSearchSelection(); model.setFilters(f => ({ ...f, savedOnly: true })); }
    else if (target.id === "reset") model.reset();
    else {
      const action = target.id;
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent(action === "water-history" ? "earthsignal:water-history" : "earthsignal:radar-analysis-mode", { detail: action }));
        document.querySelector(action === "water-history" ? ".water-history" : ".toolstrip")?.scrollIntoView({ block: "start" });
      });
    }
    setWorkspaceMode("science");
  };
  const investigateRadar = (id: string) => {
    setInvestigationSeed(previous => ({ id, nonce: (previous?.nonce ?? 0) + 1 }));
    setWorkspaceMode("decisions");
  };
  useScienceTools(model);
  return (
    <main className="app-shell science-app">
      <header className="app-header">
        <div className="workspace-masthead">
          <Link className="brand" href="/" aria-label="Earthsignal home">
            <EarthsignalMark />
            <span>Earthsignal<span>Advanced tools</span></span>
          </Link>
          <Link className="workspace-return" href="/"><ArrowLeft size={17} aria-hidden="true" />Back to the story</Link>
        </div>
        <UniversalSearch model={model} entries={searchEntries} onNavigate={navigateSearch} />
        <div className="workspace-mode-switch" role="group" aria-label="Workspace view">
          <button type="button" aria-pressed={workspaceMode === "decisions"} onClick={() => setWorkspaceMode("decisions")}>Place & question</button>
          <button type="button" aria-pressed={workspaceMode === "science"} onClick={() => setWorkspaceMode("science")}>Scientific explorer</button>
        </div>
        <div className="workspace-access"><CollaboratorAccess publicStudyContext={publicStudyContext} /></div>
        <div className="prototype-status">
          <span className="status-dot" />
          Public Earth data
          <span className="status-divider" />
          Prototype
        </div>
      </header>
      {publicStudyContext && <aside className="public-study-handoff" aria-label="Public study context">
        <div><strong>Continue the Lake Mead radar study</strong><p>Opened with {publicStudySelectionLabel(publicStudyContext.selection)}, {PUBLIC_RADAR_STUDY.start} to {PUBLIC_RADAR_STUDY.end}. The investigation draft uses this place and date pair. Review the setup before running an analysis; no analysis has started.</p><p>The public comparison measures HH backscatter change in dB. An investigation needs additional evidence to explain its cause. Scientific explorer also carries the original acquisition pair; its crop uses the geographic box enclosing your selection.</p></div>
        <Link href={publicStudyExploreHref(publicStudyContext.selection)}>Back to the same radar selection</Link>
      </aside>}

      <div className="decision-frame" hidden={workspaceMode !== "decisions"}>
        <DecisionWorkspace publicStudyContext={publicStudyContext} onDiscoverPhoto={(point, start, end) => {
          model.clearSearchSelection();
          model.setFilters(DEFAULT_RECORD_FILTERS);
          model.setComparisonDraft(null);
          model.chooseType("GCOV");
          model.catalog.setQuery(photoCatalogQuery(point, start, end));
          setWorkspaceMode("science");
          requestAnimationFrame(() => document.querySelector<HTMLElement>(".photo-discovery-summary")?.focus());
        }} query={model.catalog.query} radarJobs={model.radarJobs.jobs} investigationSeed={investigationSeed} openScience={() => setWorkspaceMode("science")} searchEpoch={searchEpoch} onSearchEntries={registerSearch} searchNavigation={searchNavigation} />
      </div>
      <SidebarProvider className="workspace science-workspace" data-workspace-hidden={workspaceMode !== "science"} aria-hidden={workspaceMode !== "science"}>
        <Sidebar collapsible="none" className="navigation">
          <SidebarContent>
            <div className="nav-top">
              <Button
                className={`nav-button ${!model.filters.savedOnly ? "active" : ""}`}
                variant="ghost"
                size="icon"
                aria-label="Explore real observations"
                aria-pressed={!model.filters.savedOnly}
                onClick={() =>
                  model.setFilters((f) => ({ ...f, savedOnly: false }))
                }
              >
                <Globe2 size={23} />
              </Button>
              <Button
                className={`nav-button ${model.filters.savedOnly ? "active" : ""}`}
                variant="ghost"
                size="icon"
                aria-label="Show saved real observations"
                aria-pressed={model.filters.savedOnly}
                onClick={() =>
                  model.setFilters((f) => ({ ...f, savedOnly: true }))
                }
              >
                <Bookmark size={21} />
              </Button>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  className="nav-button nav-about"
                  variant="ghost"
                  size="icon"
                  aria-label="About Earthsignal data"
                >
                  <Info size={21} />
                </Button>
              </DialogTrigger>
              <DialogContent className="about-dialog">
                <DialogHeader>
                  <DialogTitle>A clearer view of Earth.</DialogTitle>
                  <DialogDescription>
                    Real data, with its scientific context intact.
                  </DialogDescription>
                </DialogHeader>
                <p>
                  The radar acquisitions and footprints come from the public ASF
                  / NASA Earthdata catalog. They are actual records, not
                  simulated environmental change.
                </p>
                <p>
                  The water study is a historical OPERA DSWx-HLS optical raster
                  from GitHub. Its native pixels are processed into a
                  georeferenced map and area totals. It is not current NISAR
                  data or the total area of Lake Mead.
                </p>
                <p>
                  Choose a data type and study area to explore. Evidence,
                  quality metadata, and processing methods stay attached to each
                  observation.
                </p>
                <div className="notice">
                  <Search size={17} />
                  <p>
                    Use ⌘K / Ctrl+K or / to search places, data types, loaded
                    products, and workspace actions.
                  </p>
                </div>
                <a
                  href="https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/"
                  target="_blank"
                  rel="noreferrer"
                >
                  NASA Space Apps inspiration
                </a>
              </DialogContent>
            </Dialog>
            <span className="rail-caption">EARTH / 01</span>
          </SidebarContent>
        </Sidebar>
        <aside className="filters-panel">
          <ScienceFilters model={model} />
        </aside>
        <section
          className="observations-panel"
          aria-label="Real observation collection"
        >
          {model.catalog.query.point && <section className="photo-discovery-summary" aria-label="Radar availability at your location" tabIndex={-1}>
            <h2>Radar at your location</h2>
            <p>{model.catalog.query.point.split(",").reverse().join(", ")} · {model.catalog.query.start} to {model.catalog.query.end}</p>
            <p>{model.catalog.status === "loading" ? "Checking the public satellite catalog…" : model.catalog.status === "error" ? "The catalog could not be reached. This does not mean there are no observations." : model.catalog.catalog?.scenes.length ? `${model.catalog.catalog.scenes.length} acquisition records found (up to 24 shown). Open one to see its date and available preview.` : "No acquisition records returned for this point and date range. Try other dates; this is not evidence of no change."}</p>
            <p>These are dated radar observations, not a diagnosis of the photo. A comparison still needs two compatible acquisitions and valid coverage.</p>
            <button type="button" onClick={() => { setWorkspaceMode("decisions"); requestAnimationFrame(() => document.querySelector<HTMLElement>(".photo-place > summary")?.focus()); }}>Back to your place & question</button>
          </section>}
          <div className="list-title">
            <div>
              <span className="eyebrow">A PLANET IN PERSPECTIVE</span>
              <h2>
                {model.filters.savedOnly ? "Saved signals" : "Observations"}
                <span>{model.visible.length.toString().padStart(2, "0")}</span>
              </h2>
            </div>

          {model.type === "radar-change" && (
            <Button variant="outline" className="radar-new-button" onClick={() => model.setComparisonDraft({})}>
              New Comparison
            </Button>
          )}

            <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
              <DialogTrigger asChild>
                <Button
                  className="mobile-filter"
                  size="icon"
                  variant="outline"
                  aria-label="Open observation filters"
                >
                  <SlidersHorizontal size={18} />
                </Button>
              </DialogTrigger>
              <DialogContent className="filter-dialog">
                <DialogHeader>
                  <DialogTitle>Refine your perspective</DialogTitle>
                  <DialogDescription>
                    Choose a data type, study area, and scientific filters.
                  </DialogDescription>
                </DialogHeader>
                <ScienceFilters
                  model={model}
                  afterSearch={() => setFiltersOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </div>
          <p className="list-description">
            Real observations. Ready to investigate.
          </p>
          {model.selectedOutsideFilters && <div className="search-selection-notice" role="status">
            Viewing a search result outside these filters. Your collection settings are preserved.
            <button type="button" onClick={model.clearSearchSelection}>Return to filtered observations</button>
          </div>}
          <div className={`card-list ${model.type === "radar-change" ? "radar-collection" : ""}`}>
            {model.type === "radar-change" && <RadarHistory model={model} />}
            {model.visible.map((record) => (
              <ScienceCard
                key={record.id}
                record={record}
                region={model.catalog.query.region}
                point={model.catalog.query.point}
                selected={model.selected?.id === record.id}
                saved={model.saved.includes(record.id)}
                onSelect={() => model.select(record.id)}
                onSave={() => model.toggleSaved(record.id)}
              />
            ))}
            {model.catalog.status === "loading" && model.type !== "water" && model.type !== "radar-change" && (
              <div className="catalog-stream-status" role="status">
                <Satellite size={17} />
                <span>Discovering radar acquisitions…</span>
              </div>
            )}
            {model.catalog.status === "error" && model.type !== "water" && model.type !== "radar-change" && (
              <div className="catalog-stream-error" role="alert">
                <Info size={18} />
                <p>{model.catalog.error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={model.catalog.retry}
                >
                  Try again
                </Button>
              </div>
            )}
            {!model.visible.length && model.catalog.status !== "loading" && (
              <div className="empty-state">
                <Search size={28} />
                <h3>{model.type === "radar-change" ? "No completed comparisons" : "No matching observations"}</h3>
                <p>
                  {model.filters.savedOnly
                    ? "Bookmark an observation to revisit it here."
                    : model.type === "radar-change" ? "Verified results appear here when they match the chosen crop location and acquisition dates. Processing history remains available above." : "Try another data type, a wider date range, or fewer scientific filters. Only actual available records are shown."}
                </p>
                <Button variant="outline" onClick={model.reset}>
                  Reset exploration
                </Button>
              </div>
            )}
          </div>
          <div className="science-list-footer">
            <div>
              <span className="signal-dot" />
              {model.catalog.status === "ready"
                ? `${model.catalog.catalog?.scenes.length ?? 0} ${model.type === "radar-change" ? "GCOV candidates available" : "radar products retrieved"}`
                : model.type === "water"
                  ? "Processed historical study"
                  : "Public data sources"}
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Refresh radar observations"
              onClick={model.catalog.retry}
              disabled={model.catalog.status === "loading"}
            >
              <RefreshCw size={14} />
            </Button>
          </div>
        </section>
        <section
          className="detail-panel science-detail"
          aria-label="Selected real observation"
        >
          <ScienceDetail model={model} onInvestigateRadar={investigateRadar} />
        </section>
      </SidebarProvider>
      <footer className="app-footer">
        <span>Built for curiosity. Grounded in evidence.</span>
        <span>
          Independent Earthsignal prototype <span>/</span> NASA Space Apps
          inspiration
        </span>
      </footer>
    </main>
  );
}
