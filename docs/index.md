# Earthsignal Documentation Hub

Earthsignal combines a public visual story about land subsidence, an optional five-station investigation game, frozen NISAR observations and a detailed scientific workspace. Start with the experience, then follow the methods or engineering path you need.

## Start with the current experience

- [Read the story](https://nasa.r8volt.com/) — follow water, ground motion and satellite echoes through interactive scenes.
- [Play with Echo](https://nasa.r8volt.com/?mode=game#opening) — five hands-on discoveries with optional neural narration.
- [Explore the observations](https://nasa.r8volt.com/explore) — Tehran ground motion, Tokyo context and Lake Mead radar images.
- [Compare Tehran and Tokyo](https://nasa.r8volt.com/compare) — inspect the two case studies and their evidence boundaries.
- [Public experience and verification](public-story.md) — feature integration, engine reuse and validation limits.
- [Neural voice implementation](../voice/README.md) — reviewed cue bank, offline rendering and playback lifecycle.
- [Challenge resources and native SAR processing](challenge-processing.md) — source-specific readers, verified original values, publication and current gates.
- [Advanced scientific workspace](https://nasa.r8volt.com/workspace) — the place-and-question workflow and underlying analysis tools.

The detailed methods, contracts, operational manuals and historical checkpoints remain linked below.

---

## 👥 Guides by Role

### 🌍 Decision Makers & General Users
Understand what was observed, why it matters, and what to verify next without reading raw sensor feeds.

- [Plain-Language Results](plain-language-results.md) — How deterministic explanations translate metrics, caveats, and next steps.
- [Environmental Change & Next Steps](environmental-change.md) — Moving from NISAR backscatter signals to contextual environmental follow-up.
- [Investigate Measurements](analytics.md) — Interactive exploration, thresholds, regions, transects, and historical lake elevation.

### 🔬 Scientists & Analysts
Examine mathematical formulations, sensor calibration, native grids, and empirical validation gates.

- [Scientific Foundation & Data Specifications](science.md) — NISAR L2 GCOV $\gamma^0$ backscatter formulations, subswath masks, and exception schemas.
- [Observatory Methods & Limits](observatory-methods.md) — Evaluation algorithms, gauge models, seasonal baselines, and abstention criteria.
- [Source Registry & Capabilities](source-registry.md) — Implemented provider adapters, access boundaries, and operational limits.
- [Reproducibility & Verification](reproducibility.md) — Exact recipes and receipts for historical water and prepared NISAR study `932485953d57489eb109b90eb34a606b`.
- [Offline Radar Detection](radar-detection.md) — Frozen fixed/empirical/temporal contracts, real native development reproduction and explicit calibration gates.
- [Recorded Water-State History](water-state-history.md) — Observed acquisition counts, unknowns and bounded transition intervals; no interpolated daily hydroperiod.
- [GEOID Real-data Readiness](geoid-development.md) — One frozen Sentinel-1 case, bounded acquisition, explicit missing coverage and withheld flood claims.
- [Water Sampling Sensitivity](water-sampling-sensitivity.md) — Compare visit-weighted and year-weighted summaries, explicit date exclusions, and missing-year withholding; includes a guided fictional example.
- [Mapped Water-Footprint Transitions](water-footprint-transitions.md) — Spatial gains, losses, offsetting net change and unknown support on compatible class-1 maps.
- [Pinned Gauge Information Sets](forecast-information.md) — Receipt cutoffs, complete station-days and future target timing in the existing workspace; no forecast-skill promotion.
- [Sampling & Uncertainty Workspace](sampling-workspace.md) — Guided private experiments, weighted area estimates, separate sampling error and reproducible exports.
- [Software Citation Guidance](../CITATION.md) — Rules for citing Earthsignal software, exact commits, and distinguishing code from upstream data.

### 💻 Software Engineers & Integrators
Inspect system boundaries, local development workflows, and wire protocols.

- [System Architecture](architecture.md) — Service boundaries, process isolation, and state management.
- [API & Wire Contracts](api.md) — Loopback HTTP contracts, HMAC-SHA256 request signing, and payload schemas.
- [Satellite Read Performance](cloud-io.md) — Bounded range reuse, measurement, reproducible benchmarks and scientific parity.
- [Contributing Guide](../CONTRIBUTING.md) — Local workstation setup, quality gates, test execution, and internal standards.

### 🛠️ Systems Operators & Administrators
Deploy, configure, secure, and maintain the production services.

- [Deployment Guide](deployment.md) — Host setup, systemd units, slice resource limits, nginx reverse proxy, and TLS.
- [Operations & Administration](operations.md) — Collaborator account CLI, credential rotation, SQLite backups, and recovery.
- [Troubleshooting & Diagnostics](troubleshooting.md) — Service logging, common HTTP error codes, and recovery procedures.

---

## 🧭 Topic & Capability Index

- **Core Radar Processing**: [science.md](science.md) · [reproducibility.md](reproducibility.md)
- **Environmental Context (Water, Fire, Ecology, Urban)**: [environmental-change.md](environmental-change.md) · [source-registry.md](source-registry.md)
- **Decision Support & Scenarios**: [plain-language-results.md](plain-language-results.md) · [decision-observatory.md](decision-observatory.md)
- **System Internals & Gateway**: [architecture.md](architecture.md) · [api.md](api.md)
- **Deployment & Runbooks**: [deployment.md](deployment.md) · [operations.md](operations.md) · [troubleshooting.md](troubleshooting.md)

---

## 🔬 Research & Project Milestones (Work-in-Progress)

Research recommendations remain proposed until a separate implementation checkpoint reports their acceptance. Historical checkpoints distinguish observed results, limitations and work that remained pending.

- [Implementation Checkpoint](decision-observatory.md) — Decision observatory milestones, worker receipts, and validation gates.
- [Archived Project History](project-history.md) — Repository development history and superseded configurations.
- [Science Engine Research (2026-10-10)](research/science-engine-2026-10-10/INSIGHTS-UPDATE.md) — Exploratory research into expanded analytics and capacity tracking.
- [Free-Data Research & Challenge Fit (2026-10-10)](research/academic-data-2026-10-10/README.md) — Source-checked scientific opportunities, competition fit and unresolved data/validation gates.

- [🧮 Stratified area experiments](stratified-area.md) — sample weights, sampling uncertainty and explicit scientific limits.
