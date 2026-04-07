import express from "express";
import cors from "cors";
import "dotenv/config";
import axios from "axios";
import { evaluate } from "mathjs";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

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
    console.error("❌ Ethos auth failed:", err.response?.data || err.message);
    return null;
  }
}

/* =========================================================
   🧰 TOOL DEFINITIONS
========================================================= */
const tools = [
  {
    functionDeclarations: [
      {
        name: "calculator",
        description: "Evaluate a math expression",
        parameters: {
          type: "object",
          properties: { expression: { type: "string" } },
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
          properties: { advisorId: { type: "string" } },
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
    if (!token) return "Authentication failed";

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
      console.error("❌ Advisees fetch error:", err.response?.data || err.message);
      return "Failed to fetch advisees";
    }
  }
};

/* =========================================================
   🛡️ SAFE RESPONSE PARSER
========================================================= */
function getFirstPart(response) {
  if (
    !response ||
    !response.candidates ||
    response.candidates.length === 0 ||
    !response.candidates[0].content ||
    !response.candidates[0].content.parts ||
    response.candidates[0].content.parts.length === 0
  ) {
    console.error("❌ Invalid Gemini response:", JSON.stringify(response, null, 2));
    return null;
  }
  return response.candidates[0].content.parts[0];
}

/* =========================================================
   🤖 GEMINI CALL WITH RETRY + FALLBACK
========================================================= */
async function callGemini(contents, tools) {
  const models = ["gemini-3-flash-preview", "gemini-1.5-flash"];

  for (const model of models) {
    try {
      console.log(`🧠 Calling model: ${model}`);

      const response = await ai.models.generateContent({
        model,
        contents,
        tools
      });

      console.log("📦 RAW RESPONSE:", JSON.stringify(response, null, 2));

      const part = getFirstPart(response);
      if (part) return { part, model };

    } catch (err) {
      console.error(`❌ Model ${model} failed:`, err.message);
    }
  }

  return null;
}

/* =========================================================
   💬 SESSION MEMORY
========================================================= */
const sessions = {};

/* =========================================================
   🧠 CHAT ENDPOINT
========================================================= */
app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || !sessionId) {
    return res.status(400).json({ reply: "message and sessionId required" });
  }

  if (!sessions[sessionId]) sessions[sessionId] = [];

  sessions[sessionId].push({
    role: "user",
    parts: [{ text: message }]
  });

  const contents = [
    {
      role: "user",
      parts: [{
        text: `
You are an assistant with tools:
- calculator
- get_time
- get_my_advisees

You MUST use tools when relevant.
`
      }]
    },
    ...sessions[sessionId]
  ];

  try {
    let result = await callGemini(contents, tools);

    if (!result) {
      return res.status(500).json({
        reply: "AI failed to generate response"
      });
    }

    let { part } = result;

    /* 🔁 TOOL LOOP */
    while (part && part.functionCall) {
      const { name, args } = part.functionCall;

      console.log("🛠 Tool call:", name, args);

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

      result = await callGemini(contents, tools);
      if (!result) break;

      part = result.part;
    }

    const reply = part?.text || "No response generated";

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
   🔍 DEBUG ENDPOINT
========================================================= */
app.get("/debug", (req, res) => {
  res.json({
    sessions,
    tokenCached: !!cachedToken,
    tokenExpiry
  });
});

/* =========================================================
   ❤️ HEALTH CHECK
========================================================= */
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

/* =========================================================
   RESET
========================================================= */
app.post("/api/reset", (req, res) => {
  delete sessions[req.body.sessionId];
  res.json({ message: "Session reset" });
});

/* =========================================================
   START SERVER
========================================================= */
app.listen(process.env.PORT || 5000, () => {
  console.log("🚀 MCP Gemini Agent running");
});
