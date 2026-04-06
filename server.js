import express from "express";
import cors from "cors";
import { OpenAI } from "langchain/llms/openai";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { Tool } from "langchain/tools";
import { ChatMemory } from "langchain/memory";
import { evaluate } from "mathjs";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

// 🔑 LLM Setup
const llm = new OpenAI({
  openAIApiKey: process.env.OPENROUTER_API_KEY,
  modelName: "mistralai/mixtral-8x7b-instruct",
  temperature: 0.7,
});

// 🛠 Define Tools

const calculator = new Tool({
  name: "Calculator",
  description: "Use this to perform math calculations.",
  func: async (input) => {
    try {
      return evaluate(input).toString();
    } catch (e) {
      return "Invalid calculation";
    }
  },
});

const getTime = new Tool({
  name: "GetTime",
  description: "Get the current server time in ISO format.",
  func: async () => new Date().toISOString(),
});

// Add more tools as needed
const tools = [calculator, getTime];

// 🔄 Session-based chat memory
const sessions = {}; // key = sessionId

app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message) return res.status(400).json({ reply: "Message required" });

    // Initialize memory for session if needed
    if (!sessions[sessionId]) {
      sessions[sessionId] = new ChatMemory({ memoryKey: "chat_history" });
    }

    // Create agent executor for this session
    const agent = await initializeAgentExecutorWithOptions(tools, llm, {
      agentType: "chat-conversational-react-description",
      memory: sessions[sessionId],
      verbose: true,
    });

    const response = await agent.call({ input: message });

    res.json({ reply: response.output });

  } catch (err) {
    console.error("LANGCHAIN ERROR:", err);
    res.status(500).json({ reply: "Error processing request" });
  }
});

// Reset memory
app.post("/api/reset", (req, res) => {
  const { sessionId } = req.body;
  delete sessions[sessionId];
  res.json({ message: "Session memory reset" });
});

app.listen(process.env.PORT || 5000, () =>
  console.log("LangChain agent backend running")
);
