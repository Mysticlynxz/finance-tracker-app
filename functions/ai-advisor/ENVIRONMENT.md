# Appwrite AI Advisor Function environment

Configure these values in the Appwrite Console under the `ai-advisor` Function's
**Settings / Variables**. Mark credentials as protected/secret where available.
Do not commit a populated `.env` file.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Gemini advisor responses and expense extraction. |
| `GNANI_API_KEY` | Yes for primary transcription | Gnani Prisma API key ID, sent only as `X-API-Key-ID` by the function. |
| `APPWRITE_DATABASE_ID` | Yes for advisor | Database queried for user expenses and budgets. |
| `APPWRITE_EXPENSES_COLLECTION_ID` | Optional | Expenses collection; defaults to `expenses`. |
| `APPWRITE_BUDGETS_COLLECTION_ID` | Optional | Budgets collection; defaults to `budgets`. |
| `APPWRITE_ENDPOINT` | Usually no | Override; otherwise uses `APPWRITE_FUNCTION_API_ENDPOINT`. |
| `APPWRITE_PROJECT_ID` | Usually no | Override; otherwise uses `APPWRITE_FUNCTION_PROJECT_ID`. |

Appwrite supplies the function endpoint and project ID at runtime. The handler
uses the caller's `x-appwrite-user-jwt` and `x-appwrite-user-id` request headers
for user-scoped access; do not replace them with a broad-privilege API key.
Appwrite does not automatically load this directory's `.env.example` when the
function is deployed. Enter values in the Console or use a supported deployment
flow. Never put populated server configuration in the Expo frontend.

## Required Appwrite Console setup

Use the existing Storage bucket whose configured ID is
`spendwise-voice-recordings`; do not recreate it. Verify **File Security** is
enabled, authenticated users have bucket-level **Create** only, and there are
no public or bucket-level Read, Update, or Delete permissions. Verify its
maximum file size is at least 5 MB and the `m4a` extension is allowed; do not
change existing settings unless they conflict with these requirements. Native
Android recordings use an MPEG-4 container with AAC audio; iOS recordings use
MPEG-4 AAC. The mobile upload declares `audio/mp4`. If Appwrite reports a
`.m4a` file as `video/mp4`, the function checks the downloaded MP4 container
and sends it to Gnani as `audio/mp4`. Uploads are assigned only owner Read and
Delete file permissions; the function rejects files with any additional file
permission.

The local `appwrite.config.json` deploys the Function only; it does not manage
Storage bucket settings. Changing or redeploying this Function does not set the
bucket's allowed extensions.

In the `ai-advisor` Function's variables, set `GNANI_API_KEY` as a protected
server-side variable. Retain `GEMINI_API_KEY` for the advisor and expense
extraction. Never put provider credentials in Expo or an `EXPO_PUBLIC_`
variable.
Configure the Function timeout to the Appwrite-supported 30-second maximum;
voice execution is synchronous and internally targets completion within 22
seconds, leaving time for cleanup and response delivery.

The local Appwrite CLI manifest targets the Appwrite `node-22` runtime.
Voice transcription uses Node 22's built-in `fetch`, `FormData`, `Blob`, and
`AbortSignal.timeout`; Appwrite Storage and account checks use the installed
`appwrite` SDK with the caller's JWT. Deploy only this function with
`appwrite push function --function-id 69a76eab00275ef10835`. Do not pass
`--with-variables`; keep protected provider keys configured in Appwrite.

## Voice transcription behavior

The function uses Gnani's synchronous `POST https://api.vachana.ai/stt/v3`
REST endpoint with multipart `audio_file`, `model=prisma-v3.0`,
`language_code=indic-auto`, and `format=transcribe`. Prisma REST has a 30-second
audio limit. The app recommends 15–20 seconds and automatically stops recording
at 30 seconds. The function runs synchronously and reserves time under
Appwrite's 30-second execution limit. Gnani Prisma v3.0 is the only speech-to-
text provider. Voice capture is available only in the Android and iOS apps;
Expo Web displays a mobile-app-only message and does not record audio.

For manual provider verification, test Malayalam (`ml-IN`), English (`en-IN`),
and Malayalam-English code-mixed audio. The current request uses automatic
language identification (`indic-auto`); provider credentials and recordings
are required to verify recognition quality.
