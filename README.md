# 🔥 Repozyn AI — GitHub Roast & Rescue

> Built for a university hackathon challenge: *GitHub Roast and Rescue*.
> Enter a public GitHub username and get a recruiter-style first impression, a transparent health score, evidence-backed roasts, and a concrete plan to fix the profile.

Repozyn AI is **rule-based**. There is no LLM: every score, roast and recommendation is computed by deterministic code from public GitHub profile and repository metadata, and each one shows the data it was derived from.

---

## The challenge

> **GitHub Roast and Rescue: Give a messy GitHub profile the honest feedback it deserves.**
>
> **Problem.** Student GitHub profiles are often empty, messy or full of half-finished projects, and students lack clear guidance about what a good portfolio looks like.
>
> **Mission.** Build an application that takes a GitHub username, reads real public GitHub data and tells the owner the truth in a way they will actually listen to.

### How Repozyn AI answers the three key questions

| Key question | What the app does |
| :--- | :--- |
| **What does a recruiter notice in 30 seconds?** | The first section after the profile header is a recruiter first impression: an archetype, a one-line 30-second verdict, and the green flags and friction points behind it, each quoting the data it came from. It is a rule-based simulation and is labelled as one. |
| **How can feedback be funny without being cruel?** | Every roast is paired with the evidence that triggered it, jokes target the profile and never the person, and the tone can be set to Mild, Medium or Savage. An empty profile gets one gentle roast rather than invented faults. |
| **What helps someone actually improve afterward?** | The rescue section opens with the top three priorities, each stating the observed fact behind it, a first step and the effort involved, followed by a full checklist with copyable templates. The simulator then shows what the score becomes if the fixes are made. |

The core path is deliberately short: **username → recruiter impression → roast → rescue**. Everything deeper (the score breakdown, repository evidence, README analysis, role-aware assessment and the repository explorer) sits below it and is optional.

**Truthfulness.** The app reads real public data through the GitHub REST API and is rule-based: there is no LLM, and every statement can be traced to a number in that data. Profiles with no repositories are described as exactly that. The built-in demo personas are synthetic and labelled as sample data throughout.

### 60-second demo

1. **Username (5s).** Type a GitHub username and press *Roast Me*. The first result appears in about a second.
2. **Recruiter impression (10s).** Read the 30-second verdict and one friction point: this is what a reviewer notices before reading any code.
3. **Roast (10s).** Read one roast aloud with its evidence line, then switch the tone to show it stays about the profile, not the person.
4. **Rescue (15s).** Point at the top three priorities: each says why (the observed fact) and what to do first. Open one template.
5. **Evidence (10s).** Start *Inspect Repository Evidence* to show the file-level check with source paths, then pick a target role.
6. **Improvement simulation (10s).** Toggle two fixes in the simulator and show the projected score move.

---

## Features

1. **Profile audit** — fetches the public profile and up to the 100 most recently updated public repositories of a GitHub user.
2. **Recruiter first impression** — what a recruiter notices in 30 seconds: an archetype (for example *Blank Slate*, *Fork Collector*, *Dormant Veteran*, *Open Source Trailblazer*), a hireability signal, green flags and friction points. This section is heuristic and is labelled as such.
3. **4-pillar health score (0–100)** — 25 points per pillar, with an expandable breakdown of every point:
   - **Documentation & Clarity**: repository descriptions, topic tags, profile completeness (bio, website, location).
   - **Own Work & Traction**: share of repositories that are not forks, total stars.
   - **Maintenance & Cadence**: days since the last push, share of repositories untouched for over a year.
   - **Professional Hygiene**: license coverage and live demo links on original repositories.
