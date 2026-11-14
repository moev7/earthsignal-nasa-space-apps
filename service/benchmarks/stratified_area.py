"""Pure experimental categorical area estimation under a declared sampling design.

This module accepts nominal equal-area cells and explicitly supplied outcomes.
It does not select samples, prove probability selection, inspect rasters, adapt
image reviews, establish field truth, or estimate map accuracy. No native CRS,
network, file IO, classifier, confidence interval or reference-error model is
involved. Invalid inputs raise ValueError; incomplete valid evidence is retained
in a detached, hashed artifact with estimates withheld.
"""
from copy import deepcopy
import hashlib
import json
import math
import re
import unicodedata

SCHEMA_VERSION = 1
METHOD_VERSION = "stratified-srswor-equal-area-v1"
DESIGN_KIND = "stratified-area-design"
OUTCOMES_KIND = "stratified-reference-outcomes"
ARTIFACT_KIND = "stratified-area-estimate"
MAX_BYTES = 2 * 1024 * 1024
MAX_STRATA = 64
MAX_CELLS = 1_000_000
MAX_SAMPLES = 320
MAX_CLASSES = 8
MIN_CELL_AREA_M2 = 1e-12
MAX_CELL_AREA_M2 = 1_000_000
_HASH = re.compile(r"[0-9a-f]{64}\Z")
STATES = ("known", "unreviewed", "reviewed_unobservable",
          "reviewed_unknown_visibility", "reviewed_observable_unknown")
LIMITATIONS = (
    "Experimental estimates are conditional on the declared stratified simple random sampling "
    "without replacement design, nominal equal-area frame and supplied mutually exclusive outcomes.",
    "Hashes detect revisions; they do not prove probability selection, frame coverage, identities, "
    "qualified reference observations, target validity or field truth.",
    "responseTarget.sha256 is a supplied frozen pin, matched exactly to responseTargetHash; "
    "no target digest algorithm or independent authentication is inferred.",
    "Any incomplete selected outcome or unsampled positive stratum withholds all class estimates; "
    "respondents are never renormalized and unknown is never a class.",
    "Noncensus singleton strata allow point estimates but make the entire sampling covariance "
    "and all sampling standard errors non-estimable; partial variances are not reported.",
    "Zero estimated sampling standard error for homogeneous samples does not prove population "
    "certainty absent a census. A census removes sampling error only for the declared frame/outcomes.",
    "Reference bias/error, coverage, time mismatch and projection/nominal-area uncertainty "
    "are not included in sampling standard errors and have not been quantified.",
    "No confidence intervals, kappa, map accuracy, voting or environmental calibration are provided.",
    "Numbers use binary64 arithmetic with rounding. The declared minimum cell area is an "
    "engineering range guard for representable area/covariance, not a scientific resolution threshold.",
)


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _keys(value, keys, name):
    _require(type(value) is dict and set(value) == set(keys), f"{name}: exact fields required")


def _integer(value, low, high, name):
    _require(type(value) is int and low <= value <= high, f"{name}: integer out of bounds")


def _text(value, maximum, name):
    _require(type(value) is str and 0 < len(value) <= maximum and value == value.strip(),
             f"{name}: nonempty trimmed text required")
    _require(all(c == " " or unicodedata.category(c)[0] not in "CZ" for c in value),
             f"{name}: control/separator text forbidden except ordinary space")


def _hash(value, name):
    _require(type(value) is str and _HASH.fullmatch(value) is not None,
             f"{name}: lowercase SHA-256 required")


