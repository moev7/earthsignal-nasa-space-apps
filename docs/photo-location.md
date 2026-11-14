# 📷 Start from a photo

In **Place & question → Place → Start from a photo**, choose a picture or use
**Take photo** on a supported mobile browser. Check the proposed place, adjust it
on the map if needed, choose dates and select **Confirm location & find radar**.

No saved location? Use the map, the coordinate editor, or **Use where I am now**
if you took the photo at your current location. Device location asks for browser
permission and displays the device's estimated accuracy. Permission denial is
recoverable. Camera capture and GPS metadata depend on the phone, browser and
format. JPEG GPS is supported; HEIC/HEIF, PNG and WebP can use manual location.
JPEG conversion may strip metadata, so converted photos can still need a pin.

Replacing a photo keeps your current preview and chosen location until the new
file can be read. An empty, oversized or unreadable replacement shows an error
without discarding that selection. A successfully read replacement clears the
old location and proposes its own saved GPS, or asks you to choose a location.
Missing or reversed search dates show an explanation beside the affected field;
the search becomes available again when both the location and dates are valid.

The camera may be far from its subject. Saved GPS may be wrong or edited.
The photo's file modification date is never treated as capture time. This
feature locates a search; it does not classify the photo, establish ground truth,
diagnose damage or infer environmental causes.

## Privacy

The photo, filename, other EXIF metadata and preview stay local. There is no
photo-upload endpoint, Gemini submission, persistent browser storage or shared
photo artifact. Closing the photo section, removing the photo, changing accounts
or leaving the page releases the preview URL and invalidates pending reads.
Removing a photo does not undo a place already confirmed into the workspace;
choose another place or reset the explorer to replace that selection.

Opening the optional map requests tiles from OpenStreetMap, revealing the viewed
area to that provider; this is disclosed before opening it. Explicit confirmation
submits the chosen point, dates and product through Earthsignal's public
`/api/scenes` gateway to ASF / NASA Earthdata. Other existing workspace searches
and maps independently request their own data. Point responses use
`Cache-Control: private, no-store`; no photo job or saved photo is created.
Like other HTTP searches, coordinates are visible to the gateway/provider and
may appear in operator access logs. This is not an anonymity or zero-network
guarantee for the application.

## Results and limits

The explorer searches NISAR GCOV records intersecting the confirmed point. It
shows at most 24 returned records, acquisition dates and available previews.
This is a bounded catalog search, not an exhaustive coverage audit or proof that
every asset is readable. No records, an unavailable catalog and a completed
scientific comparison remain separate states.

Comparisons retain existing metadata, release, grid, mask, crop, access and
common-valid-support checks. A small editable starting assessment rectangle is
placed around the point where the existing assessment contract supports it
(latitude −85° to 85°). Its angular size is not a fixed-area measurement or the
photographed subject's footprint. Polar points can be searched while assessment
setup explains its limit and keeps the previous supported area. Rectangles at
±180° are clipped rather than wrapped. Switching questions preserves the area;
choosing a preset removes the custom catalog point. Account changes clear the
photo and point search.

## Implementation and reproducibility

- `lib/photo-location.ts`: pure JPEG SOI/APP1/Exif TIFF IFD0/GPS reader.
- Original file limit: 20 MiB. Read limit: first 256 KiB, locally.
- Bounded entries, directories, segments and reads; no recursive IFD traversal.
- Both byte orders; unsigned DMS rationals and mandatory hemisphere references.
- Zero and exact ±90°/±180° accepted. Conflicting, malformed, out-of-bounds and
  unsupported metadata falls back to manual selection.
- An absent survey datum is an unverified WGS84 assumption. Explicit WGS84
  spellings are accepted; other/malformed datum declarations are refused.
- No analytical resampling, source-study rewrites or science-service activation.

Synthetic fixtures cover signs, zero/boundaries, APP1 escapes, truncation,
duplicate tags, budgets, datum declarations and 2,500 mutated/random headers.
Gateway checks cover exact requests, invalid-point denial, private cache headers,
and empty/error separation. Integration regressions cover semantic query identity
independent of JSON key order and exclusion of unrelated historical studies.

These tests do not establish GPS authenticity, all-phone compatibility, complete
network/telemetry privacy certification, or human comprehension outcomes. Native
camera capture, permission denial and device-location accuracy need actual-device
testing. The planned formative study and scientific validation gates remain open.

Primary references: [browser file selection and capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file),
[IPTC camera versus subject location](https://iptc.org/std/photometadata/documentation/mappingguidelines/),
[ASF NISAR availability](https://hyp3-docs.asf.alaska.edu/nisar-docs/availability-overview/),
[ASF visualization limits](https://hyp3-docs.asf.alaska.edu/nisar-docs/worldview/).

## Local recovery increment — 17 October 2026

Team `earthsignal-continuation-20261017-t3`, coordinator
`earthsignal-t3-coordinator-20261017`, epoch1/revision1. Coordinator implemented
transactional replacement and accessible date recovery. Accepted Codex Luna scout
`b210c28ff77449e6aaa0ac3f98c3e77d` identified selection loss before file rejection.
Accepted independent Codex Sol review `904421d32c984592b81bc7aa2061a17d`
checked the actual component with22 grouped mocked transitions and27 focused
tests. Its missing/impossible-date message-priority finding was reproduced and
corrected; ordering feedback now follows valid calendar dates only.

Final local checks:257 web tests, TypeScript, scoped ESLint, production build
and git whitespace checks pass. T3's in-app browser verified synthetic empty,
oversized and failed reads retain the chosen point; an accepted preview survives
rejection; successful replacement clears the old point; late file/GPS replies
cannot overwrite newer choices; mocked permission denial recovers; account
changes clear private previews. Missing/reversed dates disable confirmation with
linked field errors, and equal dates recover. The390px mobile view has no
horizontal overflow and its date feedback was visually inspected. Synthetic QA
details are retained locally in ignored `outputs/photo-recovery-20261017.json`.
One initial browser assertion sampled before rendering settled; condition-based
checks verified the resulting state. No actual-phone validation is claimed.

The four revision25 consultation receipts in the scientific implementation
checkpoint already cover the unchanged local-photo architecture, privacy,
recovery and async rules. Their current dispositions are recorded as covered,
without claiming new replies. Gemini's fresh in-app tab opened, but snapshot and
evaluate timed out; no Argon selector, answer or replacement model is claimed.
The schema3 eleven-surface plan and actual reviews are recorded in the new team.
Coverage retains ordering and missing delegated-build warnings because the
coordinator implemented this increment directly; it is not a complete ordered
worker-chain certificate. This is a locally verified change, not a new production
deployment or scientific validation milestone.
