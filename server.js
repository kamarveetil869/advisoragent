# with Ethos integration
import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";
import { evaluate } from "mathjs";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Function to get Ethos auth token ---
async function getEthosToken() {
  try {
    const response = await axios.post(
      `${process.env.ETHOS_BASE_URL}/auth`,
      { apiKey: process.env.ETHOS_API_KEY }, // pass API key in body
      { headers: { "Content-Type": "application/json" } }
    );
    return response.data.access_token; // assumes token returned as access_token
  } catch (err) {
    console.error("Failed to get Ethos token:", err.response?.data || err.message);
    return null;
  }
}

// --- Tools ---
const tools = {
  Calculator: async (input) => {
    try { return evaluate(input).toString(); }
    catch { return "Invalid calculation"; }
  },
  GetTime: async () => new Date().toISOString(),
  get_my_advisees: async (advisorId) => {
    if (!advisorId) return "Advisor ID is required.";

    const token = await getEthosToken();
    if (!token) return "Could not authenticate with Ethos API.";

    try {
      const response = await axios.get(
        `${process.env.ETHOS_BASE_URL}/api/x-get-advisees`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          params: { advisor_id: advisorId },
        }
      );

      const advisees = response.data;
      if (!Array.isArray(advisees) || advisees.length === 0) return "No advisees found.";

      return advisees
        .map((a, i) => `${i + 1}. ${a.name} (${a.email || "no email"})`)
        .join("\n");

    } catch (err) {
      console.error("Failed to fetch advisees:", err.response?.data || err.message);
      return "Failed to fetch advisees.";
    }
  },
};

const sessions = {};

// --- Chat endpoint ---
app.post("/api/chat", async (req, res) => {
  const { message, sessionId, advisorId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ reply: "message and sessionId required" });

  if (!sessions[sessionId]) sessions[sessionId] = [];

  sessions[sessionId].push({ role: "user", content: message });

  const prompt = [
    ...sessions[sessionId],
    { role: "system", content: "You are a helpful assistant with access to tools: Calculator, GetTime, get_my_advisees." }
  ];

  // --- Tool parsing ---
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

  if (message.toLowerCase().includes("advisees") && advisorId) {
    const advisees = await tools.get_my_advisees(advisorId);
    sessions[sessionId].push({ role: "assistant", content: advisees });
    return res.json({ reply: advisees });
  }

  // --- LLM call ---
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: prompt,
    temperature: 0.7,
  });

  const reply = completion.choices[0].message.content;
  sessions[sessionId].push({ role: "assistant", content: reply });
  res.json({ reply });
});

// --- Reset endpoint ---
app.post("/api/reset", (req, res) => {
  const { sessionId } = req.body;
  if (sessions[sessionId]) delete sessions[sessionId];
  res.json({ message: "Session reset" });
});

// --- Health check ---
app.get("/", (req, res) => res.send("Chat agent running ✅"));

app.listen(process.env.PORT || 5000, () => console.log("Server running"));
