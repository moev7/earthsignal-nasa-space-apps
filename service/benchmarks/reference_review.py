"""Offline optical development sampling and validation, never reference truth.

The public packet omits classifier strata, classes, weights, allocation and seed.
Keep the separate audit private until interpretation is frozen. SHA-256 provides
integrity, not authentication: a rehashed replacement is not a trusted original.
These functions do not read/write files, acquire imagery or compute accuracy.
CRS validation uses the existing runtime's GDAL/OSR local CRS parser.
"""
from copy import deepcopy
from datetime import datetime
import hashlib
import json
import math
import random
import re
import sys

import numpy as np

from ..observatory.methods import array_hash

SCHEMA_VERSION = 1
METHOD_VERSION = "optical-reference-review-v1"
PACKET_KIND = "optical-reference-review-packet"
REVIEW_KIND = "optical-image-review"
AUDIT_KIND = "optical-reference-review-private-audit"
SUMMARY_KIND = "optical-image-review-summary"
MAX_CELLS = 1_000_000
MAX_SAMPLES = 320
MAX_TEXT_BYTES = 1024 * 1024
STRATA = ("gain", "loss", "water_both", "non_water_both", "unknown")
LABELS = ("water", "non_water", "unknown")
VISIBILITIES = ("observable", "unobservable", "unknown")
SAMPLING_ALGORITHM = "python.random.Random.sample-without-replacement-v1"
ORDER_ALGORITHM = "python.random.Random.shuffle-independent-stream-v1"
RESPONSE_DEFINITION = {
    "water": "Visible open water covers the entire highlighted 20m cell.",
    "non_water": "Visibly no open water in the highlighted 20m cell.",
    "unknown": "Otherwise unknown; mixed, dark or shadowed scenes may be unknown.",
    "visibility": "Record observable, unobservable or unknown for each date.",
    "caution": "non_water (not_open_water) establishes neither dry ground nor danger.",
    "semantics": "This interpretation target is not automatically equivalent to SCL class semantics.",
}
LIMITS = {
    "maxSamples": MAX_SAMPLES,
    "maxTextBytes": MAX_TEXT_BYTES,
    "developmentOnly": True,
    "sampling": "Engineering prototype; sample size is not statistically validated power.",
    "evidence": "Human decisions are provenance, not automatically truth or independent evidence.",
    "integrity": "Hashes establish integrity, not authentication.",
}
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_SAMPLE_ID = re.compile(r"s-[0-9a-f]{32}\Z")
_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\Z")


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _keys(value, keys, name):
    _require(type(value) is dict and set(value) == set(keys), f"{name}: exact fields required")


def _integer(value, minimum, maximum, name):
    _require(type(value) is int and minimum <= value <= maximum, f"{name}: integer out of bounds")


def _text(value, maximum, name, *, empty=False):
    _require(type(value) is str and len(value) <= maximum and value == value.strip()
             and ((empty and value == "") or (bool(value) and value.isprintable())),
             f"{name}: trimmed printable text required")


def _timestamp(value, name):
    _require(type(value) is str and _TIME.fullmatch(value) is not None
             and not value.endswith("-00:00"), f"{name}: timezone ISO timestamp required")
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{name}: invalid timestamp") from exc
    _require(result.utcoffset() is not None, f"{name}: timezone required")
    return result


def _hash(value, name):
    _require(type(value) is str and _HASH.fullmatch(value) is not None, f"{name}: SHA-256 required")


def _canonical(value):
    """Bounded strict JSON: sorted keys, compact UTF-8, no nonfinite numbers."""
    text_size = 0
    nodes = 0

    def visit(item, depth):
        nonlocal text_size, nodes
        nodes += 1
        _require(depth <= 16 and nodes <= 20_000, "JSON structure too large/deep")
        if type(item) is str:
            _require(len(item) <= MAX_TEXT_BYTES, "aggregate text exceeds 1MiB")
            try:
                text_size += len(item.encode("utf-8"))
            except UnicodeError as exc:
                raise ValueError("invalid Unicode text") from exc
            _require(text_size <= MAX_TEXT_BYTES, "aggregate text exceeds 1MiB")
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
        else:
            _require(item is None or type(item) in (int, bool), "unsupported JSON type")

    visit(value, 0)
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"),
                          ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError("invalid JSON") from exc


