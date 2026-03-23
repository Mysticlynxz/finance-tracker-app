import fetch from "node-fetch";

const FALLBACK_ADVICE =
  "Try reducing unnecessary expenses and saving regularly.";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const parseRequestBody = (req) => {
  const rawBody = req?.body ?? req?.bodyText ?? {};

  if (typeof rawBody === "string") {
    try {
      return JSON.parse(rawBody);
    } catch {
      return {};
    }
  }

  if (rawBody && typeof rawBody === "object") {
    return rawBody;
  }

  return {};
};

export default async ({ req, res, log, error }) => {
  try {
    const body = parseRequestBody(req);
    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : "Give one practical budgeting tip.";

    const apiKey = process.env.OPENROUTER_API_KEY?.trim();

    if (!apiKey) {
      error("OPENROUTER_API_KEY is missing.");
      return res.json({ reply: FALLBACK_ADVICE });
    }

    if (!apiKey.startsWith("sk-or-")) {
      error("OPENROUTER_API_KEY is invalid. Expected a key starting with sk-or-.");
      return res.json({ reply: FALLBACK_ADVICE });
    }

    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "http://localhost",
        "X-Title": "Finance Tracker App",
      },
      body: JSON.stringify({
        model: "mistralai/mistral-7b-instruct",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful financial advisor. Give short, practical advice.",
          },
          {
            role: "user",
            content: message,
          },
        ],
      }),
    });

    const rawResponse = await response.text();
    let data = {};

    try {
      data = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
      error("Failed to parse OpenRouter response JSON: " + rawResponse);
    }

    log("OpenRouter response: " + JSON.stringify(data));

    if (response.status !== 200) {
      error(`OpenRouter API error (${response.status}): ${JSON.stringify(data)}`);
      return res.json({ reply: FALLBACK_ADVICE });
    }

    const reply = data?.choices?.[0]?.message?.content;

    if (!reply || typeof reply !== "string" || !reply.trim()) {
      return res.json({
        reply: FALLBACK_ADVICE,
      });
    }

    return res.json({ reply: reply.trim() });
  } catch (err) {
    error("Function error: " + (err?.message || String(err)));
    return res.json({ reply: FALLBACK_ADVICE });
  }
};
