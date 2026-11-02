import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.APPWRITE_FUNCTION_API_ENDPOINT = "https://appwrite.test/v1";
process.env.APPWRITE_FUNCTION_PROJECT_ID = "test-project";
process.env.GNANI_API_KEY = "test-gnani-key";
process.env.GEMINI_API_KEY = "test-gemini-key";

const { default: handler } = await import("../index.js");
const originalFetch = globalThis.fetch;
const originalGnaniKey = process.env.GNANI_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.GNANI_API_KEY = originalGnaniKey;
});

const fileId = "test-recording-id";
const bucketId = "spendwise-voice-recordings";
const userId = "test-user-id";
const audioBytes = Buffer.from([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
]);
const ownerPermissions = [
  `read("user:${userId}")`,
  `delete("user:${userId}")`,
];

const createFile = (overrides = {}) => ({
  $id: fileId,
  bucketId,
  $permissions: ownerPermissions,
  name: "voice-test.m4a",
  mimeType: "audio/mp4",
  sizeOriginal: audioBytes.length,
  ...overrides,
});

const callHandler = async (body, overrides = {}) => {
  let response;
  const logs = [];
  const req = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-appwrite-user-jwt": "test-user-jwt",
      "x-appwrite-user-id": userId,
      ...overrides.headers,
    },
    body: JSON.stringify(body),
    ...overrides.req,
  };

  await handler({
    req,
    res: {
      json(payload, status = 200) {
        response = { payload, status };
        return response;
      },
    },
    log(message) {
      logs.push(message);
    },
    error(message) {
      logs.push(message);
    },
  });

  return { ...response, logs };
};

const setupVoiceFetch = ({
  file = createFile(),
  accountId = userId,
  downloadStatus = 200,
  downloadBytes = audioBytes,
  gnaniStatus = 200,
  gnaniResult = {
    success: true,
    transcript: "ഞാൻ ചായയ്ക്ക് 20 രൂപ ചെലവാക്കി",
    detected_language_code: "ml-IN",
  },
  gnaniError,
} = {}) => {
  const calls = { delete: 0, gnani: 0, downloaded: 0, form: null };
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);

    if (url.endsWith("/account")) {
      return Response.json({ $id: accountId });
    }
    if (url.includes(`/files/${fileId}/download`)) {
      calls.downloaded += 1;
      return new Response(downloadBytes, { status: downloadStatus });
    }
    if (url.endsWith(`/files/${fileId}`) && options.method === "DELETE") {
      calls.delete += 1;
      return Response.json({});
    }
    if (url.endsWith(`/files/${fileId}`)) {
      if (!file) {
        return Response.json({ message: "Not found" }, { status: 404 });
      }
      return Response.json(file);
    }
    if (url === "https://api.vachana.ai/stt/v3") {
      calls.gnani += 1;
      calls.form = options.body;
      calls.apiKeyHeader = options.headers["X-API-Key-ID"];
      calls.contentTypeHeader = options.headers["Content-Type"];
      if (gnaniError) {
        throw gnaniError;
      }
      return Response.json(gnaniResult, { status: gnaniStatus });
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  };

  return calls;
};

const requestBody = (overrides = {}) => ({
  mode: "transcribe-voice",
  fileId,
  bucketId,
  ...overrides,
});

test("transcribes Malayalam audio with the documented multipart request and owner cleanup", async () => {
  const calls = setupVoiceFetch();
  const result = await callHandler(requestBody());

  assert.equal(result.status, 200);
  assert.equal(result.payload.transcript, "ഞാൻ ചായയ്ക്ക് 20 രൂപ ചെലവാക്കി");
  assert.equal(result.payload.detected_language_code, "ml-IN");
  assert.equal(calls.delete, 1);
  assert.equal(calls.gnani, 1);
  assert.equal(calls.form.get("model"), "prisma-v3.0");
  assert.equal(calls.form.get("language_code"), "indic-auto");
  assert.equal(calls.form.get("format"), "transcribe");
  assert.equal(calls.form.get("audio_file").name, "voice-recording.m4a");
  assert.equal(calls.apiKeyHeader, "test-gnani-key");
  assert.equal(calls.contentTypeHeader, undefined);
  assert.deepEqual(
    Buffer.from(await calls.form.get("audio_file").arrayBuffer()),
    audioBytes
  );
});

