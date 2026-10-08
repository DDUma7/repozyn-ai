# 🔥 Repozyn AI — GitHub Roast & Rescue

> **8-Hour University Hackathon Challenge:** *GitHub Roast and Rescue*  
> An honest, evidence-based GitHub portfolio assessment engine that delivers realistic recruiter first impressions, transparent health scoring, witty (yet respectful) roasts, and actionable rescue roadmaps.

---

## 🌟 Overview

Developers often spend months building projects on GitHub without knowing how their profiles appear to hiring managers and recruiters. **Repozyn AI** bridges this gap by directly analyzing public GitHub REST API data against real-world engineering recruiting rubrics.

### Why Repozyn AI?
- **Zero Fake AI Claims / No Fabricated Metrics**: All metrics are mathematically derived from verified GitHub API repository and profile metadata.
- **Client-Side Privacy**: Runs 100% in the user's browser. No backend database, no telemetry, and no storage of private credentials.
- **Rate-Limit Resilience**: Displays real-time API quotas with countdown resets, optional Personal Access Token (PAT) support (5,000 req/hr), and built-in instant demo personas for offline evaluation.

---

## ✨ Features

### 1. 🔍 GitHub Handle Audit & Verification
- Fetches real public profile metadata, up to 100 repositories, commit recency, and public activity.
- Visual badges distinguish between **🟢 Verified GitHub Facts** and **🟣 Heuristic Assessments**.

### 2. 👔 Recruiter 10-Second Reality Check
- Simulates what an engineering hiring manager sees during their initial 10-second profile scan.
- Classifies profiles into archetypes (e.g., *The Fork Collector*, *The Product Crafter*, *The Dormant Veteran*, *The Open Source Trailblazer*).
- Surfaces instant **Green Flags** (strengths) and **Friction Points** (warning signals).

### 3. 📊 Transparent 4-Pillar Health Score (0–100)
A deterministic mathematical rubric across 4 core engineering pillars (25 points each):
1. **Documentation & Clarity (25 pts)**: Repository descriptions, README presence, discovery topic tags, bio and social links.
2. **Originality & Independence (25 pts)**: Ratio of original creations versus tutorial forks, community stars, and repository depth.
3. **Maintenance & Cadence (25 pts)**: Push recency, active commits, and stale (>1 year untouched) repository ratio.
4. **Professional Hygiene (25 pts)**: Open-source SPDX license coverage, live demo previews (Vercel/GitHub Pages), and repository housekeeping.

### 4. 🌶️ Evidence-Based Roast Station
- Witty, humorous observations directly paired with **verified evidence citations** (e.g., `[Evidence: 14 of 18 repos have empty descriptions]`).
- Three spice levels:
  - 🌱 **Mild**: Gentle constructive nudge
  - 🔥 **Medium**: Realistic senior engineer feedback
  - 💀 **Savage**: University hackathon roast mode
- 1-click button to copy roasts to clipboard.

### 5. 🛠️ Actionable Rescue Roadmap
- Prioritized checklist categorized by effort (`< 15 mins`, `1–2 hours`, `Weekend project`).
- Copy-paste ready starter templates:
  - **Repository "About" Formula**
  - **MIT License Snippet**
  - **High-Impact Profile README.md Template**
- Interactive checklist with progress tracking and celebration confetti.

### 6. 📁 Repository Health Explorer
- Interactive table and grid of all analyzed repositories.
- Filter by Original creations, Forks, Missing descriptions, or Live Demos.
- Sort by stars, push recency, or alphabetical name.
- Direct links to GitHub repositories and live deployments.

### 7. 📄 One-Click Markdown Export
- Export complete portfolio audits as clean GitHub Flavored Markdown ready to attach to job applications, issues, or resume reviews.

---

## 🏗️ Architecture & Tech Stack

```
repozyn-ai/
├── src/
│   ├── components/            # Responsive React components (Tailwind CSS)
│   │   ├── Navbar.tsx         # Brand, Rate Limit indicator, PAT modal, Mock persona selector
│   │   ├── SearchHero.tsx     # Handle input, quick popular chips, instant demo personas
│   │   ├── ProfileHeader.tsx  # Verified facts, avatar, grade badge, social links
│   │   ├── RecruiterImpressionCard.tsx # 10-sec verdict, archetype, hiring manager quote
│   │   ├── HealthScoreSection.tsx      # 4-pillar progress bars and expandable rubric details
│   │   ├── RoastSection.tsx   # Evidence-tagged roasts with tone toggle
│   │   ├── RescueRoadmapSection.tsx    # Interactive checklist & copyable code templates
│   │   ├── RepositoryExplorer.tsx      # Filterable, sortable repository browser
│   │   ├── TokenModal.tsx     # Optional personal token drawer for 5,000 req/hr
│   │   ├── MarkdownReportModal.tsx     # Formatted markdown report preview and download
│   │   └── components.test.tsx# Integration & component tests
│   ├── data/
│   │   └── mockProfiles.ts    # Built-in realistic personas for offline evaluation
│   ├── services/
│   │   ├── github.ts          # GitHub REST API client with cache & rate limit parsing
│   │   ├── analyzer.ts        # Facts extractor, rubric scoring, roast & roadmap engine
│   │   └── analyzer.test.ts   # Comprehensive unit test suite
│   ├── types/
│   │   ├── github.ts          # Strongly typed GitHub REST API schemas
│   │   └── analysis.ts        # Rubric, facts, roasts, and recruiter models
│   ├── utils/
│   │   ├── cn.ts              # Tailwind class merging utility
│   │   └── markdownReport.ts  # Markdown audit report generator
│   ├── App.tsx                # Main state controller & layout coordinator
│   └── main.tsx               # React 19 root entry
```

