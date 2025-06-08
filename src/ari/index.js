const Ari = require('ari-client');
const config = require('../config');
const logger = require('../utils/logger');
// Import both functions from aiService
const { getAIResponseWithMemory, getAIAgentResponse } = require('../services/aiService');
const { getRedisClient } = require('../services/memoryService');

async function getChannelVar(channel, varName) {
  try {
    const variable = await channel.getChannelVar({ variable: varName });
    if (variable && variable.value) {
      logger.debug(`Retrieved channel variable ${varName}: ${variable.value}`);
      return variable.value;
    }
    logger.warn(`Channel variable ${varName} not found or empty for channel ${channel.id}`);
    return undefined;
  } catch (error) {
    if (error.message && error.message.includes('Variable not found')) {
        logger.warn(`Channel variable ${varName} not found for channel ${channel.id}`);
        return undefined;
    }
    logger.error(`Error getting channel variable ${varName} for channel ${channel.id}:`, error);
    return undefined;
  }
}

async function stasisStartHandler(event, channel) {
  logger.info(`Channel ${channel.name} (ID: ${channel.id}) entered Stasis app ${config.ari.appName}`);

  try {
    await channel.answer();
    logger.info(`Channel ${channel.name} answered`);

    const sessionId = channel.id;
    logger.info(`Using session ID: ${sessionId} for channel ${channel.name}`);

    const initialPrompt = await getChannelVar(channel, 'AI_INITIAL_PROMPT') || "Hello, tell me about yourself.";
    const customAIProvider = await getChannelVar(channel, 'AI_PROVIDER');
    const systemPrompt = await getChannelVar(channel, 'AI_SYSTEM_PROMPT'); // Will use default in AI service if null
    const useAgentStr = await getChannelVar(channel, 'AI_USE_AGENT');
    const useAgent = useAgentStr === 'true';

    logger.info(`Initial prompt for ${sessionId}: "${initialPrompt}"`);
    if (customAIProvider) logger.info(`AI Provider from dialplan for ${sessionId}: ${customAIProvider}`);
    if (systemPrompt) logger.info(`System prompt for ${sessionId}: "${systemPrompt}"`);
    logger.info(`Use AI Agent for ${sessionId}: ${useAgent}`);

    const redisClient = getRedisClient();
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error(`Redis client not ready (status: ${redisClient ? redisClient.status : 'null'}). Cannot proceed for ${sessionId}.`);
        try { await channel.play({ media: 'sound:tt-somethingwrong' }); } catch(e){ logger.error("Error playing sound", e); }
        await channel.hangup();
        return;
    }

    let aiResponse;
    if (useAgent) {
      logger.info(`Using AI Agent for session ${sessionId}`);
      // Note: getAIAgentResponse currently defaults to OpenAI.
      // Provider var from dialplan might need more specific handling if Gemini agent is implemented.
      if (customAIProvider && customAIProvider !== 'openai') {
          logger.warn(`AI_PROVIDER set to '${customAIProvider}' but agent currently defaults to OpenAI. This provider will be ignored by the agent call.`);
      }
      aiResponse = await getAIAgentResponse(sessionId, initialPrompt, systemPrompt);
    } else {
      logger.info(`Using standard AI response (no agent) for session ${sessionId}`);
      aiResponse = await getAIResponseWithMemory(sessionId, initialPrompt, customAIProvider, systemPrompt);
    }

    if (aiResponse) {
      logger.info(`AI response for ${sessionId}: "${aiResponse}"`);
      try {
        await channel.setChannelVar({ variable: 'AI_RESPONSE', value: aiResponse });
        logger.info(`Set channel variable AI_RESPONSE for ${sessionId}`);
      } catch (setVarError) {
        logger.error(`Error setting AI_RESPONSE for ${sessionId}: `, setVarError);
      }
    } else {
      logger.warn(`No AI response received for ${sessionId}. Setting default error.`);
      try {
        await channel.setChannelVar({ variable: 'AI_RESPONSE', value: 'Error: No AI response' });
        await channel.play({ media: 'sound:tt-somethingwrong' });
      } catch (err) {
        logger.error(`Error setting/playing error for ${sessionId}: `, err);
      }
    }

    logger.info(`Hanging up channel ${channel.name} after AI interaction.`);
    await channel.hangup();

  } catch (err) {
    logger.error(`Error in stasisStartHandler for channel ${channel.name}: `, err);
    try {
      if (channel && channel.state !== 'DOWN') { await channel.hangup(); }
    } catch (hangupErr) {
      logger.error(`Error hanging up channel ${channel.name} after error: `, hangupErr);
    }
  }
}

// ariConnect function remains the same as before
async function ariConnect() {
  try {
    const client = await Ari.connect(config.ari.url, config.ari.username, config.ari.password);
    logger.info(`ARI client connected to ${config.ari.url}`);

    client.on('StasisStart', stasisStartHandler);
    client.on('StasisEnd', (event, channel) => {
      logger.info(`Channel ${channel.name} (ID: ${channel.id}) left Stasis app`);
    });
    client.on('WebSocketMaxRetries', (err) => {
        logger.error({ err },'ARI connection: Max retries reached. Exiting.');
        process.exit(1);
    });
    client.on('ARIClientError', (err) => {
        logger.error({ err }, 'ARI connection: Client error. Exiting.');
        process.exit(1);
    });

    await client.start(config.ari.appName);
    logger.info(`ARI application '${config.ari.appName}' started and listening for events.`);
    return client;
  } catch (err) {
    logger.error(`Failed to connect or start ARI application: `, err);
    process.exit(1);
  }
}
module.exports = { ariConnect };
