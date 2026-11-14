# One real gauge retrieval, preserved as received

Credit: **U.S. Geological Survey**. This bounded example retrieved three daily
mean discharge records for **USGS-09421500**, 1–3 June 2025, on **12 October
2026**. The original response bytes and their retrieval receipts are pinned
beside the owner-free archive snapshot. The snapshot is historical data
retrieved now; it does not establish availability in June 2025, forecast skill,
flooding, or a regional condition.

The local check used 7,065 transferred bytes and about 1.94 seconds. Its
standalone macOS Python process peaked at 35,192,832 bytes RSS; this is not a
concurrent production load test. The small SQLite ledger occupied 20,480 bytes.
A separate October 2026 date-window check returned no usable daily records;
no current observations were substituted with this historical example.

Run from the repository root:

```sh
service/.venv/bin/python -m service.verify_gauge_vintage
```

This offline check hashes the original responses, replays the actual provider
filters/duplicate policy into a new temporary ledger, verifies the protected
snapshot contract, and compares the complete snapshot to the frozen receipt.
It neither downloads new values nor changes an issued result.

The frozen responses are data produced by the USGS API. USGS describes its
own produced data as US public-domain information and requests attribution:
[USGS copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits).
This receipt does not extend that permission to unrelated third-party datasets,
logos, photographs or code. Approval and qualifiers remain in the data;
[USGS provisional-data statement](https://waterdata.usgs.gov/provisional-data-statement/).

`forecast-information.json` is a new timing-only report derived from this exact
snapshot using `forecast_information`. It retains all three completed June2025
station-days and shows every1/3/7-day target as expired at the actual October2026
receipt cutoff. It does not backdate receipt availability or establish forecasting
skill. The original capture, source responses and measurements are unchanged.
The new report's information-set hash binds the compact report and the internal
retention/exclusion ledger and points; reproducing it requires the whole derived
result, as described in [forecast-information.md](../../docs/forecast-information.md).
