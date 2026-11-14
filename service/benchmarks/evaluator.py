"""Frozen, sequential open-water transition evaluation; no acquisition or training.

Counts describe only the supplied labels and support. Metadata assertions require
external review; this runner cannot establish reference truth or independence.
"""

import hashlib
import io
import json
import math
from datetime import datetime
from pathlib import Path
import struct
import zipfile

import numpy as np

VERSION = "1.1.0"
AREA_METHODS = {
    'constant_equal_area_m2': 'Constant cells in an externally verified equal-area CRS.',
    'constant_projected_grid_m2': 'Nominal projected grid cell areas; projection distortion is not corrected. These are not geodesic or accuracy-adjusted areas.',
}
MAX_CASES = 32
MAX_PIXELS = 1_000_000
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_HEADER_BYTES = 16 * 1024
ARRAYS = (
    "reference_before", "reference_after", "prediction_before",
    "prediction_after", "common_observable", "reference_observable",
)
CLASSES = ("no_detection", "gain", "loss", "persistent_water")
CLASS_DEFINITION = {
    "input": {"unknown": -1, "non_water": 0, "open_water": 1},
    "transition": {"0_to_0": "no_detection", "0_to_1": "gain",
                   "1_to_0": "loss", "1_to_1": "persistent_water"},
}
SUPPORT_POLICY = "common_observable_and_reference_observable_and_both_reference_labels_known"
AGGREGATION = "pooled_pixel_counts_and_summed_mapped_m2_per_fold; cases_reported_separately"


class BenchmarkError(ValueError):
    """Invalid, changed, unsafe or leaking frozen inputs; no result is accepted."""


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _json_hash(value):
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def array_sha256(value):
    """Digest includes dtype, shape and C-order values, not just container bytes."""
    a = np.asarray(value)
    h = hashlib.sha256(canonical_json({"dtype": a.dtype.str, "shape": list(a.shape)}).encode())
    h.update(b"\n")
    h.update(a.tobytes(order="C"))
    return h.hexdigest()


def _require(condition, message):
    if not condition:
        raise BenchmarkError(message)


def _text(obj, key):
    v = obj.get(key)
    _require(isinstance(v, str) and bool(v.strip()), f"Missing/non-text {key}")
    return v


def _hash(value, label):
    _require(isinstance(value, str) and len(value) == 64 and
             all(c in "0123456789abcdef" for c in value), f"Invalid SHA256: {label}")
    return value


def _number(value, label, low, high):
    _require(type(value) in (int, float) and math.isfinite(value) and low <= value <= high,
             f"Invalid finite numeric range: {label}")
    return value


def _ids(obj, key):
    values = obj.get(key)
    _require(isinstance(values, list) and len(values) <= 1024 and
             all(isinstance(x, str) and x.strip() for x in values) and
             len(values) == len(set(values)), f"Invalid ID list: {key}")
    return values


def _time(value):
    _require(isinstance(value, str), "Timestamp must be text")
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BenchmarkError("Invalid ISO timestamp") from exc
    _require(t.tzinfo is not None, "Timestamp requires timezone")
    return t


def _unique_object(pairs):
    d = {}
    for k, v in pairs:
        _require(k not in d, f"Duplicate JSON key: {k}")
        d[k] = v
    return d


def _read_manifest(path, expected):
    _hash(expected, "external manifest freeze")
    with open(path, "rb") as stream:
        raw = stream.read(MAX_MANIFEST_BYTES + 1)
    _require(len(raw) <= MAX_MANIFEST_BYTES, "Manifest exceeds byte limit")
    digest = hashlib.sha256(raw).hexdigest()
    _require(digest == expected, "Manifest hash changed from external freeze")
    try:
        m = json.loads(raw, object_pairs_hook=_unique_object,
                       parse_constant=lambda x: (_ for _ in ()).throw(BenchmarkError(f"Nonfinite JSON: {x}")))
        canonical_json(m)  # Reject overflowing finite literals such as 1e999.
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise BenchmarkError(f"Invalid manifest JSON: {exc}") from exc
    _require(isinstance(m, dict), "Manifest must be an object")
    return m, digest


