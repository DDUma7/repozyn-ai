# 🔥 Repozyn AI — GitHub Roast & Rescue

> Built for a university hackathon challenge: *GitHub Roast and Rescue*.
> Enter a public GitHub username and get a recruiter-style first impression, a transparent health score, evidence-backed roasts, and a concrete plan to fix the profile.

Repozyn AI is **rule-based**. There is no LLM: every score, roast and recommendation is computed by deterministic code from public GitHub profile and repository metadata, and each one shows the data it was derived from.

---

## Features

1. **Profile audit** — fetches the public profile and up to the 100 most recently updated public repositories of a GitHub user.
2. **Recruiter first impression** — an archetype (for example *Fork Collector*, *Dormant Veteran*, *Open Source Trailblazer*), a hireability signal, green flags and friction points. This section is heuristic and is labelled as such.
3. **4-pillar health score (0–100)** — 25 points per pillar, with an expandable breakdown of every point:
   - **Documentation & Clarity**: repository descriptions, topic tags, profile completeness (bio, website, location).
   - **Originality & Independence**: ratio of original repositories to forks, total stars.
   - **Maintenance & Cadence**: days since the last push, share of repositories untouched for over a year.
   - **Professional Hygiene**: license coverage and live demo links on original repositories.
4. **Roast station** — humorous observations, each paired with the evidence behind it. The Mild / Medium / Savage switch filters which roasts are shown.
5. **Before & After Rescue Simulator** — toggle realistic fixes and see the projected score, recomputed with the same rubric. Projections are labelled as estimates.
6. **Rescue roadmap** — a prioritised checklist with effort estimates, copyable templates and progress tracking.
7. **Profile Makeover** — generates an editable profile `README.md` from the audited data, with a rendered preview, copy and download.
8. **Repository explorer** — filter, search and sort the analysed repositories.
9. **Markdown export** — the full audit as GitHub Flavored Markdown.
10. **Shareable links** — the URL tracks the audit on screen (`?user=<login>` or `?demo=<persona id>`), so *Share Audit* copies a link that reopens it.
11. **Demo personas** — three built-in profiles that work without any API calls. They are **synthetic** and are labelled *Sample Data* throughout the UI, the generated README and the exported report.
12. **Rate-limit handling** — live quota indicator, a recovery banner with reset time, and optional personal access token support.

### Known limits

- Only repository *metadata* is analysed. README contents, commit history and code quality are not inspected.
- Accounts with more than 100 public repositories are scored on the 100 most recently updated.
- The recruiter impression is a heuristic, not a hiring prediction.

---

## Architecture

```
repozyn-ai/
├── server.js                 # Production server: static files + GitHub API proxy
├── vite.config.ts            # Dev server, including the equivalent dev proxy
├── Dockerfile                # Multi-stage build for container hosting
├── src/
│   ├── App.tsx               # State, search flow, deep links, layout
│   ├── components/           # Navbar, SearchHero, ProfileHeader, RecruiterImpressionCard,
│   │                         # HealthScoreSection, RoastSection, PortfolioSimulatorSection,
│   │                         # RescueRoadmapSection, RepositoryExplorer, TokenModal,
│   │                         # MarkdownReportModal, ProfileMakeoverModal
│   ├── hooks/                # useDialogAccessibility (focus trap, Escape, focus restore)
│   ├── services/
│   │   ├── github.ts         # API client: proxy first, direct fallback, cache, rate-limit parsing
│   │   ├── analyzer.ts       # Facts, scoring rubric, recruiter impression, roasts, roadmap
│   │   └── simulator.ts      # Projected scores using the same rubric
│   ├── utils/                # Markdown report and profile README generators
│   ├── data/mockProfiles.ts  # Synthetic demo personas
│   └── types/
└── *.test.* files            # See "Testing"
```

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide icons.
- **Backend**: a dependency-free Node.js server (`server.js`). There is no database and no analytics.

### How data flows

The browser calls the app's own endpoints, which forward to the GitHub REST API:

| App endpoint | GitHub endpoint |
| :--- | :--- |
| `/api/github/user/:username` | `/users/:username` |
| `/api/github/repos/:username` | `/users/:username/repos` (100 most recently updated) |
| `/api/github/rate_limit` | `/rate_limit` |

If the proxy cannot be reached, the browser falls back to calling `api.github.com` directly. All analysis then runs in the browser.

### Server-side proxy protections

