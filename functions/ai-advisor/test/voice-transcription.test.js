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
  const errors = [];
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
      errors.push(message);
    },
  });

  return { ...response, logs, errors };
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
  deleteError,
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
      if (deleteError) {
        throw deleteError;
      }
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
  assert.equal(calls.form.get("audio_file").type, "audio/mp4");
  assert.equal(calls.apiKeyHeader, "test-gnani-key");
  assert.equal(calls.contentTypeHeader, undefined);
  const loggedStages = result.logs
    .filter((message) => message.startsWith("{"))
    .map((message) => JSON.parse(message).stage);
  assert.deepEqual(result.errors, []);
  assert.ok(loggedStages.includes("authentication.headers_received"));
  assert.ok(loggedStages.includes("storage.permissions_checked"));
  assert.ok(loggedStages.includes("storage.download_completed"));
  assert.ok(loggedStages.includes("prisma.request_started"));
  assert.ok(loggedStages.includes("prisma.response_received"));
  assert.ok(loggedStages.includes("storage.cleanup_completed"));
  const transcriptionRequestLog = result.logs
    .filter((message) => message.startsWith("{"))
    .map((message) => JSON.parse(message))
    .find((entry) => entry.stage === "prisma.request_started");
  assert.equal(transcriptionRequestLog.fileName, "voice-recording.m4a");
  assert.equal(transcriptionRequestLog.mimeType, "audio/mp4");
  assert.equal(transcriptionRequestLog.sizeBytes, audioBytes.length);
  assert.equal(transcriptionRequestLog.multipartField, "audio_file");
  assert.equal(JSON.stringify(result.logs).includes("test-user-jwt"), false);
  assert.equal(JSON.stringify(result.logs).includes("test-gnani-key"), false);
  assert.deepEqual(
    Buffer.from(await calls.form.get("audio_file").arrayBuffer()),
    audioBytes
  );
});

