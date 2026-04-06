import express from "express";
import cors from "cors";
import { InferenceClient } from "@huggingface/inference";

const app = express();
app.use(cors());
app.use(express.json());

// Hugging Face client (NEW router endpoint handled internally)
const client = new InferenceClient(process.env.HF_API_KEY);

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Message is required" });
    }

   const response = await client.chat.completions.create({
  model: "mistralai/Mistral-7B-Instruct-v0.2",
  messages: [
    { role: "user", content: message }
  ],
  max_tokens: 200,
  temperature: 0.3
});

    res.json({ reply: response.generated_text });

  } catch (err) {
    console.error("HF ERROR:", err);
    res.status(500).json({ reply: "Error calling Hugging Face" });
  }
});

app.get("/", (req, res) => {
  res.send("HF backend running");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
