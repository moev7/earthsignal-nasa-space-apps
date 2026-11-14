"use client";
import { ChevronDown, Database, Search, Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { REGIONS, type CatalogQuery } from "@/features/catalog/domain";
import { DATA_TYPES, type DataType } from "./domain";
import type { ScienceModel } from "./use-science";
export function ScienceFilters({
  model,
  afterSearch,
}: {
  model: ScienceModel;
  afterSearch?: () => void;
}) {
  const { catalog, type, filters } = model;
  return (
    <div className="filters-content science-filters">
      <div className="section-heading">
        <h2>Explore</h2>
        <Button variant="ghost" size="sm" onClick={model.reset}>
          Reset
        </Button>
      </div>
      <div className="search-wrap">
        <Search size={16} />
        <Input
          aria-label="Filter loaded observations"
          placeholder="Filter these observations"
          value={filters.query}
          onChange={(e) =>
            model.setFilters((f) => ({ ...f, query: e.target.value }))
          }
        />
      </div>
      <label className="field-label">Data type</label>
      <Select
        value={type}
        onValueChange={(value) => model.chooseType(value as DataType)}
      >
        <SelectTrigger className="region-select" aria-label="Choose data type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(DATA_TYPES).map(([id, t]) => (
            <SelectItem key={id} value={id}>
              <span className="type-select-item">
                <span className="signal-dot" style={{ background: t.color }} />
                {t.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="filter-hint">{DATA_TYPES[type].caption}</p>
      <label className="field-label">Study area</label>
      <Select
        value={catalog.query.point ? "confirmed-point" : catalog.query.region}
        onValueChange={(value) =>
          value !== "confirmed-point" && model.chooseRegion(value as CatalogQuery["region"])
        }
      >
        <SelectTrigger className="region-select" aria-label="Choose study area">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {catalog.query.point && <SelectItem value="confirmed-point">Your confirmed location</SelectItem>}
          {Object.entries(REGIONS).map(([id, r]) => (
            <SelectItem value={id} key={id}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="filter-divider" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          catalog.search();
          afterSearch?.();
        }}
      >
        <h3>Date range</h3>
        <div className="science-date-inputs">
          <label>
            From
            <Input
              type="date"
              aria-label="Observation start date"
              required
              value={catalog.draft.start}
              max={catalog.draft.end}
              onChange={(e) =>
                catalog.setDraft((d) => ({ ...d, start: e.target.value }))
              }
            />
          </label>
          <label>
            To
            <Input
              type="date"
              aria-label="Observation end date"
              required
              value={catalog.draft.end}
              min={catalog.draft.start}
              onChange={(e) =>
                catalog.setDraft((d) => ({ ...d, end: e.target.value }))
              }
            />
          </label>
        </div>
        <Button
          type="submit"
          className="catalog-submit"
          disabled={catalog.status === "loading"}
        >
          Apply dates
        </Button>
      </form>
      <p className="filter-hint">Historical studies keep their source date.</p>
      <div className="filter-divider" />
      <Accordion type="single" collapsible className="filter-advanced">
        <AccordionItem value="advanced">
          <AccordionTrigger>Scientific filters</AccordionTrigger>
          <AccordionContent>
            <label className="field-label">Orbit direction</label>
            <Select
              value={filters.direction}
              onValueChange={(direction) =>
                model.setFilters((f) => ({ ...f, direction }))
              }
            >
              <SelectTrigger aria-label="Orbit direction filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any direction</SelectItem>
                <SelectItem value="ASCENDING">Ascending</SelectItem>
                <SelectItem value="DESCENDING">Descending</SelectItem>
              </SelectContent>
            </Select>
            <label className="field-label">Product maturity</label>
            <Select
              value={filters.maturity}
              onValueChange={(maturity) =>
                model.setFilters((f) => ({ ...f, maturity }))
              }
            >
              <SelectTrigger aria-label="Product maturity filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All maturity levels</SelectItem>
                <SelectItem value="provisional">Provisional</SelectItem>
                <SelectItem value="beta">Beta</SelectItem>
              </SelectContent>
            </Select>
            <label className="science-checkbox">
              <Checkbox
                aria-label="Only scenes with a radar preview"
                checked={filters.previewOnly}
                onCheckedChange={(checked) =>
                  model.setFilters((f) => ({ ...f, previewOnly: !!checked }))
                }
              />
              Has radar preview
            </label>
            <p className="filter-hint">
              Radar-specific filters exclude the optical water study.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <div className="filter-footer science-sources">
        <span className="eyebrow">CONNECTED SOURCES</span>
        <div>
          <Satellite size={15} />
          <span>ASF / NASA Earthdata</span>
        </div>
        <div>
          <Database size={15} />
          <span>OPERA applications</span>
        </div>
        <p className="filter-hint">
          Public data. Traceable processing.
          <br />
          No map key required.
        </p>
        <a href="/reference-review" target="_blank" rel="noreferrer">
          Help check a water-map study
        </a>
        <p className="filter-hint">Guided development exercise for collaborators. Opens in a new tab.</p>
        <a href="/sampling-lab" target="_blank" rel="noreferrer">Explore sampling & uncertainty</a>
        <p className="filter-hint">Try a made-up example or run your own private area experiment.</p>
      </div>
    </div>
  );
}