def _canonical(value, limit=MAX_BYTES):
    """Bound strict sorted compact UTF-8 JSON before copying untrusted inputs."""
    nodes = 0
    text_bytes = 0

    def visit(item, depth):
        nonlocal nodes, text_bytes
        nodes += 1
        _require(depth <= 16 and nodes <= 100_000, "JSON structure too large/deep")
        if type(item) is str:
            _require(len(item) <= limit, "canonical JSON exceeds byte limit")
            try:
                text_bytes += len(item.encode("utf-8"))
            except UnicodeError as exc:
                raise ValueError("invalid Unicode text") from exc
            _require(text_bytes <= limit, "canonical JSON exceeds byte limit")
        elif type(item) is dict:
            for key, val in item.items():
                _require(type(key) is str, "JSON keys must be strings")
                visit(key, depth + 1)
                visit(val, depth + 1)
        elif type(item) is list:
            for val in item:
                visit(val, depth + 1)
        elif type(item) is float:
            _require(math.isfinite(item), "nonfinite JSON number")
        elif type(item) is int:
            _require(item.bit_length() <= 4096, "JSON integer too large")
        else:
            _require(item is None or type(item) is bool, "unsupported JSON type")

    visit(value, 0)
    encoded = bytearray()
    encoder = json.JSONEncoder(sort_keys=True, separators=(",", ":"),
                               ensure_ascii=False, allow_nan=False)
    for piece in encoder.iterencode(value):
        chunk = piece.encode("utf-8")
        _require(len(encoded) + len(chunk) <= limit, "canonical JSON exceeds byte limit")
        encoded.extend(chunk)
    return bytes(encoded)


