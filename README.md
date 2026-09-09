# Grounded Expat

## Free Journal signup integration

This repository serves static HTML with Cloudflare Pages Functions. The handler at
`functions/api/submit.js` implements `POST /api/submit`. There is no build manifest,
Wrangler configuration, or deployment workflow checked in. The local Python server
in `.claude/launch.json` only serves static files; it cannot execute the API handler.
Cloudflare confirms the project `grounded-expat-site` deploys automatically from
GitHub `main`. The repair was applied to production revision `d3da1aa` in an
isolated release checkout so newer site changes are preserved.

The Free Journal forms on `/`, `/start-here/`, and `/journals/` now use that single
server request. Explicit `_form` values `grounded-waitlist` and
`library-free-journals` select the Kit handoff. Other flows, including direct
journal gates, product-page scripts, and The Circle, are outside this repair.

Previously, the browser independently posted to Kit's public subscription endpoint
without awaiting or checking the response. Its synchronous try/catch could not
catch rejected fetch promises. The API reported success after the internal Resend
notification, regardless of Kit delivery. This permits the reported Gmail/Kit
mismatch; the specific upstream rejection or transport failure on September 8,
2026 cannot be determined without historical browser/provider logs.

The handler preserves the internal notification and existing best-effort Resend
journal email. It then uses Kit V3 to subscribe the email
to form **9638627**, awaiting and validating the returned form membership. No sequence, tag,
automation, or existing subscriber state is changed directly. The existing Welcome
automation remains responsible for processing that form association.

Each Kit attempt has a five-second deadline. Network/JSON failures and 5xx responses
get one retry; 4xx responses (including rate limits) return a retryable form failure
without immediate retry. Missing credentials also fail visibly. After the internal
notification succeeds, Kit failures return HTTP 502 with `journal_access: true`:
the existing journal access remains available, the existing retry text is shown,
and the form retains its values so the visitor can retry. Successful signups use
the same success copy and access behavior as before. There is no durable retry
queue: persistent failures require a visitor retry or an explicitly authorized
operational follow-up, and must not be interpreted as completed signups.

Kit maintains one subscriber per email and remembers form membership. The handler
accepts 200/201 only when the response identifies form 9638627 and a subscriber ID. Identical Resend payloads use
stable, hashed idempotency keys, separately for the internal and journal emails.
Resend deduplicates these for 24 hours. After that window, another submission can
send another notification/journal email. Keys are never logged. Kit failure logs
contain only event, random request ID, fixed form ID, operation stage, status, and
attempt—no addresses, names, credentials, or upstream response bodies.

API contracts:
- [Kit V3 form subscription API](https://developers.kit.com/api-reference/v3/forms)
- [Resend idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys)

## Safe verification

With a recent Node.js runtime, run:

```sh
node --test tests/*.test.mjs
```

The tests import the actual Pages handler and execute the three page scripts with
mocked browser surfaces. Every outbound fetch is mocked; only reserved
`example.invalid` addresses and fake keys are used. Tests cover association order,
awaited completion, duplicates, notification preservation, all three frontends,
partial-failure access, retry controls, malformed responses, configuration/auth
errors, timeouts, input validation, and separation from other forms. They do not
validate production credentials, Cloudflare deployment, or real automation delivery.

## Configuration and release

Stephanie authorized configuration and deployment. The second task saved the
existing V3 key and handed off; this task owns the single deployment.

1. Confirm the intended Cloudflare Pages project serves this repository and deploys
   its root `functions/` directory; verify the deployment branch/revision and existing
   `RESEND_API_KEY`, `LEAD_TO`, and `LEAD_FROM` settings.
2. Add **`KIT_API_KEY` as a server-side encrypted secret**, using a Kit **V3** API key
   from the account that owns form **9638627**. Never put it in HTML or commit it.
   Leave the existing Welcome automation and form settings unchanged.
3. Keep local/preview verification mocked. A preview pointed at the production Kit
   account or Resend credentials can send real emails and is not a safe test simply
   because it uses a preview URL. Do not attach production credentials or submit
   preview forms for testing without separate authorization.
4. After approval, release the handler and three HTML changes together. Check
   Pages Function logs for `free_journal_kit_failure`; missing_key, 401, 404, and 429
   identify configuration/auth/form/rate-limit issues without exposing subscriber data.
5. A real end-to-end confirmation would require separate approval for a controlled
   signup address and its resulting emails/Kit membership. Do not submit a live signup or send test emails without that separate approval.
