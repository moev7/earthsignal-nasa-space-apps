# Comparison restoration evidence

Assignment: `earthsignal-public-ux-20261109`, `comparison_restorer`, revision 7.
Write scope: `features/public-story/comparison/**` only.

## Integration contract

`comparison/index.ts` exports `CityComparison` and `TokyoStory`.

- `CityComparison` supplies the complete comparison body, including its h1, inside the existing `PublicFrame` for `/compare`.
- `TokyoStory` is a manual, interactive Tokyo history embed for the main story response chapter. It does not need a story provider, animation loop, map, or network data.
- Each component imports the shared `comparison.css`. Every selector is scoped beneath `.es-public` and uses the public dark tokens.
- City profile map links use `/explore?city=tehran` and `/explore?city=tokyo`, as agreed with the coordinator.

## Exact source parity mapping

Reference root: `/tmp/earthsignal-ground-truth-reference/ground-truth/src`.
Runtime data imports use `features/ground-truth/data` without copying or changing factual values.

| Original source                                                           | Restored surface                                                                        | Evidence retained                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages/Compare.tsx`, `data/cities.ts`                                     | `CityComparison.tsx` → `CityProfile`                                                    | Both cities' names, regions, countries, taglines, overviews, six environmental-context fields each, published-reference headline, all five subsidence-context fields each, five causes each, four observation-source descriptions each. Deeper context uses native details.                               |
| `components/charts/TrendChart.tsx`, both `CaseCity.trend` arrays          | `ComparisonCharts.tsx` → `TrendExplorer`, `IllustratedPlot`, `PointReading`; `model.ts` | All 11 Tehran and 15 Tokyo source points, exact years/rates/uncertainties, positive sinking magnitude, bands clipped at zero. No numerical interpolation, resampling or generated measurements. Native SVG joins the illustrative points.                                                                 |
| Original chart tooltip / user-requested series controls                   | `TrendExplorer`                                                                         | Independent city toggles, band toggle, pointer inspection, native point-index slider with year-valuetext, year select and previous/next buttons. Missing city/year samples explicitly remain missing. Both-series-hidden state stays usable.                                                              |
| `components/charts/TimelineScrubber.tsx`, both `CaseCity.timeline` arrays | `ComparisonCharts.tsx` → `MilestoneTimeline`; `model.ts`                                | All 13 events, full source descriptions, five event kinds, shared chronological axis, reached/unreached markers, native annual slider, selectable marker buttons, event select and previous/next buttons. City/source-index identity keeps both Tokyo 1962 entries independently selectable.              |
| `data/comparison.ts`                                                      | `CityComparison.tsx` → semantic comparison table                                        | All ten dimensions, both city cells, every comparability label and every original note. Focusable horizontal scrolling retains the full table on narrow screens.                                                                                                                                          |
| `CaseCity.groundwater`, `policies`, `evidenceAfterIntervention`           | `CityComparison.tsx` → `ManagementHistory`                                              | Both groundwater summaries, all eight history phases, eight policy records and eight evidence items. History is initially open; policies/evidence use native details.                                                                                                                                     |
| `data/stories.ts` → `LEARNINGS`                                           | `CityComparison.tsx` → lessons                                                          | All five exact titles and details.                                                                                                                                                                                                                                                                        |
| `data/satellites.ts` → `SOURCES.tehranTrend`, `SOURCES.tokyoTrend`        | `CityComparison.tsx` → `ComparisonSources`                                              | Both source records: platform, sensor, provider, illustrated period, processing description, resolution, limitations, confidence, demo state, demonstration provenance; optional attribution is rendered if present.                                                                                      |
| Existing public source links, `data/tehranStory.ts` → `CITATIONS`         | Profiles, management evidence and source details                                        | Mahmoudpour (2013), Moradi (2023), Japan Ministry of the Environment and JICA links reused. No new claims or acquisition imagery are invented.                                                                                                                                                            |
| `TOKYO.trend`, `TOKYO.timeline`, groundwater/evidence/source records      | `TokyoStory.tsx`                                                                        | All 15 Tokyo points/bands; historical peak/after-controls buttons; manual slider over source point/event years; all seven events in a chronological native select; distinct peak and Building Water Law entries in 1962; source details. A 1956 event selection correctly has no illustrated trend point. |

Synthetic status appears in each figure header, SVG title/description, persistent plot label, point readouts and caption. Detailed provenance is in disclosures; there is no measured Tokyo curve or groundwater hydrograph.

## Checks run

- `npx eslint features/public-story/comparison --max-warnings 0`: passed, exit 0.
- `npm run typecheck -- --incremental false`: passed, exit 0. Incremental output is disabled to avoid writing outside ownership.
- `npx tsx --test features/public-story/comparison/comparison.test.ts`: passed, 3 tests, 0 failures. The DOM test exercises series/band toggles, both 1962 marker selections, chart/year selectors, native range events, Tokyo milestone selections and peak/after-controls buttons. It verifies all context, causes, observation sources, policy effects, history, evidence and lesson text, plus all ten table rows.
- `npx tsx -e` with `assert.deepEqual` of both full city records and `COMPARISON_ROWS` against their original reference modules: passed. Output: `cityRecords: exact original parity; trendPoints: tehran 11, tokyo 15; milestones 13; comparisonRows 10; policies 8; historyPhases 8; evidenceItems 8; lessons 5`.
- `npx tsx -e` with deep equality for both trend `DataSource` records and exact equality of the full `LEARNINGS` declaration read from both files: passed.
- DOM resize-observer fixture from width 1100 to 320: passed; SVG geometry reflows to a `0 0 320 350` viewBox. This checks geometry only, not browser visual layout.

## Remaining verification and source caveat

The coordinator owns route/story integration, root build/full tests, real desktop/mobile browser verification and independent acceptance. Those are not claimed by this worker.

The inherited Tehran 2003 milestone incorrectly included “Sentinel-era”. The coordinator corrected this one description to distinguish the early radar record from Sentinel-1's later observations. ESA's [Sentinel-1A launch announcement](https://www.esa.int/Newsroom/Press_Releases/Europe_lofts_first_Copernicus_environmental_satellite) dates its launch to 3 April 2014. This documented copy correction is the exception to exact city-record parity; curve values, dates, event identities and counts are unchanged. Case-study status and policy-effect prose is inherited educational context, not independently revalidated live agency data.