test("returns a successful English transcript and accepts an empty transcript response", async (t) => {
  await t.test("English", async () => {
    const calls = setupVoiceFetch({
      gnaniResult: {
        success: true,
        transcript: "I spent 20 rupees on tea",
        detected_language_code: "en-IN",
      },
    });
    const result = await callHandler(requestBody());

    assert.equal(result.status, 200);
    assert.equal(result.payload.transcript, "I spent 20 rupees on tea");
    assert.equal(result.payload.detected_language_code, "en-IN");
    assert.equal(calls.delete, 1);
  });

  await t.test("empty", async () => {
    setupVoiceFetch({ gnaniResult: { success: true, transcript: "" } });
    const result = await callHandler(requestBody());

    assert.equal(result.status, 200);
    assert.equal(result.payload.transcript, "");
  });

  await t.test("Malayalam-English code mix", async () => {
    setupVoiceFetch({
      gnaniResult: {
        success: true,
        transcript: "ചായയ്ക്ക് 20 rupees spent ചെയ്തു",
        detected_language_code: "ml-IN",
      },
    });
    const result = await callHandler(requestBody());

    assert.equal(result.status, 200);
    assert.equal(result.payload.transcript, "ചായയ്ക്ക് 20 rupees spent ചെയ്തു");
  });
});

test("does not retrieve or delete a file whose individual permissions are not owner-only", async () => {
  const calls = setupVoiceFetch({
    file: createFile({ $permissions: ['read("any")'] }),
  });
  const result = await callHandler(requestBody());

  assert.equal(result.status, 403);
  assert.equal(calls.downloaded, 0);
  assert.equal(calls.gnani, 0);
  assert.equal(calls.delete, 0);
});

test("does not delete a missing file or process a caller-supplied user identity", async () => {
  const calls = setupVoiceFetch({ file: null });
  const result = await callHandler(requestBody({ userId: "another-user" }));

  assert.equal(result.status, 403);
  assert.equal(calls.gnani, 0);
  assert.equal(calls.delete, 0);
});

test("rejects a user identity header that does not match the JWT account", async () => {
  const calls = setupVoiceFetch({ accountId: "different-user" });
  const result = await callHandler(requestBody());

  assert.equal(result.status, 401);
  assert.equal(calls.downloaded, 0);
  assert.equal(calls.delete, 0);
});

test("deletes owned files with invalid size or audio format without sending them to Gnani", async (t) => {
  await t.test("empty file", async () => {
    const calls = setupVoiceFetch({ file: createFile({ sizeOriginal: 0 }) });
    const result = await callHandler(requestBody());

    assert.equal(result.status, 413);
    assert.equal(calls.gnani, 0);
    assert.equal(calls.delete, 1);
  });

  await t.test("unsupported format", async () => {
    const calls = setupVoiceFetch({
      file: createFile({ name: "voice-test.webm", mimeType: "audio/webm" }),
    });
    const result = await callHandler(requestBody());

    assert.equal(result.status, 415);
    assert.equal(calls.gnani, 0);
    assert.equal(calls.delete, 1);
  });

  await t.test("invalid M4A container signature", async () => {
    const calls = setupVoiceFetch({ downloadBytes: Buffer.alloc(audioBytes.length) });
    const result = await callHandler(requestBody());

    assert.equal(result.status, 415);
    assert.equal(calls.gnani, 0);
    assert.equal(calls.delete, 1);
  });
});

