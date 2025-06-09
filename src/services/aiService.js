const { ChatOpenAI } = require('@langchain/openai');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { ChatPromptTemplate, MessagesPlaceholder } = require('@langchain/core/prompts');
const { RunnableSequence } = require('@langchain/core/runnables');
const { createRedisMemory } = require('./memoryService');
const config = require('../config'); // .env config
const systemConfigService = require('./systemConfigService'); // System config from Redis
const logger = require('../utils/logger');
const axios = require('axios');

const { AgentExecutor, createOpenAIFunctionsAgent } = require('langchain/agents');
const { DynamicTool } = require('@langchain/core/tools');
const toolService = require('./toolService');

let openaiModel, geminiModel;
// (Model initialization logic remains the same - checks .env keys)
if (config.ai.openaiApiKey && config.ai.openaiApiKey !== 'YOUR_OPENAI_API_KEY' && config.ai.openaiApiKey.startsWith('sk-')) {
  try {
    openaiModel = new ChatOpenAI({ apiKey: config.ai.openaiApiKey, modelName: 'gpt-3.5-turbo-1106', temperature: 0 });
    logger.info('OpenAI model initialized.');
  } catch (e) { logger.error('Failed to initialize OpenAI model:', e); openaiModel = null; }
} else { logger.warn('OpenAI API key invalid/missing. OpenAI model unavailable.'); openaiModel = null; }

if (config.ai.geminiApiKey && config.ai.geminiApiKey !== 'YOUR_GEMINI_API_KEY' && config.ai.geminiApiKey.length > 10) {
  try {
    geminiModel = new ChatGoogleGenerativeAI({ apiKey: config.ai.geminiApiKey, modelName: 'gemini-pro' });
    logger.info('Gemini model initialized.');
  } catch (e) { logger.error('Failed to initialize Gemini model:', e); geminiModel = null; }
} else { logger.warn('Gemini API key invalid/missing. Gemini model unavailable.'); geminiModel = null; }


async function getDefaultProvider() {
    let provider = await systemConfigService.getSystemConfig('defaultAiProvider');
    if (!provider) {
        provider = config.ai.defaultProvider; // Fallback to .env
        logger.info(`Default AI provider not set in Redis, using .env default: ${provider}`);
    } else {
        logger.info(`Using default AI provider from Redis: ${provider}`);
    }
    return provider;
}

async function getAIResponseWithMemory(sessionId, userPrompt, providerOverride, systemPromptText) {
  const effectiveProvider = providerOverride || await getDefaultProvider();
  let modelInstance;
  logger.info(`[getAIResponseWithMemory] Effective AI Provider: ${effectiveProvider} for session ID: ${sessionId}`);

  if (effectiveProvider === 'openai') {
    if (!openaiModel) { logger.error('[getAIResponseWithMemory] OpenAI model unavailable.'); return null; }
    modelInstance = openaiModel;
  } else if (effectiveProvider === 'gemini') {
    if (!geminiModel) { logger.error('[getAIResponseWithMemory] Gemini model unavailable.'); return null; }
    modelInstance = geminiModel;
  } else { logger.error(`[getAIResponseWithMemory] Unsupported AI provider: ${effectiveProvider}`); return null; }

  const memory = createRedisMemory(sessionId);
  if (!memory) { logger.error(`[getAIResponseWithMemory] Failed to create Redis memory for session ${sessionId}.`); return null; }

  const effectiveSystemPrompt = systemPromptText || "You are a helpful AI assistant.";
  const prompt = ChatPromptTemplate.fromMessages([
      new SystemMessage(effectiveSystemPrompt), new MessagesPlaceholder("chat_history"), new HumanMessage("{input}"),
  ]);
  memory.memoryKeys = ["chat_history"];

  const chain = RunnableSequence.from([
    { input: (i) => i.input, chat_history: async () => (await memory.loadMemoryVariables({})).chat_history || [] },
    prompt, modelInstance, new StringOutputParser(),
  ]);

  try {
    const responseContent = await chain.invoke({ input: userPrompt });
    await memory.saveContext({ input: userPrompt }, { output: responseContent });
    return responseContent;
  } catch (error) { logger.error(`[getAIResponseWithMemory] Error for session ${sessionId}: `, error); return null; }
}

