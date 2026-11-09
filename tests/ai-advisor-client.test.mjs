import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const createAdvisorClient = () => {
  let current = { userId: "user-a", sessionId: "session-a" };
  let generation = 0;
  let nextTransitionId = 0;
  const pendingTransitions = new Set();
  const executions = [];
  const executionOptions = [];
  let execute = async () => ({
    status: "completed",
    responseStatusCode: 200,
    responseBody: JSON.stringify({ reply: "FinBot reply" }),
  });

  const account = {
    get: async () => ({ $id: current.userId }),
    getSession: async () => ({ $id: current.sessionId }),
  };
  const functions = {
    createExecution: async (options) => {
      executions.push(JSON.parse(options.body));
      executionOptions.push(options);
      return execute(options);
    },
  };

  class Client {
    setEndpoint() { return this; }
    setProject() { return this; }
  }
  class Account {
    constructor() { return account; }
  }
  class Functions {
    constructor() { return functions; }
  }
  class EmptyService {}
  class AppwriteException extends Error {}

  const createAuthSessionGuard = (readCurrentSession) => ({
    beginTransition() {
      generation += 1;
      const id = ++nextTransitionId;
      pendingTransitions.add(id);
      return id;
    },
    finishTransition(id) {
      if (pendingTransitions.delete(id)) generation += 1;
    },
    capture: async () => {
      if (pendingTransitions.size) return null;
      const capturedGeneration = generation;
      try {
        const subject = await readCurrentSession();
        if (pendingTransitions.size || generation !== capturedGeneration) return null;
        return { ...subject, generation: capturedGeneration };
      } catch {
        return null;
      }
    },
    isGenerationCurrent: (identity) =>
      pendingTransitions.size === 0 && identity.generation === generation,
    isCurrent: async (identity) => {
      if (pendingTransitions.size || identity.generation !== generation) return false;
      try {
        const subject = await readCurrentSession();
        return pendingTransitions.size === 0 &&
          identity.generation === generation &&
          identity.userId === subject.userId &&
          identity.sessionId === subject.sessionId;
      } catch {
        return false;
      }
    },
  });

  const appwriteSdk = {
    Account,
    AppwriteException,
    Client,
    Databases: EmptyService,
    ExecutionMethod: { POST: "POST" },
    Functions,
    ID: { unique: () => "unique-id" },
    Permission: { read: () => "", update: () => "", delete: () => "" },
    Query: { equal: () => "", limit: () => "", offset: () => "" },
    Role: { user: () => "" },
    Storage: EmptyService,
  };
  const dependencies = {
    appwrite: appwriteSdk,
    "../constants/currency": { normalizeCurrencyCode: (currency) => currency ?? "INR" },
    "./authSessionGuard": { createAuthSessionGuard },
  };
  const source = readFileSync(new URL("../lib/appwrite.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(transpiled, {
    exports: module.exports,
    module,
    require: (name) => {
      if (dependencies[name]) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process,
    console: { error() {}, warn() {}, log() {} },
  });

  return {
    api: module.exports,
    executions,
    executionOptions,
    setExecute: (next) => { execute = next; },
    switchSession: (next) => {
      const transition = module.exports.beginAuthSessionTransition();
      current = next;
      module.exports.finishAuthSessionTransition(transition);
    },
  };
};

test("advisor client accepts empty history and preserves the existing typed request", async () => {
  const client = createAdvisorClient();
  assert.equal(await client.api.askFinancialAdvisor("Hello", "USD"), "FinBot reply");
  assert.deepEqual(client.executions[0], {
    mode: "advisor",
    message: "Hello",
    currency: "USD",
    history: [],
  });
});

test("failed advisor requests show the friendly fallback without entering later history", async () => {
  const client = createAdvisorClient();
  client.setExecute(async () => {
    throw new Error("offline");
  });
  const first = await client.api.askFinancialAdvisorWithStatus("Earlier question", "INR");
  assert.equal(first.ok, false);
  assert.equal(first.reply, client.api.AI_ADVISOR_FALLBACK_RESPONSE);
  assert.equal(
    await client.api.askFinancialAdvisor("Legacy failed request", "INR"),
    client.api.AI_ADVISOR_FALLBACK_RESPONSE
  );

  let history = client.api.updateAdvisorConversationHistory([], "Earlier question", first);
  assert.deepEqual(JSON.parse(JSON.stringify(history)), []);

  client.setExecute(async () => ({
    status: "completed",
    responseStatusCode: 200,
    responseBody: JSON.stringify({ reply: "A successful answer." }),
  }));
  const second = await client.api.askFinancialAdvisorWithStatus(
    "Follow-up question",
    "INR",
    history
  );
  assert.equal(second.ok, true);
  history = client.api.updateAdvisorConversationHistory(history, "Follow-up question", second);
  assert.deepEqual(
    JSON.parse(JSON.stringify(history)),
    [
      { role: "user", text: "Follow-up question" },
      { role: "assistant", text: "A successful answer." },
    ]
  );
  assert.deepEqual(client.executions[1].history, []);

  const legacyFallback = await client.api.askFinancialAdvisor("Legacy caller", "INR");
  assert.equal(legacyFallback, "A successful answer.");
});

test("failed server executions are unavailable, not assistant answers", async () => {
  const client = createAdvisorClient();
  client.setExecute(async () => ({
    status: "completed",
    responseStatusCode: 502,
    responseBody: JSON.stringify({
      reply: client.api.AI_ADVISOR_FALLBACK_RESPONSE,
      unavailable: true,
    }),
  }));
  const result = await client.api.askFinancialAdvisorWithStatus("Question");
  assert.equal(result.ok, false);
  assert.equal(result.reply, client.api.AI_ADVISOR_FALLBACK_RESPONSE);
});

test("advisor accepts completed successful executions and rejects non-successful executions", async () => {
  const client = createAdvisorClient();

  for (const responseStatusCode of [200, 201, 299]) {
    client.setExecute(async () => ({
      status: "completed",
      responseStatusCode,
      responseBody: JSON.stringify({ reply: `reply-${responseStatusCode}` }),
    }));
    const result = await client.api.askFinancialAdvisorWithStatus("Question");
    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
      ok: true,
      reply: `reply-${responseStatusCode}`,
    });
  }

  for (const execution of [
    {
      status: "failed",
      responseStatusCode: 200,
      responseBody: JSON.stringify({ reply: "must not be used" }),
    },
    {
      status: "completed",
      responseStatusCode: 502,
      responseBody: JSON.stringify({ reply: "must not be used" }),
    },
  ]) {
    client.setExecute(async () => execution);
    const result = await client.api.askFinancialAdvisorWithStatus("Question");
    assert.equal(result.ok, false);
    assert.equal(result.reply, client.api.AI_ADVISOR_FALLBACK_RESPONSE);
  }
});

