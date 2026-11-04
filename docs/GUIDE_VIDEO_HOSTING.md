# Guide video hosting

Guide videos (tutorials in English and Urdu, widescreen and phone-shaped) are **not part of any build**. They live in
`media/guide/` in the repo and on a dedicated static host, so the main app and the landing site stay small.

## Where things are

| What | Location |
|---|---|
| Local source folder | `media/guide/` (mp4 git-ignored; posters and captions tracked) |
| Production host | `https://m3d1a.educationai.pk/guide/<file>` (cPanel subdomain, own document root `m3d1a.educationai.pk`) |
| Server config | `media/server/.htaccess` — CORS for `*.educationai.pk`, `*.educationai.com.pk`, `*.kodereduai.pk`; `text/vtt`; 7-day cache; no listing. On the server it is appended below cPanel's generated PHP block |
| Main app base | `VITE_GUIDE_VIDEO_BASE` in `frontend/.env.production` (unset in dev) |
| Landing base | `PUBLIC_GUIDE_VIDEO_BASE` in `frontend/apps/educationai-landing-astro/.env.production` |
| Dev | the Vite plugin in `frontend/vite.config.js` serves `media/guide` at `/guide` (with range requests) |

`m3d1a` is a reserved name: schools cannot use it (`schools/serializers.py`) and `TenantMiddleware` ignores it. Do not give it
the wildcard school folder; the explicit subdomain takes priority over `_wildcard_.educationai.pk`.

## File naming (one flat folder)

`<video-id>.<lang>.<variant>.<ext>`, variant part empty for widescreen:

| Variant | Suffix | Example | Shown to |
|---|---|---|---|
| desktop | none | `mark-attendance.en.mp4` | everyone, and the fallback |
| mobile (portrait) | `m.` | `mark-attendance.ur.m.mp4` | screens up to 767px wide |
| app (future Expo recordings) | `a.` | `mark-attendance.en.a.mp4` | the mobile app (`setVideoContext('app')`) |

Each variant has `.mp4`, `.vtt` and `.poster.jpg`. Fallback chains: desktop → desktop; phone → mobile → desktop;
app → app → mobile → desktop. A variant counts as published when `guideVideos.json` has seconds for it:
`seconds` (desktop), `mobile` (or `variants.mobile`), `variants.app`, each `{en, ur}`. Code: `frontend/src/utils/guideAssets.js`
(`pickVariant`), `frontend/src/hooks/useVideoContext.js`.

## Adding or replacing videos

1. **Re-record an existing video:** put files with the same names in `media/guide/`, upload them to the server's `guide/`
   folder. Browsers may keep old copies up to 7 days.
2. **New variant for a video** (for example the first `.a.` recording): upload the files, add its seconds to the entry in
   `frontend/src/data/guideVideos.json`, rebuild and deploy both apps.
3. **New guide topic:** run `guide_meta.py` (creates a `planned` placeholder), add the files, set the entry to `ready`, rebuild both apps.
4. Upload by cPanel File Manager (zip + Extract in the document root, keep the `guide/` folder) or FTP. Do not put a
   `.htaccess` inside `guide/`; it would override the parent's CORS rules (this happened once and limited access to `www` only).

Authoring scripts (`guide_meta.py`, `scripts/redub/*`, `docs/media/_authoring/publish_*.py`) all write to `media/guide`.

## Verifying the host

```bash
curl -sI -H "Origin: https://demo.educationai.pk" https://m3d1a.educationai.pk/guide/mark-attendance.en.vtt
curl -s -o /dev/null -D - -H "Range: bytes=0-99" https://m3d1a.educationai.pk/guide/mark-attendance.en.mp4
```

Expect `Access-Control-Allow-Origin` echoing the origin (and none for a foreign one), `text/vtt`, and `206 Partial Content`.

## Rollout notes (2026-11-03)

Main app is on the new host. The landing site must be rebuilt after the main app, and the old `videos/` folder on the
main app's server removed only after that.
