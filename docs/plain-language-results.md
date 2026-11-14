# Plain-language results

Earthsignal places **In simple terms** beside recorded assessments, prepared radar, the historical water mosaic and completed scenarios. Four short sections explain what was measured, why it may matter, what cannot be established and the next useful evidence. The original maps, measurements, quality, forecasts, tools and protected artifacts remain available.

`plain-language-1.0.0` is a deterministic presentation rule version. It reads the recorded result and does not change the measurement algorithm, source hashes or archived manifest. Export this explanation downloads the wording version, original numerical values/units/denominators, evidence references, geometry, assumptions and public interpretation references locally. Assessment printing includes the summary and its evidence disclosures; Gemini controls and responses are excluded from the decision PDF.

## Supported explanations and boundaries

| Recorded measurement | Plain meaning | What additional evidence is needed |
|---|---|---|
| Common-valid NDVI/NDMI difference | Vegetation reflected light differently; investigate vegetation/moisture conditions. | Compatible seasons and independent tree-cover or field evidence before attributing deforestation or ecological damage. |
| Landsat surface temperature | The observed ground surface was warmer/cooler, or a single-date surface temperature is available. | Air temperature, humidity, shade and exposure before human heat-risk interpretation. A temperature difference in K has the same numerical size in °C; absolute readings use the offset. |
| DSWx class-1 footprint | A mapped open-water footprint on a date, or matched-population area change. | Gauges, terrain, rainfall, compatible boundaries and accuracy evidence before volume, water retention, flood danger or damage interpretation. |
| Station discharge | Flow past one exact station; endpoints and descriptive seasonal slopes are distinguished. | Approval/gaps, comparable seasons, operations and rainfall before explanation. A historical slope is not a forecast. |
| FIRMS records | Returned thermal-anomaly records, which can have several causes. | Observation age, official incident information and other hot-source context. Zero returned records does not establish no fire or safety. |
| Radar backscatter | A stronger/weaker returned radar signal in the recorded patch. | Additional compatible observations before identifying the cause, damage or whole-lake conditions. |
| What-if scenario | A comparison under chosen inputs/preferences, with original measurements fixed. | Verify assumptions and unknown effects; setting counts are not event probabilities or forecasts. |

Actual acquisition dates and valid populations accompany the explanations. A zero median does not imply all pixels are unchanged. Below 80% common coverage, whole-area interpretation is explicitly withheld; this remains an initial product gate rather than a scientific constant. Unsupported/missing measurements receive a missing-evidence explanation rather than an invented class. The pinned water mosaic retains its filename-date qualification and regional footprint; it is neither a Lake Mead boundary estimate nor current evidence.

## Result-adjacent Gemini

**Ask Gemini about this result** opens the reviewed public question relevant to the displayed measurement. The actual private result is explained deterministically above it. Gemini explains the public science; it does not analyse or receive private quantities, precise areas, uploads, annotations or identities.

The user previews the exact public payload, then explicitly approves that call. The relevant public concept is placed first within the eight-block budget. Existing one-call concurrency, five-user/twenty-global daily limits, 30-second timeout and no paid fallback/retries remain. Gemini selects approved explanation blocks; citations and wording come from authoritative registered records. Unknown, duplicate or out-of-payload IDs are rejected. Question/result/auth changes invalidate visible responses and consent. Model failure leaves the local explanation and analytical workspace usable.

The guide uses one question selector, **Review what’s shared**, and one **Ask Gemini** action. Sources and the exact payload are expandable within the same approval card; Google's free-tier data-use notice remains visible before approval. Every call clears approval and review. A post-hash context check prevents sending a superseded question when the question/account changes or the panel unmounts during hashing. The independently styled card works in both the decision workspace and scientific result detail. The non-AI science library remains accessible without sign-in or a working model.

Provider quota rejection, connection configuration rejection, temporary provider service failure and an unverifiable response have distinct safe error messages. Only HTTP status classifications are retained from rejected provider responses; their body is discarded. Configured readiness is not proof of successful inference. The deployment check on 2026-10-10 reached the catalogue but actual inference returned HTTP 503, so live Gemini answers remain unavailable at this checkpoint.

`public-explanations-1.2.0` adds a station-flow explanation grounded in the [USGS Streamflow and Water Cycle](https://www.usgs.gov/water-science-school/science/streamflow-and-water-cycle). Other source definitions remain in the public registry. This is reviewed application wording, not a claim of independent domain-expert certification.

## Verification

Fixtures exercise sign/zero, missing and nonfinite measurements, unsupported units/references, acquisition versus request dates, low coverage, single-date sampling, temperature offset versus differences, station endpoints/seasonal support, thermal absence, regional historical water, radar patch support, scenario assumptions and Gemini private-field denial. Browser checks must verify evidence disclosure, payload preview/consent, output download, desktop/mobile reflow and continued access to scientific tools. Independent review receipts and deployment outcomes are recorded in `decision-observatory.md`.

Formative comprehension testing with representative decision-makers/responders/scientists remains required. Automated tests and screenshots do not establish user comprehension, classification accuracy, causal attribution, forecast reliability or a safety assessment.
