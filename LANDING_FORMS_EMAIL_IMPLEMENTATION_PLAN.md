# Landing Forms Email Implementation Plan

## Objective

Replace browser `mailto:` behavior in the Astro landing app with backend-delivered emails for all public forms, using one branded HTML template per form and automated coverage for each template.

## Scope

- Wire the demo request form to a backend public endpoint.
- Wire the contact enquiry form to a backend public endpoint.
- Keep the careers application form on its existing backend endpoint.
- Render a separate HTML email template for each form.
- Use subjects that start with `Education AI - Form ...`.
- Add focused tests that send one email for each template.

## Implemented Architecture

### Frontend

- Astro app submits JSON to backend endpoints instead of opening the local email client.
- `siteConfig` exposes three endpoints:
  - `demoRequestEndpoint`
  - `contactEnquiryEndpoint`
  - `careersEndpoint`
- Demo and contact forms now show explicit submitting, success, and error states.

### Backend

- Public endpoints live in the brochure app because careers already used that app for public landing submissions.
- Added serializers for:
  - `DemoRequestSerializer`
  - `ContactEnquirySerializer`
- Added public views for:
  - `POST /api/public/forms/demo-request/`
  - `POST /api/public/forms/contact-enquiry/`
- Reworked career email delivery to use the same branded HTML email path while preserving optional DB save behavior.

### Email Rendering

- All landing emails are sent through a shared helper that:
  - renders HTML with Django templates
  - derives a text fallback from the HTML
  - sends with `EmailMultiAlternatives`
  - supports reply-to and attachments
- Separate templates were created for:
  - demo request
  - contact enquiry
  - career application

## Branding Rules

- Demo email subject: `Education AI - Form Demo Request`
- Contact email subject: `Education AI - Form Contact Enquiry`
- Career email subject: `Education AI - Form Career Application`
- Each template has its own accent color and highlight panel to make triage easier in inboxes.

## Configuration

### Backend environment variables

- `LANDING_FORMS_EMAIL_RECIPIENT`
- `LANDING_FORMS_EMAIL_SENDER`
- Existing career settings remain active:
  - `CAREERS_EMAIL_RECIPIENT`
  - `CAREERS_EMAIL_SENDER`
  - `CAREERS_SAVE_TO_DB`

### Frontend environment variables

- `PUBLIC_DEMO_FORM_ENDPOINT`
- `PUBLIC_CONTACT_FORM_ENDPOINT`
- `PUBLIC_CAREERS_FORM_ENDPOINT`
- If these are empty, the Astro app falls back to `PUBLIC_MAIN_APP_API_BASE_URL` plus the default API paths.

## Testing Plan

- Backend tests verify one email is sent for each form flow.
- Assertions cover:
  - `201` response status
  - correct branded subject
  - rendered HTML template content
  - CV attachment for career submissions
- Use Django locmem email backend during tests.

## Validation Performed

- Backend: `pytest tests/test_public_form_emails.py -q`
- Frontend: `npm run build` in the Astro app

## Deployment Notes

- Ensure the backend email backend is configured for SMTP in deployed environments.
- Ensure the Astro app points to the correct backend base URL or explicit form endpoints.
- If the Astro site and backend run on different origins, deployed CORS settings must continue to allow the landing domain.

## Operational Follow-up

- Confirm production recipient inboxes for demo, contact, and careers routing.
- Decide whether demo/contact submissions should also be saved to DB in a later phase.
- If inbox volume increases, split recipients by form type or add CRM/webhook fan-out behind the shared helper.