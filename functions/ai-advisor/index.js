import fetch from "node-fetch";

const NO_RESPONSE_FALLBACK =
  "Try reducing unnecessary expenses and tracking your daily spending.";
const ERROR_FALLBACK =
  "Track your expenses daily and avoid unnecessary purchases to improve savings.";
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

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

    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing.");
    }

    const prompt =
      "You are a helpful financial advisor. Give short, practical advice.\n\nUser: " +
      message;

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    const rawResponse = await response.text();
    let data = {};

    try {
      data = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
      throw new Error("Failed to parse Gemini response JSON: " + rawResponse);
    }

    log("Gemini response: " + JSON.stringify(data));

    if (!response.ok) {
      error(`Gemini API error (${response.status}): ${JSON.stringify(data)}`);
      return res.json({
        reply: ERROR_FALLBACK,
      });
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply || typeof reply !== "string" || !reply.trim()) {
      return res.json({
        reply: NO_RESPONSE_FALLBACK,
      });
    }

    return res.json({ reply: reply.trim() });
  } catch (err) {
    error("Gemini error: " + (err?.message || String(err)));

    return res.json({
      reply: ERROR_FALLBACK,
    });
  }
};
