import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";
import { evaluate } from "mathjs";

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const tools = {
  Calculator: async (input) => {
    try { return evaluate(input).toString(); }
    catch { return "Invalid calculation"; }
  },
  GetTime: async () => new Date().toISOString(),
};

const sessions = {};

app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ reply: "message and sessionId required" });

  if (!sessions[sessionId]) sessions[sessionId] = [];

  sessions[sessionId].push({ role: "user", content: message });

  const prompt = [
    ...sessions[sessionId],
    { role: "system", content: "You are a helpful assistant with access to tools: Calculator, GetTime." }
  ];

  // Simple tool parsing
  let toolUsed = null;
  if (message.includes("calculate") || message.match(/\d/)) {
    const calcResult = await tools.Calculator(message);
    sessions[sessionId].push({ role: "assistant", content: calcResult });
    return res.json({ reply: calcResult });
  }

  if (message.toLowerCase().includes("time")) {
    const time = await tools.GetTime();
    sessions[sessionId].push({ role: "assistant", content: time });
    return res.json({ reply: time });
  }

  // LLM call
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: prompt,
    temperature: 0.7,
  });

  const reply = completion.choices[0].message.content;
  sessions[sessionId].push({ role: "assistant", content: reply });
  res.json({ reply });
});

app.post("/api/reset", (req, res) => {
  const { sessionId } = req.body;
  if (sessions[sessionId]) delete sessions[sessionId];
  res.json({ message: "Session reset" });
});

app.get("/", (req, res) => res.send("Chat agent running ✅"));

app.listen(process.env.PORT || 5000, () => console.log("Server running"));