test("expense extraction preserves successful replies and rejects unsuccessful Function executions", async () => {
  const client = createAdvisorClient();
  const extractedReply = JSON.stringify({ expenses: [{ category: "Food", amount: 25 }] });
  client.setExecute(async () => ({
    status: "completed",
    responseStatusCode: 200,
    responseBody: JSON.stringify({ reply: extractedReply }),
  }));

  assert.equal(await client.api.requestExpenseExtractionReply({
    message: "Food 25",
    validCategories: ["Food", "Bills"],
  }), extractedReply);
  assert.deepEqual(client.executions[0], {
    mode: "extract-expense",
    message: "Food 25",
    validCategories: ["Food", "Bills"],
  });

  for (const execution of [
    {
      status: "failed",
      responseStatusCode: 200,
      responseBody: JSON.stringify({ reply: extractedReply }),
    },
    {
      status: "completed",
      responseStatusCode: 502,
      responseBody: JSON.stringify({ reply: extractedReply }),
    },
  ]) {
    client.setExecute(async () => execution);
    await assert.rejects(
      client.api.requestExpenseExtractionReply({
        message: "Food 25",
        validCategories: ["Food", "Bills"],
      }),
      /Expense extraction service is unavailable/
    );
  }
});

test("advisor client validates roles, bounds messages, limits history, and avoids duplicate current input", async () => {
  const client = createAdvisorClient();
  const sanitized = client.api.sanitizeAdvisorConversationHistory([
    { role: "system", text: "not allowed" },
    { role: "user", text: "  " },
    { role: "assistant", text: "a".repeat(2500) },
    null,
    { role: "user", text: 10 },
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(sanitized)),
    [{ role: "assistant", text: "a".repeat(2000) }]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(client.api.sanitizeAdvisorConversationHistory(undefined))),
    []
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      client.api.sanitizeAdvisorConversationHistory(
        [{ role: "user", text: "q".repeat(2200) }],
        "q".repeat(2200)
      )
    )),
    []
  );

  const history = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    text: `previous-${index}`,
  }));
  history.push({ role: "user", text: "current question" });
  assert.equal(
    await client.api.askFinancialAdvisor("current question", "INR", history),
    "FinBot reply"
  );
  assert.deepEqual(
    client.executions[0].history.map(({ text }) => text),
    ["previous-2", "previous-3", "previous-4", "previous-5", "previous-6", "previous-7"]
  );
  assert.equal(client.executions[0].message, "current question");
  assert.equal(
    client.executions[0].history.some(({ text }) => text === "current question"),
    false
  );
});

