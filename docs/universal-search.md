# Scientific search

Open the palette with **⌘K / Ctrl+K**, or **/** outside an editable field.
It searches all loaded catalog observations and completed radar comparisons,
plus the signed-in account's loaded assessment manifests and immutable snapshots.
Individual claims, measurements, source evidence, quality statements and existing
history charts have direct navigation targets. No separate search tab is needed.

Examples:

| Query | Meaning |
| --- | --- |
| `track 85` | Literal words/numbers in indexed metadata |
| `track:85 product:GCOV` | Exact track and product fields |
| `frame:70 direction:DESCENDING` | Exact frame and orbit direction |
| `polarization:HV maturity:provisional` | Actual recorded metadata |
| `date:2026-10-06` | Exact acquisition date or recorded assessment interval endpoint |
| `source:usgs-daily discharge` | Literal discharge entries with that linked source |
| `kind:snapshot history chart` | Existing saved snapshot history charts |
| `saved:true` | Saved observation IDs and account-owned saved scientific work |

All words must match literal contiguous text; there is no scattered-letter fuzzy
matching or inferred event detection. Exact scientific IDs rank before incidental
mentions. Quotes allow phrases and colon-containing IDs. Unknown fields,
malformed quotes, invalid dates and invalid track/frame numbers show errors.

Search filters the complete loaded index before applying a display limit, with a
total and keyboard-accessible **Show more**. This does **not** search all NASA
archives or fetch another catalog product/region automatically. The current
catalog is bounded to 24 scenes per fetch; its region, product and date range
are shown. Completed comparisons may belong to other places or dates. Selecting
an observation outside current explorer filters opens it with a notice and a
return action; collection settings are retained. Scientific type/region actions
explicitly change explorer settings. The Lake Mead optical example is labeled
historical and explicitly resets exploration to its recorded starting context.

Opening a saved measurement/chart/evidence result preserves the editable
investigation area, dates and source choices. Recorded-result context and the
existing draft-mismatch notice distinguish viewing from recalculation. Ancestor
disclosures open and focus moves to the target section. Claims keep their
Observed/Derived/Possible explanation/Forecast/annotation labels; missing values
remain withheld. Source filters on measurements/claims/charts use linked evidence,
not unrelated sources elsewhere in the same assessment. Search changes no
scientific calculations, forecast validity, field accuracy or causal conclusions.

The private index is ephemeral client state built from existing authenticated,
owner-scoped endpoints. Authentication changes clear entries, pending navigation,
selected private results and open queries; stale epoch callbacks are ignored.
There is no private search persistence or external search/AI upload. Local
test fixtures exercise UI behavior; they are not real scientific measurements.

**Find a named place** hands off to the existing place form and focuses its input.
Only pressing **Find** there performs the authenticated provider lookup. Typing
in the palette makes no geocoder requests. Review the place name before sending;
do not submit confidential material. The existing proxy caches queries, identifies
the app, uses a configurable endpoint, and limits combined application traffic
to one request per second. Public Nominatim forbids autocomplete and requires
attribution; see the [official usage policy](https://operations.osmfoundation.org/policies/nominatim/).
No new paid provider or key is required.
