/** Reviewed public explanations only. Never merge job results, annotations or uploaded geometry here. */
export const PUBLIC_EXPLANATION_VERSION = "public-explanations-1.4.0";
export type PublicBlock = {
  id: string;
  domain: "general" | "water" | "fire" | "ecology" | "urban";
  title: string;
  type: "Derived" | "Possible explanation" | "Scenario";
  text: string;
  evidenceId: string;
  sourceTitle: string;
  url: string;
  limitations: string[];
  hook?: string;
  focusTarget?: PublicProofTarget;
};
const REVIEWED_BLOCKS: PublicBlock[] = [
  {
    id: "claims",
    domain: "general",
    title: "Read the claim label",
    type: "Derived",
    text: "An observation describes a measurement. A derived result applies a stated method. A possible explanation is a hypothesis. A forecast predicts a target using evaluated skill. A scenario explores changed assumptions. A human annotation is an unverified note. These labels do not establish causality.",
    evidenceId: "earthsignal-claim-policy",
    sourceTitle: "Earthsignal scientific method",
    url: "https://nasa.r8volt.com/#evidence-guide",
    limitations: [
      "Local method policy; inspect each measurement's supporting evidence.",
    ],
  },
  {
    id: "coverage",
    domain: "general",
    title: "Missing coverage changes the question",
    type: "Derived",
    text: "A valid-subset measurement describes the pixels actually observed, not automatically the entire selected area. Earthsignal flags coverage below 80% as a presentation convention; coverage above that level still does not establish representativeness of excluded pixels. Coverage, measurement uncertainty, explanation confidence and predictive performance remain separate.",
    evidenceId: "earthsignal-coverage-policy",
    sourceTitle: "Earthsignal coverage policy",
    url: "https://nasa.r8volt.com/#evidence-guide",
    limitations: [
      "80% is a presentation convention, not a universal scientific threshold or permission for a whole-area conclusion.",
    ],
  },
  {
    id: "area",
    domain: "general",
    title: "Mapped area and validated area differ",
    type: "Derived",
    text: "Adding classified pixel areas gives a mapped footprint. A statistically defensible area estimate additionally needs suitable independent reference samples, accuracy assessment and a sampling-aware estimator. A precise-looking mapped number alone does not quantify classification error.",
    evidenceId: "olofsson-2014",
    sourceTitle: "Olofsson et al., 2014",
    url: "https://doi.org/10.1016/j.rse.2014.02.015",
    limitations: [
      "No accuracy-adjusted area is claimed without an appropriate reference sample.",
    ],
  },
  {
    id: "futures",
    domain: "general",
    title: "Forecasts and scenarios answer different questions",
    type: "Scenario",
    text: "A forecast requires independent testing against relevant baselines and a stated validity domain. A scenario answers what could occur under named assumptions; its alternatives do not receive probabilities without supporting evidence. Adaptive plans identify conditions and observations that would prompt reassessment.",
    evidenceId: "rand-robust-decisions",
    sourceTitle: "RAND: Shaping the Next One Hundred Years",
    url: "https://www.rand.org/pubs/monograph_reports/MR1626.html",
    limitations: [
      "Scenario comparison supports deliberation; it does not choose a public policy for the user.",
    ],
  },
  {
    id: "radar",
    domain: "water",
    title: "Radar-signal change needs corroboration",
    type: "Possible explanation",
    text: "A radar backscatter difference measures a change in returned radar power. Moisture, vegetation, surface roughness, viewing conditions and speckle can affect the signal. Compatible acquisition metadata and native aligned grids support comparison, but the sign of a difference alone does not identify water loss, damage or its cause.",
    evidenceId: "asf-gcov",
    sourceTitle: "ASF NISAR GCOV guide",
    url: "https://nisar-docs.asf.alaska.edu/gcov/",
    limitations: [
      "A small radar patch cannot establish whole-lake conditions.",
    ],
  },
  {
    id: "water-extent",
    domain: "water",
    title: "Water extent is a footprint",
    type: "Derived",
    text: "OPERA DSWx water classifications map surface-water presence at their documented spatial support. Cloud, shadow, snow, vegetation and sensor limitations affect usable coverage. Water area, water-surface elevation, discharge and volume are different quantities; converting among them requires additional compatible measurements and geometry.",
    evidenceId: "opera-dswx-s1",
    sourceTitle: "NASA OPERA DSWx-S1 product",
    url: "https://podaac.jpl.nasa.gov/dataset/OPERA_L3_DSWX-S1_V1",
    limitations: [
      "Open-water detection has spatial and revisit limits; no classified footprint is an automatic flood-damage map.",
    ],
  },
  {
    id: "water-options",
    domain: "water",
    title: "Match the scenario to the units",
    type: "Scenario",
    text: "Explore thresholds in a measured gauge elevation or water-area history when suitable accounting inputs are absent. Supply-and-demand accounting needs compatible flow or volume units, time intervals and stated assumptions. Inspect missing observations and the vertical datum before comparing gauge elevations.",
    evidenceId: "usgs-water-api",
    sourceTitle: "USGS Water Data APIs",
    url: "https://api.waterdata.usgs.gov/docs/ogcapi/",
    limitations: [
      "Elevation alone does not establish reservoir volume or downstream discharge.",
    ],
  },
  {
    id: "water-flow",
    domain: "water",
    title: "Water flow describes one measuring station",
    type: "Derived",
    text: "Discharge describes how quickly water passes a measuring station. A daily mean reading, a difference between two days, and a season-matched descriptive slope answer different questions. Rainfall, season, upstream operations and withdrawals may contribute; the flow record alone does not identify their effects. Station flow does not measure reservoir volume, area-wide retained water or flood danger.",
    evidenceId: "usgs-station-flow",
    sourceTitle: "USGS Water Science School: Streamflow",
    url: "https://www.usgs.gov/special-topics/water-science-school/science/streamflow-and-water-cycle",
    limitations: [
      "Inspect station identity, dates, approval status and gaps. A descriptive historical slope is not a forecast or a causal estimate.",
    ],
  },
  {
    id: "water-transitions",
    domain: "water",
    title: "Net change can hide spatial turnover",
    type: "Derived",
    text: "On the same valid pixels of two compatible class-1 indicator maps, net mapped change is gained footprint minus lost footprint. The gain-plus-loss footprint describes how much mapped footprint changed locations, even when those areas offset. Class 1 at both dates does not establish continuous water between observations. Valid zero includes other classes, including partial water, and does not establish dry ground. Masked pixels remain unknown comparisons rather than zero-valued changes.",
    evidenceId: "earthsignal-class1-transitions",
    sourceTitle:
      "Earthsignal class-1 accounting and NASA OPERA DSWx-HLS definitions",
    url: "https://www.jpl.nasa.gov/go/opera/products/dswx-product-suite/",
    limitations: [
      "This is mapped class-1 footprint accounting, not accuracy-adjusted water area, a flood-damage map or causal attribution.",
      "Use the documented product, layer and processing release; unknown release semantics remain withheld.",
    ],
  },
  {
    id: "fire-detection",
    domain: "fire",
    title: "A thermal detection is not a fire perimeter",
    type: "Derived",
    text: "FIRMS detects thermal anomalies within sensor pixels. A location can reflect vegetation fire or another heat source, and a pixel does not identify the exact burning footprint. Official incident perimeters are separate evidence. No detection can also mean that the sensor did not observe a detectable anomaly.",
    evidenceId: "nasa-firms",
    sourceTitle: "NASA FIRMS",
    url: "https://www.earthdata.nasa.gov/es/news/feature-articles/nasa-firms-helps-fight-wildland-fires-near-real-time",
    limitations: [
      "Satellite detections alone do not establish confirmed damage or safe response routes.",
    ],
  },
  {
    id: "fire-age",
    domain: "fire",
    title: "Read incident and forecast times separately",
    type: "Derived",
    text: "Observation time says when the sensor measured a condition. Publication and retrieval times say when records became available and were collected. A weather forecast has its own issue and valid times. Combining these records does not make an old incident observation current.",
    evidenceId: "nws-api",
    sourceTitle: "National Weather Service API",
    url: "https://www.weather.gov/documentation/services-web-api",
    limitations: [
      "Coverage and timeliness depend on the provider and product.",
    ],
  },
  {
    id: "postfire",
    domain: "fire",
    title: "Postfire hazards depend on rainfall assumptions",
    type: "Scenario",
    text: "Published USGS postfire debris-flow assessments describe potential hazards under specified rainfall conditions and model assumptions. They can support examining cascading consequences and overlapping assets. Preserve the assessment's storm assumptions, basin support and publication date; do not treat a conditional hazard as a prediction that a debris flow will occur.",
    evidenceId: "usgs-postfire",
    sourceTitle: "USGS post-wildfire debris-flow assessment collection",
    url: "https://www.usgs.gov/data/post-wildfire-debris-flow-hazard-assessment-pwfdf-collection",
    limitations: [
      "Conditions outside the published assessment are not independently evaluated by Earthsignal.",
    ],
  },
  {
    id: "vegetation",
    domain: "ecology",
    title: "Greenness describes a spectral indicator",
    type: "Possible explanation",
    text: "Vegetation and moisture indices describe reflectance relationships. Clouds, shadows, snow, atmosphere, season and land management can change them. Persistent departures across quality-masked comparable dates warrant investigation, but a greenness change alone does not measure biodiversity or identify ecosystem damage.",
    evidenceId: "nasa-hls",
    sourceTitle: "NASA Harmonized Landsat Sentinel algorithms",
    url: "https://hls.gsfc.nasa.gov/algorithms/",
    limitations: [
      "Attribution and ecological outcomes need suitable independent observations.",
    ],
  },
  {
    id: "landcover",
    domain: "ecology",
    title: "Keep map releases comparable",
    type: "Derived",
    text: "Land-cover products support historical context when definitions, releases and spatial support are compatible. ESA WorldCover's 2020 and 2021 maps use different algorithm versions, so their differences cannot be attributed entirely to actual land change. Independent accuracy evidence remains necessary for validated area estimates.",
    evidenceId: "esa-worldcover",
    sourceTitle: "ESA WorldCover data access and interpretation",
    url: "https://esa-worldcover.org/en/data-access",
    limitations: [
      "Cross-product differences are not automatically real change.",
    ],
  },
  {
    id: "recovery",
    domain: "ecology",
    title: "Recovery needs a time history",
    type: "Derived",
    text: "Temporal segmentation methods such as LandTrendr summarize disturbance and recovery patterns in suitable optical histories. Comparable seasons, quality masking and enough observations matter. A fitted trajectory is a method-derived pattern, not proof of the cause or a guarantee of future recovery.",
    evidenceId: "landtrendr",
    sourceTitle: "US Forest Service LandTrendr research",
    url: "https://research.fs.usda.gov/treesearch/54160",
    limitations: [
      "Earthsignal does not confer decision authority on an unevaluated segmentation or foundation model.",
    ],
  },
  {
    id: "surface-heat",
    domain: "urban",
    title: "Surface temperature is not air temperature",
    type: "Derived",
    text: "Landsat surface-temperature retrievals describe the temperature of the observed surface under documented retrieval assumptions. Clouds, emissivity and observation timing affect interpretation. Surface temperature is distinct from air temperature, personal heat exposure and health outcomes, which need additional measurements and context.",
    evidenceId: "usgs-landsat-st",
    sourceTitle: "USGS Landsat Collection 2 Surface Temperature",
    url: "https://www.usgs.gov/landsat-missions/landsat-collection-2-surface-temperature",
    limitations: [
      "A surface hot spot does not by itself establish human heat risk.",
    ],
  },
  {
    id: "impervious",
    domain: "urban",
    title: "Land-cover indicators inform comparison",
    type: "Derived",
    text: "Annual NLCD supplies compatible US land-cover and fractional-impervious histories at its documented support. These indicators can help compare candidate places, alongside canopy, drainage and infrastructure context. Impervious cover alone does not quantify runoff, flood damage or intervention benefits.",
    evidenceId: "usgs-annual-nlcd",
    sourceTitle: "USGS Annual NLCD product suite",
    url: "https://www.usgs.gov/centers/eros/science/annual-nlcd-product-suite",
    limitations: [
      "Hydrologic effects require an appropriate model and compatible inputs.",
    ],
  },
  {
    id: "urban-options",
    domain: "urban",
    title: "Make planning assumptions visible",
    type: "Scenario",
    text: "Compare candidate footprints against explicit objectives, costs and assumed effects. Unknown costs or benefits remain unknown. Pareto alternatives expose tradeoffs; a weighted ranking requires declared weights. Numerical benefits of a canopy or surface intervention need suitable evidence or clearly labeled user assumptions.",
    evidenceId: "adaptive-pathways",
    sourceTitle: "Deltares adaptive policy pathways",
    url: "https://www.deltares.nl/en/expertise/areas-of-expertise/sea-level-rise/dynamic-adaptive-policy-pathways",
    limitations: [
      "The comparison does not establish causal benefits or choose policy priorities.",
    ],
  },
];
export type PublicProofTarget =
  | "radar-model"
  | "tehran-profile"
  | "lake-mead-difference"
  | "aquifer"
  | "ground-footprint"
  | "policy";