def _validate_manifest(m):
    _require(type(m.get("schema_version")) is int and m["schema_version"] == 1, "Unsupported schema version")
    _require(m.get("task") == "open_water_transition", "Unsupported task")
    _require(m.get("evidence_kind") in ("synthetic_software_check", "field_reference"),
             "Explicit evidence_kind required")
    track = m.get("track")
    tracks = {"nisar_l_band": ("NISAR", "L"), "sentinel1_c_band": ("Sentinel-1", "C"),
              "synthetic": ("SYNTHETIC", "NONE")}
    _require(track in tracks, "Unsupported sensor track")
    _require((track == "synthetic") == (m["evidence_kind"] == "synthetic_software_check"),
             "Synthetic/field evidence mismatch")
    policy = m.get("policy")
    _require(isinstance(policy, dict), "Missing frozen policy")
    frozen = _time(_text(policy, "frozen_at"))
    _require(policy.get("class_definition") == CLASS_DEFINITION, "Class definition changed")
    _require(policy.get("support_policy") == SUPPORT_POLICY, "Unsupported support policy")
    _require(policy.get("aggregation") == AGGREGATION, "Unsupported aggregation")
    algorithm = policy.get("algorithm")
    _require(isinstance(algorithm, dict), "Missing algorithm lineage")
    _text(algorithm, "name"); _text(algorithm, "version")
    _require(isinstance(algorithm.get("parameters"), dict), "Algorithm parameters required")
    algorithm_dependencies = set(_ids(algorithm, "dependency_ids"))
    budget = policy.get("task_budget")
    _require(isinstance(budget, dict), "Preregistered task budget required")
    _text(budget, "reason")
    _number(budget.get("false_alert_area_per_reference_valid_area_max"), "false alert budget", 0, 1)
    abstention_max=_number(budget.get("prediction_abstention_rate_reference_valid_max"), "abstention budget", 0, 1)
    _require(abstention_max<1, "An entirely abstaining detector cannot meet a useful-output budget")
    recall = budget.get("min_inclusive_change_recall")
    _require("min_inclusive_change_recall" in budget, "Explicit recall budget or null required")
    if recall is not None:
        _number(recall, "recall budget", 0, 1)
    for k in ("minimum_final_cases", "minimum_final_events"):
        _require(type(budget.get(k)) is int and 1 <= budget[k] <= MAX_CASES, f"Invalid {k}")
    cases = m.get("cases")
    _require(isinstance(cases, list) and 1 <= len(cases) <= MAX_CASES, "Case count out of bounds")
    seen = {k: {} for k in ("event_id", "site_id", "acquisition_ids")}
    source_seen={key:{} for key in ('product_id','sha256')}
    case_ids = set()
    reasons = {}
    for case in cases:
        _require(isinstance(case, dict), "Case must be object")
        cid = _text(case, "id")
        _require(cid not in case_ids, "Duplicate case ID")
        case_ids.add(cid)
        fold = case.get("fold")
        _require(fold in ("development", "calibration", "final"), "Invalid fold")
        for key in seen:
            ids = _ids(case, key) if key == "acquisition_ids" else [_text(case, key)]
            _require(bool(ids), "Acquisition IDs required")
            for value in ids:
                _require(value not in seen[key] or seen[key][value] == fold,
                         f"Split leakage: {key} {value} shared across folds")
                seen[key][value] = fold
        grid = case.get("grid")
        _require(isinstance(grid, dict), "Grid required")
        _text(grid, "id"); _text(grid, "crs")
        shape = grid.get("shape")
        _require(isinstance(shape, list) and len(shape) == 2 and
                 all(type(x) is int and 1 <= x <= MAX_PIXELS for x in shape) and
                 math.prod(shape) <= MAX_PIXELS, "Grid pixel count out of bounds")
        area = _number(grid.get("pixel_area_m2"), "pixel area", 1e-12, 1e12)
        _require(grid.get("area_method") in AREA_METHODS,
                 "Explicit constant equal-area or nominal projected grid area required")
        _text(grid, "area_evidence")
        transform = grid.get("transform")
        _require(grid.get("transform_convention") == "GDAL", "Explicit GDAL affine convention required")
        _require(isinstance(transform, list) and len(transform) == 6, "Six affine coefficients required")
        for x in transform:
            _number(x, "grid transform", -1e15, 1e15)
        # GDAL: origin_x, step_x, rotation_x, origin_y, rotation_y, step_y.
        # Origins are translations and cannot change a cell's area.
        determinant = abs(transform[1]*transform[5] - transform[2]*transform[4])
        _require(grid.get("linear_units") == "metre" and math.isclose(determinant, area, rel_tol=1e-9),
                 "Metre affine cell area must match pixel_area_m2")
        _require(math.isfinite(area * math.prod(shape) * MAX_CASES), "Nonfinite area total")
        geometry = case.get("geometry")
        _require(isinstance(geometry, dict), "Geometry required")
        _text(geometry, "id")
        definition = _text(geometry, "definition")
        _require(hashlib.sha256(definition.encode()).hexdigest() == _hash(geometry.get("sha256"), "geometry"),
                 "Geometry hash changed")
        inputs = case.get("inputs")
        _require(isinstance(inputs, dict), "Inputs required")
        _text(inputs, "path")
        _hash(inputs.get("archive_sha256"), "archive")
        hashes = inputs.get("array_sha256")
        _require(isinstance(hashes, dict) and set(hashes) == set(ARRAYS), "Every array hash required")
        for key in ARRAYS:
            _hash(hashes[key], key)
        mask = case.get("mask")
        _require(isinstance(mask, dict), "Mask lineage required")
        _text(mask, "id"); _text(mask, "definition")
        _require(mask.get("sha256") == hashes["common_observable"], "Mask hash mismatch")
        sources = case.get("sources")
        _require(isinstance(sources, list) and len(sources) == 2, "Before/after source pair required")
        source_dependencies = set()
        source_issues = []
        dates = []
        for source in sources:
            _require(isinstance(source, dict), "Source must be object")
            for key in ("product_id", "product_release", "maturity", "crid", "acquisition_id"):
                _text(source, key)
                if source[key].strip().lower() in ("unknown", "unresolved", "unavailable", "pending"):
                    source_issues.append(f"source {key} unresolved")
            _require((source.get("sensor"), source.get("frequency_band")) == tracks[track],
                     "Mixed or incorrect NISAR/C-band/synthetic track")
            _require(source["acquisition_id"] in case["acquisition_ids"], "Source omitted from acquisition split")
            _require(source.get("grid_id") == grid["id"] and source.get("geometry_id") == geometry["id"] and
                     source.get("mask_id") == mask["id"], "Source grid/geometry/mask mismatch")
            _hash(source.get("sha256"), "source")
            for key,values in source_seen.items():
                value=source[key]
                _require(value not in values or values[value]==fold,
                         f"Split leakage: source {key} shared across folds")
                values[value]=fold
            _require(isinstance(source.get("known_issues"), list) and
                     all(isinstance(x, str) for x in source["known_issues"]), "Explicit known issues required")
            dates.append(_time(_text(source, "acquired_at")))
            source_dependencies.update((source["product_id"], source["acquisition_id"]))
        _require(dates[0] < dates[1], "Before/after acquisitions must be ordered")
        _require(dates[1] <= frozen, "Source acquisition after policy freeze")
        _require(sources[0]["product_release"] == sources[1]["product_release"] and
                 sources[0]["crid"] == sources[1]["crid"] and
                 sources[0]["maturity"] == sources[1]["maturity"], "Product release/maturity/CRID mismatch")
        reference = case.get("reference")
        _require(isinstance(reference, dict), "Reference provenance required")
        for key in ("id", "provenance", "label_method", "visibility_evidence", "independence_evidence"):
            _text(reference, key)
        _require(_time(_text(reference, "frozen_at")) <= frozen, "Reference frozen after policy")
        reference_dates = [_time(_text(reference, key)) for key in ("before_time", "after_time")]
        _require(reference_dates[0] < reference_dates[1], "Reference dates must be ordered")
        _require(reference_dates[1] <= _time(reference["frozen_at"]), "Reference acquisition after label freeze")
        issues = list(dict.fromkeys(source_issues))
        if reference.get("temporal_match") != "resolved":
            issues.append("reference timing unresolved")
        if reference.get("visibility") != "resolved":
            issues.append("reference visibility unresolved")
        dependencies = set(_ids(reference, "dependency_ids"))
        if reference.get("independence") != "independent" or dependencies & (algorithm_dependencies | source_dependencies):
            issues.append("reference independence unresolved or shared detector dependencies")
        licence = reference.get("licence")
        _require(isinstance(licence, dict), "Reference licence declaration required")
        _text(licence, "terms_id"); _text(licence, "evidence")
        if licence.get("status") != "resolved" or licence.get("evaluation_allowed") is not True:
            issues.append("reference evaluation rights unresolved")
        reasons[cid] = issues
    _require(len({c['grid']['area_method'] for c in cases}) == 1,
             'Mixed area bases cannot be pooled; evaluate separate manifests')
    return reasons


