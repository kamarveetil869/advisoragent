import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Message is required" });
    }

    const completion = await client.chat.completions.create({
      model: "mistralai/mixtral-8x7b-instruct", // 🔥 strong + cheap
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: message }
      ],
      max_tokens: 200,
      temperature: 0.7
    });

    const reply = completion.choices[0].message.content;

    res.json({ reply });

  } catch (err) {
    console.error("OPENROUTER ERROR:", err);
    res.status(500).json({ reply: "Error calling AI API" });
  }
});

app.get("/", (req, res) => {
  res.send("OpenRouter backend running");
});

app.listen(process.env.PORT || 5000);
