# DataEngine Studio

A local-first, end-to-end data processing workspace built with **Next.js App Router, TypeScript, Tailwind CSS, Lucide, Framer Motion, TanStack Table, Recharts, and client-side Web Workers**.

Import raw files or connect a source, normalize the structure, build a replayable cleaning/transformation recipe, validate quality, explore charts, and export the result — without uploading your files to an application server.

## Quick start

Requires Node.js 22+ and npm.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. The first visit loads three explicitly synthetic sample datasets. Use **Import data** for your own files, or **Settings → Clear workspace** to start empty.

```bash
npm run typecheck
npm run lint
npm test                 # 79 unit/integration tests
npm run build            # verified production build
npm start
```

Optional real-browser smoke checks (against a running production server):

```bash
npx playwright install --with-deps chromium
npm run test:browser
# Custom target:
BASE_URL=https://your-deployment.example npm run test:browser
# Skip the external GitHub REST check in restricted networks:
SKIP_REST=1 npm run test:browser
```

The browser script exercises imports, the worker pipeline, formula logic, undo/redo, all six exports, validation, charts, the live mock API, IndexedDB persistence, keyboard commands, and mobile navigation. Screenshots and downloaded test artifacts go to the ignored `.playwright-cli/` directory.

## The six-stage workflow

| Stage | Implemented capabilities |
| --- | --- |
| **1. Import** | Multi-file drag/drop; CSV, TSV, XLSX, XLS, Parquet; PDF, DOCX, TXT, RTF, Markdown; JSON, JSONL, XML, YAML; HTTPS REST snapshots; owner-configured PostgreSQL, MySQL, and MongoDB snapshots. |
| **2. Normalize** | Header detection; Integer/Float/String/Datetime/Boolean inference; UTF-8/Latin-1/Windows-1252 detection; comma/tab/pipe/semicolon resolution; nested-object flattening; spreadsheet sheets; PDF/DOCX table extraction. |
| **3. Clean** | Drop/fill missing values (mean, median, mode, constant, forward/backfill); exact and bounded fuzzy deduplication; whitespace/case/HTML/special-character/regex normalization; email and E.164 phone formatting; date/currency/type casts; IQR/Z-score outlier capping/filtering; row filters. |
| **4. Transform** | Pivot/melt; column splitting; date components; text length; numeric bins; multi-column group rollups; cumulative totals; rolling averages; inner/left/right/full joins; vertical/horizontal concatenation; safe calculated-column formulas; explicitly simulated NLP enrichment. |
| **5. Validate** | Required columns, strict types, non-null fields, unique keys, numeric bounds, bounded regex patterns, allowed values; missing/duplicate/anomaly/schema health dashboard; export warning for rule violations. |
| **6. Serve** | Styled XLSX, CSV, JSON, Parquet, PDF summary, DOCX; TanStack grid with search/sort/filter/pagination/selection/column visibility/record inspection; bar/line/scatter/correlation-heatmap/histogram charts; stateless mock REST API and full JSON webhook payloads. |

Every recipe runs from the original source snapshot. Steps can be added, edited, disabled, reordered, removed, undone, and redone. Secondary join/concat inputs are original snapshots, which prevents circular dependencies.

## Architecture

```text
src/app/                  Next.js App Router, global styles, API routes
src/components/           Workspace shell, importer, operation drawers, grid,
                          charts, quality dashboard, exports, API playground
src/hooks/useDataEngine.ts Worker lifecycle, recipes, history, IndexedDB persistence
src/workers/data.worker.ts Parsing and pipeline execution off the main thread
src/lib/                  Typed data model, parsers, transformations, safe formula
                          compiler, quality analysis, export writers, server guards
tests/                    Vitest unit/integration coverage
scripts/                  PDF asset preparation and Playwright smoke checks
public/                   Locally served PDF.js worker, CMaps, and standard fonts
```

- **No application database is required.** Sources and recipes are stored in the current browser’s IndexedDB. Browser eviction/private browsing can remove them; export important results.
- **Files are processed locally.** PDF.js runs its own worker inside the data worker. Fonts/CMaps are served from this app, not a third-party CDN.
- **No analytics or external AI calls.** Sample records are synthetic.
- **Server routes are opt-in connectors and a stateless mock API.** They do not persist dataset contents.

## Import notes and limits

- 100 MB per file; 250,000 rows per table; 500 source columns.
- XLSX/XLS: first 20 nonempty worksheets; stored formula values are imported, external links are not executed.
- PDF: first 100 pages. Tables are reconstructed from text coordinates and consistent column counts; verify headers and merged cells. Scanned/image-only PDFs require OCR before import.
- DOCX: tables are extracted from document layout; without a table, paragraphs become rows.
- RTF: basic control-word/text extraction. Complex embedded tables should be converted to DOCX first.
- JSON: nested objects use dot-separated keys; nested arrays are JSON strings. API envelopes are searched for record arrays.
- Fuzzy deduplication: up to 10,000 rows, normalized keys, bounded edit distance, two-character prefix/suffix candidate blocks. Edits outside both blocks can be missed.
- Pivot: up to 200 distinct categories. Joins are type-sensitive and may be many-to-many; output is guarded at 250,000 rows.
- Regex patterns are statically checked for unsafe repetition and limited to 200 characters.

