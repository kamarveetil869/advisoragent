import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Message is required" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-pro"   // ✅ THIS is the key fix
    });

    const result = await model.generateContent(message);
    const response = await result.response;

    res.json({ reply: response.text() });

  } catch (err) {
    console.error("GEMINI ERROR:", err);
    res.status(500).json({ reply: "Error calling Gemini API" });
  }
});

app.listen(process.env.PORT || 5000);
