# Earthsignal navigation audit — 2026-10-10

Scope: signed-in existing result → measurements → edited investigation draft, captured fresh at 1022×913 on nasa.r8volt.com. All three screenshots were inspected. No source submissions or assistant calls.

1. [Current workspace before changes](../../images/insights-before-workspace.png) — usable, but the launch action says Inspect evidence while it submits a new processing job. Draft area and result context share one long scroll. Retained domain presets and full explorer are strengths.
2. [Measurements before changes](../../images/insights-before-measurements.png) — measurements expose units and exact population; section shortcuts vanish after jumping. User must scroll back to navigate between brief/history/options. No horizontal page overflow at this viewport.
3. [Edited draft before changes](../../images/insights-before-edited-draft.png) — correctly warns that evidence is for the recorded assessment and offers restore. The warning is above the map and scrolls away, leaving the changed question beside old results. A persistent recorded context is needed.

## Recheck on deployed release `20261010-insights-567b3cf`

1. **Choose / launch — working, clearer.** The action now says Run this investigation. Selecting an existing completed result restores its question, area and dates. The Place & question view retains the shared charcoal/lime style, all four presets, full explorer and deeper controls. Existing tools remain available. [Desktop result](../../images/live-seasonal-desktop.png).
2. **Inspect values / histories — working, linked.** Result navigation stays visible and section targets clear its actual height. Selecting 2024-06-01 links the timeline and USGS inspector to 14300ft³/s, Approved. Display conversion gives the seasonal slope −21.00166m³/s/year, retaining original units and unchanged exports. At390×844 the measured-value table scrolls horizontally inside its focusable region; ArrowRight pans it. The new tooltip stays within the screen (220px wide, bounds111.89–331.89px) and exact values remain in tables. [Mobile seasonal analysis](../../images/live-seasonal-mobile.png).
3. **Change draft / return to evidence — working, explicit.** The recorded question/date and warning remain beside unchanged measurements; Restore result selection restores the draft. At390×844 the bar begins6px from the viewport and Values starts below it. Desktop panel scrolling and mobile page scrolling each keep the context visible. No page-width overflow at checked1022×913 and390×844 sizes. [Desktop edited context](../../images/live-recorded-context-desktop.png), [mobile edited context](../../images/live-recorded-context-mobile.png).

Map recheck: the scientific explorer has one visible map with one plus/minus pair; its retained hidden map also has one pair. Zoom anchors have no text underline. The earlier apparent extra minus was the inherited anchor underline. Current counts do not establish every future map configuration.

Overall flow health: the three inspected steps work and the specific context/reflow defects are resolved. Remaining usability acceptance is representative-user comprehension, touch/screen-reader coverage and broader device checks, not assumed from these screenshots. The independent research/results retain Observed/Derived/Forecast/Scenario distinctions and withhold unsupported current predictions.

Limits: this checks concrete interactions and visible reflow, not WCAG certification, screen-reader completeness, scientific decision accuracy or the planned representative-user comprehension study. The original style/reference and all scientist tools are retained.
