import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.APPWRITE_FUNCTION_API_ENDPOINT = "https://appwrite.test/v1";
process.env.APPWRITE_FUNCTION_PROJECT_ID = "test-project";
process.env.GNANI_API_KEY = "test-gnani-key";

const { default: handler } = await import("../index.js");
const originalFetch = globalThis.fetch;
const originalGnaniKey = process.env.GNANI_API_KEY;
const userId = "test-user-id";
const speechText = "Your recent spending is within budget.";

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.GNANI_API_KEY = originalGnaniKey;
});

const callHandler = async (body, { accountId = userId, headers = {}, method = "POST" } = {}) => {
  const calls = [];
  const logs = [];
  const errors = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/account")) {
      return Response.json({ $id: accountId });
    }
    calls.push({ url, options });
    return new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
  };
  let result;
  await handler({
    req: {
      method,
      headers: {
        "content-type": "application/json",
        "x-appwrite-user-jwt": "test-user-jwt",
        "x-appwrite-user-id": userId,
        ...headers,
      },
      body: JSON.stringify(body),
    },
    res: {
      json(payload, status = 200) {
        result = { payload, status };
        return result;
      },
    },
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
  });
  return { ...result, calls, logs, errors };
};

const validRequest = (overrides = {}) => ({
  mode: "text-to-speech",
  text: speechText,
  ...overrides,
});

test("generates binary MP3 with the fixed Timbre v3.0 request", async () => {
  const result = await callHandler(validRequest());
  const providerRequest = result.calls[0];
  assert.equal(result.status, 200);
  assert.equal(result.payload.mimeType, "audio/mpeg");
  assert.equal(result.payload.audioBase64, Buffer.from([1, 2, 3]).toString("base64"));
  assert.equal(result.payload.byteLength, 3);
  assert.equal(providerRequest.url, "https://api.vachana.ai/api/v1/tts/inference");
  assert.equal(providerRequest.options.method, "POST");
  assert.equal(providerRequest.options.headers["X-API-Key-ID"], "test-gnani-key");
  assert.equal(providerRequest.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(providerRequest.options.body), {
    text: speechText,
    model: "timbre-v3.0",
    voice: "Shivani",
    language: "auto",
    audio_config: { container: "mp3", bitrate: "64k" },
  });
  assert.equal(JSON.stringify(result.logs).includes(speechText), false);
  assert.equal(JSON.stringify(result.logs).includes("test-gnani-key"), false);
  assert.equal(JSON.stringify(result.logs).includes("test-user-jwt"), false);
  assert.deepEqual(result.errors, []);
});

test("preserves representative multilingual and INR response text in mocked requests", async () => {
  const phrases = [
    "Your balance is ₹1,234.50.",
    "आपने इस महीने बजट के भीतर खर्च किया है।",
    "നിങ്ങളുടെ ചെലവ് ബജറ്റിനുള്ളിലാണ്.",
    "இந்த மாத செலவு உங்கள் பட்ஜெட்டுக்குள் உள்ளது.",
    "இந்த மாதம் உங்கள் spending ₹250.75 ആണ്.",
  ];
  const sentTexts = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/account")) return Response.json({ $id: userId });
    sentTexts.push(JSON.parse(options.body).text);
    return new Response(Uint8Array.from([1]), {
      headers: { "content-type": "audio/mpeg" },
    });
  };
  for (const text of phrases) {
    let result;
    await handler({
      req: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-appwrite-user-jwt": "test-user-jwt",
          "x-appwrite-user-id": userId,
        },
        body: JSON.stringify(validRequest({ text })),
      },
      res: { json(payload, status = 200) { result = { payload, status }; return result; } },
      log() {},
      error() {},
    });
    assert.equal(result.status, 200);
  }
  assert.deepEqual(sentTexts, phrases);
});

test("rejects invalid authentication before contacting Gnani", async () => {
  const result = await callHandler(validRequest(), { accountId: "another-user" });
  assert.equal(result.status, 401);
  assert.equal(result.calls.length, 0);

  const missingJwt = await callHandler(validRequest(), {
    headers: { "x-appwrite-user-jwt": "" },
  });
  assert.equal(missingJwt.status, 401);
  assert.equal(missingJwt.calls.length, 0);
});

test("rejects empty and oversized text and client-selected provider options", async () => {
  const empty = await callHandler(validRequest({ text: "  " }));
  assert.equal(empty.status, 400);
  assert.equal(empty.calls.length, 0);

  const tooLong = await callHandler(validRequest({ text: "x".repeat(501) }));
  assert.equal(tooLong.status, 413);
  assert.equal(tooLong.calls.length, 0);

  const clientSelectedModel = await callHandler(validRequest({ model: "other-model" }));
  assert.equal(clientSelectedModel.status, 400);
  assert.equal(clientSelectedModel.calls.length, 0);
});