def _input_path(root, path):
    p = Path(path)
    _require(not p.is_absolute() and ".." not in p.parts and ":" not in path and "\\" not in path,
             "Input must be local relative path without traversal or URLs")
    resolved = (root / p).resolve()
    _require(resolved.is_relative_to(root.resolve()), "Input symlink escapes manifest directory")
    return resolved


def _load_arrays(root, case):
    """Validate ZIP metadata AND each NPY header before np.load allocates arrays."""
    path = _input_path(root, case["inputs"]["path"])
    try:
        with open(path, "rb") as stream:
            stream.seek(0, 2)
            _require(stream.tell() <= MAX_ARCHIVE_BYTES, "ZIP compressed size exceeds bound")
            stream.seek(0)
            # One bounded snapshot prevents mutation between checksum and decode.
            raw = stream.read(MAX_ARCHIVE_BYTES + 1)
        _require(len(raw) <= MAX_ARCHIVE_BYTES, "ZIP compressed size exceeds bound")
        _require(hashlib.sha256(raw).hexdigest() == case["inputs"]["archive_sha256"], "Archive hash changed")
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            _require(len(entries) == len(ARRAYS) and {x.filename for x in entries} ==
                     {x + ".npy" for x in ARRAYS}, "NPZ contains missing/extra/duplicate arrays")
            _require(sum(x.file_size for x in entries) <= MAX_ARCHIVE_BYTES, "ZIP uncompressed size exceeds bound")
            for entry in entries:
                _require(not entry.flag_bits & 1 and entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                         "Unsupported/encrypted ZIP entry")
                with archive.open(entry) as member:
                    version = np.lib.format.read_magic(member)
                    _require(version in ((1, 0), (2, 0)), "Unsupported NPY version")
                    # NumPy's header-size check occurs after reading the header.
                    # Bound the declared byte count before that read as well.
                    size_format = "<H" if version == (1, 0) else "<I"
                    prefix = member.read(struct.calcsize(size_format))
                    _require(len(prefix) == struct.calcsize(size_format), "Truncated NPY header length")
                    header_size = struct.unpack(size_format, prefix)[0]
                    _require(header_size <= MAX_HEADER_BYTES, "NPY header byte limit exceeded")
                    header = member.read(header_size)
                    _require(len(header) == header_size, "Truncated NPY header")
                    reader = (np.lib.format.read_array_header_1_0 if version == (1, 0)
                              else np.lib.format.read_array_header_2_0)
                    shape, _, dtype = reader(io.BytesIO(prefix + header), max_header_size=MAX_HEADER_BYTES)
                    _require(shape == tuple(case["grid"]["shape"]) and len(shape) == 2 and
                             math.prod(shape) <= MAX_PIXELS, "NPY shape/pixel count mismatch or oversized")
                    _require(dtype.kind in "biuf" and dtype.itemsize <= 8 and not dtype.hasobject,
                             "Unsupported NPZ dtype (pickle/structured/complex forbidden)")
                    _require(entry.file_size == member.tell() + math.prod(shape)*dtype.itemsize,
                             "NPY payload size mismatch")
        with np.load(io.BytesIO(raw), allow_pickle=False, max_header_size=MAX_HEADER_BYTES) as inputs:
            arrays = {name: inputs[name] for name in ARRAYS}
        for name, array in arrays.items():
            _require(array_sha256(array) == case["inputs"]["array_sha256"][name], f"Array hash changed: {name}")
            _require(np.isfinite(array).all(), f"Nonfinite input: {name}")
            valid = (0, 1) if name.endswith("observable") else (-1, 0, 1)
            _require(np.isin(array, valid).all(), f"Invalid class/mask: {name}")
        _require(not np.any((arrays["reference_observable"] == 1) & (arrays["common_observable"] == 0)),
                 "Reference observable mask must be subset of common observable")
        return arrays
    except (OSError, ValueError, EOFError, zipfile.BadZipFile, NotImplementedError) as exc:
        if isinstance(exc, BenchmarkError):
            raise
        raise BenchmarkError(f"Invalid bounded NPZ input: {exc}") from exc