test("normalizes Appwrite video/mp4 metadata to audio/mp4 for validated M4A audio", async () => {
  const calls = setupVoiceFetch({
    file: createFile({ mimeType: "video/mp4" }),
  });
  const result = await callHandler(requestBody());
  const transcriptionRequestLog = result.logs
    .filter((message) => message.startsWith("{"))
    .map((message) => JSON.parse(message))
    .find((entry) => entry.stage === "prisma.request_started");

  assert.equal(result.status, 200);
  assert.equal(calls.form.get("audio_file").name, "voice-recording.m4a");
  assert.equal(calls.form.get("audio_file").type, "audio/mp4");
  assert.equal(transcriptionRequestLog.mimeType, "audio/mp4");
  assert.equal(calls.delete, 1);
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

test("logs missing owner DELETE permission without exposing user identity", async () => {
  const calls = setupVoiceFetch({
    file: createFile({ $permissions: [`read("user:${userId}")`] }),
  });
  const result = await callHandler(requestBody());
  const permissionError = result.errors
    .map((entry) => JSON.parse(entry))
    .find((entry) => entry.stage === "storage.ownership_validation_failed");

  assert.equal(result.status, 403);
  assert.equal(permissionError.hasOwnerRead, true);
  assert.equal(permissionError.hasOwnerDelete, false);
  assert.equal(permissionError.permissionCount, 1);
  assert.equal(JSON.stringify(result.logs).includes(userId), false);
  assert.equal(JSON.stringify(result.errors).includes(userId), false);
  assert.equal(calls.downloaded, 0);
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

test("records Gnani 415 status and safe error type without logging provider response details", async () => {
  const calls = setupVoiceFetch({
    gnaniStatus: 415,
    gnaniResult: {
      success: false,
      error: { type: "UNSUPPORTED_MEDIA_TYPE", message: "private provider detail" },
    },
  });
  const result = await callHandler(requestBody());
  const upstreamError = result.errors
    .map((entry) => JSON.parse(entry))
    .find((entry) => entry.stage === "prisma.response_rejected");

  assert.equal(result.status, 502);
  assert.equal(upstreamError.httpStatus, 415);
  assert.equal(upstreamError.upstreamErrorType, "UNSUPPORTED_MEDIA_TYPE");
  assert.equal(JSON.stringify(result.logs).includes("private provider detail"), false);
  assert.equal(JSON.stringify(result.errors).includes("private provider detail"), false);
  assert.equal(calls.delete, 1);
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

test("logs cleanup denial while preserving the original transcription failure", async () => {
  const calls = setupVoiceFetch({
    gnaniStatus: 401,
    gnaniResult: { success: false },
    deleteError: Object.assign(new Error("No permissions provided for action 'delete'"), {
      code: 403,
      type: "user_unauthorized",
    }),
  });
  const result = await callHandler(requestBody());
  const cleanupError = result.errors
    .map((entry) => JSON.parse(entry))
    .find((entry) => entry.stage === "storage.cleanup_failed");

  assert.equal(result.status, 502);
  assert.equal(result.payload.error, "Unable to transcribe this recording. Please retry.");
  assert.equal(cleanupError.httpStatus, 403);
  assert.equal(cleanupError.appwriteErrorType, "user_unauthorized");
  assert.equal(calls.delete, 1);
});

test("returns a cleanup failure when transcription succeeded but deletion failed", async () => {
  const calls = setupVoiceFetch({
    deleteError: Object.assign(new Error("No permissions provided for action 'delete'"), {
      code: 403,
      type: "user_unauthorized",
    }),
  });
  const result = await callHandler(requestBody());
  const cleanupError = result.errors
    .map((entry) => JSON.parse(entry))
    .find((entry) => entry.stage === "storage.cleanup_failed");

  assert.equal(result.status, 500);
  assert.equal(result.payload.error, "Unable to securely finish processing the recording.");
  assert.equal(cleanupError.httpStatus, 403);
  assert.equal(cleanupError.appwriteErrorType, "user_unauthorized");
  assert.equal(calls.delete, 1);
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
                text: JSON.stringify({ expenses: [{ category: "Food", amount: 42, date: "2026-11-01" }] }),
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
  assert.deepEqual(extracted.expenses, [{ category: "Food", amount: 42, date: "2026-11-01" }]);
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
              parts: [{ text: JSON.stringify({ expenses: [{ category: "Food", amount: 10, date: null }] }) }],
            },
          },
        ],
      });
    const result = await callHandler({
      mode: "extract-expense",
      message: "I spent 10 rupees on food",
    });

    assert.equal(JSON.parse(result.payload.reply).expenses[0].date, null);
  });

  await t.test("provider failure", async () => {
    globalThis.fetch = async () => Response.json({ error: { message: "private detail" } }, { status: 500 });
    const result = await callHandler({
      mode: "extract-expense",
      message: "I spent 10 rupees on food",
    });

    assert.equal(result.status, 502);
    assert.match(result.payload.error, /Unable to extract expenses/);
    assert.equal(JSON.stringify(result).includes("private detail"), false);
    assert.equal(JSON.stringify(result).includes("test-gemini-key"), false);
  });
});

