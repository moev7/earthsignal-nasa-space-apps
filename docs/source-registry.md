# Observatory source registry

The authoritative machine registry is `service/observatory/sources.py`. `available` means the named adapter/capability is implemented; it does not promise coverage, valid pixels, current observations, or credential-free raster access for a particular request. A catalogue result is not an environmental measurement. Unsupported and research entries expose no implemented capabilities.

| Source ID | Implemented capability | Access and scientific limits |
| --- | --- | --- |
| `pinned-water-mosaic` | Bounded public historical JSON, provenance pin, regional class statistics | Entire 2023-03-31 repository mosaic, never a private AOI crop or Lake Mead-only estimate. Date derives from filename. Class 2 is not fractional open-water area. |
| `pinned-water-history` | Historical daily elevation context and at most 2000 requested dates with null gaps | Archived Lake Mead export, 1984–2023. Station geometry and vertical datum are absent. No volume conversion or current conditions. |
| `usgs-daily` | Public OGC v1 station metadata, exact in-area station selection, daily mean discharge and gaps | Parameter 00060, statistic 00003, one time-series/unit and station. At most 2000 records; provisional flags retained. Point discharge is not inundation or reservoir volume. |
| `opera-dswx-hls` | Actual version-1 NASA CMR granule IDs, acquisition timestamps and water COG discovery | Protected COG window reads use configured Earthdata; documented WTR codes and common native grid are checked. Discovery alone is not current-water evidence. Class 2 stays separate from class-1 area. |
| `opera-dswx-s1` | None (`unsupported`) | No DSWx-S1 assessment ingestion implemented. Existing radar workspace is separate. |
| `firms-thermal` | Official S-NPP VIIRS C2 rolling CSV; exact polygon/hole/date/confidence filter | Nominal/high confidence only, record centres at nominal 375m support. Repeat overpasses remain records. Not fire counts, hectares, damage, perimeters or safety. Worldwide seven-day feed may exceed the hard 2MiB response cap. |
| `nifc-perimeters` | Separate WFIGS current perimeter discovery, at most 20 records per envelope | Bounded source polygons; large/invalid geometry excluded. DateCurrent is update time. Search-envelope overlap is not exact AOI exposure or historical completeness. |
| `sentinel-2-indices` | EarthSearch Sentinel Collection 1 discovery, calibrated red/NIR/SWIR/SCL assets, raster crop integration and common-population comparison | Public COG ranges; requires native science runtime. NDVI/NDMI are spectral indices, not biodiversity, soil moisture or causes. At most four discovered scenes and two compatible crop dates. |
| `hls-ndvi-ndmi` | Actual HLSL30 v2 CMR granule discovery | Authenticated HLSL30 v2 native 30m COG crops verify Fmask, calibration and integer alignment. Public Sentinel pixels are a separate source. |
| `landsat-c2-lst` | EarthSearch Collection 2 metadata, actual thermal/QA_PIXEL assets, calibrated crop integration | Declared thermal scale 0.00341802 and offset 149 kelvin required. AWS can require requester-pays access; no paid fallback. Surface temperature is not air temperature or personal heat exposure. |
| `nlcd-histories` | None (`unsupported`) | Annual NLCD release-specific public COG endpoints have not been verified/implemented. Older multi-year products are not substituted. |
| `nws-weather-context` | Official points/forecast/active-alert metadata | Current context at a US grid/point, separately dated from the requested observation period. No local private prediction or danger advice; no-alert query is not safety. |
| `nex-gddp` | None (`research`) | No validated local prediction or climate scenario ingestion. |

