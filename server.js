import express from "express";
import cors from "cors";
import "dotenv/config";
import axios from "axios";
import { evaluate } from "mathjs";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Gemini GenAI client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

/* ============================
   ETHOS TOKEN CACHE
============================ */
let cachedToken = null;
let tokenExpiry = null;

async function getEthosToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;

  try {
    console.log("🔑 Fetching new token...");
    const response = await axios.post(
      `${process.env.ETHOS_BASE_URL}/auth`,
      { apiKey: process.env.ETHOS_API_KEY },
      { headers: { "Content-Type": "application/json" } }
    );

    const token = response.data.access_token;
    const expiresIn = response.data.expires_in || 3600;
    cachedToken = token;
    tokenExpiry = Date.now() + (expiresIn - 300) * 1000; // refresh 5min early
    return token;
  } catch (err) {
    console.error("❌ Ethos auth failed:", err.response?.data || err.message);
    return null;
  }
}

/* ============================
   TOOL DEFINITIONS
============================ */
const tools = [
  {
    functionDeclarations: [
      {
        name: "calculator",
        description: "Evaluate a math expression",
        parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] }
      },
      {
        name: "get_time",
        description: "Get current server time",
        parameters: { type: "object", properties: {} }
      },
      {
        name: "get_my_advisees",
        description: "Retrieve advisees for an advisor",
        parameters: { type: "object", properties: { advisorId: { type: "string" } }, required: ["advisorId"] }
      }
    ]
  }
];

/* ============================
   TOOL HANDLERS
============================ */
const toolHandlers = {
  calculator: async ({ expression }) => {
    try { return evaluate(expression).toString(); }
    catch { return "Invalid calculation"; }
  },
  get_time: async () => new Date().toISOString(),
  get_my_advisees: async ({ advisorId }) => {
    const token = await getEthosToken();
    if (!token) return "Authentication failed";

    try {
      const response = await axios.get(
        `${process.env.ETHOS_BASE_URL}/x-get-advisees`,
        { headers: { Authorization: `Bearer ${token}` }, params: { advisor_id: advisorId } }
      );
      return response.data;
    } catch (err) {
      console.error("❌ Advisees fetch error:", err.response?.data || err.message);
      return "Failed to fetch advisees";
    }
  }
};

/* ============================
   SESSION MEMORY
============================ */
const sessions = {};

/* ============================
   CHAT ENDPOINT
============================ */
app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ reply: "message and sessionId required" });

  if (!sessions[sessionId]) sessions[sessionId] = [];
  sessions[sessionId].push({ role: "user", parts: [{ text: message }] });

  const contents = [
    { role: "user", parts: [{ text: "You are an assistant with tools: calculator, get_time, get_my_advisees. Use tools whenever appropriate." }] },
    ...sessions[sessionId]
  ];

  try {
    let response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
      tools
    });

    let part = response.candidates[0].content.parts[0];

    while (part.functionCall) {
      const { name, args } = part.functionCall;
      console.log("🛠 Tool call:", name, args);

      const result = await toolHandlers[name](args);

      contents.push({ role: "model", parts: [{ functionCall: { name, args } }] });
      contents.push({ role: "user", parts: [{ functionResponse: { name, response: { result } } }] });

      response = await ai.models.generateContent({ model: "gemini-3-flash-preview", contents, tools });
      part = response.candidates[0].content.parts[0];
    }

    const reply = part.text;
    sessions[sessionId].push({ role: "model", parts: [{ text: reply }] });
    res.json({ reply });

  } catch (err) {
    console.error("❌ Chat error:", err.message);
    res.status(500).json({ reply: "Something went wrong" });
  }
});

/* ============================
   RESET + HEALTH
============================ */
app.post("/api/reset", (req, res) => {
  delete sessions[req.body.sessionId];
  res.json({ message: "Session reset" });
});

app.get("/", (req, res) => res.send("Gemini 3 Flash Preview MCP Agent running ✅"));

/* ============================
   START SERVER
============================ */
app.listen(process.env.PORT || 5000, () => console.log("Server running 🚀"));