- **Framework**: React 19 + TypeScript + Vite 8
- **Styling**: Tailwind CSS v4 (responsive dark theme with modern glassmorphism)
- **Icons**: Lucide React
- **Testing**: Vitest + React Testing Library + jsdom
- **Linting**: Oxlint

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js >= 18 (Tested on Node v24.21.0)
- npm >= 9

### Installation
```bash
git clone <repository-url>
cd repozyn-ai
npm install
```

### Start Development Server
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### Run Tests
```bash
npm run test
```

### Run Linter
```bash
npm run lint
```

### Production Build
```bash
npm run build
```
The optimized static bundle is output to `dist/` (total size ~390 KB gzipped to < 110 KB).

---

## 🚢 Deployment Instructions (Google Cloud Run)

Repozyn AI is engineered specifically for **Google Cloud Run** using a multi-stage `Dockerfile` and a hardened, zero-dependency Node.js production server (`server.js`):
- Dynamic port binding via Cloud Run's `$PORT` environment variable (default `8080`) on `0.0.0.0`.
- Built-in `/health` health-check endpoint responding with `HTTP 200 OK`.
- Production security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-XSS-Protection`.
- Single Page Application (SPA) routing fallback to `/index.html`.
- Non-root execution (`USER node`) for minimal attack surface.

### Option A: Deploy via Google Cloud CLI (`gcloud`)

1. **Install and authenticate gcloud**:
   ```bash
   gcloud auth login
   gcloud config set project <YOUR_PROJECT_ID>
   ```

2. **Enable required Google Cloud services**:
   ```bash
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com
   ```

3. **Build and deploy directly from source**:
   ```bash
   gcloud run deploy repozyn-ai \
     --source . \
     --region us-central1 \
     --platform managed \
     --allow-unauthenticated \
     --port 8080
   ```

4. Once deployed, note the provided service URL (e.g., `https://repozyn-ai-xxxx-uc.a.run.app`).

---

### Option B: Deploy via Google Cloud Console (Continuous Deployment)

1. Push your code to GitHub (single `main` branch).
2. Open the [Google Cloud Run Console](https://console.cloud.google.com/run).
3. Click **Create Service**.
4. Select **Continuously deploy from a repository** (via Cloud Build) and click **Set up with Cloud Build**.
5. Connect your GitHub account and select your `repozyn-ai` repository.
6. Under **Build Configuration**, choose **Dockerfile** (path: `Dockerfile`).
7. Under **Authentication**, select **Allow unauthenticated invocations**.
8. Click **Create** to deploy.

---

### Local Container Verification (Docker / Podman)

To verify the container locally before cloud deployment:
```bash
# Build the container image
podman build -t repozyn-ai .

# Run the container bound to host port 8080
podman run -p 8080:8080 -e PORT=8080 repozyn-ai

# Verify health endpoint in another terminal
curl http://localhost:8080/health
# Output: {"status":"ok","service":"repozyn-ai","port":8080}
```

---

## 🔒 Security & API Secrets

- **No API Secrets Embedded**: No server keys, environment secrets, or private tokens are packaged into client bundles.
- **Client-Side GitHub Token Storage**: Optional Personal Access Tokens are stored solely in browser `sessionStorage` and transmitted solely to `api.github.com` via standard HTTPS Authorization headers. Tokens are erased upon closing the session.

---

## 📋 Hackathon Submission Requirements Checklist

| Requirement | Status | Details |
| :--- | :---: | :--- |
| **Hosting Platform** | ✅ | **Google Cloud Run** containerized via Alpine Node.js 22 & zero-dependency server |
| **Repository Size** | ✅ | **~452 KB** total source footprint (strictly `< 10 MB` threshold) |
| **Branch Structure** | ✅ | **Single branch (`main`)** with linear history |
| **Repo URL Format** | ✅ | Ends with `.git` (e.g. `https://github.com/<user>/repozyn-ai.git`) |
| **Public Accessibility** | ✅ | Fully open-source public repository & unauthenticated Cloud Run URL |
| **Automated Tests** | ✅ | 13/13 Vitest tests passing (Services, Components, & Accessibility) |
| **Zero Fabricated AI** | ✅ | Mathematically deterministic 4-pillar rubric & citation-backed roasts |

---

## 📝 License

Distributed under the **MIT License**. Built with ❤️ for the 8-Hour University Hackathon.
