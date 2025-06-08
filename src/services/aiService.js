const { ChatOpenAI } = require('@langchain/openai');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages'); // AIMessage removed as it's not directly used here
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { ChatPromptTemplate, MessagesPlaceholder } = require('@langchain/core/prompts');
const { RunnableSequence } = require('@langchain/core/runnables');
// BufferMemory was here, but AgentExecutor manages memory directly if provided.
const { createRedisMemory } = require('./memoryService');
const config = require('../config');
const logger = require('../utils/logger');
const axios = require('axios');

// Tool related imports
const { AgentExecutor, createOpenAIFunctionsAgent } = require('langchain/agents');
const { DynamicTool } = require('@langchain/core/tools');
const toolService = require('./toolService'); // Import the tool service

let openaiModel, geminiModel;

// Model initializations (same as before)
if (config.ai.openaiApiKey && config.ai.openaiApiKey !== 'YOUR_OPENAI_API_KEY') {
  try {
    openaiModel = new ChatOpenAI({
      apiKey: config.ai.openaiApiKey,
      modelName: 'gpt-3.5-turbo-1106',
      temperature: 0,
    });
    logger.info('OpenAI model for agent initialized.');
  } catch (error) { logger.error('Failed to initialize OpenAI model for agent:', error); }
} else { logger.warn('OpenAI API key not found. OpenAI agent will not be available.'); }

if (config.ai.geminiApiKey && config.ai.geminiApiKey !== 'YOUR_GEMINI_API_KEY') {
  try {
    geminiModel = new ChatGoogleGenerativeAI({
      apiKey: config.ai.geminiApiKey,
      modelName: 'gemini-pro',
    });
    logger.info('Gemini model initialized.');
  } catch (error) { logger.error('Failed to initialize Gemini model:', error); }
} else { logger.warn('Gemini API key not found. Gemini model may not be fully functional for agents.'); }

// --- Simple Conversational Chain (getAIResponseWithMemory - unchanged) ---
async function getAIResponseWithMemory(sessionId, userPrompt, provider, systemPromptText) {
  const selectedProvider = provider || config.ai.defaultProvider;
  let modelInstance;
  logger.info(`[getAIResponseWithMemory] Selected AI Provider: ${selectedProvider} for session ID: ${sessionId}`);

  if (selectedProvider === 'openai') {
    if (!openaiModel) { logger.error('[getAIResponseWithMemory] OpenAI model is not initialized.'); return null; }
    modelInstance = openaiModel;
  } else if (selectedProvider === 'gemini') {
    if (!geminiModel) { logger.error('[getAIResponseWithMemory] Gemini model is not initialized.'); return null; }
    modelInstance = geminiModel;
  } else { logger.error(`[getAIResponseWithMemory] Unsupported AI provider: ${selectedProvider}`); return null; }

  const memory = createRedisMemory(sessionId);
  if (!memory) { logger.error(`[getAIResponseWithMemory] Failed to create Redis memory for session ${sessionId}.`); return null; }

  const effectiveSystemPrompt = systemPromptText || "You are a helpful AI assistant.";
  const prompt = ChatPromptTemplate.fromMessages([
      new SystemMessage(effectiveSystemPrompt),
      new MessagesPlaceholder("chat_history"), // Ensure memoryKey in memory object matches this
      new HumanMessage("{input}"),
  ]);
  memory.memoryKeys = ["chat_history"]; // Explicitly define if not default

  const chain = RunnableSequence.from([
    {
      input: (initialInput) => initialInput.input,
      chat_history: async () => {
        const memoryVariables = await memory.loadMemoryVariables({});
        return memoryVariables.chat_history || [];
      },
    },
    prompt,
    modelInstance,
    new StringOutputParser(),
  ]);

  try {
    logger.debug(`[getAIResponseWithMemory] Invoking AI chain for session ${sessionId} with input: ${userPrompt}`);
    const responseContent = await chain.invoke({ input: userPrompt });
    await memory.saveContext({ input: userPrompt }, { output: responseContent });
    logger.info(`[getAIResponseWithMemory] AI (${selectedProvider}) for session ${sessionId} responded.`);
    return responseContent;
  } catch (error) {
    logger.error(`[getAIResponseWithMemory] Error in AI chain for session ${sessionId}: `, error);
    return null;
  }
}

// --- Dynamic Tool Creation ---
let dynamicTools = []; // Cache for dynamically loaded tools

