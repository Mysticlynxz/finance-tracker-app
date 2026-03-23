import fetch from "node-fetch";

const FALLBACK_ADVICE =
    "Try reducing unnecessary expenses and saving regularly.";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

export default async ({ req, res, log, error }) => {
    try {
        let body = {};
        if (typeof req.body === "string") {
            try {
                body = JSON.parse(req.body);
            } catch {
                body = {};
            }
        } else if (req.body && typeof req.body === "object") {
            body = req.body;
        }

        const message =
            typeof body.message === "string" && body.message.trim()
                ? body.message.trim()
                : "Give one practical budgeting tip.";

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            error("OPENAI_API_KEY is missing.");
            return res.json({ reply: FALLBACK_ADVICE });
        }

        const response = await fetch(OPENAI_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
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

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            error(
                `OpenAI API error (${response.status}): ${JSON.stringify(data)}`
            );
            return res.json({ reply: FALLBACK_ADVICE });
        }

        const content = data?.choices?.[0]?.message?.content;
        const reply =
            typeof content === "string" && content.trim()
                ? content.trim()
                : FALLBACK_ADVICE;

        return res.json({ reply });
    } catch (err) {
        error("Function error: " + (err?.message || String(err)));
        return res.json({ reply: FALLBACK_ADVICE });
    }
};
