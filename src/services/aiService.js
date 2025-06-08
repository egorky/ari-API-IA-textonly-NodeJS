const { ChatOpenAI } = require('@langchain/openai');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage, AIMessage, SystemMessage } = require('@langchain/core/messages');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { PromptTemplate, ChatPromptTemplate, MessagesPlaceholder } = require('@langchain/core/prompts');
const { RunnableSequence } = require('@langchain/core/runnables');
const { BufferMemory } = require('langchain/memory');
const { createRedisMemory } = require('./memoryService');
const config = require('../config');
const logger = require('../utils/logger');
const axios = require('axios'); // Import axios

// Tool related imports
const { AgentExecutor, createOpenAIFunctionsAgent } = require('langchain/agents');
const { DynamicTool } = require('@langchain/core/tools');

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
  } catch (error) {
    logger.error('Failed to initialize OpenAI model for agent:', error);
  }
} else {
  logger.warn('OpenAI API key not found or is a placeholder. OpenAI agent will not be available.');
}

if (config.ai.geminiApiKey && config.ai.geminiApiKey !== 'YOUR_GEMINI_API_KEY') {
  try {
    geminiModel = new ChatGoogleGenerativeAI({
      apiKey: config.ai.geminiApiKey,
      modelName: 'gemini-pro',
    });
    logger.info('Gemini model initialized.');
  } catch (error) {
    logger.error('Failed to initialize Gemini model:', error);
  }
} else {
  logger.warn('Gemini API key not found or is a placeholder. Gemini model may not be fully functional for agents.');
}