test("rejects a mismatched bucket and unauthenticated request before Storage access", async () => {
  const calls = setupVoiceFetch();
  const wrongBucket = await callHandler(requestBody({ bucketId: "another-bucket" }));
  const unauthenticated = await callHandler(requestBody(), {
    headers: { "x-appwrite-user-jwt": "" },
  });

  assert.equal(wrongBucket.status, 400);
  assert.equal(unauthenticated.status, 401);
  assert.equal(calls.downloaded, 0);
  assert.equal(calls.delete, 0);
});

test("rejects an invalid JSON body without falling through to the advisor", async () => {
  const result = await callHandler({}, { req: { body: "{" } });

  assert.equal(result.status, 400);
  assert.equal(result.payload.error, "Request body must contain valid JSON.");
});

test("deletes the owner recording when the provider rejects the API key", async () => {
  const calls = setupVoiceFetch({
    gnaniStatus: 401,
    gnaniResult: { success: false, error: { message: "sensitive provider detail" } },
  });
  const result = await callHandler(requestBody());

  assert.equal(result.status, 502);
  assert.equal(result.payload.error, "Unable to transcribe this recording. Please retry.");
  assert.equal(calls.delete, 1);
  assert.equal(JSON.stringify(result).includes("test-gnani-key"), false);
  assert.equal(JSON.stringify(result).includes("sensitive provider detail"), false);
});

test("cleans up after missing credentials and provider timeout", async (t) => {
  await t.test("missing key", async () => {
    process.env.GNANI_API_KEY = "";
    const calls = setupVoiceFetch();
    const result = await callHandler(requestBody());

    assert.equal(result.status, 503);
    assert.equal(calls.gnani, 0);
    assert.equal(calls.delete, 1);
  });

  await t.test("timeout", async () => {
    const timeout = new Error("network timeout");
    timeout.name = "TimeoutError";
    const calls = setupVoiceFetch({ gnaniError: timeout });
    const result = await callHandler(requestBody());

    assert.equal(result.status, 504);
    assert.equal(calls.delete, 1);
  });
});

test("extracts a transaction date and preserves the exact original transcript", async () => {
  const transcript = "Yesterday I spent 42 rupees on food";
  let prompt = "";
  globalThis.fetch = async (input, options = {}) => {
    assert.match(String(input), /^https:\/\/generativelanguage\.googleapis\.com\//);
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return Response.json({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  category: "Food",
                  amount: 42,
                  date: "2026-11-01",
                }),
              },
            ],
          },
        },
      ],
    });
  };

  const result = await callHandler(
    { mode: "extract-expense", message: transcript },
    { headers: { "x-appwrite-user-jwt": "test-user-jwt" } }
  );
  const extracted = JSON.parse(result.payload.reply);

  assert.equal(result.status, 200);
  assert.equal(extracted.date, "2026-11-01");
  assert.equal(extracted.transcript, transcript);
  assert.match(prompt, /Asia\/Kolkata/);
  assert.match(prompt, /If no transaction date is spoken, return null/);
  assert.match(prompt, /Yesterday/);
  const todayKolkata = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  assert.match(prompt, new RegExp(todayKolkata));
});

test("returns null for an absent date and safely handles Gemini extraction failures", async (t) => {
  await t.test("no spoken date", async () => {
    globalThis.fetch = async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ category: "Food", amount: 10, date: null }) }],
            },
          },
        ],
      });
    const result = await callHandler({
      mode: "extract-expense",
      message: "I spent 10 rupees on food",
    });

    assert.equal(JSON.parse(result.payload.reply).date, null);
  });

  await t.test("provider failure", async () => {
    globalThis.fetch = async () => Response.json({ error: { message: "private detail" } }, { status: 500 });
    const result = await callHandler({
      mode: "extract-expense",
      message: "I spent 10 rupees on food",
    });

    assert.equal(result.status, 200);
    assert.equal(JSON.stringify(result).includes("private detail"), false);
    assert.equal(JSON.stringify(result).includes("test-gemini-key"), false);
  });
});
