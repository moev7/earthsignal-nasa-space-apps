import sourceReadiness from "@/public/data/challenge/source-readiness.json";
import officialResources from "@/public/data/challenge/official-resources.json";
/** Challenge coverage is not a claim that a source has been downloaded or validated. */
import { type SarSourceId } from "./sar-contract";
export const CHALLENGE_VERSION = "dancing-with-the-sars-2026-11-13";
export const SAR_SOURCES: Array<{
  id: SarSourceId;
  name: string;
  band: string;
  description: string;
  url: string;
  access: string;
}> = [
  {
    id: "nisar",
    name: "NISAR",
    band: "L-band",
    description:
      "Calibrated backscatter and quality-screened ground motion. Product support is checked before processing.",
    url: "https://nisar-docs.asf.alaska.edu/",
    access:
      "Earthdata credentials are required by the science service for native files.",
  },
  {
    id: "radarsat-1",
    name: "RADARSAT-1",
    band: "C-band",
    description:
      "Historical radar acquisitions through EODMS and its ready-product archive.",
    url: "https://registry.opendata.aws/radarsat-1/",
    access:
      "Open Government Licence; availability and calibration metadata checked per product.",
  },
  {
    id: "rcm",
    name: "RADARSAT Constellation",
    band: "C-band",
    description:
      "Public analysis-ready products and authorized archive records, including compact polarization.",
    url: "https://www.asc-csa.gc.ca/eng/satellites/radarsat/access-to-data/about.asp",
    access:
      "Public and vetted holdings differ. Restricted assets are not downloaded by this public adapter.",
  },
  {
    id: "saocom",
    name: "SAOCOM",
    band: "L-band",
    description:
      "CONAE archive and level-specific products for licensed scientific use.",
    url: "https://catalogos.conae.gov.ar/catalogo/catalogoSatSaocomInfo.html",
    access:
      "Archive access and sample downloads have terms. No license is accepted automatically; numerical processing is withheld until a publication-compatible grant and reader are verified.",
  },
  {
    id: "uavsar",
    name: "UAVSAR",
    band: "Airborne L-band",
    description:
      "Numeric ground-projected polarimetric products behind NASA's postcards.",
    url: "https://uavsar.jpl.nasa.gov/education/postcards.html",
    access:
      "Original annotation and numeric grid required; postcards are context, never analytical rasters.",
  },
];
export const CHALLENGE_RESOURCES = [
  {
    id: "earthdata",
    title: "NASA Earthdata Search",
    kind: "discovery",
    source: "nisar",
    url: "https://search.earthdata.nasa.gov/",
    use: "Exact collection and acquisition discovery; provenance for processed studies.",
  },
  {
    id: "asf",
    title: "ASF Vertex",
    kind: "discovery",
    source: "nisar",
    url: "https://search.asf.alaska.edu/",
    use: "Acquisition identity, pair selection and native-product checks.",
  },
  {
    id: "nisar-guide",
    title: "NISAR Data User Guide",
    kind: "method",
    source: "nisar",
    url: "https://nisar-docs.asf.alaska.edu/",
    use: "Versioned product, grid, mask, calibration and access requirements.",
  },
  {
    id: "remote-sensing",
    title: "Introduction to remote sensing",
    kind: "interpretation",
    source: null,
    url: "https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/remote-sensing",
    use: "Spatial support, observation times and measurement uncertainty.",
  },
  {
    id: "sar-intro",
    title: "Introduction to SAR",
    kind: "interpretation",
    source: null,
    url: "https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar",
    use: "Frequency, polarization and scattering explanations linked to the radar lesson.",
  },
  {
    id: "arset",
    title: "NASA ARSET training",
    kind: "method",
    source: null,
    url: "https://appliedsciences.nasa.gov/get-involved/training",
    use: "Reviewed recipes for surface change; training is not an independent measurement.",
  },
  {
    id: "storymaps",
    title: "NISAR StoryMaps",
    kind: "interpretation",
    source: "nisar",
    url: "https://science.nasa.gov/mission/nisar/arcgis-storymaps/",
    use: "Phenomenon-led explanations; original source values remain authoritative.",
  },
  {
    id: "white-papers",
    title: "NISAR applications",
    kind: "method",
    source: "nisar",
    url: "https://science.nasa.gov/mission/nisar/societal-benefits/",
    use: "Scientific questions and application limits for investigation recipes.",
  },
  {
    id: "uavsar-postcards",
    title: "UAVSAR postcards",
    kind: "data",
    source: "uavsar",
    url: "https://uavsar.jpl.nasa.gov/education/postcards.html",
    use: "Trace a postcard to numeric radar grids and their annotations.",
  },
  {
    id: "rcm",
    title: "RCM data",
    kind: "data",
    source: "rcm",
    url: "https://donnees-data.asc-csa.gc.ca/en/dataset/rcm",
    use: "Public and authorized C-band radar holdings; rights checked separately.",
  },
  {
    id: "csa-tutorial",
    title: "CSA Python / QGIS tutorial",
    kind: "method",
    source: "rcm",
    url: "https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial",
    use: "Real wildfire raster examples and reproducible interpretation; code/data licenses reviewed separately.",
  },
  {
    id: "radarsat-1",
    title: "RADARSAT-1 archive",
    kind: "data",
    source: "radarsat-1",
    url: "https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1",
    use: "Historical C-band records and documented analysis-ready assets.",
  },
  {
    id: "saocom",
    title: "SAOCOM catalogue",
    kind: "data",
    source: "saocom",
    url: "https://catalogos.conae.gov.ar/catalogo/catalogoSatSaocomInfo.html",
    use: "CONAE product discovery and licensed native processing path.",
  },
  {
    id: "saocom-access",
    title: "SAOCOM access and registration",
    kind: "access",
    source: "saocom",
    url: "https://www.argentina.gob.ar/noticias/la-informacion-saocom-cada-vez-mas-accesible",
    use: "Explicit archive/license readiness; no automatic agreements or account creation.",
  },
] as const;
export const MAIN_EXPERIENCE = {
  focus: "Tehran subsidence and Tokyo comparison",
  storyHref: "/",
  compareHref: "/compare",
  processingHref: "/workspace?view=sar",
} as const;

export const OFFICIAL_CHALLENGE_RESOURCES = officialResources;

export const SOURCE_READINESS = sourceReadiness;