def _ratio(a, b):
    return float(a / b) if b else None


def _transition(before, after):
    unknown = (before == -1) | (after == -1)
    out = (2*before + after).astype(np.int8)
    out[unknown] = 4
    return out


def _summarize(counts, area):
    cm = np.asarray(counts["confusion"], dtype=np.int64)
    known = int(cm[:, :4].sum())
    valid = int(cm.sum())
    metrics = {}
    for k, label in enumerate(CLASSES):
        tp = int(cm[k, k])
        predicted = int(cm[:, k].sum())
        ref_inclusive = int(cm[k].sum())
        ref_conditional = int(cm[k, :4].sum())
        precision = _ratio(tp, predicted)
        metrics[label] = {
            "true_positive_pixels": tp, "predicted_pixels": predicted,
            "reference_valid_pixels": ref_inclusive,
            "conditional": {"precision": precision, "recall": _ratio(tp, ref_conditional),
                            "iou": _ratio(tp, predicted + ref_conditional - tp),
                            "omission": _ratio(ref_conditional-tp, ref_conditional),
                            "commission": _ratio(predicted-tp, predicted)},
            "inclusive": {"precision": precision, "recall": _ratio(tp, ref_inclusive),
                          "iou": _ratio(tp, predicted + ref_inclusive - tp),
                          "omission": _ratio(ref_inclusive-tp, ref_inclusive),
                          "commission": _ratio(predicted-tp, predicted)},
        }
    change_ref = int(cm[1:3].sum())
    # A reversed gain/loss counts as a missed class and false class-specific alert.
    correct_change = int(cm[1, 1]+cm[2, 2])
    return {
        "counts": counts, "area_m2": area, "per_class": metrics,
        "denominators": {"inclusive_pixels": valid, "conditional_pixels": known},
        "prediction_abstention_rate_reference_valid": _ratio(valid-known, valid),
        "prediction_unknown_rate_common_observable": _ratio(counts["mapped_pixels"]["unknown"], counts["common_observable_pixels"]),
        "common_observable_fraction": _ratio(counts["common_observable_pixels"], counts["total_pixels"]),
        "reference_valid_fraction_common_observable": _ratio(valid, counts["common_observable_pixels"]),
        "false_alert_area_per_common_observable_area": _ratio(area["false_alert"], area["common_observable"]),
        "false_alert_area_per_reference_valid_area": _ratio(area["false_alert"], area["reference_valid"]),
        "quiet_false_alert_area_per_quiet_reference_area": _ratio(area["quiet_false_alert"], area["quiet_reference"]),
        "inclusive_change_recall": _ratio(correct_change, change_ref),
        "area_bias": {label: {
            "mapped_minus_reference_m2": area["mapped_on_reference_valid"][label] - area["reference"][label],
            "relative": _ratio(area["mapped_on_reference_valid"][label] - area["reference"][label], area["reference"][label]),
        } for label in CLASSES},
    }