Primary specifications consulted: [USGS OGC API](https://api.waterdata.usgs.gov/docs/ogcapi/), [NASA FIRMS public downloads](https://firms.modaps.eosdis.nasa.gov/active_fire), [Element84 EarthSearch](https://github.com/Element84/earth-search/blob/main/README.md), [Sentinel Collection 1 catalogue](https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a), [Landsat surface temperature](https://www.usgs.gov/landsat-missions/landsat-collection-2-surface-temperature), [CMR search](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html), [NIFC perimeter service metadata](https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0?f=pjson), [NWS API](https://www.weather.gov/documentation/services-web-api).

## Science worker checkpoint, 2026-10-09

Team `earthsignal-decision-observatory-20261009`, science assignment `1c728b3345394b13a756edbd28736015`, revision 1. Coordinator retains review/integration authority. Browser design consultation was already covered by coordinator receipt `13ca4775-7638-4706-b416-df0aa75527d0`; this bounded worker did not initiate consultation, delegation, deployment or credential reads.

Read-only live probes and engine roundtrips reached actual public endpoints. The source-specific smoke requires a genuine domain source, manifest validation and exactly five artifacts, rather than accepting NWS context alone for ecology/urban. It passed in 19.3 seconds using the local Python 3.14 interpreter. These are technical checks, not human usability or independent pilot acceptance.

| Case | Actual evidence/check | Result |
| --- | --- | --- |
| Water, Hoover Dam point, 2025-06-01–03 | USGS-09421500, time-series `ad7aed75280e439c96815ccf2ac3f889`; metadata SHA256 `57c1e29b2fd0ad24ad7e4afba0ec3ff08aa93b2b79734e8894c860622d42e17b`; daily response SHA256 `ada7695c2524dc089664885e895074a13f07a889ec6f8ae8e662b12d293a5d3e` | Three observations; last 17600 ft³/s; observed endpoint difference 3300 ft³/s; partial area assessment. |
| Water satellite discovery | `G3558717017-POCLOUD` and `G3581454238-POCLOUD`, DSWx-HLS v1.0 | Real acquisitions and protected water COG URLs retained in provenance notes; no pixel claim. |
| Fire, bounding polygon −84/45 to −78/49, 2026-10-08–09 | Official USA-contiguous-and-Hawaii 24h S-NPP feed; SHA256 `ed14080fec88683612d8a864ece58b9a27133375f1aa837d210b66edd6ddf671`, version 2.0NRT | Seven qualifying thermal records; partial. This polygon includes non-US territory; the feed's spatial completeness is not claimed. NWS point query failed honestly. |
| Ecology, small polygon near −115/35.94, June 2025 | Actual C1 Sentinel scenes June 13/18/23/28, including `S2C_T11SPV_20250628T182903_L2A`; item SHA256 `c30e58918060026e5ecfc949e6122bade77b4c740fc74170c2f78304cf5116fa` | Real calibrated assets discovered. HLS IDs `G3585103458-LPCLOUD`, `G3573082813-LPCLOUD` also returned. Local measurements unavailable without native runtime. |
| Urban, same small polygon, June 2025 | `LC08_L2SP_039035_20250601_02_T1`, `LC09_L2SP_039035_20250609_02_T1`, June 17/25 endpoints; June 25 item SHA256 `258e7655d9811811b01792c5db34a09773121e763278f865885c42438b8a8121` | Real thermal/QA metadata and scaling; local measurements unavailable without native runtime. AWS raster access remains a separate gate. |

Negative evidence: EarthSearch GET sorting by `datetime` returned HTTP 400; verified `+properties.datetime` and `-properties.datetime` return HTTP 200 and are now used. No retry/fallback loop was added. Local `/opt/homebrew/opt/python@3.14/bin/python3.14` has no NumPy, rasterio, GDAL or pytest, and project `.venv` is absent. Actual remote raster measurement and its memory envelope require coordinator verification in the provisioned native science runtime. The deterministic engine comparison test checks wiring only; it does not establish real raster scientific accuracy.

### Coordinator verification, 2026-10-09

Isolated native GDAL checks on the production VM used the public crop [-115, 35.94, -114.99, 35.95] and June 2025 acquisitions. These are transport/method checks, not validated decision pilots.

- Sentinel-2: June 18–28, 2,500/2,500 common valid pixels; median pixelwise NDVI difference −0.0036230563 and NDMI difference −0.0058737758. Sixteen raster/preview artifacts independently reconciled; 12,873,452 bytes transferred.
- OPERA DSWx-HLS: June 28 yielded 1,113 valid pixels and zero class-1/class-2 mapped footprints in this desert patch. The earlier acquisition had no valid pixels, so common change was withheld. Authenticated windowed reads transferred 137,987 bytes.
- Planetary Computer Landsat C2 L2SP: June 9–25, 1,114/1,114 common valid pixels; median pixelwise surface-temperature difference −3.74956794 K. Eight raster/preview artifacts independently reconciled; 424,275 bytes transferred, 179.9 MiB peak memory, 3.143 seconds. This is surface temperature, not air temperature.

Urban defaults to the separate `landsat-pc-lst` adapter. The AWS adapter remains explicitly selectable and reports its access gate; no requester-pays fallback is enabled. Canonical unsigned Azure asset URLs identify inputs; temporary read-only SAS tokens are runtime-only and excluded from exported records. See [Microsoft's dataset](https://planetarycomputer.microsoft.com/dataset/landsat-c2-l2) and [USGS product definitions](https://www.usgs.gov/landsat-missions/landsat-collection-2-surface-temperature).