export const PUBLIC_PROOF_ACTIONS: Record<
  PublicProofTarget,
  { href: string; label: string }
> = {
  "radar-model": { href: "/#phase-instrument", label: "Walk the phase probe" },
  "tehran-profile": {
    href: "/explore?proof=profile",
    label: "Draw a ground profile",
  },
  "lake-mead-difference": {
    href: "/explore?study=lake-mead-gcov-2026&proof=difference",
    label: "Probe the two radar dates",
  },
  aquifer: { href: "/#hidden-cause", label: "Try taking and returning water" },
  "ground-footprint": {
    href: "/explore?proof=footprint",
    label: "Inspect the ground beneath a footprint",
  },
  policy: { href: "/#what-we-can-do", label: "Move the policy turning point" },
};
const PRESENTATION: Record<
  string,
  { hook: string; focusTarget: PublicProofTarget }
> = {
  claims: {
    hook: "A beautiful animation can still be an assumption. Read its stamp.",
    focusTarget: "tehran-profile",
  },
  coverage: {
    hook: "A blank patch is a question mark, not a zero.",
    focusTarget: "tehran-profile",
  },
  futures: {
    hook: "The next chapter depends on the assumptions you choose.",
    focusTarget: "policy",
  },
  radar: {
    hook: "A weaker echo is a clue. It does not tell you how deep the lake is.",
    focusTarget: "lake-mead-difference",
  },
  "phase-wrap": {
    hook: "A clock can make a full turn and look unchanged. So can radar phase.",
    focusTarget: "radar-model",
  },
  "ground-motion": {
    hook: "The street can look still while repeated radar visits reveal a change.",
    focusTarget: "tehran-profile",
  },
  "ground-tilt": {
    hook: "A ground estimate cannot inspect the building above it.",
    focusTarget: "ground-footprint",
  },
  "aquifer-memory": {
    hook: "The water can come back while the street stays lower.",
    focusTarget: "aquifer",
  },
  "policy-timing": {
    hook: "Slowing the fall does not give a city its old height back.",
    focusTarget: "policy",
  },
};
REVIEWED_BLOCKS.push(
  {
    id: "phase-wrap",
    domain: "general",
    title: "The orbital duet and the repeating phase clock",
    type: "Derived",
    text: "In the synthetic 35°-incidence, 0.24 m-wavelength lesson, one phase cycle corresponds to 120 mm of line-of-sight range change, about 146.5 mm vertical sinking under the vertical-only assumption. A wrapped phase value omits whole cycles. A smooth noise-free transect with a known still reference illustrates unwrapping; real measurements need connected valid observations, processing and quality checks.",
    evidenceId: "nisar-phase-learning",
    sourceTitle: "NASA NISAR interferometry",
    url: "https://science.nasa.gov/mission/nisar/interferometry/",
    limitations: [
      "Synthetic examples are not acquired imagery. A single matching colour does not establish zero motion. Missing pixels cannot be filled by this demonstration.",
    ],
  },
  {
    id: "ground-motion",
    domain: "general",
    title: "Motion and brightness are separate clues",
    type: "Derived",
    text: "Earthsignal's frozen Tehran GUNW bundle contains relative ground-motion rate estimates in mm/yr from a short provisional record. Its separate Lake Mead GCOV study compares HH radar backscatter in dB on common valid native pixels. The places, dates, processing and quantities are separate. Neither study diagnoses structural safety or independently establishes a cause.",
    evidenceId: "earthsignal-motion-record",
    sourceTitle: "Tehran public source manifest",
    url: "https://nasa.r8volt.com/data/nisar/tehran-sw-2026/manifest.json",
    limitations: [
      "Short-record yearly rates may include seasonal and atmospheric effects; inspect uncertainty and coverage.",
    ],
  },
  {
    id: "ground-tilt",
    domain: "general",
    title: "Uncertain ground is not a structural verdict",
    type: "Derived",
    text: "The footprint layer describes estimated ground tilt beneath mapped outlines, with 560 m local support. Tilt below twice its uncertainty is labelled not_enough_evidence. Bjerrum reference levels and conditional times to them are mathematical ground comparisons, not diagnoses of building safety or collapse forecasts. Neither a large nor an unresolved ground estimate substitutes for qualified structural inspection.",
    evidenceId: "earthsignal-ground-tilt",
    sourceTitle: "Tehran footprint method and category rules",
    url: "https://nasa.r8volt.com/data/nisar/tehran-sw-2026/manifest.json",
    limitations: [
      "Mapped heights may be estimates. No structural or pipe response is measured by the teaching street.",
    ],
  },
  {
    id: "aquifer-memory",
    domain: "water",
    title: "Water and pore space have different memories",
    type: "Possible explanation",
    text: "Groundwater occupies spaces in sediment. Lower pore-water pressure can increase effective stress and compact compressible fine layers. Some compaction can be inelastic, so rising water levels need not recover lost land elevation. The teaching model uses authored normalized controls and seasons, not measured pressures or a calibrated soil law.",
    evidenceId: "usgs-aquifer-memory",
    sourceTitle: "USGS groundwater decline and subsidence",
    url: "https://pubs.usgs.gov/sir/2007/5251/section4.html",
    limitations: [
      "A mechanism illustration alone does not identify the cause at a particular Tehran address.",
    ],
  },
  {
    id: "policy-timing",
    domain: "general",
    title: "Compare the next line, keep the old height",
    type: "Scenario",
    text: "Tokyo combined groundwater controls and other supplies during its historical response. Earthsignal's history curve is an illustration, not a measured Tokyo time series or a causal policy estimate. The separate timing sandbox uses explicitly fictional settling units and steps; an earlier assumed reduction leaves less cumulative future settling but never restores the height already lost.",
    evidenceId: "earthsignal-policy-learning",
    sourceTitle: "Earthsignal Tehran–Tokyo comparison and sources",
    url: "https://nasa.r8volt.com/compare",
    limitations: [
      "The sandbox does not forecast Tehran's response, transfer a policy effect, or assign probabilities.",
    ],
  },
);
export const PUBLIC_BLOCKS: PublicBlock[] = REVIEWED_BLOCKS.map((b) => ({
  ...b,
  ...PRESENTATION[b.id],
  hook: PRESENTATION[b.id]?.hook ?? b.title,
}));
export function proofForQuestion(question: string) {
  const block = PUBLIC_BLOCKS.find((b) => PUBLIC_QUESTIONS[b.id] === question);
  const target = block?.focusTarget;
  return target ? { target, ...PUBLIC_PROOF_ACTIONS[target] } : null;
}
export function publicBlocks(ids: string[]) {
  return ids
    .map((id) => PUBLIC_BLOCKS.find((b) => b.evidenceId === id))
    .filter((b): b is PublicBlock => Boolean(b));
}

