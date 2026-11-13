import type { PublicStudy } from "./public-study-registry";
import type { SarSearch, SarStudyRequest } from "./sar-contract";
import { PUBLIC_RADAR_STUDY } from "./public-study-context";

/** Editorial questions route to real evidence, never substitute observations. */
export const STUDY_QUESTIONS: Record<
  string,
  { question: string; learn: string; limit: string }
> = {
  "tehran-sw-2026": {
    question: "Where was ground motion measured in Tehran?",
    learn:
      "Explore the measured motion map, its uncertainty and missing observations.",
    limit:
      "A short, provisional record of relative motion; it does not diagnose building safety.",
  },
  "lake-mead-gcov-2026": {
    question: "Where did the radar echo change between two dates?",
    learn:
      "Compare the original Lake Mead images and inspect their common valid support.",
    limit:
      "Backscatter change is a clue to investigate, not a measurement of water depth or its cause.",
  },
  "tehran-validated-gcov-20261028": {
    question: "How do radar echoes differ within Tehran?",
    learn:
      "Pin two native samples in the validated Tehran observation and compare their recorded returns.",
    limit:
      "One acquisition shows spatial contrast. It cannot establish a change over time or explain a cause.",
  },
  "rcm-manitoba-2025": {
    question: "What can a calibrated radar observation tell us?",
    learn:
      "Inspect the Canadian observation, its original samples and quality-valid coverage.",
    limit:
      "RR is a derived compact-polarization channel. A single acquisition does not establish temporal change.",
  },
  "radarsat-1-arctic-1996": {
    question: "What changes when calibration is not established?",
    learn:
      "Inspect the original source magnitudes and see which comparisons are withheld.",
    limit:
      "Source units are uncalibrated. These source-pixel coordinates are not a geographic map.",
  },
};

export function studyQuestion(study: Pick<PublicStudy, "id" | "notice">) {
  return (
    STUDY_QUESTIONS[study.id] ?? {
      question: "What does this recorded observation support?",
      learn: study.notice,
      limit:
        "Inspect its quantity, dates, validity and original method before drawing a conclusion.",
    }
  );
}

export type SarStartingPoint = {
  id: string;
  studyId: string;
  revision: string;
  label: string;
  question: string;
  meaning: string;
  sourceId: SarStudyRequest["sourceId"];
  product: SarSearch["product"];
  operation: SarStudyRequest["operation"];
  channel: SarStudyRequest["channel"];
  bbox: SarStudyRequest["bbox"];
  start: string;
  end: string;
  pixelWindow?: SarStudyRequest["pixelWindow"];
};

export const SAR_STARTING_POINTS: readonly SarStartingPoint[] = [
  {
    id: "tehran-echo",
    studyId: "tehran-validated-gcov-20261028",
    revision: "1147f1a28f832367",
    label: "One calibrated acquisition · Tehran",
    question: "How does the radar return vary across this place?",
    meaning:
      "GCOV HH backscatter in dB describes returned radar power. One date cannot establish ground motion or temporal change.",
    sourceId: "nisar",
    product: "GCOV",
    operation: "backscatter-observation",
    channel: "HH",
    bbox: [51.285, 35.605, 51.295, 35.615],
    start: "2026-10-28",
    end: "2026-10-28",
  },
  {
    id: "mead-change",
    studyId: "lake-mead-gcov-2026",
    revision: "e80ca8e7fb87b981",
    label: "Two compatible acquisitions · Lake Mead",
    question: "Where did the radar return change between two dates?",
    meaning:
      "A dB difference requires compatible acquisitions and common valid pixels. It does not measure water depth or identify a cause.",
    sourceId: "nisar",
    product: "GCOV",
    operation: "backscatter-change",
    channel: "HH",
    bbox: PUBLIC_RADAR_STUDY.bbox,
    start: PUBLIC_RADAR_STUDY.start,
    end: PUBLIC_RADAR_STUDY.end,
  },
  {
    id: "manitoba-echo",
    studyId: "rcm-manitoba-2025",
    revision: "6cdb4e56ca8172f5",
    label: "Calibrated compact polarization · Manitoba",
    question: "What is recorded in the RR radar channel?",
    meaning:
      "The source-specific RR gamma0 observation is in dB. It is not interchangeable with HH or a measured surface property.",
    sourceId: "rcm",
    product: "GCOV",
    operation: "backscatter-observation",
    channel: "RR",
    bbox: [-99.91, 49.61, -99.9, 49.62],
    start: "2025-02-27",
    end: "2025-02-27",
  },
  {
    id: "arctic-magnitude",
    studyId: "radarsat-1-arctic-1996",
    revision: "6c94b43b33c89944",
    label: "Original uncalibrated magnitude · Arctic",
    question: "What can I inspect without assuming calibration or geocoding?",
    meaning:
      "This operation reads an explicit source-pixel window in source units. The geographic box is discovery context, not the crop's geographic registration.",
    sourceId: "radarsat-1",
    product: "GCOV",
    operation: "native-observation",
    channel: "HH",
    bbox: [-97.501, 75.999, -97.499, 76.001],
    start: "1996-03-04",
    end: "1996-03-04",
    pixelWindow: [3700, 5600, 128, 128],
  },
];

export function sarStartingPoint(id?: string | null) {
  return SAR_STARTING_POINTS.find((point) => point.id === id) ?? null;
}

/** A reproducible handoff is offered only for the exact reviewed revision. */
export function studyStartingPoint(
  study: Pick<PublicStudy, "id" | "revision">,
) {
  return (
    SAR_STARTING_POINTS.find(
      (point) =>
        point.studyId === study.id && point.revision === study.revision,
    ) ?? null
  );
}

export function startingPointHref(point: SarStartingPoint) {
  return `/workspace?view=sar&investigation=${encodeURIComponent(point.id)}#native-investigation`;
}
