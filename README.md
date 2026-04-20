# L10: RevOps — Dashboard

A live dashboard for the L10: RevOps Asana board. Surfaces new intake requests, urgent items, current in-progress work, and upcoming reviews — with Company / BTC Vertical / Team filters and a separate completed-tasks page.

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌──────────────┐
│  Dashboard UI   │ ───▶ │ /api/get-tasks   │ ───▶ │  Asana API   │
│  (static HTML)  │      │ (Vercel function)│      │              │
│                 │ ◀─── │ holds ASANA_PAT  │ ◀─── │              │
└─────────────────┘      └──────────────────┘      └──────────────┘
```

The front-end is a pair of static HTML files. It never sees the Asana token — it only talks to `/api/get-tasks` on the same origin. The token lives as a Vercel environment variable and is used server-side only.

Tasks refresh automatically every 60 seconds on the main dashboard. The serverless function caches responses for 30 seconds (in-memory + Vercel edge) so heavy dashboard traffic doesn't hammer Asana's API.

## Setup

### 1. Create a bot Asana user (recommended)

Rather than using your personal PAT, create a dedicated read-only bot user:

1. Invite a new guest user to your Asana workspace — e.g., `revops-dashboard-bot@yourdomain.com` (a shared alias you control).
2. Log in as that user and share the **L10: RevOps** project with them at **Comment-only** access (most restrictive option; cannot edit or create tasks).
3. From that account, go to [app.asana.com/0/my-apps](https://app.asana.com/0/my-apps) → **Personal access tokens** → **+ Create new token**. Name it "L10 RevOps Dashboard."
4. Copy the token. You will not be able to see it again.

Why this matters: Asana PATs inherit the full permissions of the account that generated them. Using a dedicated bot with Comment-only access to one project means a leaked token's blast radius is limited to that one project, read-only.

### 2. Deploy to Vercel

```bash
# From this directory
npm i -g vercel        # if not already installed
vercel                 # follow prompts; link to new or existing project
```

Then in the Vercel dashboard, under **Settings → Environment Variables**, add:

| Name                | Value                                       | Environments        |
|---------------------|---------------------------------------------|---------------------|
| `ASANA_PAT`         | The token from step 1                       | Production, Preview |
| `ASANA_PROJECT_GID` | `1213046253934403`                          | Production, Preview |

Redeploy: `vercel --prod`

### 3. Protect the URL

Vercel deployments are public URLs by default. For an internal dashboard with potentially sensitive operational data, you should put authentication in front of it:

- **Easiest:** Vercel's built-in Password Protection (Pro plan, single shared password).
- **Best for teams:** [Cloudflare Access](https://www.cloudflare.com/products/zero-trust/access/) in front of the deployment — free for up to 50 users, integrates with Google Workspace / Okta SSO. Your team signs in with their work Google account and that's it.
- **If you must leave it open:** at least do not share the URL in any public channel. The serverless endpoint (`/api/get-tasks`) has no auth check beyond obscurity.

## Local development

```bash
cp .env.example .env.local
# fill in ASANA_PAT in .env.local
npm i -g vercel
vercel dev
```

Open http://localhost:3000

## Customization

### Change which fields appear on cards
Edit the `taskCardHtml` function in `index.html`.

### Change section logic
Edit the `render()` function in `index.html`. Current mapping:

| Section              | Logic                                                 |
|----------------------|-------------------------------------------------------|
| New Requests         | Asana section == `New Requests / Needs Review`        |
| Urgent               | Urgent field == `Yes` (any status)                    |
| Current Workload     | Status field == `In Progress`, sorted by due date     |
| Up Next              | Status field == `In Review / Scoping`                 |

### Add a filter
Add an entry to the `FILTERS` array at the top of `index.html`'s `<script>` block. Filters work automatically against the `fields` object returned from the API — just use the field key.

### "Identify me" feature
The dashboard has a per-browser "identify me" chip. A user enters their work email once; it's stored in their browser's localStorage and used to match against Asana's `assignee.name` (best-effort via email local-part matching) to highlight their tasks. Nothing is sent anywhere — this is a purely client-side UX aid.

## Security posture

- **Token:** Server-side only. Never touches the browser or the repo. Rotatable in Vercel in ~10 seconds.
- **Endpoint surface:** `GET /api/get-tasks?scope=active|completed|all`. Project GID is hardcoded server-side; clients cannot request arbitrary projects. Scope is validated against an allowlist. Method is locked to GET.
- **Caching:** 30-second server-side cache limits API-call volume if the dashboard gets opened on many screens.
- **Rate limiting:** Not implemented. If you open this to a large audience, consider adding basic rate limiting (e.g., via [Upstash](https://upstash.com/) free tier) or putting Cloudflare in front.
- **Auth:** None at the application level. Put access control upstream (Cloudflare Access / Vercel password / SSO).

## What it costs

- Vercel Hobby: free for personal projects (has an attribution requirement and usage limits).
- Vercel Pro: $20/user/month — needed for team projects, password protection, and commercial use.
- Asana API: free within normal usage limits (150 requests per minute per token, which this app stays well under).
- Cloudflare Access: free for up to 50 users.

## File structure

```
├── api/
│   └── get-tasks.js       # Serverless function — proxies to Asana
├── index.html             # Main dashboard
├── completed.html         # Completed tasks page
├── package.json
├── vercel.json            # Vercel function + header config
├── .env.example
├── .gitignore
└── README.md
```
