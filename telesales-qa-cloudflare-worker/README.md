# Telesales QA — Cloudflare Workers Free

This is a no-Render-billing alternative for the prototype. It uses the Workers AI binding for:
1. Indonesian audio transcription via `@cf/openai/whisper`.
2. Text QA evaluation via `@cf/meta/llama-3.1-8b-instruct-fp8`.

**Important limitations**
- The Worker does not use an OpenAI API key.
- Cloudflare Workers AI has a daily free allocation. Usage above that requires the paid Workers plan; do not upgrade. When a quota/limit is reached, this API reports an error and should be retried after reset.
- It evaluates the transcript, not the full acoustic experience. Tone, smiling voice, articulation, enthusiasm, speaking over the customer, and actual product price/fact accuracy require a human reviewer.
- Audio upload is limited to 10 MB in this implementation.
- It does not store uploaded audio or transcripts.
- Do not upload call recordings without appropriate permission.

## Deploy using the Cloudflare dashboard (no CLI required)

1. Create/sign in to a Cloudflare account. Do not add a payment method or upgrade for this prototype.
2. Open Workers & Pages and create a Worker named `telesales-qa-audio-api`.
3. Copy `worker.js` into the Worker editor and save/deploy.
4. In the Worker settings, enable the Workers AI binding named `AI` (model usage may stop if the free daily quota is exhausted).
5. In Worker Settings → Variables and Secrets, add secret `QA_ACCESS_TOKEN` with a long random string. Never commit it to GitHub or paste it into a public page.
6. Set variable `FRONTEND_ORIGIN` to the exact origin of the published QA frontend, or keep `*` only for a short restricted prototype. Bearer token is still required.
7. Visit `https://YOUR-WORKER.workers.dev/healthz`. It should return JSON with `ok: true`.
8. Configure the saved Telesales QA page with the endpoint `https://YOUR-WORKER.workers.dev/api/qa/analyze-recording` and the same access token in its password field.

This Worker will not charge an API key or silently upgrade your plan. Cloudflare's published AI free allowance is finite; monitor usage and stop when the free allocation is reached.