let dynamicTools = [];
async function loadAndPrepareTools() { /* ... unchanged ... */
    logger.info('[loadAndPrepareTools] Attempting to load tools defined in Redis...');
    const definedTools = await toolService.listTools();
    if (!definedTools) {
        logger.error('[loadAndPrepareTools] Failed to list tools from toolService. Redis might not be ready there. No tools will be loaded.');
        dynamicTools = []; return;
    }
    if (definedTools.length === 0) {
        logger.info('[loadAndPrepareTools] No tools currently defined in Redis.');
        dynamicTools = []; return;
    }
    dynamicTools = definedTools.map(toolDef => new DynamicTool({
        name: toolDef.name, description: toolDef.description,
        func: async (toolInputString) => {
            let args = {};
            if (typeof toolInputString === 'string') {
                try { args = JSON.parse(toolInputString); }
                catch (e) {
                    if (toolDef.parameters && toolDef.parameters.length === 1) args[toolDef.parameters[0].name] = toolInputString;
                    else logger.warn(`[DynamicTool:${toolDef.name}] Input not JSON, multiple/no params. ToolInput: '${toolInputString}'`);
                }
            } else if (typeof toolInputString === 'object' && toolInputString !== null) args = toolInputString;
            logger.info(`[DynamicTool:${toolDef.name}] Executing with: ${JSON.stringify(args)}`);
            const { httpMethod, endpointUrl } = toolDef;
            const requestConfig = { method: httpMethod, url: endpointUrl, headers: {} };
            (toolDef.headers || []).forEach(h => requestConfig.headers[h.name] = h.value);
            const queryParams = {}, bodyParams = {};
            (toolDef.parameters || []).forEach(pDef => {
                const val = args[pDef.name];
                if (val === undefined && pDef.required) throw new Error(`Missing param '${pDef.name}' for ${toolDef.name}.`);
                if (val !== undefined) httpMethod === 'GET' ? queryParams[pDef.name] = val : bodyParams[pDef.name] = val;
            });
            if (httpMethod === 'GET' && Object.keys(queryParams).length) requestConfig.params = queryParams;
            else if (['POST', 'PUT', 'PATCH'].includes(httpMethod) && Object.keys(bodyParams).length) {
                requestConfig.data = bodyParams;
                if (!requestConfig.headers['Content-Type']) requestConfig.headers['Content-Type'] = 'application/json';
            }
            try {
                const response = await axios(requestConfig);
                return typeof response.data === 'object' ? JSON.stringify(response.data) : String(response.data);
            } catch (err) {
                logger.error(`[DynamicTool:${toolDef.name}] API call failed: ${err.message}`, err.response?.status, err.response?.data);
                return `Error for ${toolDef.name}: API failed (${err.response?.status}) ${err.message}`;
            }
        },
    }));
    logger.info(`[loadAndPrepareTools] ${dynamicTools.length} tools loaded.`);
}


async function getAIAgentResponse(sessionId, userPrompt, systemPromptText) {
  logger.info(`[getAIAgentResponse] Session ID: ${sessionId}`);
  // Agent currently defaults to OpenAI; provider override from dialplan not used here yet.
  // To use default provider for agent: check await getDefaultProvider() and select model.
  if (!openaiModel) { logger.error('[getAIAgentResponse] OpenAI model unavailable for agent.'); return 'Error: AI Agent service unavailable.'; }
  const modelForAgent = openaiModel;

  if (!dynamicTools) await loadAndPrepareTools(); // Ensure tools are loaded if array is undefined (e.g. first call before app.js finishes refresh)
  if (dynamicTools.length === 0) logger.warn("[getAIAgentResponse] Agent has no dynamic tools.");

  const memory = createRedisMemory(sessionId);
  if (!memory) { logger.error(`[getAIAgentResponse] Failed Redis memory for ${sessionId}.`); return 'Error: Session memory error.'; }
  memory.memoryKey = "chat_history";

  const effectiveSystemPrompt = systemPromptText || "You are helpful. Use tools if needed. Be concise.";
  const agentPrompt = ChatPromptTemplate.fromMessages([
    new SystemMessage(effectiveSystemPrompt), new MessagesPlaceholder("chat_history"),
    new HumanMessage("{input}"), new MessagesPlaceholder("agent_scratchpad"),
  ]);
  try {
    const agent = await createOpenAIFunctionsAgent({ llm: modelForAgent, tools: dynamicTools, prompt: agentPrompt });
    const agentExecutor = new AgentExecutor({ agent, tools: dynamicTools, memory, verbose: true, handleParsingErrors: "Tool usage parse error. Rephrase?" });
    const result = await agentExecutor.invoke({ input: userPrompt });
    return result.output || "Agent gave no final output.";
  } catch (error) { logger.error(`[getAIAgentResponse] Agent error for ${sessionId}: `, error); return 'Error: AI agent problem.'; }
}

module.exports = { getAIResponseWithMemory, getAIAgentResponse, refreshTools: loadAndPrepareTools };
