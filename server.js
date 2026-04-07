import express from "express";
import cors from "cors";
import "dotenv/config";
import axios from "axios";
import { evaluate } from "mathjs";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
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
      {  headers: {
          'Authorization': `Bearer ${ process.env.ETHOS_API_KEY}`,
          'Accept': 'application/json'
        } }
    );

    const token = response.data.text;
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
   🧰 TOOL DEFINITIONS (OpenAI format)
========================================================= */
const tools = [
  {
    type: "function",
    function: {
      name: "calculator",
      description: "Evaluate a math expression",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string" }
        },
        required: ["expression"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_time",
      description: "Get current server time",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
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
   🤖 OPENAI CALL WITH RETRY
========================================================= */
async function callOpenAI(messages) {
  const models = ["gpt-4o-mini", "gpt-4o"]; // fallback

  for (const model of models) {
    try {
      console.log(`🧠 Calling model: ${model}`);

      const response = await client.chat.completions.create({
        model,
        messages,
        tools,
        temperature: 0.7
      });

      console.log("📦 RAW RESPONSE:", JSON.stringify(response, null, 2));

      const msg = response.choices?.[0]?.message;
      if (msg) return msg;

    } catch (err) {
      console.error(`❌ Model ${model} failed:`, err.message);
    }
  }

  return null;
}

/* =========================================================
   🧠 CHAT ENDPOINT (MCP LOOP)
========================================================= */
app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || !sessionId) {
    return res.status(400).json({ reply: "message and sessionId required" });
  }

  if (!sessions[sessionId]) sessions[sessionId] = [];

  sessions[sessionId].push({ role: "user", content: message });

  const messages = [
    {
      role: "system",
      content: `
You are an assistant with tools:
- calculator
- get_time
- get_my_advisees

You MUST use tools when relevant.
`
    },
    ...sessions[sessionId]
  ];

  try {
    let msg = await callOpenAI(messages);

    if (!msg) {
      return res.status(500).json({ reply: "AI failed to respond" });
    }

    /* 🔁 TOOL LOOP */
    while (msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        const { name, arguments: argsStr } = toolCall.function;
        const args = JSON.parse(argsStr);

        console.log("🛠 Tool call:", name, args);

        const result = await toolHandlers[name](args);

        messages.push(msg);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }

      msg = await callOpenAI(messages);
      if (!msg) break;
    }

    const reply = msg.content || "No response generated";

    sessions[sessionId].push({ role: "assistant", content: reply });

    res.json({ reply });

  } catch (err) {
    console.error("❌ Chat error:", err.message);
    res.status(500).json({ reply: "Something went wrong" });
  }
});

/* =========================================================
   DEBUG + HEALTH
========================================================= */
app.get("/debug", (req, res) => {
  res.json({
    sessions,
    tokenCached: !!cachedToken,
    tokenExpiry
  });
});

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
  console.log("🚀 OpenAI MCP Agent running");
});
