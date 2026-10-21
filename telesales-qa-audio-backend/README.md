# Telesales QA — Audio Backend

Node.js backend to receive a call recording, normalize it temporarily with FFmpeg, transcribe Indonesian speech, and evaluate audio/transcript against the Route of Telesales criteria.

## Render configuration

- Runtime: Node
- Region: Singapore
- Build command: `cd telesales-qa-audio-backend && npm install`
- Start command: `cd telesales-qa-audio-backend && npm start`

Set these values under the Render service Environment settings:
- `OPENAI_API_KEY`: your approved OpenAI API key (secret; never commit it or paste it into the frontend).
- `QA_ACCESS_TOKEN`: a long, random access token of your choice; enter the same value into the Telesales QA frontend's access-token field.
- `FRONTEND_ORIGIN`: allowed frontend origin(s), separated by commas. Use the exact website origin for production; `*` is only a prototype fallback and is not a substitute for the access token.
- `OPENAI_TRANSCRIBE_MODEL`: defaults to `gpt-4o-mini-transcribe`.
- `OPENAI_AUDIO_MODEL`: defaults to `gpt-audio`.

## Endpoints

- `GET /healthz`: health status plus boolean indicators for required configuration; never returns secret values.
- `POST /api/qa/analyze-recording`: multipart fields `audio` (required) and `agentName` (required); requires `Authorization: Bearer <QA_ACCESS_TOKEN>`. Maximum upload size: 25 MB. In-memory limit: four requests per IP per ten minutes.

The recording is deleted from temporary disk after processing. The transcript and findings are returned to the frontend. Reviewers must validate product/pricing claims, evidence, and high-risk findings before using results for coaching or performance decisions. Upload recordings only when the necessary permission and retention rules are in place.
