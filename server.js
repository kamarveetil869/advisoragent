import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";
import axios from "axios";
import { evaluate } from "mathjs";

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* =========================================================
   🔐 ETHOS TOKEN CACHE (with buffer)
========================================================= */
let cachedToken = null;
let tokenExpiry = null;

async function getEthosToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  try {
    const response = await axios.post(
      `${process.env.ETHOS_BASE_URL}/auth`,
      { apiKey: process.env.ETHOS_API_KEY },
      { headers: { "Content-Type": "application/json" } }
    );

    const token = response.data.access_token;
    const expiresIn = response.data.expires_in || 3600;

    // Refresh 5 minutes early
    cachedToken = token;
    tokenExpiry = Date.now() + (expiresIn - 300) * 1000;

    return token;
  } catch (err) {
    console.error("❌ Ethos auth failed:", err.response?.data || err.message);
    return null;
  }
}

/* =========================================================
   🧰 TOOL DEFINITIONS (MCP STYLE)
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
      description: "Retrieve advisees for a given advisor",
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
    try {
      return evaluate(expression).toString();
    } catch {
      return "Invalid calculation";
    }
  },

  get_time: async () => {
    return new Date().toISOString();
  },

  get_my_advisees: async ({ advisorId }) => {
    const token = await getEthosToken();
    if (!token) return "Authentication failed";

    try {
      const response = await axios.get(
        `${process.env.ETHOS_BASE_URL}/api/x-get-advisees`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          params: { advisor_id: advisorId }
        }
      );

      return response.data;
    } catch (err) {
      console.error("❌ Advisees fetch failed:", err.response?.data || err.message);
      return "Failed to fetch advisees";
    }
  }
};

/* =========================================================
   💬 SESSION MEMORY
========================================================= */
const sessions = {};

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
You are an intelligent assistant with tool access.

Use tools when appropriate:
- calculator → math
- get_time → current time
- get_my_advisees → student/advisee data

Always prefer tools when relevant.
`
    },
    ...sessions[sessionId]
  ];

  try {
    let response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.7
    });

    let msg = response.choices[0].message;

    // 🔁 TOOL LOOP (supports chaining)
    while (msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments || "{}");

        console.log(`🛠 Tool called: ${toolName}`, args);

        const result = await toolHandlers[toolName](args);

        messages.push(msg);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }

      response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        tools
      });

      msg = response.choices[0].message;
    }

    const reply = msg.content;

    sessions[sessionId].push({ role: "assistant", content: reply });

    res.json({ reply });

  } catch (err) {
    console.error("❌ Chat error:", err.message);
    res.status(500).json({ reply: "Something went wrong" });
  }
});

/* =========================================================
   🔄 RESET
========================================================= */
app.post("/api/reset", (req, res) => {
  const { sessionId } = req.body;
  delete sessions[sessionId];
  res.json({ message: "Session reset" });
});

/* =========================================================
   ❤️ HEALTH
========================================================= */
app.get("/", (req, res) => {
  res.send("MCP Agent running ✅");
});

/* =========================================================
   🚀 START
========================================================= */
app.listen(process.env.PORT || 5000, () => {
  console.log("Server running 🚀");
});
