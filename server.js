// =============================
// BACKEND USING HUGGING FACE (LangChain Wrapper) - OPTION 3
// =============================

// ----------- BACKEND (Node + Express) -----------
// file: server.js

import express from "express";
import cors from "cors";
import { HuggingFaceInference } from "@langchain/community/llms/hf";

const app = express();
app.use(cors());
app.use(express.json());

// --------- Hugging Face Model (Mistral) ---------
// Uses HF Inference API (no OpenAI compatibility required)

const model = new HuggingFaceInference({
  apiKey: process.env.HF_API_KEY,
  model: process.env.HF_MODEL || "mistralai/Mistral-7B-Instruct-v0.2",
  temperature: 0.3,
  maxTokens: 512,
  baseUrl: "https://router.huggingface.co",
});

// --------- API endpoint ---------
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Message is required" });
    }

    // Call Hugging Face model directly via LangChain wrapper
    const response = await model.call(message);

    res.json({ reply: response });

  } catch (err) {
    console.error("LLM ERROR:", err?.response?.data || err.message);
    res.status(500).json({ reply: "Error calling Hugging Face LLM" });
  }
});

// --------- Health check ---------
app.get("/", (req, res) => {
  res.send("HF Mistral backend is running");
});

// --------- Start server ---------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// ----------- HOW TO RUN -----------
// npm install express cors @langchain/community
// export HF_API_KEY=your_huggingface_token
// export HF_MODEL=mistralai/Mistral-7B-Instruct-v0.2
// node server.js


// ----------- TEST -----------
// curl -X POST http://localhost:5000/api/chat \
//   -H "Content-Type: application/json" \
//   -d '{"message":"Explain GPA in simple terms"}'


// ----------- NOTES -----------
// - This uses Hugging Face Inference API directly (no OpenAI compatibility layer needed)
// - Slower on free tier; consider dedicated endpoints for production
// - Works cleanly with LangChain without ChatOpenAI mismatch


// ----------- NEXT STEPS -----------
// - Add prompt templates
// - Add memory (ConversationBufferMemory)
// - Reintroduce agent + tools once stable
