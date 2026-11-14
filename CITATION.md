# Citing Earthsignal

Earthsignal is a private, proprietary software repository. All rights are reserved by the repository owner as defined in [CONTRIBUTING.md](CONTRIBUTING.md).

When authorized internal collaborators or reviewers reference this codebase in reports, research memos, or evaluation benchmarks, cite the specific immutable Git commit hash, the repository URL, and the date accessed.

---

## Software Citation Format

Use the immutable commit snapshot. Formal authorship, release and DOI metadata have not been established by this guide; do not infer a published release from a package version. This Markdown guide does not create a CFF citation record or change repository permissions.

### Recommended Plain-Text Citation

```text
Earthsignal Observatory codebase (Git commit <COMMIT_HASH>), accessed <YYYY-MM-DD>, https://github.com/meowtappeparlechat/earthsignal/tree/<COMMIT_HASH>. Private repository.
```

### BibTeX Entry

```bibtex
@misc{earthsignal_codebase,
  title        = {Earthsignal Observatory},
  howpublished = {Private Git repository},
  url          = {https://github.com/meowtappeparlechat/earthsignal/tree/<COMMIT_HASH>},
  note         = {Git commit <COMMIT_HASH>; accessed <YYYY-MM-DD>. Proprietary; all rights reserved}
}
```

Replace `<COMMIT_HASH>` with the full commit SHA from `git rev-parse HEAD`, and `<YYYY-MM-DD>` with the actual retrieval date. The immutable link remains accessible only to readers who already have repository access. Use verified contributor/release metadata if it is formally supplied later.

---

## Code Citation vs. Upstream Data & Scientific Citation

Citing the Earthsignal software repository cites only the computational pipeline, user interface, and analytical algorithms. **A code citation does not constitute an upstream data citation or validation of upstream satellite and in-situ observations.**

When reporting scientific findings or publishing analyses generated with Earthsignal, cite both the software commit and the upstream data sources, recording:

1. **Sensor & Platform**: Exact instrument (e.g., NISAR L-band SAR, Sentinel-2 MSI, Landsat 8/9 TIRS, VIIRS).
2. **Provider & Archive**: Upstream distributing provider (e.g., NASA CMR, Alaska Satellite Facility, USGS, ESA Copernicus/EarthSearch, Planetary Computer).
3. **Product & Processing Level**: Full product designator (e.g., NISAR L2 GCOV, OPERA DSWx-HLS v1.0, Landsat Collection 2 Level-2 Surface Temperature).
4. **Acquisition Timestamps & Identifiers**: Granule IDs, overpass dates, and orbit/track/frame details.
5. **Quality Masks & Exceptions**: Subswath masks, cloud/shadow masks, and exception schemas applied.
6. **Processing Methods & Parameters**: Grid resolution, bounding box, polarization channel (e.g., Frequency A HHHH), and logarithmic difference equations.

See the [Observatory Source Registry](docs/source-registry.md) for official provider endpoints and the [Scientific Foundation](docs/science.md) for algorithm specifications.

---

## Rights & Contribution Policy

Citing this software does not grant public distribution rights, open-source licensing, or rights to redistribute private code or internal credentials. Refer to [CONTRIBUTING.md](CONTRIBUTING.md) for full terms.
