# Security policy

## Reporting

Please report suspected vulnerabilities privately through GitHub security advisories for `kennedy-blip/dataengine-studio`. Do not include real credentials, personal data, or production database contents in reports.

## Threat model and controls

- Uploaded files are parsed in a client Web Worker. The application does not send file contents to its server. Sources/recipes are stored in browser IndexedDB; users should export backups.
- Formula evaluation uses a whitelisted AST interpreter, never `eval` or `Function`.
- User regexes are bounded by static checks and length limits. This reduces, but cannot mathematically eliminate, all regex denial-of-service risks; workers isolate the main UI thread.
- XML DOCTYPE/entity declarations and custom YAML tags are rejected. Prototype-polluting keys are excluded during flattening and rejected by the mock API.
- REST connectors require public HTTPS destinations, validate every DNS answer, pin the chosen address, revalidate redirects, strip cross-origin sensitive headers, limit response size/time, and accept only limited request headers.
- Database connectors require both an owner-configured connection URL and a 32+ character `DATAENGINE_ACCESS_TOKEN`. Supplied connection strings must exactly match the configured value. Comparisons are constant-time. Tokens are not persisted by the browser.
- SQL is parsed as a single SELECT and executed in a read-only transaction with timeouts and row caps. MongoDB filters reject executable/lookup operators. Owners must still use least-privilege read-only database credentials.
- Private database networks require explicit owner opt-in. Database DNS checks are preflight checks; unlike REST, driver connections are not custom DNS-pinned. Configure trusted database hosts and network egress controls.
- Raw driver errors are not returned to clients or logged by the app.
- Spreadsheet exports neutralize formula injection; XLSX text is written as literal string cells.
- The mock API is stateless, validates row shapes, caps body/rows/columns/page size, and sets `Cache-Control: no-store`.
- CSP, nosniff, referrer policy, permissions policy, and same-origin checks are enabled. Frame ancestors are limited to the app, Arena, and E2B previews.

## Deployment responsibilities

The included rate limiter is in-memory and best-effort across warm serverless instances. Add edge rate limiting/WAF and authentication/authorization before exposing sensitive connectors to untrusted users. Do not enable private database access casually. Rotate `DATAENGINE_ACCESS_TOKEN` if disclosed. Browser storage is not encrypted by this app and is accessible to scripts/origins with access to the site; use a trusted deployment origin and device.

## Supported version

The deployed `main` branch and latest release are supported. Dependency overrides are recorded in `package-lock.json`; run `npm audit` and the full verification suite before releasing changes.
