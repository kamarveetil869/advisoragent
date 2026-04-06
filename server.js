import express from "express";
import cors from "cors";
import "dotenv/config";

import { OpenAI, Tool, initializeAgentExecutorWithOptions } from "langchain";
import { evaluate } from "mathjs";

const app = express();
app.use(cors());
app.use(express.json());

// Initialize LLM
const llm = new OpenAI({
  openAIApiKey: process.env.OPENROUTER_API_KEY,
  modelName: "mistralai/mixtral-8x7b-instruct",
  temperature: 0.7,
});

// Define tools
const calculator = new Tool({
  name: "Calculator",
  description: "Performs math calculations",
  func: async (input) => {
    try {
      return evaluate(input).toString();
    } catch {
      return "Invalid calculation";
    }
  },
});

const getTime = new Tool({
  name: "GetTime",
  description: "Returns current server time in ISO format",
  func: async () => new Date().toISOString(),
});

const tools = [calculator, getTime];

// Session memory (manual implementation)
const sessions = {}; // sessionId -> array of messages

app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ reply: "Message required" });
    if (!sessionId) return res.status(400).json({ reply: "sessionId required" });

    // Initialize session messages array
    if (!sessions[sessionId]) sessions[sessionId] = [];

    // Add user message to session
    sessions[sessionId].push({ role: "user", content: message });

    // Initialize agent
    const agent = await initializeAgentExecutorWithOptions(tools, llm, {
      agentType: "chat-conversational-react-description",
      verbose: true,
      // Use the session messages as memory substitute
      memory: {
        loadMemoryVariables: async () => ({ chat_history: sessions[sessionId] }),
        saveContext: async ({ input, output }) => {
          sessions[sessionId].push({ role: "assistant", content: output });
        },
      },
    });

    // Run agent
    const response = await agent.call({ input: message });
    res.json({ reply: response.output });
  } catch (err) {
    console.error("LANGCHAIN ERROR:", err);
    res.status(500).json({ reply: "Error processing request" });
  }
});

// Reset session memory
app.post("/api/reset", (req, res) => {
  const { sessionId } = req.body;
  if (sessions[sessionId]) delete sessions[sessionId];
  res.json({ message: "Session memory reset" });
});

// Health check
app.get("/", (req, res) => {
  res.send("LangChain agent backend running ✅");
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
