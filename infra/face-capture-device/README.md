# Face Capture Device (Tier B — fixed on-prem camera)

Runs at a school, on a small on-prem machine (a mini PC on the school's LAN
is enough — no GPU required). Pulls frames from a fixed camera, detects and
extracts a face embedding locally, and POSTs only that embedding vector
(never the image or video) to the school's KoderEduAI backend. See
`docs/face-attendance-live-detection-design.md` in the main repo for the
full design.

## What this does and doesn't do

- Samples one frame every `SAMPLE_INTERVAL_SECONDS` — this is a periodic
  snapshot service, not continuous video processing.
- Runs the same `face_recognition`/dlib stack the backend already uses for
  the group-photo (Tier C) flow, so results land in the same embedding
  space (`dlib_v1`) — no separate enrollment step is needed for a school
  that already has students enrolled via the group-photo flow.
- Raw video/images never leave this machine. Only a 128-number vector and
  a timestamp are sent over the network, over HTTPS, to `/api/face-attendance/live/match/`.

## Prerequisites

- **Docker** with Compose v2 (Docker Desktop on Windows, or a native Docker
  install on Linux — this is meant to run unattended on a small always-on
  machine, so a headless Linux mini PC is the expected long-term setup).
- A fixed camera reachable from this machine — either an RTSP URL (typical
  for an IP camera on the school's LAN) or a USB webcam plugged into this
  machine.
- A device key from the school's Django admin (see below).

## 1. Register the device in Django admin

There is no self-service pairing flow yet — an admin creates the device
row directly:

1. Log into Django admin as a staff user with access to the `face_attendance` app.
2. Go to **Face Attendance → Face Capture Devices → Add**.
3. Fill in:
   - **School** — the school this camera belongs to.
   - **Name** — something identifying, e.g. "Front Gate Camera".
   - **Scope type** — `CLASS` if this camera only ever sees one classroom
     (set **Class obj** too), or `SCHOOL` if it's an entrance-style camera
     that should match against the whole school's roster.
   - **Embedding version** — leave as `dlib_v1` unless told otherwise.
4. Save. A **yellow banner appears exactly once** with the raw device key —
   copy it now. It is hashed before storage and cannot be shown again; if
   lost, delete the device row and create a new one.
5. Confirm **Tier B is enabled for this school** — an admin needs to flip
   `tier_b_enabled=True` on that school's `FaceAttendanceSchoolConfig` row
   (also in Django admin), or every request from this device will be
   rejected with a 403 even with a valid key.

## 2. Configure and run

```bash
cd infra/face-capture-device
cp .env.example .env
# edit .env: at minimum set CAMERA_SOURCE, API_BASE_URL, DEVICE_KEY
docker compose up -d --build
```

See `.env.example` for what each variable means. The important ones:

| Variable | Required | Notes |
|---|---|---|
| `CAMERA_SOURCE` | yes | RTSP URL, or a local device index (e.g. `0`) for a USB webcam |
| `API_BASE_URL` | yes | The backend's base URL, no trailing slash |
| `DEVICE_KEY` | yes | The raw key shown once in step 1 |
| `EMBEDDING_VERSION` | no | Must match the device's Django admin row (default `dlib_v1`) |
| `CLASS_ID` | no | Only meaningful for a `CLASS`-scoped device; leave unset for `SCHOOL`-scoped |
| `SAMPLE_INTERVAL_SECONDS` | no | Default `3` — how often a frame is actually processed |

If `CAMERA_SOURCE` is a local device index rather than an RTSP URL,
uncomment the `devices:` mapping in `docker-compose.yml` first (a USB
camera needs to be passed through to the container explicitly).

## 3. Check it's working

```bash
docker compose logs -f
```

You should see one log line per detected face, e.g. `Match: Ali Hassan
(92.3% confidence) — attendance_marked=True`, or `No match (IGNORED)` for
faces that don't match anyone enrolled. `last_seen_at` on the device's row
in Django admin updates on every successful request — a stale timestamp
there is the quickest way to tell the camera has gone offline.

## Stopping / updating

```bash
docker compose down            # stop
docker compose up -d --build   # rebuild after pulling repo changes, restart
```

## Minimum hardware assumptions

CPU-only face detection (`face_recognition`'s `hog` model, matching the
backend) at one frame every few seconds is light enough for a low-end mini
PC (e.g. an Intel N100-class machine, 4GB RAM) — no GPU needed. Network
connectivity to the backend's `API_BASE_URL` is required at all times;
frames sampled while offline are simply dropped (not queued or retried) —
matches the school's LAN reliability expectations of a live camera feed,
not a store-and-forward system.
