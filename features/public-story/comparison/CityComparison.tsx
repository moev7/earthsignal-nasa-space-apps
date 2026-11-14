"use client";

import { SiteLink as Link } from "@/components/site-link";
import { TEHRAN, TOKYO } from "@/features/ground-truth/data/cities";
import {
  COMPARABILITY_LABEL,
  COMPARISON_ROWS,
} from "@/features/ground-truth/data/comparison";
import { SOURCES } from "@/features/ground-truth/data/satellites";
import { LEARNINGS } from "@/features/ground-truth/data/stories";
import { CITATIONS } from "@/features/ground-truth/data/tehranStory";
import type { CaseCity, DataSource } from "@/features/ground-truth/data/types";
import { JAPAN_POLICY_SOURCE, JICA_GROUNDWATER_SOURCE } from "../Sources";
import { MilestoneTimeline, TrendExplorer } from "./ComparisonCharts";
import { CITY_COLORS } from "./model";
import "./comparison.css";

const CITIES = [TEHRAN, TOKYO];
const CONTEXT: { key: keyof CaseCity["context"]; label: string }[] = [
  { key: "population", label: "Population" },
  { key: "elevation", label: "Elevation" },
  { key: "geology", label: "Geology" },
  { key: "climate", label: "Climate" },
  { key: "waterSource", label: "Water source" },
  { key: "landUse", label: "Land use" },
];
const SUBSIDENCE: {
  key: Exclude<keyof CaseCity["subsidence"], "headline" | "headlineProvenance">;
  label: string;
}[] = [
  { key: "peakRate", label: "Reported peak" },
  { key: "cumulative", label: "Cumulative lowering" },
  { key: "firstDetected", label: "First detection" },
  { key: "affectedArea", label: "Affected area" },
  { key: "monitoringSince", label: "Monitoring record" },
];
const SOURCE_FIELDS: { key: keyof DataSource; label: string }[] = [
  { key: "mission", label: "Platform context" },
  { key: "sensor", label: "Sensor context" },
  { key: "provider", label: "Provider / compilation" },
  { key: "acquisitionDate", label: "Illustrated period" },
  { key: "processing", label: "Processing description" },
  { key: "resolution", label: "Spatial summary" },
  { key: "limitations", label: "Limitations" },
  { key: "confidence", label: "Confidence" },
  { key: "state", label: "Data state" },
  { key: "provenance", label: "Provenance" },
  { key: "attribution", label: "Attribution" },
];

export function CityReferences({ city }: { city: CaseCity }) {
  return (
    <p className="ec-references">
      {city.id === "tehran" ? (
        <>
          <a href={CITATIONS.mahmoudpour2013.url}>Mahmoudpour et al. (2013)</a>{" "}
          · <a href={CITATIONS.moradi2023.url}>Moradi et al. (2023)</a>
        </>
      ) : (
        <>
          <a href={JAPAN_POLICY_SOURCE}>Japan Ministry of the Environment</a> ·{" "}
          <a href={JICA_GROUNDWATER_SOURCE}>
            JICA groundwater-management history
          </a>
        </>
      )}
    </p>
  );
}