## Formula builder

No `eval`, `Function`, JavaScript property access, or arbitrary code execution. Columns are referenced with brackets; quoted bracket names are also accepted.

```text
IF([monthly_spend] > 100) THEN "High value" ELSE "Standard"
IF([score] >= 80, "Pass", "Review")
ROUND([price] * [quantity], 2)
CONCAT([first_name], " ", [last_name])
COALESCE([revenue], 0) * 0.2
```

Operators: `+ - * / % ^ > < >= <= = != AND OR NOT`. Functions include `ROUND, ABS, SQRT, MIN, MAX, CONCAT, UPPER, LOWER, TRIM, LEN, COALESCE, ISNULL, YEAR, MONTH`. Row-level errors become null and are counted in the run log.

## Quality score

The score starts at 100 and subtracts capped, weighted penalties:

- Missing cells: up to 40 points.
- Exact duplicate rows: up to 20 points.
- Numeric IQR anomalies: up to 20 points.
- Active schema-rule violations: up to 40 points.

Anomalies use column-wise `1.5 × IQR` with at least eight numeric values. The score is a useful signal, not a guarantee of business correctness. Validation reports issues without deleting rows.

## Export notes

- **XLSX:** bold/filled headers, frozen header row, autofilter, column widths, numeric formats, and a quality-summary sheet.
- **CSV:** UTF-8 BOM; potentially dangerous spreadsheet formulas are prefixed with an apostrophe.
- **JSON:** exact typed records; webhook download adds schema and metadata.
- **Parquet:** typed columns, native nulls, uncompressed for broad compatibility.
- **PDF:** summary report, not a full data dump. Built-in Latin fonts approximate non-Latin characters; use the data formats for exact Unicode.
- **DOCX:** quality summary plus up to 5,000 rows and 20 columns. Use XLSX/CSV/Parquet for the complete table.

## Mock REST API

`POST /api/mock` is a real stateless endpoint. Submit cleaned rows in the body; receive schema metadata and a paginated JSON response. Nothing is stored or published.

```bash
curl -X POST http://localhost:3000/api/mock \
  -H 'Content-Type: application/json' \
  -d '{
    "dataset": "customers",
    "limit": 100,
    "offset": 0,
    "fields": ["id", "name"],
    "data": [{"id": 1, "name": "Ada"}, {"id": 2, "name": "Grace"}]
  }'
```

Limits: 2 MB request body, 10,000 rows, 200 columns, page size up to 1,000. The playground sends up to 1,000 rows; the webhook download contains the full current result. A persistent public GET API would require a storage backend and access controls and is intentionally not faked.

`GET /api/health` returns service health.

## REST and database connectors

### REST

Read-only HTTPS GET on port 443/8443; JSON/CSV/XML/YAML; 4 MB and 10,000-row limits. DNS answers must be public; the resolved address is pinned for the request; redirects are revalidated; sensitive headers are stripped on cross-origin redirects. Optional `Authorization`/`X-API-Key` values are used once and never saved.

### PostgreSQL, MySQL, MongoDB

Database access is **owner-configured and token-protected**, not an anonymous proxy for arbitrary connection strings:

1. Set the relevant connection URL in the deployment environment.
2. Set `DATAENGINE_ACCESS_TOKEN` to a random secret of at least 32 characters.
3. Redeploy. In **Import data → Database**, enter that workspace access token. Leave the connection string blank to use the configured connection, or supply the exact configured string.
4. Use a read-only database user with TLS. SQL accepts one `SELECT`; MongoDB accepts a collection and a restricted JSON filter.

See `.env.example`. Private database hosts are blocked unless the owner explicitly sets `DATAENGINE_ALLOW_PRIVATE_DATABASES=true` and network routing permits it. Driver errors are sanitized. Tokens, connection strings, queries, and API header values are not persisted in workspace storage.

## Deploy to Vercel + GitHub

1. Push this repository to GitHub.
2. Import it in Vercel with the **Next.js** preset, Node.js 22, install `npm ci`, build `npm run build`.
3. Add the optional connector environment variables above. The core local-first app needs no environment variables.
4. Deploy. Connect the Git repository for subsequent deployments.

The app binds preview/dev servers to `0.0.0.0` and uses relative browser API URLs. Security headers include a CSP; `frame-ancestors` permits the app itself, Arena, and the E2B preview domain. Adjust that list if embedding on another site.

## Production boundaries

This is a functional single-workspace product, not a multi-tenant SaaS identity system. There is no account/login layer, shared cloud dataset storage, background job queue, or OCR service. AI/NLP features are deterministic simulations and are labeled as such in the UI. For sensitive shared deployments, add authentication/authorization and edge rate limiting (for example Vercel Firewall) in front of connector routes; the included in-memory rate limiter is best-effort across warm serverless instances.

## Security

See [SECURITY.md](SECURITY.md). Never commit `.env` files or database credentials.
