# Science engine research package — 10 October 2026

Start with [the active free-now scope](FREE-NOW.md), which reflects the user's latest constraint: immediately available resources and no additional spending. The broader [scientific roadmap](REPORT.md) and [additional methods and data](EXTENSIONS.md) remain supporting research, covering more than 7,500 words of engine-specific research and recommendations.

The subsequent [scientific-insights update](INSIGHTS-UPDATE.md) implements seasonal station slopes, forecast-band diagnostics and linked navigation, and measures current-host calculation capacity. It also specifies a stronger-host experiment under the user's later request to consider more processing power; purchases remain unapproved. [Navigation audit](NAVIGATION-AUDIT.md) · [capacity receipt](capacity-2026-10-10.json).

- [Bibliography](BIBLIOGRAPHY.md): 60 non-GitHub source URLs across papers, official documentation and books; includes multiple pages of some works.
- [Machine-readable source inventory](sources.json): sources used, access depth and document locations.
- [Repository snapshot](repositories.json): 38 successfully inspected canonical repositories and four failed candidate paths; metadata, redirects, licenses and inspected README URLs. Not installation/benchmark certification.
- [Pinned public source evidence](public-source-evidence.json): 38 HEAD references, 37 matching README snapshots, and five matching selected code files.
- [Claim/source-section receipts](claim-evidence.json): consequential claims, actual source sections and access limits.
- [Registered citation metadata](citation-metadata.json): DOI checks, access failures and the corrected citation mismatch.
- [Synthetic audit script](audit_experiments.py) and [receipt](audit-experiments.json): five counterexamples for existing numerical gates.
- [Browser consultation receipt](browser-consultation.json): actual Perplexity Free consultation, public brief, verified sources and coordinator verdict.
- [Review and handoff record](REVIEW.md): independent review outcomes and final artifact checks.

Run the synthetic audit from the repository root:

    service/.venv/bin/python docs/research/science-engine-2026-10-10/audit_experiments.py

It writes only the research receipt. These experiments demonstrate software behavior on constructed inputs; they are not field validation or estimates of real-world model performance.

Research scope: improve scientific foundations and define implementation priorities. Production code, enabled methods, data services, authentication and deployment are not changed by this package.