// --- Simple Conversational Chain (getAIResponseWithMemory - unchanged from previous version) ---
async function getAIResponseWithMemory(sessionId, userPrompt, provider, systemPromptText) {
  const selectedProvider = provider || config.ai.defaultProvider;
  let modelInstance;
  logger.info(`[getAIResponseWithMemory] Selected AI Provider: ${selectedProvider} for session ID: ${sessionId}`);

  if (selectedProvider === 'openai') {
    if (!openaiModel) {
      logger.error('[getAIResponseWithMemory] OpenAI model is not initialized.');
      return null;
    }
    modelInstance = openaiModel;
  } else if (selectedProvider === 'gemini') {
    if (!geminiModel) {
      logger.error('[getAIResponseWithMemory] Gemini model is not initialized.');
      return null;
    }
    modelInstance = geminiModel;
  } else {
    logger.error(`[getAIResponseWithMemory] Unsupported AI provider: ${selectedProvider}`);
    return null;
  }

  const memory = createRedisMemory(sessionId);
  if (!memory) {
    logger.error(`[getAIResponseWithMemory] Failed to create Redis memory for session ${sessionId}.`);
    return null;
  }

  const effectiveSystemPrompt = systemPromptText || "You are a helpful AI assistant.";
  const prompt = ChatPromptTemplate.fromMessages([
      new SystemMessage(effectiveSystemPrompt),
      new MessagesPlaceholder("chat_history"),
      new HumanMessage("{input}"),
  ]);

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


// --- Agent-based Response with Tools ---

// Helper to get coordinates for a city (simulated for simplicity, a real app would use a geocoding API)
async function getCoordinatesForCity(city) {
    // This is a simplified mock. In a real application, you'd use a geocoding service.
    const cityLower = city.toLowerCase();
    if (cityLower === 'london') return { latitude: 51.5074, longitude: 0.1278 };
    if (cityLower === 'new york') return { latitude: 40.7128, longitude: -74.0060 };
    if (cityLower === 'tokyo') return { latitude: 35.6895, longitude: 139.6917 };
    if (cityLower === 'berlin') return { latitude: 52.5200, longitude: 13.4050 };
    // Add more cities or a proper geocoding API call here
    logger.warn(`[getCoordinatesForCity] No coordinates found for ${city}. Using default (London).`);
    return null; // Indicate city not found
}

const tools = [
  new DynamicTool({
    name: 'getWeather',
    description: 'Call this tool to get the current weather for a specific location. Input should be the city name (e.g., "London", "New York").',
    func: async (city) => {
      logger.info(`[Tool:getWeather] Called with city: ${city}`);
      if (typeof city !== 'string' || city.trim() === '') {
        return "Error: City name must be a non-empty string.";
      }
      const sanitizedCity = city.trim();

      const coordinates = await getCoordinatesForCity(sanitizedCity);
      if (!coordinates) {
          return `Error: Could not find coordinates for the city: ${sanitizedCity}. Please try a well-known city.`;
      }

      const weatherApiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}&current_weather=true`;

      try {
        logger.info(`[Tool:getWeather] Fetching weather from: ${weatherApiUrl}`);
        const response = await axios.get(weatherApiUrl);
        if (response.data && response.data.current_weather) {
          const weather = response.data.current_weather;
          // Construct a human-readable weather string
          return `The current weather in ${sanitizedCity} is: Temperature ${weather.temperature}°C, Wind Speed ${weather.windspeed} km/h, Weather code ${weather.weathercode}. (Note: Weather code interpretation might be needed for full description).`;
        } else {
          logger.warn(`[Tool:getWeather] Unexpected response structure from weather API for ${sanitizedCity}`, response.data);
          return `Error: Could not retrieve detailed weather for ${sanitizedCity} at this time.`;
        }
      } catch (error) {
        logger.error(`[Tool:getWeather] Error fetching weather for ${sanitizedCity}: `, error.message);
        if (error.response) {
            logger.error('Weather API Response Error Data:', error.response.data);
            logger.error('Weather API Response Error Status:', error.response.status);
        }
        return `Error: Failed to fetch weather information for ${sanitizedCity}. The service might be temporarily unavailable.`;
      }
    },
  }),
  new DynamicTool({ // Unchanged from previous version
    name: 'getUserProfile',
    description: 'Call this tool to get user profile information based on a user ID. Input should be the user ID.',
    func: async (userId) => {
        logger.info(`[Tool:getUserProfile] Called with userID: ${userId}`);
        if (userId === '123') return '{"name": "John Doe", "email": "john.doe@example.com", "preferences": " любит музыку джаз"}';
        if (userId === '456') return '{"name": "Jane Smith", "email": "jane.smith@example.com", "preferences": "prefers vegetarian food"}';
        return '{"error": "User not found"}';
    }
  })
];

// getAIAgentResponse function (mostly unchanged, ensure it uses the updated tools array)
async function getAIAgentResponse(sessionId, userPrompt, systemPromptText) {
  logger.info(`[getAIAgentResponse] Processing for session ID: ${sessionId}`);

  if (!openaiModel) {
    logger.error('[getAIAgentResponse] OpenAI model (for agent) is not initialized.');
    return 'Error: AI Agent service not available.';
  }
  const modelForAgent = openaiModel;

  const memory = createRedisMemory(sessionId);
  if (!memory) {
    logger.error(`[getAIAgentResponse] Failed to create Redis memory for session ${sessionId}.`);
    return 'Error: Could not initialize session memory.';
  }
  memory.memoryKey = "chat_history";

  const effectiveSystemPrompt = systemPromptText || "You are a helpful assistant that can use tools to answer questions. If you use a tool, tell the user what information you found and be concise.";

  const agentPrompt = ChatPromptTemplate.fromMessages([
    new SystemMessage(effectiveSystemPrompt),
    new MessagesPlaceholder("chat_history"),
    new HumanMessage("{input}"),
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  try {
    const agent = await createOpenAIFunctionsAgent({
      llm: modelForAgent,
      tools, // Ensure this uses the updated tools array from this scope
      prompt: agentPrompt,
    });

    const agentExecutor = new AgentExecutor({
      agent,
      tools, // Ensure this also uses the updated tools array
      memory,
      verbose: true,
      handleParsingErrors: "Please try rephrasing your request, I had trouble understanding how to use my tools for that.", // Handles cases where the LLM output for tool usage is malformed
    });

    logger.debug(`[getAIAgentResponse] Invoking agent for session ${sessionId} with input: "${userPrompt}"`);
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
};
