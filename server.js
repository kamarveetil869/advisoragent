import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Message is required" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash" // fast + cheap
    });

    const result = await model.generateContent(message);
    const response = await result.response;

    const reply = response.text();

    res.json({ reply });

  } catch (err) {
    console.error("GEMINI ERROR:", err);
    res.status(500).json({ reply: "Error calling Gemini API" });
  }
});

app.get("/", (req, res) => {
  res.send("Gemini backend running");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
