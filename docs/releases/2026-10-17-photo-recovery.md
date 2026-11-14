# Photo recovery deployed — 17 October 2026

Photo recovery commit [4655c2a](https://github.com/meowtappeparlechat/earthsignal/commit/4655c2a6381c35fa5eb46ec1d148cf062a28e5be) is active at [nasa.r8volt.com](https://nasa.r8volt.com/) on the Hetzner host `167.233.60.119`.

A failed, empty or oversized replacement keeps the previously selected photo and location. Missing or reversed dates now have linked field explanations, and equal dates remain valid. Photos continue to stay in the browser.

The migration initially retained web release `372bf0f`. This follow-up activates the already staged, verified release `/opt/earthsignal/web/releases/20261017-4655c2a`, retaining the previous release for web rollback. Its 2,757 files match the locally tested build. Only the web service was restarted; the science engine, private configuration, queue and scientific methods were unchanged.

Verification: 257 web tests, TypeScript, scoped ESLint and production build pass. [Source CI](https://github.com/meowtappeparlechat/earthsignal/actions/runs/38978679239) passed all three jobs. Independent Codex Sol review `c98d319df57f47cbb2aac425a86dee86` found no scoped blockers, with 27 focused tests and 16 mocked component transitions. These checks do not establish actual-phone behavior.

After activation, all three services are active; public workspace, health and session endpoints return 200, while anonymous job access returns 401. The migration receipt verified all 73 original result files at cutover. A fresh post-release check finds 58 still present with unchanged hashes, including all nine retained radar-study files; 15 ordinary-result files are now absent, alongside one fewer assessment and two fewer scenario jobs. Ordinary results remain subject to the existing seven-day expiry policy; this release does not extend their retention. HTTPS remains on the hostname-specific Cloudflare origin port 2087; the existing VPN listener on 443 was preserved.

Migration details and its separate acceptance evidence remain in [the scientific implementation checkpoint](../scientific-implementation-2026-10-12.md#revision30--recovered-hetzner-migration-17-october-2026). Broader scientific validation gates remain open.
