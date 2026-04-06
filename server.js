import express from "express";
import cors from "cors";
import "dotenv/config";
import axios from "axios";
import { evaluate } from "mathjs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(cors());
app.use(express.json());

// Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/* =========================================================
   🔐 ETHOS TOKEN CACHE
========================================================= */
let cachedToken = null;
let tokenExpiry = null;

async function getEthosToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

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
    tokenExpiry = Date.now() + (expiresIn - 300) * 1000;

    return token;
  } catch (err) {
    console.error("❌ Auth failed:", err.response?.data || err.message);
    return null;
  }
}

/* =========================================================
   🧰 TOOL DEFINITIONS (Gemini format)
========================================================= */
const tools = [
  {
    functionDeclarations: [
      {
        name: "calculator",
        description: "Evaluate a math expression",
        parameters: {
          type: "object",
          properties: {
            expression: { type: "string" }
          },
          required: ["expression"]
        }
      },
      {
        name: "get_time",
        description: "Get current server time",
        parameters: { type: "object", properties: {} }
      },
      {
        name: "get_my_advisees",
        description: "Retrieve advisees for an advisor",
        parameters: {
          type: "object",
          properties: {
            advisorId: { type: "string" }
          },
          required: ["advisorId"]
        }
      }
    ]
  }
];

/* =========================================================
   ⚙️ TOOL HANDLERS
========================================================= */
const toolHandlers = {
  calculator: async ({ expression }) => {
    try { return evaluate(expression).toString(); }
    catch { return "Invalid calculation"; }
  },

  get_time: async () => new Date().toISOString(),

  get_my_advisees: async ({ advisorId }) => {
    const token = await getEthosToken();
    if (!token) return "Auth failed";

    try {
      const response = await axios.get(
        `${process.env.ETHOS_BASE_URL}/x-get-advisees`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { advisor_id: advisorId }
        }
      );
      return response.data;
    } catch (err) {
      console.error("❌ Advisees error:", err.response?.data || err.message);
      return "Failed to fetch advisees";
    }
  }
};

/* =========================================================
   💬 SESSION MEMORY
========================================================= */
const sessions = {};

/* =========================================================
   🧠 CHAT ENDPOINT (Gemini MCP LOOP)
========================================================= */
app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || !sessionId) {
    return res.status(400).json({ reply: "message and sessionId required" });
  }

  if (!sessions[sessionId]) sessions[sessionId] = [];

  sessions[sessionId].push({ role: "user", parts: [{ text: message }] });

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    tools
  });

  let contents = [
    {
      role: "user",
      parts: [{ text: `
You are an assistant with tools:
- calculator
- get_time
- get_my_advisees

Use tools when appropriate.
`}]
    },
    ...sessions[sessionId]
  ];

  try {
    let result = await model.generateContent({ contents });
    let response = result.response;
    let part = response.candidates[0].content.parts[0];

    // 🔁 TOOL LOOP
    while (part.functionCall) {
      const { name, args } = part.functionCall;

      console.log("🛠 Tool:", name, args);

      const toolResult = await toolHandlers[name](args);

      contents.push({
        role: "model",
        parts: [{ functionCall: { name, args } }]
      });

      contents.push({
        role: "user",
        parts: [{
          functionResponse: {
            name,
            response: { result: toolResult }
          }
        }]
      });

      result = await model.generateContent({ contents });
      response = result.response;
      part = response.candidates[0].content.parts[0];
    }

    const reply = part.text;

    sessions[sessionId].push({
      role: "model",
      parts: [{ text: reply }]
    });

    res.json({ reply });

  } catch (err) {
    console.error("❌ Chat error:", err.message);
    res.status(500).json({ reply: "Something went wrong" });
  }
});

/* =========================================================
   RESET + HEALTH
========================================================= */
app.post("/api/reset", (req, res) => {
  delete sessions[req.body.sessionId];
  res.json({ message: "Session reset" });
});

app.get("/", (req, res) => res.send("Gemini MCP Agent running ✅"));

app.listen(process.env.PORT || 5000, () =>
  console.log("Server running 🚀")
);
