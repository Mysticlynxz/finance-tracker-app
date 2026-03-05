import fetch from "node-fetch";

export default async ({ req, res, log, error }) => {
    try {
        const body =
            typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

        const message = body.message || "Hello";

        const prompt = `
You are a helpful financial advisor inside a budgeting app.
The user is asking about their expenses and budgeting.

User message:
${message}

Give short, practical financial advice.
`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [{ text: prompt }],
                        },
                    ],
                }),
            }
        );

        const data = await response.json();

        log("Gemini response: " + JSON.stringify(data));

        const reply =
            data?.candidates?.[0]?.content?.parts?.[0]?.text ||
            "Sorry, I couldn't generate advice.";

        return res.json({ reply });
    } catch (err) {
        error("Function error: " + err.message);

        return res.json({
            reply: "AI advisor encountered an error.",
        });
    }
};