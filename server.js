import express from "express";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Message is required" });
    }

    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: message,
    });

    res.json({ reply: response.text });

  } catch (err) {
    console.error("GEMINI ERROR:", err);
    res.status(500).json({ reply: "Error calling Gemini API" });
  }
});

app.listen(process.env.PORT || 5000);