def _digest(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _projected_metres(crs):
    # Do not pass arbitrary strings to SetFromUserInput: they may be file paths.
    from osgeo import osr

    spatial = osr.SpatialReference()
    try:
        if re.fullmatch(r"EPSG:[1-9][0-9]{0,6}", crs):
            result = spatial.ImportFromEPSG(int(crs[5:]))
        elif crs.startswith(("PROJCS[", "PROJCRS[")):
            result = spatial.ImportFromWkt(crs)
        else:
            raise ValueError("CRS must be a projected EPSG code or WKT")
        valid = (result == 0 and spatial.IsProjected() == 1
                 and spatial.GetAxesCount() == 2 and spatial.GetLinearUnits() == 1.0
                 and spatial.GetLinearUnitsName().lower() in ("metre", "meter", "metres", "meters"))
    except (RuntimeError, TypeError) as exc:
        raise ValueError("invalid CRS") from exc
    _require(valid, "CRS must be projected with two metre axes")


def _grid(grid):
    _keys(grid, ("crs", "transform", "shape"), "grid")
    _text(grid["crs"], 16_384, "CRS")
    _projected_metres(grid["crs"])
    shape = grid["shape"]
    _require(type(shape) is list and len(shape) == 2, "grid shape must be [rows, cols]")
    for dim in shape:
        _integer(dim, 1, MAX_CELLS, "grid dimension")
    _require(shape[0] * shape[1] <= MAX_CELLS, "grid exceeds cell limit")
    transform = grid["transform"]
    _require(type(transform) is list and len(transform) == 6, "GDAL transform requires six numbers")
    _require(all(type(v) in (int, float) and abs(v) <= sys.float_info.max and math.isfinite(v)
                 for v in transform),
             "transform requires finite nonboolean numbers")
    _require(transform[1] == 20 and transform[2] == 0 and transform[4] == 0
             and transform[5] == -20, "native north-up 20m grid required")
    # Ensure adjacent native coordinates remain distinguishable in float arithmetic.
    for origin, step, count in ((transform[0], 20, shape[1]), (transform[3], -20, shape[0])):
        edge = origin + step * count
        _require(math.isfinite(edge) and origin + step != origin and edge - step != edge,
                 "native coordinates exceed numeric precision")


def _sources(sources, pins):
    _require(type(sources) is list and len(sources) == 2, "exactly two ordered sources required")
    times = []
    for source in sources:
        _keys(source, ("id", "observedAt"), "source")
        _text(source["id"], 256, "source id")
        times.append(_timestamp(source["observedAt"], "source observedAt"))
    _require(sources[0]["id"] != sources[1]["id"] and times[0] < times[1],
             "distinct sources with strictly increasing observation times required")
    _keys(pins, ("receipt", "metadata", "beforeArchive", "afterArchive"), "source_pins")
    for name, pin in pins.items():
        _hash(pin, name)


def validate_packet(packet):
    """Validate the exact blind schema and its integrity; return a detached copy.

    This cannot authenticate the packet or recover its AOI/strata without the
    private audit. Bounds, unique native cells, and anonymous IDs are enforced.
    """
    _canonical(packet)
    _keys(packet, ("schemaVersion", "kind", "methodVersion", "developmentOnly", "grid",
                   "sources", "source_pins", "samples", "responseDefinition", "limits", "packetHash"), "packet")
    _require(type(packet["schemaVersion"]) is int and packet["schemaVersion"] == SCHEMA_VERSION,
             "unsupported packet schemaVersion")
    _require(packet["kind"] == PACKET_KIND and packet["methodVersion"] == METHOD_VERSION,
             "unsupported packet kind/method")
    _require(packet["developmentOnly"] is True, "packet must be development-only")
    _require(_canonical(packet["responseDefinition"]) == _canonical(RESPONSE_DEFINITION)
             and _canonical(packet["limits"]) == _canonical(LIMITS), "fixed response definition/limits required")
    _grid(packet["grid"])
    _sources(packet["sources"], packet["source_pins"])
    samples = packet["samples"]
    _require(type(samples) is list and len(samples) <= MAX_SAMPLES, "sample limit exceeded")
    ids, cells = set(), set()
    rows, cols = packet["grid"]["shape"]
    for sample in samples:
        _keys(sample, ("id", "row", "col"), "sample")
        _require(type(sample["id"]) is str and _SAMPLE_ID.fullmatch(sample["id"]) is not None,
                 "anonymous sample id required")
        _integer(sample["row"], 0, rows - 1, "sample row")
        _integer(sample["col"], 0, cols - 1, "sample col")
        cell = (sample["row"], sample["col"])
        _require(sample["id"] not in ids and cell not in cells, "duplicate sample id/cell")
        ids.add(sample["id"])
        cells.add(cell)
    _hash(packet["packetHash"], "packetHash")
    _require(packet["packetHash"] == _digest({k: v for k, v in packet.items() if k != "packetHash"}),
             "packet hash mismatch")
    return deepcopy(packet)


def make_packet(before_scl, after_scl, aoi, *, grid, sources, source_pins, seed, per_stratum):
    """Return (blind packet, PRIVATE audit) for uniform sampling per SCL stratum.

    Arrays must be 2D NumPy integer SCL arrays on the same native 20m grid.
    AOI is a boolean/integer binary NumPy array. Only AOI-selected SCL values
    must be 0..11. All selected cells enter exactly one of five strata;
    anything outside clear classes 4/5/6 at either endpoint is unknown.
    Sampling/order/ID streams are separate and reproducible for the recorded
    Python runtime. Zero-population strata retain null probabilities/weights.
    The audit contains population counts/hashes and sampled cells, and is
    unsuitable for blind review. It does not duplicate every population cell.
    No statistical power, spatial independence or field accuracy is established.
    """
    _integer(seed, 0, 2**32 - 1, "seed")
    _integer(per_stratum, 1, 64, "per_stratum")
    for name, array in (("before_scl", before_scl), ("after_scl", after_scl), ("aoi", aoi)):
        _require(type(array) is np.ndarray and array.ndim == 2 and 0 < array.size <= MAX_CELLS,
                 f"{name}: bounded 2D NumPy array required")
        valid_kind = "biu" if name == "aoi" else "iu"
        _require(array.dtype.kind in valid_kind, f"{name}: invalid dtype")
    _require(before_scl.shape == after_scl.shape == aoi.shape, "array shape mismatch")
    _require(np.isin(aoi, (0, 1)).all(), "AOI must be binary")
    area = aoi.astype(bool)
    _require(np.isin(before_scl[area], range(12)).all() and np.isin(after_scl[area], range(12)).all(),
             "selected SCL values must be 0..11")
    _canonical({"grid": grid, "sources": sources, "source_pins": source_pins})
    _grid(grid)
    _require(grid["shape"] == list(before_scl.shape), "grid/array shape mismatch")
    _sources(sources, source_pins)
    known = area & np.isin(before_scl, (4, 5, 6)) & np.isin(after_scl, (4, 5, 6))
    before_water, after_water = before_scl == 6, after_scl == 6
    masks = (known & ~before_water & after_water, known & before_water & ~after_water,
             known & before_water & after_water, known & ~before_water & ~after_water, area & ~known)
    sampler = random.Random(seed)
    order_rng = random.Random(f"{METHOD_VERSION}:order:{seed}")
    id_rng = random.Random(f"{METHOD_VERSION}:ids:{seed}")
    audit_strata, selected = {}, []
    width = before_scl.shape[1]
    for name, mask in zip(STRATA, masks):
        indices = np.flatnonzero(mask).tolist()  # frozen row-major population order
        count = len(indices)
        n = min(per_stratum, count)
        chosen = sampler.sample(indices, n)
        stats = {"N_h": count, "n_h": n, "selectionProbability": n / count if count else None,
                 "designWeight": count / n if n else None}
        audit_strata[name] = stats
        for index in chosen:
            row, col = divmod(index, width)
            selected.append({"row": row, "col": col, "beforeClass": int(before_scl[row, col]),
                             "afterClass": int(after_scl[row, col]), "stratum": name, **stats})
    order_rng.shuffle(selected)
    # IDs are assigned after shuffling, independent of the stratum sampling RNG.
    used = set()
    for sample in selected:
        identifier = f"s-{id_rng.getrandbits(128):032x}"
        while identifier in used:
            identifier = f"s-{id_rng.getrandbits(128):032x}"
        used.add(identifier)
        sample["id"] = identifier
    packet = {"schemaVersion": SCHEMA_VERSION, "kind": PACKET_KIND, "methodVersion": METHOD_VERSION,
              "developmentOnly": True, "grid": deepcopy(grid), "sources": deepcopy(sources),
              "source_pins": deepcopy(source_pins),
              "samples": [{k: sample[k] for k in ("id", "row", "col")} for sample in selected],
              "responseDefinition": deepcopy(RESPONSE_DEFINITION), "limits": deepcopy(LIMITS)}
    packet["packetHash"] = _digest(packet)
    audit = {"schemaVersion": SCHEMA_VERSION, "kind": AUDIT_KIND, "methodVersion": METHOD_VERSION,
             "developmentOnly": True, "private": True, "packetHash": packet["packetHash"],
             "inputHashes": {"before_scl": array_hash(before_scl), "after_scl": array_hash(after_scl),
                             "aoi": array_hash(aoi)},
             "sampling": {"seed": seed, "perStratum": per_stratum, "algorithm": SAMPLING_ALGORITHM,
                          "orderAlgorithm": ORDER_ALGORITHM, "pythonVersion": sys.version.split()[0],
                          "populationOrder": "row-major within each stratum",
                          "idAlgorithm": "independent-stream-128-bit-anonymous-v1"},
             "populationCount": int(area.sum()), "strata": audit_strata, "samples": selected}
    # Population membership can be reproduced from the pinned arrays. Record
    # counts and sample coordinates rather than allocating 1e6 Python records.
    audit["auditHash"] = hashlib.sha256(json.dumps(audit, sort_keys=True, separators=(",", ":"),
                                                 ensure_ascii=False, allow_nan=False).encode("utf-8")).hexdigest()
    return packet, audit


def _decision(decision):
    _keys(decision, ("status", "label", "visibility", "reason", "reviewedAt"), "decision")
    _require(decision["status"] in ("unreviewed", "reviewed") and decision["label"] in LABELS
             and decision["visibility"] in VISIBILITIES, "unsupported decision enum")
    if decision["status"] == "unreviewed":
        _require(decision["label"] == "unknown" and decision["visibility"] == "unknown"
                 and decision["reason"] == "" and decision["reviewedAt"] is None,
                 "unreviewed must have unknown/unknown/empty/null")
    else:
        _text(decision["reason"], 1000, "review reason")
        _timestamp(decision["reviewedAt"], "reviewedAt")
        _require(decision["label"] == "unknown" or decision["visibility"] == "observable",
                 "known labels require observable visibility")
        _require(decision["visibility"] != "unobservable" or decision["label"] == "unknown",
                 "unobservable must have unknown label")


def validate_review(packet, review):
    """Validate all sample endpoints and return counts plus detached provenance.

    Every sampled ID must appear once, including partially untouched reviews.
    Attempted counts are supplied endpoint slots (twice sample count); reviewed
    counts include reviewed uncertainty. Label counts exclude unreviewed slots;
    visibility counts include them. No decision is promoted to truth and no
    accuracy, area, correctness or forecast quantity is returned.
    """
    packet = validate_packet(packet)
    _canonical({"packet": packet, "review": review})  # joint aggregate text limit
    _keys(review, ("schemaVersion", "kind", "packetHash", "reviewerAlias", "reviews"), "review")
    _require(type(review["schemaVersion"]) is int and review["schemaVersion"] == SCHEMA_VERSION
             and review["kind"] == REVIEW_KIND, "unsupported review schema/kind")
    _hash(review["packetHash"], "review packetHash")
    _require(review["packetHash"] == packet["packetHash"], "foreign review packetHash")
    _text(review["reviewerAlias"], 64, "reviewerAlias")
    reviews = review["reviews"]
    _require(type(reviews) is list and len(reviews) == len(packet["samples"])
             and len(reviews) <= MAX_SAMPLES, "exact sample coverage required")
    expected = {sample["id"] for sample in packet["samples"]}
    seen = set()

    def counts():
        return {"attempted": 0, "reviewed": 0, "water": 0, "non_water": 0, "unknown": 0,
                "unreviewed": 0, "visibility": {v: 0 for v in VISIBILITIES}}

    total = counts()
    endpoints = {side: counts() for side in ("before", "after")}
    for entry in reviews:
        _keys(entry, ("sampleId", "before", "after"), "review entry")
        identifier = entry["sampleId"]
        _require(type(identifier) is str and identifier in expected and identifier not in seen,
                 "foreign or duplicate sampleId")
        seen.add(identifier)
        for side in ("before", "after"):
            decision = entry[side]
            _decision(decision)
            for target in (total, endpoints[side]):
                target["attempted"] += 1
                target["visibility"][decision["visibility"]] += 1
                if decision["status"] == "reviewed":
                    target["reviewed"] += 1
                    target[decision["label"]] += 1
                else:
                    target["unreviewed"] += 1
    _require(seen == expected, "missing sampled IDs")
    return {"schemaVersion": SCHEMA_VERSION, "kind": SUMMARY_KIND, "methodVersion": METHOD_VERSION,
            "developmentOnly": True, "packetHash": packet["packetHash"], "reviewHash": _digest(review),
            "counts": total, "endpointCounts": endpoints, "review": deepcopy(review)}