def _digest(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _validate_design(design):
    _keys(design, ("schemaVersion", "kind", "methodVersion", "frameId", "frameHash",
                   "cellAreaM2", "areaBasis", "classes", "responseTarget", "strata"), "design")
    _integer(design["schemaVersion"], 1, 1, "design schemaVersion")
    _require(design["kind"] == DESIGN_KIND, "unsupported design kind")
    _require(design["methodVersion"] == METHOD_VERSION, "unsupported methodVersion")
    _text(design["frameId"], 128, "frameId")
    _hash(design["frameHash"], "frameHash")
    area = design["cellAreaM2"]
    _require(type(area) in (int, float) and MIN_CELL_AREA_M2 <= area <= MAX_CELL_AREA_M2 and math.isfinite(area),
             "cellAreaM2: finite nonboolean number in [1e-12, 1000000] required")
    _require(design["areaBasis"] == "nominal-equal-area-cells", "unsupported areaBasis")
    classes = design["classes"]
    _require(type(classes) is list and 1 <= len(classes) <= MAX_CLASSES, "classes: require 1..8 IDs")
    for name in classes:
        _text(name, 128, "class ID")
        _require(name.casefold() != "unknown", "unknown is not an estimable class")
    _require(len(set(classes)) == len(classes), "duplicate class ID")
    target = design["responseTarget"]
    _keys(target, ("id", "version", "definition", "sha256"), "responseTarget")
    for key in ("id", "version", "definition"):
        _text(target[key], 4096 if key == "definition" else 128, f"responseTarget {key}")
    _hash(target["sha256"], "responseTarget sha256")
    strata = design["strata"]
    _require(type(strata) is list and 1 <= len(strata) <= MAX_STRATA, "strata: require 1..64 strata")
    stratum_ids = set()
    selected = {}
    population = 0
    for stratum in strata:
        _keys(stratum, ("id", "N", "sampleIds"), "stratum")
        _text(stratum["id"], 128, "stratum ID")
        _require(stratum["id"] not in stratum_ids, "duplicate stratum ID")
        stratum_ids.add(stratum["id"])
        _integer(stratum["N"], 0, MAX_CELLS, "stratum N")
        ids = stratum["sampleIds"]
        _require(type(ids) is list and len(ids) <= min(stratum["N"], MAX_SAMPLES),
                 "sampleIds: list with n <= N and <= 320 required")
        for sample_id in ids:
            _text(sample_id, 128, "sample ID")
            _require(sample_id not in selected, "duplicate selected sample ID")
            selected[sample_id] = stratum["id"]
        population += stratum["N"]
    _require(1 <= population <= MAX_CELLS, "total population: require 1..1000000 cells")
    _require(len(selected) <= MAX_SAMPLES, "total sample count exceeds 320")
    return population, selected


def _validate_outcomes(design, outcomes, selected, design_hash):
    _keys(outcomes, ("schemaVersion", "kind", "designHash", "responseTargetHash", "records"), "outcomes")
    _integer(outcomes["schemaVersion"], 1, 1, "outcomes schemaVersion")
    _require(outcomes["kind"] == OUTCOMES_KIND, "unsupported outcomes kind")
    _hash(outcomes["designHash"], "designHash")
    _hash(outcomes["responseTargetHash"], "responseTargetHash")
    _require(outcomes["designHash"] == design_hash, "designHash mismatch")
    _require(outcomes["responseTargetHash"] == design["responseTarget"]["sha256"], "responseTargetHash mismatch")
    records = outcomes["records"]
    _require(type(records) is list and len(records) == len(selected), "exactly one outcome per selected sample required")
    by_id = {}
    for record in records:
        _keys(record, ("sampleId", "stratumId", "status", "visibility", "label"), "outcome record")
        _text(record["sampleId"], 128, "outcome sampleId")
        _text(record["stratumId"], 128, "outcome stratumId")
        sample_id = record["sampleId"]
        _require(sample_id in selected and sample_id not in by_id, "foreign or duplicate outcome sampleId")
        _require(record["stratumId"] == selected[sample_id], "outcome stratumId mismatch")
        _require(type(record["status"]) is str and record["status"] in ("reviewed", "unreviewed"), "invalid outcome status")
        _require(type(record["visibility"]) is str and record["visibility"] in ("observable", "unobservable", "unknown"), "invalid visibility")
        label = record["label"]
        _require(label is None or (type(label) is str and label in design["classes"]), "label must be a declared class or null")
        if record["status"] == "unreviewed":
            _require(label is None and record["visibility"] == "unknown", "unreviewed requires null label and unknown visibility")
        elif record["visibility"] != "observable":
            _require(label is None, "nonobservable reviewed outcome requires null label")
        by_id[sample_id] = record
    return by_id


def _counts(records, classes):
    counts = {"total": 0, "known": 0, "unknown": 0,
              "byStatus": {"reviewed": 0, "unreviewed": 0},
              "byVisibility": {v: 0 for v in ("observable", "unobservable", "unknown")},
              "byState": {s: 0 for s in STATES}, "knownLabelCounts": {k: 0 for k in classes}}
    for record in records:
        if record["status"] == "unreviewed":
            state = "unreviewed"
        elif record["visibility"] == "unobservable":
            state = "reviewed_unobservable"
        elif record["visibility"] == "unknown":
            state = "reviewed_unknown_visibility"
        elif record["label"] is None:
            state = "reviewed_observable_unknown"
        else:
            state = "known"
            counts["knownLabelCounts"][record["label"]] += 1
        counts["total"] += 1
        counts["byStatus"][record["status"]] += 1
        counts["byVisibility"][record["visibility"]] += 1
        counts["byState"][state] += 1
    counts["known"] = counts["byState"]["known"]
    counts["unknown"] = counts["total"] - counts["known"]
    return counts


def estimate_area(design, outcomes):
    """Return detached JSON-safe estimates and conditional sampling uncertainty.

    designHash is SHA256(sorted compact UTF-8 JSON of the entire design, with
    ensure_ascii=False and allow_nan=False). The supplied target pin must match
    outcomes.responseTargetHash. Array order remains part of input provenance;
    numerical quantities follow declared class/stratum order. Combined canonical
    inputs and canonical output (including artifactHash) each have a 2MiB bound.

    With all positive strata sampled and every selected outcome known, estimates
    use W_h=N_h/N, p_hk=x_hk/n_h and p_k=sum(W_h*p_hk). SRSWOR categorical
    covariance is sum(W_h**2*(1-n_h/N_h)/(n_h-1)*(diag(p_h)-p_h*p_h.T)).
    Census contributions are zero, including 1/1; noncensus singletons withhold
    the entire covariance. No reference uncertainty is folded into sampling SE.
    """
    _canonical({"design": design, "outcomes": outcomes})
    population, selected = _validate_design(design)
    design_hash = _digest(design)
    by_id = _validate_outcomes(design, outcomes, selected, design_hash)
    classes = design["classes"]
    counts = _counts(by_id.values(), classes)
    unsampled = [s["id"] for s in design["strata"] if s["N"] > 0 and not s["sampleIds"]]
    singletons = [s["id"] for s in design["strata"] if len(s["sampleIds"]) == 1 < s["N"]]
    point_available = not unsampled and counts["unknown"] == 0
    covariance_available = point_available and not singletons
    strata = []
    for s in design["strata"]:
        size, n = s["N"], len(s["sampleIds"])
        local_counts = _counts((by_id[sample_id] for sample_id in s["sampleIds"]), classes)
        reasons = [state for state in STATES[1:] if local_counts["byState"][state]]
        if size and not n:
            reasons.append("unsampled-positive-stratum")
        ph = [local_counts["knownLabelCounts"][k] / n for k in classes] if point_available and n else None
        strata.append({"id": s["id"], "N": size, "n": n, "weight": size / population,
                       "selectionProbability": n / size if size else None,
                       "expansionWeight": size / n if n else None,
                       "sampleIds": list(s["sampleIds"]), "counts": local_counts,
                       "classProportions": ph, "pointWithholdingReasons": reasons,
                       "samplingVarianceStatus": ("empty-stratum" if not size else
                           "withheld" if not point_available else
                           "non-estimable" if s["id"] in singletons else "estimable"),
                       "isCensus": n == size})
    proportions = ([math.fsum(s["weight"] * s["classProportions"][k]
                             for s in strata if s["N"]) for k in range(len(classes))]
                   if point_available else None)
    covariance = None
    if covariance_available:
        covariance = [[math.fsum(
            s["weight"] ** 2 * (1 - s["selectionProbability"]) / (s["n"] - 1)
            * ((s["classProportions"][i] if i == j else 0)
               - s["classProportions"][i] * s["classProportions"][j])
            for s in strata if s["n"] >= 2 and not s["isCensus"])
            for j in range(len(classes))] for i in range(len(classes))]
    frame_area = population * design["cellAreaM2"]
    area_covariance = ([[value * frame_area ** 2 for value in row] for row in covariance]
                       if covariance_available else None)
    estimates = [{"id": name, "proportion": proportions[k] if point_available else None,
                  "areaM2": frame_area * proportions[k] if point_available else None,
                  "proportionSamplingSE": math.sqrt(covariance[k][k]) if covariance_available else None,
                  "areaSamplingSE_M2": math.sqrt(covariance[k][k]) * frame_area if covariance_available else None}
                 for k, name in enumerate(classes)]
    artifact = {
        "schemaVersion": SCHEMA_VERSION, "kind": ARTIFACT_KIND, "methodVersion": METHOD_VERSION,
        "experimental": True, "conditionalOnDeclaredDesignAndOutcomes": True,
        "designHash": design_hash, "responseTargetHash": design["responseTarget"]["sha256"],
        "responseTarget": deepcopy(design["responseTarget"]),
        "inputs": {"design": deepcopy(design), "outcomes": deepcopy(outcomes)},
        "classOrder": list(classes), "counts": counts, "N": population, "n": len(selected),
        "nominalFrameAreaM2": frame_area, "areaBasis": design["areaBasis"],
        "pointEstimateStatus": "available" if point_available else "withheld",
        "pointWithholdingReasons": (["incomplete-selected-outcomes"] if counts["unknown"] else [])
                                   + (["unsampled-positive-strata"] if unsampled else []),
        "unsampledStrata": unsampled, "nonEstimableVarianceStrata": singletons,
        "samplingVarianceStatus": ("withheld" if not point_available else
                                   "non-estimable" if singletons else "estimable"),
        "strata": strata, "classes": estimates,
        "proportionCovariance": covariance, "areaCovarianceM4": area_covariance,
        "referenceUncertainty": {"status": "not-quantified", "includedInSamplingSE": False},
        "fieldTruthEstablished": False, "referenceErrorQuantified": False,
        "mapAccuracyEstimated": False, "confidenceIntervalsProvided": False,
        "limitations": list(LIMITATIONS),
        "limits": {"maxCombinedInputBytes": MAX_BYTES, "maxArtifactBytes": MAX_BYTES,
                   "maxStrata": MAX_STRATA, "maxClasses": MAX_CLASSES,
                   "maxSamples": MAX_SAMPLES, "minPopulationCells": 1, "maxPopulationCells": MAX_CELLS,
                   "minCellAreaM2": MIN_CELL_AREA_M2, "maxCellAreaM2": MAX_CELL_AREA_M2,
                   "maxNominalFrameAreaM2": MAX_CELLS * MAX_CELL_AREA_M2,
                   "maxIdCharacters": 128, "maxTargetDefinitionCharacters": 4096,
                   "arithmetic": "binary64"},
    }
    artifact["artifactHash"] = _digest(artifact)
    _canonical(artifact)  # Enforce the output ceiling with its self-hash included.
    return artifact
