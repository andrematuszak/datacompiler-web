# datacompiler-web

Static site for data-compiler.com (HTML/CSS/JS, no dependencies, no build step).

## Deploy
- Netlify > Add new site > Deploy manually: drop the folder (or the zip), then add the domain data-compiler.com.
- Later: connect this repository (only this one) to deploy on every `git push`.

## Demo mode
In `app.js`, `CONFIG.DEMO = true` returns simulated results (fake numbers; the file name picks the case: "polish" = human review, "tax" = ready). Set it to `false` once the API answers (`/upload`, `/status/{id}`, `/result/{id}`, `/preview/{id}.png`) and point `API_BASE` at it.

## Rules
- No secrets in this repository (OpenRouter keys, etc. live on the server only).
- The blurred preview must be an image blurred server-side (`preview_url`); the CSS blur is demo decoration only.
- Prices, lead times and the texts in `pricing.html` are provisional.

## Diagnostic API connection

`API_BASE` remains the existing full-processing API. `DIAGNOSTIC_API_BASE` is
the separate public Cloudflare URL for `datacompiler-api` (for example, the
URL of its own tunnel). Put that URL in the `DIAGNOSTIC_API_BASE` setting at
the top of `app.js` after starting that service on the Mac. The
frontend posts to `/v1/diagnostics`, displays scan OCR/translation previews as
they arrive, and keeps the existing API for native-text PDFs and as a fallback
while the new endpoint is unavailable. The API must allow the site's origin in
its CORS configuration.
