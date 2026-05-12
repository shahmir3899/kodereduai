# WAHA (local WhatsApp HTTP API)

## How to run WAHA

### Prerequisites

- **Docker** with Compose v2: on Windows use [Docker Desktop](https://www.docker.com/products/docker-desktop/) and keep it running before you start WAHA.
- **Port:** WAHA is exposed on **`127.0.0.1:3080`** on the host (see [`docker-compose.yml`](docker-compose.yml)). That keeps **port 3000** free for the main Vite frontend (`npm run dev` in `frontend/`). `WAHA_BASE_URL` in `.env` must use the same URL so dashboard assets and links work.
- All commands below assume you are in this folder: `infra/waha` (full path on your machine: `…/smart-attendance/infra/waha`).

### First-time setup (once)

1. Open a terminal in `infra/waha`.
2. Copy the example env file and edit it:
   - **PowerShell:** `Copy-Item .env.example .env`
   - **cmd:** `copy .env.example .env`
3. Edit `.env` and set at least:
   - `WAHA_API_KEY` — strong secret; clients (and Django) send it as HTTP header `X-Api-Key`.
   - `WAHA_DASHBOARD_USERNAME` / `WAHA_DASHBOARD_PASSWORD` — web dashboard login.
4. (Optional) Pull the image: `docker compose pull`

### Run on Windows (recommended)

1. Ensure **Docker Desktop** is running.
2. Double‑click **`start-waha.bat`** in this folder.  
   It runs `docker compose up -d`, prints container status, then shows:
   - URLs for checks and the dashboard (see **After it is running** below);
   - a **Tip** that REST callers must send header `X-Api-Key` with the same value as `WAHA_API_KEY` in your `.env`.  
   That line is a **reminder for HTTP clients**, not an error if you already configured `.env`.

| Script | What it does |
|--------|----------------|
| `start-waha.bat` | Start WAHA in the background (`docker compose up -d`). |
| `stop-waha.bat` | Stop and remove containers for this compose project. |
| `waha-status.bat` | `docker compose ps` plus a quick `GET /ping` check. |
| `waha-logs.bat` | Follow WAHA container logs (Ctrl+C exits log view only). |
| `run-waha-foreground.bat` | Run WAHA in the **current** window; Ctrl+C stops the stack. Same URL/tip as `start-waha.bat` before Compose attaches. |

**From a terminal (Windows):** `cd` into `infra\waha`, then run `start-waha.bat` by name (or use the PowerShell block below).

### Run manually (any OS, or CI)

```powershell
cd infra\waha
# Ensure .env exists (see first-time setup)
docker compose up -d
```

Stop: `docker compose down` (add `-v` only if you intend to wipe volumes/sessions).

### After it is running

- **Dashboard (UI):** [`http://127.0.0.1:3080/dashboard`](http://127.0.0.1:3080/dashboard) — sign in with `WAHA_DASHBOARD_USERNAME` / `WAHA_DASHBOARD_PASSWORD` from `.env`.  
  The site **root** (`/` only) is often blank; use **`/dashboard`** ([WAHA docs](https://waha.devlike.pro/docs/how-to/dashboard/)).
- **Reachability:** `GET http://127.0.0.1:3080/ping` (no auth) — used by `waha-status.bat`.
- **Swagger / API explorer:** same host and port (**3080**); enable with `WHATSAPP_SWAGGER_ENABLED` and `WHATSAPP_SWAGGER_*` in `.env` (exact path can vary by WAHA version — see [WAHA documentation](https://waha.devlike.pro/docs/)).

### Dashboard: Connect worker

The dashboard is a separate UI that talks to the **WAHA HTTP API** on the same machine. After login, use **Workers → Connect** (or edit the **Server** modal) so the UI can reach your container.

| Field | What to enter |
|-------|----------------|
| **Name** | Any label you like (e.g. `local`, `EducationAI`). Shown only in the dashboard. |
| **API URL** | **`http://127.0.0.1:3080`** — same as `WAHA_BASE_URL` and [`docker-compose.yml`](docker-compose.yml) host port. No `/api` or `/dashboard` suffix. |
| **API Key** | Paste **`WAHA_API_KEY`** from `infra/waha/.env` (must match the value the container was started with). Same as Django **`WHATSAPP_API_KEY`**. |

WAHA stores worker entries in **browser local storage** (their blue notice is normal): each browser profile needs the URL/key once, or again after you clear site data.

**Red banner: “WAHA_API_KEY is not set or using a default value”** — set a long random `WAHA_API_KEY` in `infra/waha/.env`, keep Django’s `WHATSAPP_API_KEY` identical, **recreate/restart** the stack, then paste the same value into **API Key** and click **Connect**. See [WAHA security](https://waha.devlike.pro/docs/how-to/security/).

### Create session and scan QR

Once a **worker** is connected (green), link a WhatsApp account to a **session** (this is the name Django uses as **WhatsApp sender ID** per school).

1. In the dashboard, open **Sessions** (or the sessions area for your worker).
2. Click **Create session** (or equivalent).
3. In **Create Session**:
   - **Server** — pick your connected worker (e.g. `EducationAI`).
   - **Name** — on **WAHA Core** (free `devlikeapro/waha` image), the session name **must** be exactly **`default`**, and you may have **only one** session. Put that same value in the school’s **WhatsApp sender ID** in Django. **WAHA Plus** is required for multiple sessions or custom session names (WAHA shows this in 422 errors).
   - **Engine** — leave **`WEBJS`** unless you know you need another engine (matches `WHATSAPP_DEFAULT_ENGINE` in `.env`).
   - **Custom device / Events** — optional; defaults are fine for first setup.
4. Click **Create & Start** (not only **Create** if you want the session to go to **SCAN_QR** immediately). WAHA should show a **QR code**.
5. On the phone, open **WhatsApp → Settings → Linked devices → Link a device** and scan the QR. When linking finishes, the session should show as **WORKING** (wording may vary by WAHA version).

**422 “only `default` session”** — you are on **Core** (free tier). WAHA allows **one** session and its id **must** be `default`. Any other session name is rejected until you use **WAHA Plus** for multiple accounts.

**422 “Session `default` already exists”** — you already created the `default` session. Do **not** create it again: cancel this dialog, open the **Sessions** list, select the existing **`default`** row, and use actions such as **Start**, **QR**, or **restart** to link WhatsApp or refresh the QR.

**ERP alignment:** the session **Name** must match **School → WhatsApp sender ID** (see [Backend alignment](#backend-alignment)). On Core, that is almost always **`default`**.

If the QR expires, use the session row actions in the dashboard to **restart** or show QR again (per WAHA UI).

## Roadmap (integration)

1. **Infra (this folder)** — Run WAHA in Docker; confirm dashboard/API respond on host port **3080**.
2. **WhatsApp session** — Connect a **worker**, then [create a session and scan QR](#create-session-and-scan-qr) with the phone you want to automate (personal risk: unofficial client; possible bans).
3. **App integration** — Set `WHATSAPP_PROVIDER=waha`, base `WHATSAPP_API_URL`, `WHATSAPP_API_KEY` (see table below); set each school’s WhatsApp sender ID to the WAHA **session** name. Backend must reach WAHA (localhost only works when Django runs on the same machine).

## Verify it is running (API)

WAHA expects the API key header `X-Api-Key` (same value as `WAHA_API_KEY` in `.env`). Example (PowerShell):

```powershell
$h = @{ "X-Api-Key" = "<paste WAHA_API_KEY from .env>" }
Invoke-WebRequest -Uri "http://127.0.0.1:3080/api/version" -Headers $h -UseBasicParsing
```

**cmd:** `curl -s -H "X-Api-Key: YOUR_KEY" http://127.0.0.1:3080/api/version`

You should see HTTP **200** and JSON including `"tier":"CORE"`. Other useful checks: `GET /api/sessions`, `GET /api/server/status`.

**Note:** On **CORE**, some routes (for example `/health` in current builds) may return **422** and mention **Plus** — that only means that specific feature is gated; the main REST API still works as above.

**Production HTTPS:** terminate TLS with Nginx/Caddy or your host in front of WAHA; see [WAHA security — HTTPS](https://waha.devlike.pro/docs/how-to/security/#https). This repo’s compose only exposes HTTP on **3080** for local dev.

## Files

| Path | Purpose |
|------|---------|
| `sessions/` | Persisted login state (gitignored under `infra/waha/sessions/`) |
| `media/` | Downloaded media (already covered by repo `media/` gitignore) |

## Backend alignment

In Django `backend/.env` (see `backend/.env.example`):

| Variable | WAHA local example |
|----------|-------------------|
| `WHATSAPP_PROVIDER` | `waha` |
| `WHATSAPP_API_URL` | `http://127.0.0.1:3080` (no path; must match WAHA host port) |
| `WHATSAPP_API_KEY` | Same as `WAHA_API_KEY` in `infra/waha/.env` |

Per school, set **WhatsApp sender ID** to the **WAHA session name** (e.g. `default`) in admin / school settings. Enable the **whatsapp** module for schools that should send absence alerts via this stack.