4. **Roast station** — humorous observations, each paired with the evidence behind it. The Mild / Medium / Savage switch filters which roasts are shown.
5. **Before & After Rescue Simulator** — toggle realistic fixes and see the projected score, recomputed with the same rubric. Projections are labelled as estimates.
6. **Rescue roadmap** — opens with the top three priorities, each with the observed fact behind it and a first step, followed by a prioritised checklist with effort estimates, copyable templates and progress tracking. An empty profile starts with "Publish your first project".
7. **Profile Makeover** — generates an editable profile `README.md` from the audited data, with a rendered preview, copy and download.
8. **Repository explorer** — filter, search and sort the analysed repositories.
9. **Markdown export** — the full audit as GitHub Flavored Markdown.
10. **Shareable links** — the URL tracks the audit on screen (`?user=<login>` or `?demo=<persona id>`), so *Share Audit* copies a link that reopens it.
11. **Demo personas** — three built-in profiles that work without any API calls. They are **synthetic** and are labelled *Sample Data* throughout the UI, the generated README and the exported report.
12. **Evidence Intelligence** — an optional, user-started inspection of up to 6 of the user's own repositories. It reads each repository's file listing (paths and sizes, never file contents) and reports evidence of a README, tests, CI, deployment configuration and documentation, each with source paths, a confidence level and an explicit "unknown" or "not inspected" state. The evidence is then read against five roles (AI/ML Engineer, Data Scientist, Full-Stack, Backend, DevOps) using fixed, published criteria and weights. The user selects their target role; the role score is shown next to its evidence coverage, with a warning when the evidence is limited. This assessment is separate from the health score and does not change it.
13. **README content analysis** — a second, separately started step that reads at most three README files (one per inspected repository) and checks, deterministically, whether each explains the project's purpose, setup, usage, evaluation, limitations and deployment. It distinguishes an explained section from a bare heading or placeholder. Findings are labelled *Content verified*: that means the documentation's text was read, not that the software runs or that its claims are true. It does not change any score.
14. **Rate-limit handling** — live quota indicator, a recovery banner with reset time, and optional personal access token support.

### Known limits

- The health score uses repository *metadata* only. Evidence Intelligence additionally reads file *paths*. File contents, commit history, code quality and CI results are never inspected, so "not found" always means "not seen in the inspected paths".
- Evidence Intelligence covers at most 6 repositories per audit and skips forks and empty repositories.
- Accounts with more than 100 public repositories are scored on the 100 most recently updated. The audit header and the exported report say so whenever this sampling applies.
- The "Own Work & Traction" pillar measures the share of repositories that are not forks, and stars received. It does not judge whether code is original, clean or production-ready; nothing in the app does.
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
| `/api/github/tree/:owner/:repo?ref=<branch>` | `/repos/:owner/:repo/git/trees/<branch>?recursive=1` |
| `/api/github/readme/:owner/:repo?ref=<branch>&path=<README path>` | `/repos/:owner/:repo/contents/<README path>?ref=<branch>` |

The README route is the only one that reads file contents, and it is deliberately narrow. The path must be a README-named document at most three levels deep, it must exist as a regular file (not a symbolic link) in the repository's file listing, and it must be within the size limit (100 KB by default). On the server token the repository's own metadata must have confirmed it public, under the same owner and name, within the last minute. The response is decoded text only; binary files are refused. README text is treated as untrusted data: it is measured, never executed, rendered as markup or followed.

The tree route uses the repository's default branch from the metadata already loaded. A branch name containing slashes is first resolved to a commit SHA through `/git/ref/heads/<branch>` (one extra request); with no usable branch name the repository `HEAD` is used. The response is reduced to path, type and size, vendored directories are dropped, and it is capped at 2,000 entries. Nothing else under `/api/github/` is forwarded. The Vite dev server serves these routes with the same request handler as production (`server.js`), so every protection described here applies in development too.

