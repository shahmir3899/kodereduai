# Rebranding: KoderEduAI -> Education AI

Status as of 2026-10-12. Branch: `feature/rebrand-educationai`.

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
- **Mobile:** bundle ID `pk.educationai.app`, not yet published. Expo `slug` stays `kodereduai`
  because it must match the EAS project (projectId in `mobile/app.json`); rename it on expo.dev first if wanted.
- **Images:** existing logo/favicons reused.

## Phases
1. **Configurable domains** (done, `12f17bc`): `BASE_DOMAINS` (backend) and `src/config/domain.js` (frontend).
2. **Go live on new domain** (waiting on hostnext ticket): DNS, wildcard SSL, same document root, upload build, test
   `demo.`, `portal.`, `www.`, `focus.` on `educationai.pk`. Users must log in again (tokens are per-origin).
3. **Visible rebrand** (this branch): UI text and reports, landing app (folder renamed to
   `educationai-landing-astro`), mobile config, docs and config.
4. **Redirect old domain for ~1 month:** host-conditional rules in the shared `.htaccess`.
   Landing `public/.htaccess` already redirects the apex to `www` for both domains.
5. **Cleanup and repo rename:** drop `kodereduai.pk` from `BASE_DOMAINS` defaults
   (`backend/config/settings.py`, `frontend/src/config/domain.js`) and the landing `.htaccess` rule;
   rename the GitHub repo to `educationai`, then fix `.gitmodules` in the `personal-gateway` parent
   (push the submodule commit first).

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

## Local-only files to check (gitignored)
`frontend/apps/educationai-landing-astro/.env.production` has `SITE_URL` updated, but
`PUBLIC_MAIN_APP_API_BASE_URL` still points at the suspended `kodereduai-api.onrender.com`;
set it to `https://personal-gateway-sg.onrender.com/educationai`.