- Public responses are cached in memory for 15 minutes ("user not found" for 5), and identical in-flight lookups share one upstream request.
- Per-client request limits, a per-client budget for uncached lookups, a global budget on the shared quota, a cap on concurrent upstream requests, and an upstream timeout.
- Usernames and tokens are validated before anything is sent upstream.
- Static files are served only from inside `dist/`; encoded path traversal, symlink escapes and malformed URLs are rejected.

Limits are held in memory per server instance and can be tuned with environment variables:

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `8080` | Listening port |
| `GITHUB_TOKEN` | unset | Optional server-side token that raises the shared GitHub quota |
| `TRUST_PROXY` | on when `K_SERVICE` is set | Read the client IP from the last `X-Forwarded-For` hop |
| `PROXY_RATE_LIMIT_MAX` / `PROXY_RATE_LIMIT_WINDOW_MS` | `120` / `60000` | Proxy requests per client per window |
| `PROXY_UPSTREAM_IP_MAX` / `PROXY_UPSTREAM_IP_WINDOW_MS` | `60` / `600000` | Uncached lookups per client per window |
| `PROXY_UPSTREAM_GLOBAL_MAX` / `PROXY_UPSTREAM_GLOBAL_WINDOW_MS` | `2000` / `3600000` | Uncached lookups on the shared quota per window |
| `PROXY_MAX_CONCURRENT` | `8` | Concurrent upstream requests |
| `PROXY_UPSTREAM_TIMEOUT_MS` | `8000` | Upstream timeout |

---

## Security & token handling

- **No secrets in the client bundle.** `GITHUB_TOKEN`, if set, lives only on the server, is sent only to GitHub, and is never returned to the browser.
- **Personal tokens are optional.** A token entered in the app is kept in the browser tab's `sessionStorage` and sent with each lookup to the app's proxy in an `x-github-token` header. The proxy forwards it to `api.github.com` as an `Authorization` header and does not log, cache or persist it; responses fetched with a personal token never enter the shared cache. The token is cleared when the tab closes. Use a read-only token with no extra scopes.
- `.dockerignore` and `.gcloudignore` exclude `.env` files, keys, credential files, `.git`, `node_modules` and build output.

---

## Local development

Requires Node.js 22 or newer and npm.

```bash
npm install
npm run dev        # http://localhost:5173
```

Unauthenticated GitHub access is limited to 60 requests per hour per IP. To raise it locally, either add a token in the app or start the dev server with one:

```bash
GITHUB_TOKEN=<your token> npm run dev
```

Other commands:

```bash
npm run lint       # oxlint
npm test           # vitest
npm run build      # type-check and build to dist/
npm start          # serve dist/ with server.js on $PORT (default 8080)
```

---

## Testing

`npm test` runs the whole suite with Vitest:

- **Analysis logic** — scoring rubric, simulator, README generator and its sanitisation (`src/services/*.test.ts`, `src/utils/*.test.ts`).
- **API client** — caching, de-duplication, rate-limit and error handling (`src/services/github.test.ts`).
- **UI** — components, dialogs and accessibility attributes, profile switching, stale responses, search errors, sample-data labelling, the persona menu and shareable links (`src/**/*.test.tsx`).
- **Production server** — HTTP-level tests against a real `node server.js` process: path containment, malformed requests, proxy limits, caching and timeouts (`server.test.js`).
- **Dev proxy** — token forwarding through a real Vite dev server (`vite.proxy.test.js`).
- **Deployment hygiene** — ignore files and privacy wording (`deploy.config.test.js`).

The server and dev-proxy tests start short-lived local processes on free ports and use a local stand-in for the GitHub API; they make no external network calls.

---

## Deployment (Google Cloud Run)

The repository contains a multi-stage `Dockerfile` that builds the app and runs `server.js` as a non-root user, listening on `$PORT` with a `/health` endpoint.

```bash
gcloud auth login
gcloud config set project <YOUR_PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com

gcloud run deploy repozyn-ai \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --max-instances 1
```

Notes:

- **Set a server token.** Without `GITHUB_TOKEN` the service shares GitHub's 60 requests per hour for its outbound IP. Provide it through Secret Manager, for example `--set-secrets GITHUB_TOKEN=<secret-name>:latest`, rather than committing it or passing it in plain text.
- **Instance count.** Rate limits and the response cache are in memory per instance, so `--max-instances 1` keeps the limits exact. With more instances each one enforces its own.
- To check the container locally before deploying:

  ```bash
  docker build -t repozyn-ai .
  docker run -p 8080:8080 repozyn-ai
  curl http://localhost:8080/health
  ```