async function loadAndPrepareTools() {
    logger.info('[loadAndPrepareTools] Loading tools defined in Redis...');
    const definedTools = await toolService.listTools();
    if (!definedTools || definedTools.length === 0) {
        logger.info('[loadAndPrepareTools] No tools defined in Redis.');
        dynamicTools = [];
        return;
    }

    dynamicTools = definedTools.map(toolDef => {
        logger.info(`[loadAndPrepareTools] Creating dynamic tool: ${toolDef.name}`);
        return new DynamicTool({
            name: toolDef.name,
            description: toolDef.description, // This is for the AI to understand when to use the tool
            func: async (toolInputString) => {
                // Tool input from AI is often a string, sometimes JSON string.
                // We need to parse it based on expected parameters.
                // For OpenAI functions, it might pass a structured object directly if the schema is well defined.
                // For now, let's assume toolInputString might be a JSON string of arguments, or a simple string.
                let args = {};
                if (typeof toolInputString === 'string') {
                    try {
                        args = JSON.parse(toolInputString);
                    } catch (e) {
                        // If not a JSON string, and the tool expects a single unnamed parameter,
                        // we might assign it directly. This part needs robust handling.
                        // For now, if a tool has one param, assume toolInputString is its value.
                        if (toolDef.parameters.length === 1) {
                           args[toolDef.parameters[0].name] = toolInputString;
                        } else {
                           logger.warn(`[DynamicTool:${toolDef.name}] Input '${toolInputString}' is not JSON and multiple params exist. Tool might fail.`);
                           // Fallback: pass the raw string if a tool expects it.
                           // This part might need more sophisticated input mapping based on toolDef.parameters.
                        }
                    }
                } else if (typeof toolInputString === 'object' && toolInputString !== null) {
                    args = toolInputString; // Already an object (e.g. from OpenAI function calling)
                }


                logger.info(`[DynamicTool:${toolDef.name}] Executing with input: ${JSON.stringify(args)}`);

                const { httpMethod, endpointUrl } = toolDef;
                const requestConfig = {
                    method: httpMethod,
                    url: endpointUrl,
                    headers: {},
                };

                // Add static headers from definition
                (toolDef.headers || []).forEach(h => requestConfig.headers[h.name] = h.value);

                // Prepare parameters for query (GET) or body (POST, PUT, etc.)
                const queryParams = {};
                const bodyParams = {};

                (toolDef.parameters || []).forEach(paramDef => {
                    const value = args[paramDef.name];
                    if (value === undefined && paramDef.required) {
                        return `Error: Missing required parameter '${paramDef.name}' for tool ${toolDef.name}.`;
                    }
                    if (value !== undefined) {
                        if (httpMethod === 'GET') {
                            queryParams[paramDef.name] = value;
                        } else {
                            bodyParams[paramDef.name] = value;
                        }
                    }
                });

                if (httpMethod === 'GET' && Object.keys(queryParams).length > 0) {
                    requestConfig.params = queryParams;
                } else if (['POST', 'PUT', 'PATCH'].includes(httpMethod) && Object.keys(bodyParams).length > 0) {
                    requestConfig.data = bodyParams;
                    // Ensure content type if sending JSON body, common case
                    if (!requestConfig.headers['Content-Type']) {
                        requestConfig.headers['Content-Type'] = 'application/json';
                    }
                }

                try {
                    logger.debug(`[DynamicTool:${toolDef.name}] Making API call: `, requestConfig);
                    const response = await axios(requestConfig);
                    // Return a string representation of the data.
                    // If API returns JSON, stringify it. If text, return as is.
                    if (typeof response.data === 'object') {
                        return JSON.stringify(response.data);
                    }
                    return String(response.data);
                } catch (error) {
                    logger.error(`[DynamicTool:${toolDef.name}] API call failed: ${error.message}`, error.response ? { status: error.response.status, data: error.response.data } : '');
                    return `Error executing tool ${toolDef.name}: ${error.message}`;
                }
            },
        });
    });
    logger.info(`[loadAndPrepareTools] ${dynamicTools.length} tools loaded and prepared.`);
}

// Call it once on service startup (or on demand, with caching)
// For simplicity, call on startup. In a more complex app, this might be event-driven or scheduled.
loadAndPrepareTools().catch(err => logger.error("Initial tool loading failed:", err));


// --- Agent-based Response with Tools ---
async function getAIAgentResponse(sessionId, userPrompt, systemPromptText) {
  logger.info(`[getAIAgentResponse] Processing for session ID: ${sessionId}`);

  if (!openaiModel) {
    logger.error('[getAIAgentResponse] OpenAI model (for agent) is not initialized.');
    return 'Error: AI Agent service not available.';
  }
  const modelForAgent = openaiModel;

  if (dynamicTools.length === 0) {
      logger.warn("[getAIAgentResponse] No dynamic tools loaded. Agent will have no tools available.");
      // Optionally, you could fall back to getAIResponseWithMemory or inform the user.
      // For now, proceed, but agent won't use tools.
  }

  const memory = createRedisMemory(sessionId);
  if (!memory) {
    logger.error(`[getAIAgentResponse] Failed to create Redis memory for session ${sessionId}.`);
    return 'Error: Could not initialize session memory.';
  }
  memory.memoryKey = "chat_history"; // Langchain default, ensure consistency with MessagesPlaceholder

  const effectiveSystemPrompt = systemPromptText || "You are a helpful assistant. Use available tools if they can help you answer the user's request. Be concise.";

  const agentPrompt = ChatPromptTemplate.fromMessages([
    new SystemMessage(effectiveSystemPrompt),
    new MessagesPlaceholder("chat_history"),
    new HumanMessage("{input}"),
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  try {
    const agent = await createOpenAIFunctionsAgent({
      llm: modelForAgent,
      tools: dynamicTools, // Use the dynamically loaded tools
      prompt: agentPrompt,
    });

    const agentExecutor = new AgentExecutor({
      agent,
      tools: dynamicTools, // Use the dynamically loaded tools
      memory,
      verbose: true,
      handleParsingErrors: "I had trouble understanding how to use my tools for that request. Could you please rephrase it?",
    });

    logger.debug(`[getAIAgentResponse] Invoking agent for session ${sessionId} with input: "${userPrompt}" using ${dynamicTools.length} tools.`);
    const result = await agentExecutor.invoke({ input: userPrompt });

    logger.info(`[getAIAgentResponse] Agent for session ${sessionId} finished.`);
    logger.debug(`[getAIAgentResponse] Agent result: ${JSON.stringify(result)}`);
    return result.output || "Agent did not provide a final output.";

  } catch (error) {
    logger.error(`[getAIAgentResponse] Error in AI agent execution for session ${sessionId}: `, error);
    return 'Error: An unexpected problem occurred with the AI agent.';
  }
}

module.exports = {
  getAIResponseWithMemory,
  getAIAgentResponse,
  // Expose for potential admin refresh?
  refreshTools: loadAndPrepareTools
};