test("returns a safe error when the existing Gnani key has no TTS scope", async () => {
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/account")) return Response.json({ $id: userId });
    return Response.json(
      { detail: { error_code: "SCOPE_NOT_ALLOWED", message: "provider detail" } },
      { status: 403 }
    );
  };
  let result;
  await handler({
    req: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-appwrite-user-jwt": "test-user-jwt",
        "x-appwrite-user-id": userId,
      },
      body: JSON.stringify(validRequest()),
    },
    res: { json(payload, status = 200) { result = { payload, status }; return result; } },
    log() {},
    error() {},
  });
  assert.equal(result.status, 403);
  assert.match(result.payload.error, /existing key/);
  assert.match(result.payload.error, /TTS service permission/);
  assert.equal(JSON.stringify(result).includes("provider detail"), false);
});

test("maps provider authentication, throttling, timeout, and network failures safely", async () => {
  for (const [providerStatus, expectedStatus] of [[401, 502], [429, 429]]) {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/account")) return Response.json({ $id: userId });
      return new Response("provider error", { status: providerStatus });
    };
    let result;
    await handler({
      req: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-appwrite-user-jwt": "test-user-jwt",
          "x-appwrite-user-id": userId,
        },
        body: JSON.stringify(validRequest()),
      },
      res: { json(payload, status = 200) { result = { payload, status }; return result; } },
      log() {},
      error() {},
    });
    assert.equal(result.status, expectedStatus);
    assert.equal(JSON.stringify(result).includes("provider error"), false);
  }

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/account")) return Response.json({ $id: userId });
    const timeout = new Error("request timed out");
    timeout.name = "TimeoutError";
    throw timeout;
  };
  let result;
  await handler({
    req: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-appwrite-user-jwt": "test-user-jwt",
        "x-appwrite-user-id": userId,
      },
      body: JSON.stringify(validRequest()),
    },
    res: { json(payload, status = 200) { result = { payload, status }; return result; } },
    log() {},
    error() {},
  });
  assert.equal(result.status, 504);
  assert.equal(result.payload.error.includes("too long"), true);

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/account")) return Response.json({ $id: userId });
    throw new Error("provider network details");
  };
  await handler({
    req: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-appwrite-user-jwt": "test-user-jwt",
        "x-appwrite-user-id": userId,
      },
      body: JSON.stringify(validRequest()),
    },
    res: { json(payload, status = 200) { result = { payload, status }; return result; } },
    log() {},
    error() {},
  });
  assert.equal(result.status, 502);
  assert.equal(JSON.stringify(result).includes("provider network details"), false);
});

test("rejects unexpected MIME, empty audio, and oversized audio", async () => {
  for (const response of [
    new Response("not audio", { headers: { "content-type": "application/json" } }),
    new Response(null, { headers: { "content-type": "audio/mpeg" } }),
    new Response(new Uint8Array(512 * 1024 + 1), {
      headers: { "content-type": "audio/mpeg" },
    }),
  ]) {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;
      return url.endsWith("/account") ? Response.json({ $id: userId }) : response;
    };
    let result;
    await handler({
      req: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-appwrite-user-jwt": "test-user-jwt",
          "x-appwrite-user-id": userId,
        },
        body: JSON.stringify(validRequest()),
      },
      res: { json(payload, status = 200) { result = { payload, status }; return result; } },
      log() {},
      error() {},
    });
    assert.notEqual(result.status, 200);
    assert.equal(JSON.stringify(result).includes(speechText), false);
  }
});

test("cancels the upstream stream when audio exceeds the configured byte cap", async () => {
  let upstreamCancelled = false;
  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(512 * 1024));
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      upstreamCancelled = true;
    },
  });
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/account")) return Response.json({ $id: userId });
    return new Response(oversizedStream, {
      headers: { "content-type": "audio/mpeg" },
    });
  };
  let result;
  await handler({
    req: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-appwrite-user-jwt": "test-user-jwt",
        "x-appwrite-user-id": userId,
      },
      body: JSON.stringify(validRequest()),
    },
    res: { json(payload, status = 200) { result = { payload, status }; return result; } },
    log() {},
    error() {},
  });
  assert.equal(result.status, 413);
  assert.equal(upstreamCancelled, true);
});

test("reports missing server credentials without contacting Gnani", async () => {
  process.env.GNANI_API_KEY = "";
  const result = await callHandler(validRequest());
  assert.equal(result.status, 503);
  assert.equal(result.calls.length, 0);
});
