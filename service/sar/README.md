# Native SAR backend boundaries

Current processing identity: `native-sar-study-2`. A completed result is private;
verification does not authorize a public release or establish redistribution rights.
Historical method-1 receipts remain historical; rerun rather than relabel them.

## Implemented numerical paths

* NISAR GCOV: Frequency A HH diagonal gamma0 only, producer schemas 1.5.0/1.6.0
  admitted by `service.processing.inspect_metadata`. Reuses its exception/focus
  masks and full frame/look/release/mode comparison checks. Different native grids
  reject; there is no analytical resampling.
* NISAR GUNW: schema 1.5.0 Frequency A HH single-pair relative LOS in millimetres.
  Reads a bounded native window, excludes fill/reserved quality values, screens
  coherence at 0.6, keeps one connected component, subtracts the ionosphere screen
  and references the valid-population median (at least 50 samples). No fixed-height
  geometry, troposphere correction, vertical decomposition or rate is inferred.
  The inherited phase-sign convention still requires independent real-source
  validation before a verified public ground-motion claim.
* RADARSAT-1 L1 COG: explicit native pixel-window **magnitude** in source units.
  Complex storage is reduced to magnitude for this operation only. Calibration,
  geographic geocoding from GCPs and a backscatter/time-change claim are withheld.
* RCM CEOS ARD: exact original metadata binds the selected channel, gamma0 linear
  power, float32 storage and quality-code raster. Operator license approval is
  required before imagery reads. Both source masks/grids must match exactly.
* UAVSAR: explicit GRD/annotation links, diagonal HH/HV/VV real float32 power,
  declared grid and antenna calibration. Ambiguous link sets reject. The result
  records producer power and source-defined area normalization, **not an inferred
  sigma0/gamma0 equivalence**. GRD registration, byte convention and scientific
  calibration still need an actual independently reproduced source pilot.

## Concrete unsupported gates

* GOFF: bounded schema 1.6 Frequency A slant-range/along-track offsets in metres,
  declared matching layer 1–3. Uses variance, SNR, correlation peak and co-registered
  focus/subswath/anomaly masks. These are native unculled offsets, not LOS, vertical
  motion or velocity. The actual 13 August–5 November source pilot rejected its
  older specification after 2.1 MB; no original-source numerical verification is claimed.
* GSLC: bounded schema 1.6 complex64 Frequency A beta0 (abs(DN)^2) observation,
  original complex crop bytes retained in provenance. The actual validated 28 October
  product lacks the producer-defined isReceiveOnly attribute; execution rejects
  before science reads rather than assuming transmit state. Pair processing remains
  withheld until acquisition-mode compatibility is separately verified.
* SAOCOM: no verified CONAE access/license grant or level-specific numerical
  reader. Discovery/execution retain explicit access gates; no terms acceptance
  or generic TIFF calibration substitution is implemented.
* Additional GCOV channels/frequencies, UAVSAR cross terms and cross-sensor
  numerical subtraction are not supported by these contracts.

## Verification and resource evidence

Native remote reads require HTTPS allowlists, range-only transport, stable source
length and a strong ETag. Missing/weak validators fail closed; there is no entire
science-file fallback. TIFF decoding stays in an isolated bounded process so GDAL
cannot deadlock the range proxy. Non-identity TIFF scale/offset calibration rejects
the calibrated path; raw pixel magnitude remains explicitly uncalibrated.

The hard crop cap is 262,144 pixels; configured smaller output limits also apply.
Each artifact is at most 8 MiB. Temporal comparisons retain both source value/mask
populations in provenance and independently recompute their hashes and exact
common-valid subtraction before commit. Their provenance can hit the byte cap
before the pixel cap; choose a smaller crop rather than omit verification evidence.
Hashes check integrity and identity consistency; they do not authenticate upstream
authorship or substitute for an independent scientific review.

`test_sar*.py` uses analytical/synthetic HDF5/TIFF/transport fixtures and explicit
corruption/cancellation cases. These are regression evidence, not live processing
receipts. Root owns upstream pilots, source/license approval, API/TS integration
and publication. Existing local RCM XML and UAVSAR catalog records can establish
metadata parsing/link selection only; they do not prove numerical source success.