def _case_metrics(a, pixel_area):
    common = a["common_observable"] == 1
    ref = _transition(a["reference_before"], a["reference_after"])
    pred = _transition(a["prediction_before"], a["prediction_after"])
    valid = common & (a["reference_observable"] == 1) & (ref != 4)
    cm = np.bincount(ref[valid]*5 + pred[valid], minlength=20).reshape(4, 5)
    mapped = {name: int(np.count_nonzero(common & (pred == k)))
              for k, name in enumerate((*CLASSES, "unknown"))}
    counts = {
        "total_pixels": int(common.size), "common_observable_pixels": int(common.sum()),
        "outside_common_pixels": int((~common).sum()), "reference_valid_pixels": int(valid.sum()),
        "reference_unknown_common_pixels": int((common & ~valid).sum()),
        "reference_label_unknown_common_pixels": int((common & (ref == 4)).sum()),
        "reference_unobservable_common_pixels": int((common & (a["reference_observable"] == 0)).sum()),
        "prediction_abstentions_reference_valid_pixels": int(cm[:, 4].sum()),
        "mapped_pixels": mapped, "confusion": cm.tolist(),
    }
    false = sum(int(cm[:, k].sum() - cm[k, k]) for k in (1, 2))
    quiet_ref = int(cm[[0, 3]].sum())
    quiet_false = int(cm[np.ix_([0, 3], [1, 2])].sum())
    area = {
        "total": counts["total_pixels"]*pixel_area,
        "common_observable": counts["common_observable_pixels"]*pixel_area,
        "outside_common_unknown": counts["outside_common_pixels"]*pixel_area,
        "reference_valid": counts["reference_valid_pixels"]*pixel_area,
        "reference_unknown_common": counts["reference_unknown_common_pixels"]*pixel_area,
        "prediction_abstentions_reference_valid": int(cm[:, 4].sum())*pixel_area,
        "false_alert": false*pixel_area, "quiet_reference": quiet_ref*pixel_area,
        "quiet_false_alert": quiet_false*pixel_area,
        "mapped_common": {k: n*pixel_area for k, n in mapped.items()},
        "mapped_on_reference_valid": {name: int(cm[:, k].sum())*pixel_area for k, name in enumerate(CLASSES)},
        "reference": {name: int(cm[k].sum())*pixel_area for k, name in enumerate(CLASSES)},
    }
    return _summarize(counts, area)


