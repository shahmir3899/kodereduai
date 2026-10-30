# Rebranding: KoderEduAI -> Education AI

Status as of 2026-10-13. Merged to `main` (kodereduai `fa4f528`, parent personal-gateway `5cbe969`) and deployed.

## Decisions
- **Display name:** "Education AI". Identifiers/file names: `EducationAI` / `educationai`.
- **Domains:** primary `educationai.pk` (+ `*.educationai.pk`); `educationai.com.pk` 301-redirects to it.
  Old `kodereduai.pk` stays live for ~1 month as a redirect, then expires.
- **Backend:** Render service unchanged (`personal-gateway-sg`). No `api.educationai.pk`.
- **Hosting:** frontend on hostnext.net. The new wildcard must share the **same document root**
  as the old wildcard, so one upload serves both domains (and survives the old domain expiring).
- **Company vs product:** Koder Kids is the legal company; Education AI is its product, with separate
  domain branding. "a product of Koder Kids" appears only in the privacy policy, terms and footer copyright.
  Social handles stay the Koder Kids ones.
- **Mobile:** bundle ID `pk.educationai.app`, not yet published. Expo `slug` is now `educationai` (changed
  2026-10-28); it must match the EAS project (projectId in `mobile/app.json`), so rename the project on expo.dev to match.
- **Images:** existing logo/favicons reused.

## Phases
1. **Configurable domains** (done): `BASE_DOMAINS` (backend) and `src/config/domain.js` (frontend).
2. **Go live on new domain** (done 2026-10-13): wildcard on hostnext, app and landing builds uploaded, backend
   deployed. Verified: `demo.`, `portal.`, `focus.`, `www.educationai.pk` load with no console errors and pass CORS;
   apex redirects to `www`. Logins are the user's to test (production credentials are not entered by tooling).
   Findings: the old domain serves its **own folder with the old build** (not shared with the new domain);
   `educationai.com.pk` did not resolve at the time of testing.
3. **Visible rebrand** (done, in `main`): UI text and reports, landing app (folder renamed to
   `educationai-landing-astro`), mobile config, docs and config.
4. **Redirect old domains** (file ready, not yet live): `infra/hostnext/old-domain/.htaccess` redirects
   `kodereduai.pk` and `educationai.com.pk` (apex, www and every subdomain, path and query kept) to
   `educationai.pk`. Upload it into the old domain's document root (back up the existing `.htaccess` first).
   It ships with `R=302`; switch to `R=301` once tested. Users must log in again on the new domain (tokens are
   per-origin), so tell schools before enabling. If `educationai.com.pk` points at the same folder as
   `educationai.pk` instead, that folder needs a `.com.pk` rule of its own.
5. **Cleanup and repo rename:** when `kodereduai.pk` expires, drop it from `BASE_DOMAINS` defaults
   (`backend/config/settings.py`, `frontend/src/config/domain.js`), `VITE_BASE_DOMAINS`/`BASE_DOMAINS` env, the
   landing `.htaccess` rule, and `infra/hostnext/old-domain/`. Then rename the GitHub repo to `educationai`, fix
   `.gitmodules` in the `personal-gateway` parent (push the submodule commit first), and check the Render
   deploy hook.

## Deliberately NOT changed
- Old migrations (`brochure/`, `schools/`) and `schools/models.py` help_text (would create a migration).
- `docs/reports/*` (historical records).
- `kodereduai-api.onrender.com` in `ALLOWED_HOSTS` and Render service names.
- Demo seed fake emails `*@demo.kodereduai.pk` (changing them risks duplicate users on re-seed).
- Generated `mobile/android` (ignored; `npx expo prebuild --clean` regenerates it with the new package).

## Pending (blocked on mailboxes)
Create `admin@`, `support@`, `info@`, `noreply@educationai.pk` with SPF/DKIM/DMARC, then change:
- `backend/config/settings.py` defaults (`DEFAULT_FROM_EMAIL`, `CAREERS_EMAIL_RECIPIENT`, ...) still `@koderkids.pk`
- the matching env vars on Render.
Changing the defaults earlier would make password-reset and form emails fail or land in spam.

## Local-only files (gitignored)
`frontend/apps/educationai-landing-astro/.env.production` now has `SITE_URL=https://www.educationai.pk` and
`PUBLIC_MAIN_APP_API_BASE_URL=https://personal-gateway-sg.onrender.com/educationai`. The `PUBLIC_*_FORM_ENDPOINT`
values are empty; check that the contact/demo/careers forms work.

## Deploy note
Render builds the parent repo `personal-gateway`: push `kodereduai` first, then bump the submodule pointer in the parent.
