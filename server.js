// =============================
// MULTI-TOOL LANGCHAIN AGENT + MISTRAL (HUGGING FACE)
// =============================

// ----------- BACKEND (Node + Express) -----------
// file: server.js

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fetch from "node-fetch";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { DynamicTool } from "langchain/tools";
import { ChatOpenAI } from "langchain/chat_models/openai"; // used as generic client

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --------- Mistral via Hugging Face Endpoint ---------
// Set HF_API_KEY and HF_BASE_URL (your inference endpoint URL)
// Example HF_BASE_URL: https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2

const model = new ChatOpenAI({
  openAIApiKey: process.env.HF_API_KEY || "hf_dummy",
  temperature: 0.2,
  configuration: {
    basePath: process.env.HF_BASE_URL, // points to Hugging Face endpoint
    defaultHeaders: {
      Authorization: `Bearer ${process.env.HF_API_KEY}`,
      "Content-Type": "application/json",
    },
  },
});

// --------- Utility: authenticate Ellucian ---------
async function authenticate(apiKey) {
  const authResponse = await fetch("https://integrate.elluciancloud.ie/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  const data = await authResponse.json();
  return data.access_token;
}

// --------- Tools (Multiple APIs) ---------

const gpaTool = new DynamicTool({
  name: "get_gpa",
  description: "Get the GPA of a student by name. Input should be the student name.",
  func: async (name) => {
    try {
      const token = await authenticate(process.env.ELLUCIAN_API_KEY);
      const res = await fetch(
        `https://integrate.elluciancloud.ie/api/gpa?search=${encodeURIComponent(name)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!data || data.length === 0) return `GPA for ${name} not found.`;
      return `Student ${name} has GPA ${data[0].gpa}`;
    } catch (err) {
      console.error(err);
      return `Error fetching GPA for ${name}`;
    }
  },
});

const riskTool = new DynamicTool({
  name: "get_risk",
  description: "Get the at-risk level of a student by name. Input should be the student name.",
  func: async (name) => {
    try {
      const token = await authenticate(process.env.ELLUCIAN_API_KEY);
      const res = await fetch(
        `https://integrate.elluciancloud.ie/api/risk?search=${encodeURIComponent(name)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!data || data.length === 0) return `Risk info for ${name} not found.`;
      return `Student ${name} risk level: ${data[0].riskLevel}`;
    } catch (err) {
      console.error(err);
      return `Error fetching risk for ${name}`;
    }
  },
});

// Add more tools as needed...

// --------- Initialize Agent (provider-agnostic) ---------
const tools = [gpaTool, riskTool];

let agentExecutor;
(async () => {
  agentExecutor = await initializeAgentExecutorWithOptions(tools, model, {
    // Use a generic agent type for non-OpenAI function-calling models
    agentType: "structured-chat-zero-shot-react-description",
    verbose: true,
  });
})();

// --------- API endpoint ---------
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;
  if (!agentExecutor) {
    return res.status(500).json({ reply: "Agent not ready yet." });
  }

  try {
    const result = await agentExecutor.run(message);
    res.json({ reply: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "Error processing your request." });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));