test("extracts multiple transactions independently and supports legacy and multilingual transcripts", async (t) => {
  const cases = [
    ["one", "I spent 500 on food", [{ amount: 500, category: "Food", date: null }]],
    ["two", "500 food and 200 bills", [{ amount: 500, category: "Food", date: null }, { amount: 200, category: "Bills", date: null }]],
    ["three", "food 500, bills 200, travel 80", [{ amount: 500, category: "Food", date: null }, { amount: 200, category: "Bills", date: null }, { amount: 80, category: "Travel", date: null }]],
    ["different dates", "food yesterday, bills today", [{ amount: 5, category: "Food", date: "2026-11-03" }, { amount: 8, category: "Bills", date: "2026-11-04" }]],
    ["Malayalam", "ഭക്ഷണത്തിന് 500 രൂപ ചെലവാക്കി", [{ amount: 500, category: "Food", date: null }]],
    ["mixed language", "500 രൂപ food ന്, 200 bills ന്", [{ amount: 500, category: "Food", date: null }, { amount: 200, category: "Bills", date: null }]],
  ];
  for (const [label, transcript, expenses] of cases) {
    await t.test(label, async () => {
      globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ expenses }) }] } }] });
      const result = await callHandler({ mode: "extract-expense", message: transcript }, { headers: { "x-appwrite-user-jwt": "test-user-jwt" } });
      assert.deepEqual(JSON.parse(result.payload.reply).expenses, expenses);
      assert.equal(JSON.parse(result.payload.reply).transcript, transcript);
    });
  }
  await t.test("empty list and malformed items do not fabricate zero expenses", async () => {
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ expenses: [{ amount: 0, category: "Food" }, { amount: 10 }, { amount: 12, category: "Bills", date: "not-a-date" }] }) }] } }] });
    const result = await callHandler({ mode: "extract-expense", message: "ambiguous" }, { headers: { "x-appwrite-user-jwt": "test-user-jwt" } });
    assert.deepEqual(JSON.parse(result.payload.reply).expenses, [{ amount: 12, category: "Bills", date: null }]);
  });
  await t.test("legacy single-object response remains one expense", async () => {
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ amount: 25, category: "Food", date: null }) }] } }] });
    const result = await callHandler({ mode: "extract-expense", message: "food 25" }, { headers: { "x-appwrite-user-jwt": "test-user-jwt" } });
    assert.deepEqual(JSON.parse(result.payload.reply).expenses, [{ amount: 25, category: "Food", date: null }]);
  });
});

test("strictly rejects malformed expense amounts and preserves valid decimal amounts", async (t) => {
  const invalid = [true, false, null, undefined, [], {}, " ", "abc", "0xFF", "1e5", 0, -100, "NaN", "Infinity"];
  const candidates = invalid.map((amount) => ({ amount, category: "Food" }));
  candidates.push({ amount: 100, category: "Food" }, { amount: 100.5, category: "Bills" }, { amount: "500", category: "Travel" });
  await t.test("rejects invalid and retains individually valid expenses", async () => {
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ expenses: candidates }) }] } }] });
    const result = await callHandler({ mode: "extract-expense", message: "expenses" }, { headers: { "x-appwrite-user-jwt": "test-user-jwt" } });
    assert.deepEqual(JSON.parse(result.payload.reply).expenses, [
      { amount: 100, category: "Food", date: null },
      { amount: 100.5, category: "Bills", date: null },
      { amount: 500, category: "Travel", date: null },
    ]);
  });
  await t.test("accepts a one item array and retains cent precision", async () => {
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ expenses: [{ amount: 100.509, category: "Food" }] }) }] } }] });
    const result = await callHandler({ mode: "extract-expense", message: "food" }, { headers: { "x-appwrite-user-jwt": "test-user-jwt" } });
    assert.deepEqual(JSON.parse(result.payload.reply).expenses, [{ amount: 100.51, category: "Food", date: null }]);
  });
});

test("rejects amounts whose two-decimal rounding overflows and keeps finite amounts", async () => {
  const values = [1e307, 1e306, Number.MAX_VALUE, 1e100, 100, 100.5, 0.01, 0.004];
  const expenses = values.map((amount) => ({ amount, category: "Food" }));
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ expenses }) }] } }] });
  const result = await callHandler({ mode: "extract-expense", message: "amounts" }, { headers: { "x-appwrite-user-jwt": "test-user-jwt" } });
  const accepted = JSON.parse(result.payload.reply).expenses;
  assert.deepEqual(accepted.map(({ amount }) => amount), [1e307, 1e306, Number.MAX_VALUE, 1e100, 100, 100.5, 0.01]);
  assert.ok(accepted.every(({ amount }) => Number.isFinite(amount) && amount > 0));
  assert.ok(accepted.every(({ amount }) => amount !== null && Number.isFinite(amount)));
});