/** A closed public question registry prevents typed secrets/identities/areas from leaving the server. */
export const PUBLIC_QUESTIONS: Record<string, string> = {
  "phase-wrap":
    "Why can two different sinking depths have the same radar colour?",
  "ground-motion":
    "How are Tehran ground motion and Lake Mead radar brightness different?",
  "ground-tilt":
    "Can satellite ground tilt tell us whether a building is safe?",
  "aquifer-memory": "Why might refilling groundwater fail to raise the street?",
  "policy-timing": "Can slowing subsidence recover the height already lost?",
  claims: "How do observations, explanations, forecasts and scenarios differ?",
  coverage: "How does missing coverage limit an environmental comparison?",
  area: "How is mapped area different from an accuracy-adjusted area estimate?",
  futures: "How are forecasts different from what-if scenarios?",
  radar: "What can a radar backscatter difference establish?",
  "water-extent":
    "How are water extent, elevation, discharge and volume different?",
  "water-options":
    "What inputs does water supply-and-demand accounting require?",
  "water-flow":
    "What does a change in station water flow mean, and what does it not establish?",
  "water-transitions":
    "Why can zero net water-footprint change hide gains and losses?",
  "fire-detection": "What is a thermal anomaly?",
  "fire-age":
    "How should incident observation and forecast times be interpreted?",
  postfire: "What do published postfire hazard assessments establish?",
  vegetation: "What can vegetation greenness and moisture indices establish?",
  landcover: "Why must land-cover releases be comparable?",
  recovery: "What evidence is needed to describe ecological recovery?",
  "surface-heat":
    "How is Landsat surface temperature different from air temperature?",
  impervious: "What can impervious land-cover indicators establish?",
  "urban-options": "How should planning assumptions and tradeoffs be compared?",
};
export function approvedPublicQuestion(question: string) {
  return Object.values(PUBLIC_QUESTIONS).includes(question.trim());
}

/** Selected public concept first, so the eight-block budget never truncates it. No result argument. */
export function publicAssistantContext(
  domain: PublicBlock["domain"],
  question: string,
) {
  const eligible = PUBLIC_BLOCKS.filter(
    (b) => b.domain === domain || b.domain === "general",
  );
  const selected = eligible.find((b) => PUBLIC_QUESTIONS[b.id] === question);
  return [
    ...(selected ? [selected] : []),
    ...eligible.filter((b) => b !== selected),
  ]
    .slice(0, 8)
    .map((b) => b.evidenceId);
}
