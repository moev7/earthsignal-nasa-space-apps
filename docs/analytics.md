# Investigate measurements

Open [Earthsignal](https://nasa.r8volt.com). Historical water measurements are public. Sign in with an operator-provisioned collaborator account to inspect completed radar comparisons and their protected downloads.

## Where did backscatter change?

1. Open observation filters and select **Radar comparison**, then select a completed comparison. Its acquisition dates, coverage and source provenance remain beside the result.
2. Switch **Before**, **After**, **Difference** and **Excluded pixels**. Before/after share a brightness scale; the difference legend is centred on zero.
3. Choose **Draw region**, click at least three vertices, then **Finish region**. The region includes native pixel centres within its boundary. **Reset** returns to the full processed crop.
4. Inspect valid area and the distributions. Before, after and difference histograms use the same common-valid population. The threshold partitions that area into increased, decreased and within-threshold backscatter. Adjust the dB threshold and press **Apply** to recalculate.

These threshold categories are descriptive measurements. They do not establish significance, identify a cause or classify damage. Speckle, vegetation, soil moisture and acquisition conditions can affect the signal. The analysis uses native exported float32 GeoTIFF values, so its rounding can differ slightly from the original processing summaries calculated in float64.

## Where to inspect next

Completed native analyses now include **Where to inspect next**. The first three
candidate windows appear initially; expand the list to see up to twelve. Each
entry gives its reason, brighter/fainter counts, usable and unknown support,
nominal projected footprint area, and the strongest selected native pixel's
row, column and location. **Locate and inspect** focuses the map and probes that
exact coordinate using the displayed result's recorded boundary and cutoff. It
does not apply unfinished slider or drawing edits.

The method `native-inspection-windows-v1` groups the native grid into 32 × 32
cell windows anchored at the crop origin. Within the selected area, it uses
only finite common-valid differences. Strictly greater than the positive cutoff
or less than its negative counts as an excursion; equality remains within it.
Order is descending excursion count, then descending absolute peak difference,
then ascending native window row and column. Representative-pixel ties use
native row and column order. These fixed windows are browsing groups, not
detected objects, water-change classes or event boundaries. Ranking is heuristic;
no calibrated confidence, significance or improved human decision is established.

Counts include all candidate windows and any omitted from the bounded list.
No usable support withholds the list; no excursions means no usable pixels
exceeded this cutoff, with below-cutoff and unknown-area changes unresolved.
Projection failure keeps the native evidence and disables locating that entry.
Before assigning a cause, inspect the original before/after/exclusion layers and
obtain compatible dated independent evidence. JSON and CSV include the complete
loaded list, ranking policy, native windows and unrounded coordinates. Results
from an earlier service without this optional field explicitly show inspection
locations as unavailable.

The frozen [real NISAR development receipt](../examples/native-radar-development/inspection-receipt.json)
and offline runner `python -m service.benchmarks.native_inspection` reproduce
the original selected-area signal counts using pinned TIFF/NPZ bytes. The runner
uses the optional Rasterio test reader; it does not install a new production
dependency, alter the original study or establish environmental accuracy.

## Inspect a pixel or profile

**Inspect pixel** reads the next clicked location. **Draw transect** reads 128 positions between two clicked endpoints. Invalid or outside-crop samples remain missing; the profile preserves gaps. Distances are cumulative spherical approximations along the sampled WGS84 line. Point and transect probes use the full crop's common-valid mask independently of a drawn region.

**CSV** exports statistics, histogram bins and samples. **JSON** also includes your loaded annotations. Both preserve the selection and analytical provenance. Original GeoTIFFs and the processing manifest remain separate protected downloads beneath the result.

## Record a hypothesis

Open **Annotations**, select a hypothesis label and save a note. Notes are private to their creator, including on the shared prepared study. Each append receives a version; the maximum is 100 notes per owner and comparison. These are unverified human hypotheses, with no automatic training or causal claim. Failed loads and saves have explicit retry controls.

## Explore water history

Select the Lake Mead water study and use **Water over time**. This panel plots observed historical gauge elevation in feet, a different quantity from the satellite water-class area above it. Choose a historical cutoff and a chart window. Dense views preserve extrema; exported observations retain their exact values. Missing readings are excluded, with visible chart gaps. The archived source does not specify a vertical datum.

Expand **Forecast experiment** to inspect a seven-day projection from the chosen historical cutoff. The model fits the preceding 28 observed days. Twenty earlier weekly origins calibrate empirical error bands; twelve later origins test 84 subsequent observations against a persistence baseline. Forecasts require 365 consecutive observations, at least 10% lower validation mean absolute error than persistence, and at least 75% validation band coverage. Otherwise the forecast is withheld.

The dataset ends on 2023-09-18. These are retrospective experiments, not forecasts for today. Reservoir operations and weather can change the trajectory, and empirical bands do not guarantee future coverage. **Model evidence & learning** exposes the method and a JSON export of validation predictions, metrics and source identity. CSV rows explicitly distinguish `observed` from `predicted` values.

Universal search exposes contextual commands for pixel inspection, region analysis, transects and water history. Commands operate on the selected compatible observation in the same workspace.

## Assessment workflow and reported-summary comparison

Place & question keeps **Inspect the evidence** at the top of the controls. Question guidance states what the current engine can establish before submission. The overview exposes recorded acquisition dates, measured quantities and separate quality dimensions; each quality indicator opens its evidence disclosure.

Changing the draft place, dates or question keeps the recorded result clearly labelled. **Restore recorded selection** restores its exact area and period. Snapshots restore their recorded question and dates too.

Expand **Compare with another assessment** to select another completed assessment from your own collection. Differences are reported only for matching area/domain/question/method, quantity definitions, units, populations, source versions, spatial support and mask methods, with measurement/coverage quality recorded and common coverage at least80%. Otherwise each row explains the abstention. This is a comparison of reported summaries, not a newly aligned common-pixel change measurement, significance test or causal explanation. The JSON export includes both complete evidence manifests and comparison decisions.
