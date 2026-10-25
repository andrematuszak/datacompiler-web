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
