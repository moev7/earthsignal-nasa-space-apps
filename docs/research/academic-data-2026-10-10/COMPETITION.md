# Earthsignal and Dancing with the SARs

Assessment date: 10 October 2026. **Earthsignal has credible competitive potential, but there is not enough evidence to call it winner-ready.** This is a coordinator assessment of the present implementation, not a prediction of judging outcomes. No competing submissions were evaluated and no winning probability or numerical judging score is assigned.

## The challenge we found

The 2026 challenge summary asks for an interactive application using **NASA–ISRO NISAR radar observations to track and visualize surface changes**. It permits choosing one or more change types; demonstrating every domain is not required by that summary. The current summary is reproduced by the [Athlone event organizer](https://hackathlone.com/challenges/dancing-with-the-sars). NASA's [Space Apps repository](https://github.com/nasa/spaceapps/discussions/1743) independently identifies the challenge, but that discussion is only a placeholder data question and supplies no additional requirements.

The global challenge page returned fetch errors/HTTP403 in this investigation. An event page on the official Space Apps site states that the complete statements arrive **28 October**. The global 2026 page gives **14–15 November** for the hackathon. Consequently, this is a **summary-level assessment**, not certification against an unreleased complete brief. [Official-site statement schedule](https://www.spaceappschallenge.org/2026/local-events/ramallah/) · [2026 global event page](https://www.spaceappschallenge.org/2026/).

Challenge choice and event choice are separate. The user has confirmed **Dancing with the SARs, virtual Universal Event**. The global2026 page describes that virtual option. No registration or external message was made. The direct production Universal Event page could not be retrieved; a search result on a staging host contained obvious test venue/contact content and was rejected as authoritative event guidance. Universal-specific deadlines, time basis and organizer contact remain to be verified.

## Resolve eligibility before calling this a submission

A **2026 local-event page hosted on the official Space Apps site** explicitly says teams must develop the submitted solution during the hackathon and must not start it beforehand. Earthsignal already has an October development/deployment history. This is a material eligibility concern. The linked page is event guidance, not a retrieved global rulebook or organizer ruling on this particular project; we cannot conclude definitive disqualification or assume an exception. [Published timing guidance](https://www.spaceappschallenge.org/2026/local-events/santiago-dominican-republic/).

Before making a competition build plan, obtain the applicable global rules and an organizer answer about prior work. Describe the existing code and development dates accurately. Do not erase history or represent the present app as built during November. Suggested question, **not sent**: “We have an independently developed, pre-existing EO application. Can we use any of it in the 2026 submission, and if so what prior-work disclosure and event-built contribution are required?” Research and skill preparation are distinct from producing entry assets; an event-specific extension is not automatically permitted either.

Access is another gap. The current repository is private, and processing/studies/downloads require collaborator sign-in. The **2025** judging instructions required unrestricted project links, NASA data use and AI disclosure, and imposed a short video/slide demo limit. Those are useful preparation checks, **not verified 2026 requirements**. Do not change repository visibility, publish private results or disable production authentication during this assessment. If the applicable rules require it, prepare an authorized, sanitized public entry/read-only demonstration while preserving protected operations. [Prior-year judging instructions](https://spaceapps-v2-staging.s3.amazonaws.com/media/documents/Final_Space_Apps_2025_Judging_Guidelines_for_web.pdf).

## How the present app stands

The five familiar judging lenses appear on a **2026 official-site local-event page**. Exact global scoring, weights, demo limits and award categories still need the current global guide. The table below is qualitative judgment grounded in repository evidence, not an official score. [2026 judging lenses](https://www.spaceappschallenge.org/2026/local-events/ajmer/).

| Lens | Present strength | Gap affecting a compelling entry |
|---|---|---|
| Relevance | Actual NISAR GCOV processing, native masks, aligned comparisons, radar maps and pixel/region tools | Make NISAR the first demonstrated investigation. The general water/fire/ecology/urban menu can obscure the mission-specific answer. |
| Validity | Retained input IDs, exact quantity, masks, artifacts and an independently recomputed numerical result | Numerical correctness does not establish flood, deforestation, damage, cause, predictive accuracy or usefulness. Independent environmental reference evidence remains needed. |
| Creativity | Measurement → explanation → limitations → useful next check, with source-linked records and scenarios | Distinctiveness needs a demonstrated user advantage. A dark map, charts, search and an AI explanation are not by themselves a novel scientific method. |
| Impact | Potential to make complicated radar evidence understandable and inspectable | No measured improvement in a real user's task, independent decision pilot or validated operational benefit is established. Define one user and one practical question. |
| Presentation | Polished responsive workspace, charts, scientific explorer and plain-language guide | A concise competition pitch, a frictionless judged path and a memorable environmental case have not been delivered. Reliability must survive provider/auth/network failures. |

Concrete implementation evidence: [front page](../../../README.md), [retained manifest](../../../examples/prepared-study/manifest.json), [numerical reproduction receipt](../../../examples/prepared-study/verification.json), [science definitions](../../science.md), [source capabilities](../../source-registry.md), [plain-language methods](../../plain-language-results.md). The README and methods checkpoint are evidence of implemented scope; some historical science text describes archived forecast versions, so new forecasting claims must follow the current engine rather than those older thresholds.

The retained NISAR study compares **26 June and 30 September 2026**, using track5/frame20, ascending acquisitions and releaseP05023. It reports approximately **−1.46dB** median backscatter difference over **1.0002km²** of common valid pixels with **93.3%** common coverage. These are provisional GCOV source products and a single small Lake Mead-region crop. The HH power ratio is a radar-signal measurement. It is not independently validated proof that water receded, vegetation died or a hazard occurred. The reproduction shares transport/metadata checks with production while recomputing comparison logic separately; it is not an external environmental validation study.

## The most useful competitive improvement

Proposed positioning: **“Turn NISAR surface changes into an understandable, traceable investigation.”** It connects the mission-specific data to a clear user task and allows uncertainty to be part of the story. This is proposed messaging, not a new scientific finding.

Prioritized work, conditional on the eligibility answer and complete brief:

1. **One convincing NISAR case.** Choose a documented surface-change event and a declared user question. Use compatible acquisitions, ideally a short sequence that distinguishes persistence from a one-off change. Show the actual masks/coverage and a stable comparison area. If only two observations are available, describe a two-date comparison rather than sustained tracking.
2. **Evidence that explains the change.** Pair the radar measurement with dated, suitably independent optical/field/official references. Record which inputs are shared. Label a supported interpretation, alternatives and unresolved cause. Do not turn an arbitrary dB threshold into a validated water/damage classifier.
3. **A short, direct experience.** Open the permitted demonstration, select the case, compare dates/layers, inspect the affected patch, understand what is and is not established, export evidence. Ensure the judged path can work without Gemini inference or a live long-running satellite job. A read-only public path would require a separate authorized implementation and release.
4. **Demonstrate wider applicability.** A second, product-compatible case in a different region would make the worldwide ambition more credible. This is a recommendation, not a verified requirement for exactly two countries or change types. A transferable pipeline alone does not prove global environmental accuracy.
5. **Show a measurable user benefit.** Use small formative sessions with task completion, interpretation errors and ability to find evidence/counterevidence. Report who participated and the actual observations. Technical QA or a polished screenshot cannot stand in for this.
6. **Package the entry honestly.** Once current rules are available, document event-built versus prior work, NASA sources, licenses, AI assistance and reproduction steps. Build the required short demo and submission page around one question and one result. Recheck every submitted link with a signed-out browser.

These priorities use existing low-cost/free tools and evidence methods. New GPUs, paid services, full foundation-model training and extra domains are not needed to establish the story. OPERA/TESSERA may later support corroboration or context; they must not replace the NISAR core or supply unsupported real-time claims. Forecasting is an optional later benefit, not a requirement established by the current summary.

## Proposed demonstration outline

This is an outline, not a completed pitch or an approved demo duration:

- A person has a concrete question about a changing landscape.
- Real NISAR acquisitions reveal a measured difference; show dates, source identity and the comparison interactively.
- Explain why the measurement matters, show independent context and expose plausible alternatives.
- Inspect evidence and export a reproducible brief; show what additional observation would resolve the uncertainty.
- End with the demonstrated benefit and the explicit applicability limit.

The prior-year award descriptions suggest **Best Use of Data** or **Best Use of Science** as plausible positioning, conditional on the 2026 categories and stronger evidence. This is a strategic fit judgment, not an award forecast. A strong submission would make a defensible NISAR story understandable within the judges' review window; additional model names do not establish that.

## Evidence limits

Current global challenge/rule pages were inaccessible; indexed official-site 2026 event text and primary organizer summaries were used with their authority limits stated. No organizer approval, competition entry, public release, registration, user-benefit study, new case processing or new prediction model was produced. Complementary browser-adviser access was attempted but the shared preview host disappeared; those gaps are in [consultations.json](consultations.json). Independent repository extraction and source/code critique were separately reviewed by the coordinator. Reassess on October28 and when the applicable event/rules are confirmed.