test("pending advisor response is rejected after the authenticated session changes", async () => {
  const client = createAdvisorClient();
  let entered;
  let release;
  const requestEntered = new Promise((resolve) => { entered = resolve; });
  const requestRelease = new Promise((resolve) => { release = resolve; });
  client.setExecute(async () => {
    entered();
    await requestRelease;
    return {
      status: "completed",
      responseStatusCode: 200,
      responseBody: JSON.stringify({ reply: "stale reply" }),
    };
  });

  const expectedSession = await client.api.captureAuthSessionIdentity();
  const pending = client.api.askFinancialAdvisor(
    "How much did I spend?",
    "INR",
    [{ role: "user", text: "Earlier question" }],
    expectedSession
  );
  await requestEntered;
  client.switchSession({ userId: "user-b", sessionId: "session-b" });
  release();
  await assert.rejects(pending, { name: "AdvisorSessionChangedError" });
});

test("advisor history is retained only for an unchanged focused session", () => {
  const client = createAdvisorClient();
  const screenSource = readFileSync(new URL("../app/advisor.tsx", import.meta.url), "utf8");
  const history = [{ role: "user", text: "Private conversation" }];
  const sessionA = { userId: "user-a", sessionId: "session-a", generation: 1 };
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      client.api.getAdvisorHistoryForSession(history, sessionA, { ...sessionA })
    )),
    history
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      client.api.getAdvisorHistoryForSession(history, sessionA, {
        userId: "user-b",
        sessionId: "session-b",
        generation: 3,
      })
    )),
    []
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(client.api.getAdvisorHistoryForSession(history, sessionA, null))),
    []
  );
  assert.match(screenSource, /useFocusEffect\(/);
  assert.match(screenSource, /getAdvisorHistoryForSession\(/);
});

test("suggested questions are configured and use the shared submission handler", () => {
  const source = readFileSync(new URL("../app/advisor.tsx", import.meta.url), "utf8");
  const match = source.match(
    /export const SUGGESTED_ADVISOR_QUESTIONS = \[([\s\S]*?)\] as const;/
  );
  assert.ok(match);
  const questions = [...match[1].matchAll(/"([^"]+)"/g)].map(([, question]) => question);
  assert.deepEqual(questions, [
    "Give me a practical saving tip.",
    "Help me understand my recent spending.",
    "How can I manage my monthly budget better?",
    "What spending habit should I improve?",
  ]);
  assert.match(source, /submitMessage\(question\)/);
});

