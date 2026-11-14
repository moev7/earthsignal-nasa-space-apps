"""Bounded offline radar signal detection; metadata are assertions, not certification.

No acquisition, resampling, water classification, automatic activation or field
accuracy claims. Serializable receipts are separate from native-grid arrays.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import math
from typing import Any, Sequence

import numpy as np

from .evaluator import array_sha256, canonical_json

VERSION = "1.0.0"
MAX_CELLS = 1_000_000
MAX_CASES = 32
MAX_HISTORY = 12
CHUNK_CELLS = 65_536
MAX_CANDIDATES_PER_TAIL = 256  # Computational bound, not a scientific threshold.
UNKNOWN = 2
SUPPORT = "positive_finite_producer_mask_and_declared_footprint_if_available; reference_scoring_adds_visible_known_target_stable"
FLAGS = {"signal_decrease": -1, "no_alert": 0, "signal_increase": 1, "unknown": UNKNOWN}
METHODS = ("fixed_pair", "empirical_pair", "empirical_temporal")


class RadarError(ValueError):
    """Invalid or changed contract; no fitted policy/result is accepted."""


@dataclass(frozen=True)
class Grid:
    id: str
    crs: str
    shape: tuple[int, int]
    transform: tuple[float, float, float, float, float, float]  # GDAL affine
    linear_units: str
    area_evidence: str  # Asserted metre CRS and nominal affine area, not geodesic.


@dataclass(frozen=True)
class Product:
    track: str  # nisar_l_band / sentinel1_c_band / synthetic
    sensor: str
    band: str
    polarization: str
    product_type: str
    units: str  # LINEAR_POWER only
    release: str
    crid: str
    maturity: str
    known_issues: tuple[str, ...]  # Empty means explicitly asserted none known.
    geometry: str  # Explicit track/frame/orbit/look identifier or frozen definition.


@dataclass(frozen=True)
class Profile:
    product: Product
    grid: Grid  # Frozen lattice; integer-offset crops permitted, never reprojected.
    stratum: str
    producer_mask_definition: str
    target_stable_definition: str
    target_footprint_definition: str | None = None


@dataclass(frozen=True)
class Source:
    id: str
    acquisition_id: str
    acquired_at: str
    sha256: str  # Original source asset digest, externally asserted.
    power_sha256: str
    mask_sha256: str
    product: Product
    producer_mask_definition: str
    metadata_evidence: str


@dataclass(frozen=True)
class Frame:
    power: np.ndarray
    mask: np.ndarray
    grid: Grid
    source: Source


@dataclass(frozen=True)
class Reference:
    labels: np.ndarray  # -1 unknown, 0 not target-stable, 1 target-stable
    visible: np.ndarray  # Unknown/unobservable visibility must be false.
    definition: str
    review_id: str
    independently_reviewed: bool
    independent_of_detector: bool
    temporal_match: bool
    evidence: str
    frozen_at: str
    labels_sha256: str
    visible_sha256: str


@dataclass(frozen=True)
class Footprint:
    mask: np.ndarray
    definition: str
    sha256: str


@dataclass(frozen=True)
class Case:
    id: str
    event_id: str
    site_id: str
    stratum: str
    target: Frame
    before: Frame | None = None
    history: tuple[Frame, ...] = ()  # Chronological, unique IDs and dates.
    reference: Reference | None = None
    footprint: Footprint | None = None


@dataclass(frozen=True)
class Spec:
    method: str
    profile: Profile
    frozen_at: str
    lower_candidates: tuple[float, ...] = ()
    upper_candidates: tuple[float, ...] = ()
    lower_tail_budget: float = 0.0
    upper_tail_budget: float = 0.0
    minimum_cells: int = 1  # Caller task parameters, no universal science default.
    minimum_independent_units: int = 1
    minimum_valid_histories: int = 1
    history_cutoff_seconds: int = 0  # Strictly older than target minus this lag.
    maximum_history_age_seconds: int | None = None
    maximum_history_gap_seconds: int | None = None
    support_policy: str = SUPPORT
    task_parameter_evidence: str = ""  # Must explain task-specific frozen choices.


@dataclass
class Scores:
    values: np.ndarray  # NaN where unknown
    valid: np.ndarray
    counts: dict[str, int]
    history_counts: np.ndarray | None = None


@dataclass
class Detection:
    receipt: dict[str, Any]
    scores: np.ndarray
    flags: np.ndarray
    valid: np.ndarray


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RadarError(message)


def _text(value: Any, name: str) -> None:
    _require(isinstance(value, str) and bool(value.strip()) and
             value.strip().lower() not in ("unknown", "unresolved", "pending"),
             f"Missing/unsupported {name}")


def _time(value: str) -> datetime:
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError) as exc:
        raise RadarError("Invalid acquisition/freeze time") from exc
    _require(t.tzinfo is not None, "Times require an explicit timezone")
    return t.astimezone(timezone.utc)


def _hash(value: Any, name: str) -> None:
    _require(isinstance(value, str) and len(value) == 64 and
             all(c in "0123456789abcdef" for c in value), f"Invalid hash: {name}")


def digest(value: Any) -> str:
    """Canonical JSON hash; persist/pin externally before final evaluation."""
    try:
        return hashlib.sha256(canonical_json(value).encode()).hexdigest()
    except (TypeError, ValueError, RecursionError) as exc:
        raise RadarError("Policy/receipt must be finite canonical JSON") from exc


def _array(a: np.ndarray, name: str, shape=None, mask=False) -> None:
    _require(isinstance(a, np.ndarray) and not np.ma.isMaskedArray(a),
             f"{name} requires ndarray and explicit separate mask")
    _require(a.ndim == 2 and 0 < a.size <= MAX_CELLS, f"{name} cell/shape bound")
    _require(a.dtype.kind == "b" if mask else a.dtype.kind in "fiu",
             f"{name} dtype unsupported")
    if not mask:
        _require(a.dtype.itemsize <= 8, f"{name} must be float64-compatible")
    if shape is not None:
        _require(a.shape == tuple(shape), f"{name} shape mismatch")


def _grid(g: Grid) -> None:
    _text(g.id, "grid ID"); _text(g.crs, "CRS"); _text(g.area_evidence, "area evidence")
    _require(len(g.shape) == 2 and all(type(x) is int and x > 0 for x in g.shape)
             and math.prod(g.shape) <= MAX_CELLS, "Grid cell bound")
    _require(g.linear_units == "metre", "Grid must assert metre linear units")
    _require(len(g.transform) == 6 and all(type(x) in (int, float) and math.isfinite(x)
                                         for x in g.transform), "Invalid metre affine")
    t = g.transform
    area = abs(t[1] * t[5] - t[2] * t[4])
    _require(math.isfinite(area) and area > 0 and math.isfinite(area * MAX_CELLS),
             "Degenerate/overflowing affine cell area")


def _aligned(a: Grid, b: Grid, exact: bool = False) -> None:
    _grid(a); _grid(b)
    _require((a.id, a.crs, a.linear_units) == (b.id, b.crs, b.linear_units),
             "Unmatched grid/CRS")
    ta, tb = a.transform, b.transform
    _require(tuple(ta[i] for i in (1, 2, 4, 5)) == tuple(tb[i] for i in (1, 2, 4, 5)),
             "Unmatched grid affine basis; no resampling")
    try:
        offset = np.linalg.solve(np.array([[ta[1], ta[2]], [ta[4], ta[5]]]),
                                 np.array([tb[0] - ta[0], tb[3] - ta[3]]))
    except np.linalg.LinAlgError as exc:
        raise RadarError("Singular grid") from exc
    _require(np.all(np.isfinite(offset)) and
             np.all(np.abs(offset - np.rint(offset)) <= 1e-9), "Non-integer-aligned grid")
    if exact:
        _require(a.shape == b.shape and tuple(ta) == tuple(tb), "Pair/history grid must match exactly")


def _product(p: Product) -> None:
    tracks = {"nisar_l_band": ("NISAR", "L"), "sentinel1_c_band": ("Sentinel-1", "C"),
              "synthetic": ("SYNTHETIC", "NONE")}
    _require(p.track in tracks and (p.sensor, p.band) == tracks[p.track], "Unsupported domain/track")
    _require(p.units == "LINEAR_POWER", "Only compatible LINEAR_POWER inputs")
    if p.track == "nisar_l_band":
        _require(p.polarization == "HH", "NISAR research profile requires HH power")
    for name in ("polarization", "product_type", "release", "crid", "maturity", "geometry"):
        _text(getattr(p, name), name)
    _require(isinstance(p.known_issues, (tuple, list)), "Explicit known issues required")
    for issue in p.known_issues:
        _text(issue, "known issues evidence")


def _spec(s: Spec) -> None:
    _require(s.method in METHODS, "Unsupported method")
    _product(s.profile.product); _grid(s.profile.grid)
    _text(s.profile.stratum, "frozen stratum")
    _text(s.profile.producer_mask_definition, "producer mask definition")
    _text(s.profile.target_stable_definition, "frozen target-stable definition")
    if s.profile.target_footprint_definition is not None:
        _text(s.profile.target_footprint_definition, "frozen footprint definition")
    _text(s.task_parameter_evidence, "task parameter evidence")
    _time(s.frozen_at)
    _require(s.support_policy == SUPPORT, "Unsupported support policy")
    for name, hi in (("minimum_cells", MAX_CELLS), ("minimum_independent_units", MAX_CASES),
                     ("minimum_valid_histories", MAX_HISTORY)):
        v = getattr(s, name)
        _require(type(v) is int and 1 <= v <= hi, f"Invalid {name}")
    _require(type(s.history_cutoff_seconds) is int and s.history_cutoff_seconds >= 0,
             "Invalid history cutoff")
    for name in ("maximum_history_age_seconds", "maximum_history_gap_seconds"):
        v = getattr(s, name)
        _require(v is None or (type(v) is int and v > 0), f"Invalid {name}")
    for v in (s.lower_tail_budget, s.upper_tail_budget):
        _require(type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1,
                 "Invalid declared tail-area budget")
    for values, lower in ((s.lower_candidates, True), (s.upper_candidates, False)):
        if s.method == "fixed_pair":
            _require(not values, "Fixed baseline does not accept tuned candidates")
            continue
        _require(0 < len(values) <= MAX_CANDIDATES_PER_TAIL, "Candidate count bound")
        _require(all(type(v) in (int, float) and math.isfinite(v) and
                     (v < 0 if lower else v > 0) for v in values), "Invalid signed candidates")
        _require(all(values[i] < values[i+1] for i in range(len(values)-1)),
                 "Candidates must be strictly sorted/unique")


def _frame(f: Frame, p: Profile) -> None:
    _array(f.power, "power", f.grid.shape); _array(f.mask, "mask", f.grid.shape, mask=True)
    _aligned(p.grid, f.grid)
    _product(f.source.product)
    _require(asdict(f.source.product) == asdict(p.product), "Unmatched product/release/geometry/profile")
    _require(f.source.producer_mask_definition == p.producer_mask_definition,
             "Unmatched producer mask policy")
    for name in ("id", "acquisition_id", "metadata_evidence"):
        _text(getattr(f.source, name), name)
    _time(f.source.acquired_at)
    for name in ("sha256", "power_sha256", "mask_sha256"):
        _hash(getattr(f.source, name), name)
    _require(array_sha256(f.power) == f.source.power_sha256, "Power hash changed")
    _require(array_sha256(f.mask) == f.source.mask_sha256, "Producer mask hash changed")


def _frames(c: Case) -> tuple[Frame, ...]:
    return (() if c.before is None else (c.before,)) + tuple(c.history) + (c.target,)


def _asserted_lineage(c: Case) -> dict[str, Any]:
    """Retain assertions even when a case fails validation; no raw arrays."""
    return {"event_id": c.event_id, "site_id": c.site_id, "stratum": c.stratum,
            "sources": [asdict(f.source) for f in _frames(c)],
            "grids": [asdict(f.grid) for f in _frames(c)],
            "footprint": None if c.footprint is None else {
                "definition": c.footprint.definition, "sha256": c.footprint.sha256},
            "reference": None if c.reference is None else {
                k: getattr(c.reference, k) for k in c.reference.__dataclass_fields__
                if k not in ("labels", "visible")}}


def _tokens(c: Case) -> set[str]:
    """Typed lineage keys include source asset aliases and all history acquisitions."""
    tokens = {"event:" + c.event_id, "site:" + c.site_id}
    for f in _frames(c):
        tokens.update(("source:" + f.source.id, "asset:" + f.source.sha256,
                       "acquisition:" + f.source.acquisition_id,
                       "date:" + _time(f.source.acquired_at).isoformat()))
    return tokens


def connected_groups(cases: Sequence[Case]) -> list[list[str]]:
    """Transitive connected components, never per-crop or pixel independence."""
    _require(len(cases) <= MAX_CASES, "Case count bound")
    groups: list[tuple[set[str], list[str]]] = []
    for c in cases:
        tokens, ids = _tokens(c), [c.id]
        rest = []
        for old_tokens, old_ids in groups:
            if tokens & old_tokens:
                tokens |= old_tokens; ids += old_ids
            else:
                rest.append((old_tokens, old_ids))
        # Earlier groups can become connected through a later merge.
        changed = True
        while changed:
            changed = False
            keep = []
            for old_tokens, old_ids in rest:
                if tokens & old_tokens:
                    tokens |= old_tokens; ids += old_ids; changed = True
                else:
                    keep.append((old_tokens, old_ids))
            rest = keep
        groups = rest + [(tokens, ids)]
    return sorted([sorted(ids) for _, ids in groups])


def _counts(valid: np.ndarray, **extra: int) -> dict[str, int]:
    n = int(np.count_nonzero(valid))
    return {"total_cells": valid.size, "valid_cells": n, "unknown_cells": valid.size-n, **extra}


def pair_scores(before: np.ndarray, after: np.ndarray, before_mask: np.ndarray,
                after_mask: np.ndarray) -> Scores:
    """10*(log10(after)-log10(before)); never form a power ratio."""
    _array(before, "before"); _array(after, "after", before.shape)
    _array(before_mask, "before mask", before.shape, True)
    _array(after_mask, "after mask", before.shape, True)
    b, a = before.astype(np.float64), after.astype(np.float64)
    valid = before_mask & after_mask & np.isfinite(b) & np.isfinite(a) & (b > 0) & (a > 0)
    values = np.full(b.shape, np.nan)
    values[valid] = 10 * (np.log10(a[valid]) - np.log10(b[valid]))
    return Scores(values, valid, _counts(valid))


def temporal_scores(target: np.ndarray, target_mask: np.ndarray,
                    histories: Sequence[np.ndarray], history_masks: Sequence[np.ndarray],
                    *, minimum_valid_histories: int, chunk_cells: int = CHUNK_CELLS) -> Scores:
    """Departure from causal LINEAR-power median; callers validate time/metadata."""
    _array(target, "target"); _array(target_mask, "target mask", target.shape, True)
    _require(len(histories) == len(history_masks) and 0 < len(histories) <= MAX_HISTORY,
             "History count bound")
    _require(type(minimum_valid_histories) is int and 1 <= minimum_valid_histories <= MAX_HISTORY,
             "Invalid minimum valid histories")
    _require(type(chunk_cells) is int and 1 <= chunk_cells <= CHUNK_CELLS, "Chunk cell bound")
    for power, mask in zip(histories, history_masks):
        _array(power, "history", target.shape); _array(mask, "history mask", target.shape, True)
    values = np.full(target.shape, np.nan)
    counts = np.zeros(target.shape, dtype=np.uint8)
    # No full regional temporal stack; at most 12 x 65536 float64 scratch cells.
    for start in range(0, target.size, chunk_cells):
        end = min(start + chunk_cells, target.size)
        block = np.full((len(histories), end-start), np.inf)
        for i, (power, mask) in enumerate(zip(histories, history_masks)):
            a = power.flat[start:end].astype(np.float64)
            ok = mask.flat[start:end] & np.isfinite(a) & (a > 0)
            block[i, ok] = a[ok]
        block.sort(axis=0)
        n = np.sum(np.isfinite(block), axis=0).astype(np.uint8)
        counts.flat[start:end] = n
        idx = np.arange(end-start)
        lo = block[np.maximum(n.astype(int)-1, 0)//2, idx]
        hi = block[n.astype(int)//2, idx]
        enough = n >= minimum_valid_histories
        # Use the summed midpoint when safe: subtract-then-half can round
        # unequal subnormal endpoints down before the final addition.
        # For large endpoints use the difference branch to avoid sum overflow.
        median = np.full(end-start, np.nan)
        summed = enough & (hi <= np.finfo(np.float64).max / 2)
        large = enough & ~summed
        median[summed] = (lo[summed] + hi[summed]) / 2
        median[large] = lo[large] + (hi[large]-lo[large])/2
        a = target.flat[start:end].astype(np.float64)
        ok = enough & target_mask.flat[start:end] & np.isfinite(a) & (a > 0)
        out = np.full(end-start, np.nan)
        out[ok] = 10*(np.log10(a[ok])-np.log10(median[ok]))
        values.flat[start:end] = out
    valid = np.isfinite(values)
    return Scores(values, valid, _counts(valid, insufficient_history_cells=int(
        np.count_nonzero(counts < minimum_valid_histories))), counts)


def _case_scores(c: Case, s: Spec, *, compute: bool = True) -> tuple[Scores | None, dict[str, Any]]:
    for name in ("id", "event_id", "site_id", "stratum"):
        _text(getattr(c, name), name)
    _require(c.stratum == s.profile.stratum, "Unmatched frozen stratum")
    _require(len(c.history) <= MAX_HISTORY, "History count bound")
    for f in _frames(c):
        _frame(f, s.profile)
        _aligned(c.target.grid, f.grid, exact=True)
    _require((c.footprint is None) == (s.profile.target_footprint_definition is None),
             "Unmatched frozen footprint availability")
    footprint = None
    if c.footprint is not None:
        _array(c.footprint.mask, "target footprint", c.target.power.shape, True)
        _require(c.footprint.definition == s.profile.target_footprint_definition,
                 "Unmatched frozen footprint definition")
        _hash(c.footprint.sha256, "footprint")
        _require(array_sha256(c.footprint.mask) == c.footprint.sha256, "Footprint hash changed")
        footprint = {"definition": c.footprint.definition, "sha256": c.footprint.sha256,
                     "assertion": "externally_asserted_not_certified"}
    if s.method in ("fixed_pair", "empirical_pair"):
        _require(c.before is not None and not c.history, "Pair method needs only before/target")
        _require(c.before.source.id != c.target.source.id and
                 c.before.source.acquisition_id != c.target.source.acquisition_id and
                 _time(c.before.source.acquired_at) < _time(c.target.source.acquired_at),
                 "Pair chronology/duplicate acquisition")
        _require(c.before.source.sha256 != c.target.source.sha256,
                 "Pair source asset hashes must be distinct")
        result = pair_scores(c.before.power, c.target.power, c.before.mask, c.target.mask) if compute else None
        history = None
    else:
        _require(c.before is None and 0 < len(c.history) <= MAX_HISTORY,
                 "Temporal method needs history, never pair fallback")
        times = [_time(f.source.acquired_at) for f in c.history]
        target = _time(c.target.source.acquired_at)
        all_frames = c.history + (c.target,)
        for name in ("id", "acquisition_id", "sha256"):
            ids = [getattr(f.source, name) for f in all_frames]
            _require(len(set(ids)) == len(ids), "Duplicate history/target IDs")
        _require(len(set(times)) == len(times) and times == sorted(times),
                 "History dates must be unique and chronological")
        _require(all((target-t).total_seconds() > s.history_cutoff_seconds for t in times),
                 "History future/cutoff violation")
        ages = [(target-t).total_seconds() for t in times]
        if s.maximum_history_age_seconds is not None:
            _require(all(age <= s.maximum_history_age_seconds for age in ages), "History age policy violated")
        gaps = [(b-a).total_seconds() for a, b in zip(times, times[1:] + [target])]
        if s.maximum_history_gap_seconds is not None:
            _require(all(g <= s.maximum_history_gap_seconds for g in gaps), "History gap policy violated")
        result = temporal_scores(c.target.power, c.target.mask,
                                 [f.power for f in c.history], [f.mask for f in c.history],
                                 minimum_valid_histories=s.minimum_valid_histories) if compute else None
        history = {"ages_seconds": ages, "gaps_seconds": gaps, "selection": "all_supplied_or_withheld_no_fallback"}
    if result is not None:
        if c.footprint is not None:
            result.valid &= c.footprint.mask
            result.values[~result.valid] = np.nan
            extra = {k: v for k, v in result.counts.items() if k not in ("total_cells", "valid_cells", "unknown_cells")}
            result.counts = _counts(result.valid, **extra,
                target_footprint_cells=int(np.count_nonzero(c.footprint.mask)),
                outside_target_footprint_cells=int(np.count_nonzero(~c.footprint.mask)),
                invalid_within_target_footprint_cells=int(np.count_nonzero(c.footprint.mask & ~result.valid)))
        result.counts["native_window_cells"] = result.valid.size
    lineage = {"case_id": c.id, "event_id": c.event_id, "site_id": c.site_id,
               "stratum": c.stratum, "grid": asdict(c.target.grid),
               "sources": [asdict(f.source) for f in _frames(c)], "history": history,
               "footprint": footprint,
               "coverage_denominator": "declared_target_footprint" if footprint is not None else "native_rectangular_window",
               "missing_within_requested_aoi": "counted_from_supplied_footprint" if footprint is not None else "not_inferable_without_footprint",
               "metadata_correctness": "externally_asserted_not_certified"}
    return result, lineage


def _reference(c: Case, s: Spec, scores: Scores) -> tuple[np.ndarray, dict[str, Any]]:
    r = c.reference
    _require(r is not None, "Missing independently reviewed target-stable reference")
    _array(r.labels, "reference labels", c.target.power.shape)
    _array(r.visible, "reference visibility", c.target.power.shape, True)
    _require(np.all(np.isin(r.labels, (-1, 0, 1))), "Unsupported reference labels")
    for name in ("definition", "review_id", "evidence"):
        _text(getattr(r, name), name)
    _require(r.definition == s.profile.target_stable_definition, "Unmatched frozen reference definition")
    _require(r.independently_reviewed is True and r.independent_of_detector is True and
             r.temporal_match is True, "Unreviewed/dependent/temporally unmatched reference")
    _require(_time(r.frozen_at) <= _time(s.frozen_at), "Reference frozen after policy")
    _require(_time(c.target.source.acquired_at) < _time(s.frozen_at), "Calibration data after policy freeze")
    for name, a in (("labels_sha256", r.labels), ("visible_sha256", r.visible)):
        _hash(getattr(r, name), name)
        _require(array_sha256(a) == getattr(r, name), "Reference/mask hash changed")
    stable = (r.labels == 1) & r.visible
    scored = stable & scores.valid
    counts = {"reference_total_cells": r.labels.size,
              "reference_unknown_cells": int(np.count_nonzero(r.labels == -1)),
              "reference_unobservable_cells": int(np.count_nonzero(~r.visible)),
              "visible_known_target_stable_cells": int(np.count_nonzero(stable)),
              "visible_known_nonstable_cells": int(np.count_nonzero((r.labels == 0) & r.visible)),
              "visible_unknown_cells": int(np.count_nonzero((r.labels == -1) & r.visible)),
              "scored_target_stable_cells": int(np.count_nonzero(scored)),
              "target_stable_unknown_signal_cells": int(np.count_nonzero(stable & ~scores.valid))}
    receipt = {k: getattr(r, k) for k in r.__dataclass_fields__ if k not in ("labels", "visible")}
    receipt["counts"] = counts
    return scored, receipt


def _rate(values: np.ndarray, threshold: float, lower: bool) -> float:
    return int(np.count_nonzero(values < threshold if lower else values > threshold)) / values.size


def _seal(receipt: dict[str, Any]) -> dict[str, Any]:
    receipt["receipt_sha256"] = digest(receipt)
    return receipt


def freeze(s: Spec, calibration: Sequence[Case] = (), *, heldout: Sequence[Case] = ()) -> dict[str, Any]:
    """Freeze baseline or fit empirical tails. Every case attempt stays in receipt.

    Invalid global specs raise RadarError. Invalid case evidence, leakage, lack of
    support or infeasible candidates withhold the entire fit, never drop a crop.
    """
    _spec(s)
    _require(len(calibration) + len(heldout) <= MAX_CASES, "Combined case count bound")
    receipt: dict[str, Any] = {"version": VERSION, "status": "withheld", "spec": asdict(s),
                             "spec_sha256": digest(asdict(s)), "thresholds": None,
                             "attempts": [], "heldout": [], "reasons": [],
                             "field_calibration": "not_established_by_library",
                             "metric": "target_stable_nuisance_alert_fraction",
                             "aggregation": "each_tail_on_every_crop_no_pooled_pixel_target"}
    ids = [c.id for c in tuple(calibration)+tuple(heldout)]
    if len(set(ids)) != len(ids):
        receipt["reasons"].append("Duplicate case IDs")
    if s.method == "fixed_pair" and calibration:
        receipt["reasons"].append("Fixed baseline accepts no calibration/tuning cases")
    valid_tokens: set[str] = set()
    scored_cases = []
    for c in calibration:
        attempt: dict[str, Any] = {"case_id": c.id, "status": "failed", "reasons": [],
                                   "asserted_lineage": _asserted_lineage(c)}
        receipt["attempts"].append(attempt)
        try:
            scores, lineage = _case_scores(c, s)
            valid_tokens |= _tokens(c)
            attempt.update(lineage=lineage, counts=scores.counts)
            support, reference = _reference(c, s, scores)
            attempt["reference"] = reference
            n = int(np.count_nonzero(support))
            _require(n >= s.minimum_cells, "No/insufficient declared target-stable support")
            values = scores.values[support]
            lower = [_rate(values, t, True) for t in s.lower_candidates]
            upper = [_rate(values, t, False) for t in s.upper_candidates]
            area = abs(c.target.grid.transform[1]*c.target.grid.transform[5] -
                       c.target.grid.transform[2]*c.target.grid.transform[4])
            attempt.update(status="admitted", lower_tail_rates=lower, upper_tail_rates=upper,
                           denominator_cells=n, denominator_nominal_m2=n*area,
                           target_stable_reference_sha256=digest(reference))
            scored_cases.append((c, attempt))
        except RadarError as exc:
            attempt["reasons"].append(str(exc))
            receipt["reasons"].append(f"{c.id}: {exc}")
    # Even failed evidence cases retain all parseable lineage for leakage checks.
    for c in calibration:
        try:
            valid_tokens |= _tokens(c)
        except RadarError as exc:
            receipt["reasons"].append(f"{c.id}: invalid split lineage: {exc}")
    for c in heldout:
        attempt = {"case_id": c.id, "status": "failed", "reasons": [],
                   "asserted_lineage": _asserted_lineage(c)}
        receipt["heldout"].append(attempt)
        try:
            # Register lineage only: no held-out scores/reference labels used for fitting.
            _, lineage = _case_scores(c, s, compute=False)
            tokens = _tokens(c)
            _require(not (tokens & valid_tokens), "Connected split leakage with held-out final units")
            attempt.update(status="registered", lineage=lineage, tokens=sorted(tokens),
                           lineage_sha256=digest(lineage))
        except RadarError as exc:
            attempt["reasons"].append(str(exc))
            receipt["reasons"].append(f"heldout {c.id}: {exc}")
    try:
        receipt["independent_groups"] = connected_groups(calibration)
    except RadarError as exc:
        receipt["independent_groups"] = []
        receipt["reasons"].append(str(exc))
    receipt["independent_units"] = len(receipt["independent_groups"])
    try:
        receipt["heldout_independent_groups"] = connected_groups(heldout)
    except RadarError as exc:
        receipt["heldout_independent_groups"] = []
        receipt["reasons"].append(str(exc))
    receipt["heldout_independent_units"] = len(receipt["heldout_independent_groups"])
    receipt["calibration_tokens"] = sorted(valid_tokens)
    if s.method != "fixed_pair":
        if not scored_cases:
            receipt["reasons"].append("No admitted calibration crop")
        if receipt["independent_units"] < s.minimum_independent_units:
            receipt["reasons"].append("Insufficient declared independent units")
        candidates = {"lower": list(s.lower_candidates), "upper": list(s.upper_candidates)}
        receipt["candidates"] = candidates
        feasible = {}
        bottlenecks = {}
        for tail, budget in (("lower", s.lower_tail_budget), ("upper", s.upper_tail_budget)):
            checks = []
            for i, t in enumerate(candidates[tail]):
                rates = [(c.id, a[tail+"_tail_rates"][i]) for c, a in scored_cases]
                worst = max((r for _, r in rates), default=None)
                checks.append({"threshold_db": t, "maximum_crop_rate": worst,
                               "bottleneck_case_ids": [cid for cid, r in rates if r == worst],
                               "feasible": bool(rates) and all(r <= budget for _, r in rates)})
            feasible[tail] = [x["threshold_db"] for x in checks if x["feasible"]]
            bottlenecks[tail] = checks
            if not feasible[tail]:
                receipt["reasons"].append(f"Infeasible {tail} candidate tail-area budget")
        receipt["candidate_checks"] = bottlenecks
        if not receipt["reasons"]:
            receipt["thresholds"] = {"lower_db": max(feasible["lower"]), "upper_db": min(feasible["upper"])}
            for _, attempt in scored_cases:
                lower_index = list(s.lower_candidates).index(receipt["thresholds"]["lower_db"])
                upper_index = list(s.upper_candidates).index(receipt["thresholds"]["upper_db"])
                low, high = attempt["lower_tail_rates"][lower_index], attempt["upper_tail_rates"][upper_index]
                attempt["selected_rates"] = {"decrease": low, "increase": high,
                                             "target_stable_nuisance_alert_fraction": low+high}
    elif not receipt["reasons"]:
        receipt["thresholds"] = {"lower_db": -3.0, "upper_db": 3.0}
    if not receipt["reasons"]:
        receipt["status"] = "fitted_offline_not_activated"
    return _seal(receipt)


def _restore_spec(d: dict[str, Any]) -> Spec:
    try:
        p = dict(d["profile"])
        product = dict(p["product"]); product["known_issues"] = tuple(product["known_issues"])
        grid = dict(p["grid"]); grid["shape"] = tuple(grid["shape"]); grid["transform"] = tuple(grid["transform"])
        p["product"], p["grid"] = Product(**product), Grid(**grid)
        params = dict(d); params["profile"] = Profile(**p)
        params["lower_candidates"], params["upper_candidates"] = tuple(params["lower_candidates"]), tuple(params["upper_candidates"])
        return Spec(**params)
    except (TypeError, KeyError, ValueError) as exc:
        raise RadarError("Invalid serialized policy spec") from exc


def apply(policy: dict[str, Any], c: Case, *, expected_receipt_sha256: str,
          stage: str = "final") -> Detection:
    """Caller explicitly selects a pinned fit; arrays never imply water changes."""
    _hash(expected_receipt_sha256, "external fitted-policy pin")
    raw = {k: v for k, v in policy.items() if k != "receipt_sha256"}
    _require(digest(raw) == policy.get("receipt_sha256") == expected_receipt_sha256,
             "Frozen fitted policy integrity changed")
    _require(policy.get("version") == VERSION and policy.get("status") == "fitted_offline_not_activated",
             "No usable fitted thresholds; policy withheld/version unsupported")
    s = _restore_spec(policy["spec"]); _spec(s)
    _require(digest(asdict(s)) == policy["spec_sha256"], "Frozen spec changed")
    _require(stage in ("final", "calibration", "exploratory"), "Invalid evaluation stage")
    scores, lineage = _case_scores(c, s)
    if stage == "final":
        _require(not (_tokens(c) & set(policy["calibration_tokens"])), "Final split leakage")
        registered = [x for x in policy["heldout"] if x["case_id"] == c.id and x["status"] == "registered"]
        _require(len(registered) == 1 and registered[0]["lineage_sha256"] == digest(lineage),
                 "Final case not registered in frozen holdout or lineage changed")
    elif stage == "calibration":
        registered = [x for x in policy["attempts"] if x["case_id"] == c.id and x["status"] == "admitted"]
        _require(len(registered) == 1 and digest(registered[0]["lineage"]) == digest(lineage),
                 "Calibration case not in frozen fit")
    lower, upper = policy["thresholds"]["lower_db"], policy["thresholds"]["upper_db"]
    _require(math.isfinite(lower) and lower < 0 < upper and math.isfinite(upper), "Invalid fitted thresholds")
    flags = np.full(scores.values.shape, UNKNOWN, dtype=np.int8)
    flags[scores.valid] = 0
    flags[scores.valid & (scores.values < lower)] = -1
    flags[scores.valid & (scores.values > upper)] = 1
    counts = {**scores.counts, "signal_decrease_cells": int(np.count_nonzero(flags == -1)),
              "signal_increase_cells": int(np.count_nonzero(flags == 1)),
              "no_alert_cells": int(np.count_nonzero(flags == 0))}
    receipt = {"version": VERSION, "status": "scored" if scores.counts["valid_cells"] else "withheld_no_valid_support",
               "case": lineage, "method": s.method, "stage": stage,
               "policy_sha256": expected_receipt_sha256, "thresholds": policy["thresholds"],
               "counts": counts, "valid_window_fraction": scores.counts["valid_cells"]/scores.valid.size,
               "coverage_denominator": lineage["coverage_denominator"],
               "valid_target_footprint_fraction": None if c.footprint is None or not np.any(c.footprint.mask)
               else scores.counts["valid_cells"]/scores.counts["target_footprint_cells"],
               "flags": FLAGS, "estimand": "pair_log_power_difference" if s.method != "empirical_temporal"
               else "departure_from_causal_linear_power_median",
               "field_validation": "not_established", "scores_sha256": array_sha256(scores.values),
               "flags_sha256": array_sha256(flags), "valid_sha256": array_sha256(scores.valid)}
    return Detection(receipt, scores.values, flags, scores.valid)


def support_comparison(results: Sequence[Detection]) -> dict[str, Any]:
    """Disclose per-method coverage and native intersection before comparisons.

    Does not re-score/reclassify or silently equate different temporal estimands.
    """
    _require(1 <= len(results) <= 3, "Compare at most the three declared methods")
    first = results[0]
    shape = first.valid.shape
    common = np.ones(shape, dtype=bool)
    rows = []
    for result in results:
        _require(result.valid.shape == shape and result.receipt["case"]["footprint"] == first.receipt["case"]["footprint"]
                 and result.receipt["case"]["grid"] == first.receipt["case"]["grid"]
                 and result.receipt["case"]["sources"][-1] == first.receipt["case"]["sources"][-1],
                 "Comparison must share exact target and grid")
        common &= result.valid
        rows.append({"method": result.receipt["method"], "estimand": result.receipt["estimand"],
                     "valid_cells": int(np.count_nonzero(result.valid)),
                     "unknown_cells": int(np.count_nonzero(~result.valid)),
                     "valid_sha256": array_sha256(result.valid)})
    identical = all(np.array_equal(first.valid, r.valid) for r in results[1:])
    return {"identical_support": identical, "common_cells": int(np.count_nonzero(common)),
            "common_sha256": array_sha256(common), "methods": rows,
            "comparison_rule": "identical_support" if identical else "per_method_coverage_disclosed",
            "sensitivity_and_field_validation": "not_measured_by_this_helper"}
