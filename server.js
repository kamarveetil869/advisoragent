// =============================
// SIMPLE LLM BACKEND (NO TOOLS) - FOR TESTING
// =============================

// ----------- BACKEND (Node + Express) -----------
// file: server.js

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { ChatOpenAI } from "langchain/chat_models/openai";

const app = express();
app.use(cors());
app.use(express.json());

// --------- Mistral via Hugging Face ---------
const model = new ChatOpenAI({
  openAIApiKey: process.env.HF_API_KEY || "hf_dummy",
  temperature: 0.3,
  configuration: {
    basePath: process.env.HF_BASE_URL,
    defaultHeaders: {
      Authorization: `Bearer ${process.env.HF_API_KEY}`,
      "Content-Type": "application/json",
    },
  },
});

// --------- API endpoint ---------
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Message is required" });
    }

    // Call LLM directly (no agent, no tools)
    const response = await model.call([
      { role: "user", content: message }
    ]);

    res.json({ reply: response.content });

  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "Error calling LLM" });
  }
});

// --------- Health check ---------
app.get("/", (req, res) => {
  res.send("LLM backend is running");
});

// --------- Start server ---------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