def _add_dict(left, right):
    if left is None:
        return json.loads(canonical_json(right))
    for k, value in right.items():
        if isinstance(value, dict):
            _add_dict(left[k], value)
        elif k == "confusion":
            left[k] = (np.asarray(left[k], dtype=np.int64) + np.asarray(value, dtype=np.int64)).tolist()
        else:
            left[k] += value
    return left


def evaluate(manifest_path, *, expected_manifest_sha256):
    """Return deterministic scientific JSON; fail closed on invalid/tampered input.

    The expected digest must come from the preregistration/freeze record, not a
    newly computed digest after examining final scores.
    """
    path = Path(manifest_path)
    m, manifest_hash = _read_manifest(path, expected_manifest_sha256)
    reasons = _validate_manifest(m)
    cases = []
    pooled = {}
    for case in m["cases"]:
        arrays = _load_arrays(path.parent, case)
        score = _case_metrics(arrays, case["grid"]["pixel_area_m2"])
        del arrays  # No regional stack or list of arrays is retained.
        result = {"id": case["id"], "fold": case["fold"], "event_id": case["event_id"],
                  "site_id": case["site_id"], "eligibility": "ineligible" if reasons[case["id"]] else "eligible",
                  "ineligibility_reasons": reasons[case["id"]], "metrics": score,
                  "lineage": case}
        cases.append(result)
        fold = case["fold"]
        accum = pooled.setdefault(fold, {"counts": None, "area": None})
        accum["counts"] = _add_dict(accum["counts"], score["counts"])
        accum["area"] = _add_dict(accum["area"], score["area_m2"])
    summaries = {fold: _summarize(v["counts"], v["area"]) for fold, v in sorted(pooled.items())}
    budget = m["policy"]["task_budget"]
    final = [c for c in cases if c["fold"] == "final"]
    budget_reasons = [f"{cid}: {issue}" for cid, issues in reasons.items() for issue in issues]
    if len(final) < budget["minimum_final_cases"] or len({c["event_id"] for c in final}) < budget["minimum_final_events"]:
        budget_reasons.append("insufficient held-out cases/events for preregistered task")
    summary = summaries.get("final")
    if summary is None or summary["false_alert_area_per_reference_valid_area"] is None:
        budget_reasons.append("no final reference-valid support")
    if summary is None or summary['prediction_abstention_rate_reference_valid'] is None:
        budget_reasons.append('no final support for abstention gate')
    if budget["min_inclusive_change_recall"] is not None and (summary is None or summary["inclusive_change_recall"] is None):
        budget_reasons.append("no final reference change support for recall gate")
    if m["evidence_kind"] == "synthetic_software_check":
        status = "not_applicable_synthetic_software_check"
    elif budget_reasons:
        status = "unknown_ineligible"
    else:
        meets = summary["false_alert_area_per_reference_valid_area"] <= budget["false_alert_area_per_reference_valid_area_max"]
        meets = meets and summary['prediction_abstention_rate_reference_valid'] <= budget['prediction_abstention_rate_reference_valid_max']
        if budget["min_inclusive_change_recall"] is not None:
            meets = meets and summary["inclusive_change_recall"] >= budget["min_inclusive_change_recall"]
        status = "met_on_supplied_reference" if meets else "not_met_on_supplied_reference"
    return {
        "schema_version": 1, "evaluator_version": VERSION, "task": m["task"],
        "evidence_kind": m["evidence_kind"], "track": m["track"],
        "area_basis": {"method": m['cases'][0]['grid']['area_method'], "unit": "m2",
            "description": AREA_METHODS[m['cases'][0]['grid']['area_method']]},
        "manifest_sha256": manifest_hash, "policy_sha256": _json_hash(m["policy"]),
        "policy": m["policy"], "confusion_rows": list(CLASSES),
        "confusion_columns": [*CLASSES, "prediction_abstention"],
        "eligibility": "ineligible" if any(reasons.values()) else "eligible",
        "cases": cases, "pooled_by_fold": summaries,
        "task_budget_result": {"status": status, "reasons": budget_reasons,
            "scope": "quiet_false_alert_and_abstention_only_no_change_sensitivity" if budget['min_inclusive_change_recall'] is None else "change_sensitivity_false_alert_and_abstention"},
        "field_validation": "not_established_by_this_runner",
        "withheld_metrics": {
            "accuracy_adjusted_or_design_unbiased_area": "No probability-sample design or estimator is implemented; mapped convenience-label area only.",
            "confidence_intervals": "No independent-unit or sampling-design uncertainty estimator implemented.",
            "boundary_distance_and_object_alerts": "No boundary tolerance/object/time protocol implemented.",
        },
        "warnings": [
            "Synthetic software checks do not estimate field accuracy; Sentinel-1 results do not transfer to NISAR.",
            "Metadata assertions (rights, timing, visibility, independence, CRS and area basis) require external evidence review.",
            "False-alert numerator includes only reference-valid support; unknown-reference alerts cannot be classified as true or false.",
            "Inclusive recall/IoU count prediction abstentions as misses; conditional scores exclude them. Undefined ratios are null.",
            "Reference label-unknown and unobservable counts can overlap; reference_unknown_common is their union.",
            "No calibration, field validation, scientific usefulness study or regional unbiased area is established.",
        ],
        "resource_limits": {"max_cases": MAX_CASES, "max_pixels_per_case": MAX_PIXELS,
                            "max_archive_bytes": MAX_ARCHIVE_BYTES,
                            "max_uncompressed_bytes": MAX_ARCHIVE_BYTES,
                            "execution": "sequential_O_pixel_count_no_network_no_training"},
    }