If the proxy cannot be reached, profile and repository-list lookups fall back to calling `api.github.com` directly from the browser. Repository inspection has no such fallback: it only runs through the proxy, which is what enforces validation, size caps and request budgets.

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
| `PROXY_MAX_UPSTREAM_BYTES` | `4194304` | Largest upstream response accepted (larger ones return 413) |
| `PROXY_README_MAX_BYTES` | `102400` | Largest README file that will be read |
| `PROXY_REPO_VISIBILITY_MAX_AGE_MS` | `60000` | How recent a repository's "public" confirmation must be before the server token reads README text |
| `PROXY_PUBLIC_LIST_MAX_AGE_MS` | `120000` | How recent the owner's public repository list must be before the server token reads a file listing |

---

## Security & token handling

### How requests to GitHub are authenticated

For every lookup the proxy picks credentials in this order:

1. **The visitor's own token**, if they entered one in the app. It arrives in an `x-github-token` header and is forwarded to GitHub as `Authorization`.
2. **The server-side `GITHUB_TOKEN`**, if one is configured.
3. **No credentials** (GitHub's unauthenticated limit of 60 requests per hour per IP).

Safeguards:

- **The server token never leaves the server.** It is read once at startup, removed from the process environment, and sent only to GitHub. It is not written to logs, responses, error messages or cache keys, and it is not part of the browser bundle (it has no `VITE_` prefix and no browser code references it).
- **Not storable.** Every proxy response carries `Cache-Control: no-store` and `Vary: x-github-token`, so no browser or intermediary keeps an answer or reuses one visitor's answer for another.
- **Isolation in the browser.** The app's own cache and in-flight requests are tied to the credentials in force when a request started, using a change counter rather than the token itself. Changing or clearing the token empties those caches, cancels pending requests, discards anything that still arrives under the old credentials, and resets the repository-evidence view. Data fetched with a personal token is kept in memory only.
- **No mixing of credentials.** If a visitor's token is rejected, the proxy returns that error; it does not retry with the server token.
- **No leaks through the cache.** Responses fetched with a visitor's token are never stored in, or served from, the shared cache, and are never merged with another visitor's in-flight request.
- **Public data only on the server token.** Before the server token is used to read a repository's file listing for an anonymous visitor, the repository must be explicitly marked public in a copy of the owner's public repository list that is at most two minutes old. Anything else returns 404 without the listing being requested. A classic token that carries the `repo` scope is detected at first use and is never used for file listings at all; those requests are made without credentials instead.
- **Nothing is relayed verbatim.** Profile, repository and quota responses are reduced to an allowlist of public fields before they are returned or cached, so private account fields and token-specific `permissions` never reach a visitor. GitHub's error text, which can name the authenticated account, is replaced with a generic message.
- **Graceful failure.** A malformed `GITHUB_TOKEN` is ignored with a warning that does not echo it. If GitHub rejects the token (revoked or expired), the proxy logs a warning, stops sending it for 10 minutes and continues unauthenticated.
- **Visitor tokens** are kept in the browser tab's `sessionStorage` and cleared when the tab closes.
- `.gitignore`, `.dockerignore` and `.gcloudignore` exclude `.env`, `.env.*`, key and credential files. `.env.example` is the only env file in the repository and contains no value.

### Choosing a token

Use a token that can only read public data, so that a leak or a bug cannot expose anything private:

- a **fine-grained** personal access token with *Repository access: Public repositories (read-only)* and no additional permissions, or
- a **classic** personal access token with **no scopes selected**.

Set an expiry date and rotate it when it expires.

### Configure a token locally

1. Create the token at <https://github.com/settings/personal-access-tokens> as described above.
2. In the project folder, copy the example file: `cp .env.example .env.local`
3. Open `.env.local` and put the token after `GITHUB_TOKEN=` (no quotes, no spaces). This file is ignored by git, Docker and Cloud Build.
4. Check that git ignores it: `git check-ignore .env.local` should print `.env.local`.
5. Start the app:
   - development: `npm run dev` (the dev proxy reads `.env.local`)
   - production server locally: `npm run build && npm run start:local`
6. Confirm it is in use: the quota indicator in the navbar shows a limit of 5,000 instead of 60. With `npm run start:local` the startup log also prints `GitHub API authentication: server token configured`. The token itself is never printed.

A token exported in the shell (`export GITHUB_TOKEN=...`) takes priority over `.env.local`. Never commit a token, paste it into an issue, or put it in `.env.example`.

### Configure a token on Cloud Run with Secret Manager

Store the token as a secret and let the service read it as an environment variable. Run these yourself; replace the placeholders.

```bash
# 1. Enable Secret Manager
gcloud services enable secretmanager.googleapis.com

# 2. Create the secret. The command waits for input: paste the token, then press Ctrl-D.
#    Reading it from standard input keeps it out of shell history. A trailing newline is harmless.
gcloud secrets create repozyn-github-token --replication-policy=automatic --data-file=-

# 3. Allow the Cloud Run service account to read it
gcloud secrets add-iam-policy-binding repozyn-github-token \
  --member="serviceAccount:<SERVICE_ACCOUNT_EMAIL>" \
  --role="roles/secretmanager.secretAccessor"

# 4. Attach it to the service as GITHUB_TOKEN
gcloud run services update repozyn-ai \
  --region <REGION> \
  --update-secrets GITHUB_TOKEN=repozyn-github-token:latest
```

To rotate: add a new version with `gcloud secrets versions add repozyn-github-token --data-file=-`, redeploy or update the service so a new revision starts, then disable the old version. Do not pass the token with `--set-env-vars`, in a Dockerfile, or as a build argument.

---

## Accessibility

- **Structure.** One page heading per view, ordered section headings, `header` / `nav` / `main` / `footer` landmarks, a skip link, and in-page links to each audit section.
- **Keyboard.** Every action is a native button, link or form field with a visible focus outline. Dialogs trap focus, close on Escape and return focus to the control that opened them.
- **Screen readers.** Controls have accessible names, form fields have labels, toggles expose their pressed, checked or expanded state, progress bars expose their values, and audit progress, errors and token verification are announced through live regions.
- **Visual.** Text colours are checked against WCAG AA contrast (4.5:1) on the dark surfaces, no text is smaller than 11px, and the layout works at 375px wide without horizontal scrolling.
- **Motion.** Animations, smooth scrolling and the completion confetti are disabled when the system asks for reduced motion.

These are enforced by automated tests (`src/a11y.regression.test.tsx`, `a11y.static.test.js`). The app has not been audited with screen-reader software or by a third party.

---

## Local development

Requires Node.js 22 or newer and npm.

```bash
npm install
npm run dev        # http://localhost:5173
```

Unauthenticated GitHub access is limited to 60 requests per hour per IP. To raise it locally, put a token in `.env.local` as described under "Configure a token locally", or add one in the app.

Other commands:

```bash
npm run lint       # oxlint
npm test           # vitest
npm run build      # type-check and build to dist/
npm start          # serve dist/ with server.js on $PORT (default 8080)
npm run start:local  # same, also reading GITHUB_TOKEN from .env.local if present
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
- **Evidence Intelligence** — inspection rules, bounded runner, role rubric, actions and the UI section (`src/services/inspection.test.ts`, `src/services/roleAssessment.test.ts`, `src/components/EvidenceIntelligenceSection.test.tsx`).
- **Token hygiene** — authentication priority, cache isolation, no token in logs, responses or the browser bundle (`server.test.js`, `auth.security.test.js`).

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
  --region <REGION> \
  --allow-unauthenticated \
  --port 8080 \
  --max-instances 1
```

Notes:

- **Set a server token.** Without `GITHUB_TOKEN` the service shares GitHub's 60 requests per hour for its outbound IP. Provide it through Secret Manager as described under "Configure a token on Cloud Run with Secret Manager".
- **Instance count.** Rate limits and the response cache are in memory per instance, so `--max-instances 1` keeps the limits exact. With more instances each one enforces its own.
- To check the container locally before deploying:

  ```bash
  docker build -t repozyn-ai .
  docker run -p 8080:8080 repozyn-ai
  curl http://localhost:8080/health
  ```