function CityProfile({ city }: { city: CaseCity }) {
  return (
    <article className="ec-profile">
      <h3 style={{ color: CITY_COLORS[city.id] }}>{city.name}</h3>
      <p className="ec-profile-region">
        {city.region} · {city.country}
      </p>
      <p className="ec-profile-tagline">{city.tagline}</p>
      <div className="ec-reference-headline">
        <span>Published-reference summary</span>
        <strong>{city.subsidence.headline}</strong>
      </div>
      <Link className="ec-profile-map" href={`/explore?city=${city.id}`}>
        Explore {city.name} on the map
      </Link>
      <details className="ec-disclosure">
        <summary>Environmental context &amp; observation record</summary>
        <div className="ec-disclosure-body">
          <p>{city.overview}</p>
          <CityReferences city={city} />
          <dl className="ec-definition-list">
            {CONTEXT.map(({ key, label }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{city.context[key]}</dd>
              </div>
            ))}
            {SUBSIDENCE.map(({ key, label }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{city.subsidence[key]}</dd>
              </div>
            ))}
          </dl>
          <h4>Main causes in the case study</h4>
          <ul>
            {city.primaryCauses.map((cause) => (
              <li key={cause}>{cause}</li>
            ))}
          </ul>
          <h4>Observation sources referenced</h4>
          <ul>
            {city.observationSources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </div>
      </details>
    </article>
  );
}

function ManagementHistory({ city }: { city: CaseCity }) {
  return (
    <article className="ec-management">
      <h3 style={{ color: CITY_COLORS[city.id] }}>{city.name}</h3>
      <p>{city.groundwater.summary}</p>
      <details className="ec-disclosure">
        <summary>Groundwater management history</summary>
        <ol className="ec-history">
          {city.groundwater.history.map((phase) => (
            <li key={phase.period}>
              <span>{phase.period}</span>
              <h4>{phase.label}</h4>
              <p>{phase.detail}</p>
            </li>
          ))}
        </ol>
      </details>
      <details className="ec-disclosure">
        <summary>Policies &amp; responses ({city.policies.length})</summary>
        <div className="ec-disclosure-body">
          {city.policies.map((policy) => (
            <div key={policy.name} className="ec-policy">
              <span>{policy.year}</span>
              <h4>{policy.name}</h4>
              <p>{policy.effect}</p>
            </div>
          ))}
        </div>
      </details>
      <details className="ec-disclosure">
        <summary>Evidence after intervention &amp; its limits</summary>
        <div className="ec-disclosure-body">
          <ul>
            {city.evidenceAfterIntervention.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="ec-help">
            These are the original educational case-study summaries. The
            illustrated trend cannot establish a policy effect; the short
            measured Tehran bundle does not measure pumping.
          </p>
          <CityReferences city={city} />
        </div>
      </details>
    </article>
  );
}

export function ComparisonSources() {
  return (
    <details className="ec-disclosure ec-source-records">
      <summary>Illustration source records &amp; historical references</summary>
      <div className="ec-disclosure-body">
        <p>
          The two source records below describe the original demonstration
          curves. Mentioning a mission or instrument does not mean these plotted
          points were processed from its acquisitions. Every plotted point and
          band remains illustrative.
        </p>
        <div className="ec-pair">
          {CITIES.map((city) => {
            const source: DataSource =
              SOURCES[city.id === "tehran" ? "tehranTrend" : "tokyoTrend"];
            return (
              <div key={city.id}>
                <h3>{city.name} illustration</h3>
                <dl className="ec-definition-list">
                  {SOURCE_FIELDS.map(({ key, label }) =>
                    source[key] ? (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>{source[key]}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
                <CityReferences city={city} />
              </div>
            );
          })}
        </div>
        <p>
          City profiles, policy histories, timeline descriptions, comparison
          notes and lessons retain the Ground Truth educational content.
          Published-reference headlines are distinct from the synthetic chart
          values. Status descriptions are historical context, not live
          monitoring. Follow the linked literature and official accounts for
          quantitative interpretation.
        </p>
      </div>
    </details>
  );
}

/** Full /compare content, rendered inside the public shell by the coordinator. */
export function CityComparison() {
  return (
    <div className="ec-comparison">
      <header className="es-wrap ec-heading">
        <h1>
          Tehran and Tokyo.
          <br />
          Different turning points.
        </h1>
        <p className="es-lead">
          Two cities. Different choices about the water beneath them.
        </p>
        <nav className="ec-section-links" aria-label="Comparison sections">
          <a href="#comparison-trends">Explore the curves</a>
          <a href="#comparison-milestones">Historical milestones</a>
          <a href="#comparison-evidence">Compare the evidence</a>
          <a href="#comparison-water">Water &amp; policy</a>
        </nav>
      </header>

      <section
        id="comparison-trends"
        className="ec-section ec-section-scene"
        aria-labelledby="comparison-trend-title"
      >
        <div className="es-wrap">
          <div className="ec-section-intro">
            <h2 id="comparison-trend-title">When the pattern changed.</h2>
            <p>
              Show either city, inspect an illustrated point, or compare the
              shape of the two histories.
            </p>
          </div>
          <TrendExplorer />
          <ComparisonSources />
        </div>
      </section>

      <section
        id="comparison-milestones"
        className="es-wrap ec-section"
        aria-labelledby="comparison-milestone-title"
      >
        <div className="ec-section-intro">
          <h2 id="comparison-milestone-title">
            Move through a century of decisions.
          </h2>
          <p>
            Follow the causes, observations, impacts, policies and recovery.
            Select an event to read its context.
          </p>
        </div>
        <MilestoneTimeline />
      </section>

      <section
        className="ec-section ec-section-context"
        aria-labelledby="comparison-profile-title"
      >
        <div className="es-wrap">
          <div className="ec-section-intro">
            <h2 id="comparison-profile-title">
              The setting beneath the streets.
            </h2>
            <p>
              Different geology, water demand and observation histories shape
              what can be learned from each case.
            </p>
          </div>
          <div className="ec-pair ec-profiles">
            {CITIES.map((city) => (
              <CityProfile city={city} key={city.id} />
            ))}
          </div>
        </div>
      </section>

      <section
        id="comparison-evidence"
        className="es-wrap ec-section"
        aria-labelledby="comparison-table-title"
      >
        <div className="ec-section-intro">
          <h2 id="comparison-table-title">Keep the differences in view.</h2>
          <p>
            Compare each dimension with its rating and explanation alongside it.
          </p>
        </div>
        <details className="ec-disclosure"><summary>Compare all ten dimensions</summary>
        <p className="ec-help" id="comparison-table-help">
          On a narrow screen, scroll the table horizontally to read both cities
          and the interpretation.
        </p>
        <div
          className="ec-table-scroll"
          role="region"
          aria-label="Tehran and Tokyo comparison table"
          aria-describedby="comparison-table-help"
          tabIndex={0}
        >
          <table className="ec-table">
            <caption>
              Ten dimensions of the two case studies. Rates, eras and
              consequences are not interchangeable.
            </caption>
            <thead>
              <tr>
                <th scope="col">Dimension</th>
                <th scope="col">Tehran</th>
                <th scope="col">Tokyo</th>
                <th scope="col">How to compare</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{row.tehran}</td>
                  <td>{row.tokyo}</td>
                  <td>
                    <strong
                      className={`ec-comparability ec-comparability-${row.comparability}`}
                    >
                      {COMPARABILITY_LABEL[row.comparability]}
                    </strong>
                    <p>{row.note}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </details>
      </section>

      <section
        id="comparison-water"
        className="ec-section ec-section-context"
        aria-labelledby="comparison-water-title"
      >
        <div className="es-wrap">
          <div className="ec-section-intro">
            <h2 id="comparison-water-title">
              Measure the change.
              <br />
              Manage the cause.
            </h2>
            <p>
              Read the groundwater histories, expand the policy responses, and
              inspect the evidence of what changed.
            </p>
          </div>
          <div className="ec-pair">
            {CITIES.map((city) => (
              <ManagementHistory city={city} key={city.id} />
            ))}
          </div>
        </div>
      </section>

      <section
        className="es-wrap ec-section ec-lessons"
        aria-labelledby="comparison-lessons-title"
      >
        <div className="ec-section-intro">
          <h2 id="comparison-lessons-title">
            A response takes more than a map.
          </h2>
          <p>
            Five lessons to carry into questions about water management and
            monitoring.
          </p>
        </div>
        <details className="ec-disclosure"><summary>Five lessons for water and monitoring</summary><ol>
          {LEARNINGS.map((lesson) => (
            <li key={lesson.title}>
              <h3>{lesson.title}</h3>
              <p>{lesson.detail}</p>
            </li>
          ))}
        </ol></details>
        <div className="ec-next">
          <Link href="/explore" className="es-action es-action-primary">
            Explore both cities
          </Link>
          <Link href="/#what-we-can-do" className="es-action">
            Return to the response
          </Link>
        </div>
      </section>
    </div>
  );
}