test("advisor speech uses an authenticated synchronous Function request and validates audio", async () => {
  const client = createAdvisorClient();
  const audioBase64 = Buffer.from([1, 2, 3]).toString("base64");
  client.setExecute(async () => ({
    status: "completed",
    responseStatusCode: 200,
    responseBody: JSON.stringify({
      audioBase64,
      mimeType: "audio/mpeg",
      byteLength: 3,
    }),
  }));
  const session = await client.api.captureAuthSessionIdentity();
  const result = await client.api.requestAdvisorSpeech("A completed answer.", session);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    audioBase64,
    mimeType: "audio/mpeg",
    byteLength: 3,
  });
  assert.deepEqual(client.executions[0], {
    mode: "text-to-speech",
    text: "A completed answer.",
  });
  assert.equal(client.executionOptions[0].async, false);
  assert.equal(client.executionOptions[0].headers["Content-Type"], "application/json");
  assert.equal(JSON.stringify(client.executionOptions[0]).includes("test-gnani-key"), false);
});

test("advisor speech rejects invalid, unsuccessful, malformed, and stale responses", async () => {
  const client = createAdvisorClient();
  const session = await client.api.captureAuthSessionIdentity();
  await assert.rejects(client.api.requestAdvisorSpeech(" \n ", session), /cannot be spoken/);
  await assert.rejects(
    client.api.requestAdvisorSpeech("x".repeat(501), session),
    /cannot be spoken/
  );
  await assert.rejects(
    client.api.requestAdvisorSpeech("Reply", {
      userId: "other-user",
      sessionId: "session-a",
      generation: session.generation,
    }),
    /session changed/
  );
  assert.equal(client.executions.length, 0);

  const invalidResponses = [
    { status: "failed", responseStatusCode: 200, responseBody: "{}" },
    { status: "completed", responseStatusCode: 500, responseBody: "not json" },
    { status: "completed", responseStatusCode: 200, responseBody: "not json" },
    {
      status: "completed",
      responseStatusCode: 200,
      responseBody: JSON.stringify({
        audioBase64: "%%%=",
        mimeType: "audio/mpeg",
        byteLength: 1,
      }),
    },
    {
      status: "completed",
      responseStatusCode: 200,
      responseBody: JSON.stringify({
        audioBase64: "AQ==",
        mimeType: "audio/wav",
        byteLength: 1,
      }),
    },
    {
      status: "completed",
      responseStatusCode: 200,
      responseBody: JSON.stringify({
        audioBase64: "AQ==",
        mimeType: "audio/mpeg",
        byteLength: 2,
      }),
    },
  ];
  for (const response of invalidResponses) {
    client.setExecute(async () => response);
    await assert.rejects(client.api.requestAdvisorSpeech("Reply", session));
  }

  const oversizedAudio = Buffer.alloc(512 * 1024 + 1).toString("base64");
  client.setExecute(async () => ({
    status: "completed",
    responseStatusCode: 200,
    responseBody: JSON.stringify({
      audioBase64: oversizedAudio,
      mimeType: "audio/mpeg",
      byteLength: 512 * 1024 + 1,
    }),
  }));
  await assert.rejects(client.api.requestAdvisorSpeech("Reply", session), /invalid audio/);

  client.setExecute(async () => {
    client.switchSession({ userId: "user-b", sessionId: "session-b" });
    return {
      status: "completed",
      responseStatusCode: 200,
      responseBody: JSON.stringify({
        audioBase64: "AQ==",
        mimeType: "audio/mpeg",
        byteLength: 1,
      }),
    };
  });
  await assert.rejects(client.api.requestAdvisorSpeech("Reply", session), {
    name: "AdvisorSessionChangedError",
  });
});
