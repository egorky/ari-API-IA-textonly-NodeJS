const { BufferMemory } = require('langchain/memory');
const { RedisChatMessageHistory } = require('@langchain/community/stores/message/ioredis');
const IORedis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

let redisClient;

try {
  redisClient = new IORedis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    // Add any other Redis options here, e.g., TLS, db
    maxRetriesPerRequest: null, // Important for long-running apps
    enableReadyCheck: true, // Explicitly enable ready check
    connectTimeout: 10000, // 10 seconds
  });

  redisClient.on('connect', () => {
    logger.info('Connected to Redis for LangChain memory.');
  });

  redisClient.on('error', (err) => {
    logger.error('Redis client error:', err);
    // Depending on the error, you might want to prevent the app from starting
    // or implement a retry mechanism for the memory service.
  });

  redisClient.on('ready', () => {
    logger.info('Redis client is ready.');
  });

  redisClient.on('end', () => {
    logger.warn('Redis connection ended.');
  });

} catch (error) {
  logger.error('Failed to initialize Redis client for LangChain memory:', error);
  // If Redis is critical, you might want to throw this error
  // or handle it in a way that the application knows memory won't be available.
  redisClient = null; // Ensure it's null if initialization failed
}


/**
 * Creates a new LangChain memory instance backed by Redis.
 *
 * @param {string} sessionId The unique session ID (e.g., Asterisk UNIQUEID).
 * @param {number} [k=6] The number of last messages to keep in history (k value for ConversationSummaryBufferMemory).
 * @returns {BufferMemory|null} A LangChain BufferMemory instance or null if Redis client is not available.
 */
function createRedisMemory(sessionId, k = 6) {
  if (!redisClient || !redisClient.status || redisClient.status === 'end' || redisClient.status === 'reconnecting') {
      logger.error('Redis client not available or not connected. Cannot create Redis memory.');
      // Fallback to in-memory if Redis is down? Or just fail? For now, fail.
      return null;
  }

  logger.info(`Creating Redis-backed memory for session ID: ${sessionId}`);

  const messageHistory = new RedisChatMessageHistory({
    sessionId: `chat_history:${sessionId}`, // Prefix to avoid key collisions
    client: redisClient,
    // ttl: 3600, // Optional: Time-to-live for chat history in seconds (e.g., 1 hour)
  });

  // Using BufferMemory, keeps a buffer of recent messages.
  // Other memory types like ConversationSummaryBufferMemory could also be used
  // if summarization is needed and an LLM is provided to it.
  const memory = new BufferMemory({
    chatHistory: messageHistory,
    memoryKey: 'chat_history', // Must match the key used in prompts if used directly
    inputKey: 'input', // Specifies the key for new input messages
    outputKey: 'output', // Specifies the key for new output messages
    returnMessages: true, // Ensures loadMemoryVariables returns Message objects
  });

  return memory;
}

/**
 * Function to explicitly close the Redis connection.
 * Should be called on application shutdown.
 */
async function closeRedisConnection() {
    if (redisClient && redisClient.status !== 'end') {
        logger.info('Closing Redis connection for LangChain memory.');
        try {
            await redisClient.quit();
            logger.info('Redis connection closed.');
        } catch (error) {
            logger.error('Error closing Redis connection:', error);
        }
    }
}

module.exports = {
  createRedisMemory,
  closeRedisConnection,
  // Exporting client for potential direct use or testing, but generally not needed by other services
  getRedisClient: () => redisClient
};

/*
// Example Usage (for testing - ensure Redis is running)
async function testMemory() {
  if (!redisClient) {
    logger.error("Cannot run memory test, Redis client not initialized.");
    return;
  }
  // Wait for Redis client to be ready
  if (redisClient.status !== 'ready') {
    await new Promise(resolve => redisClient.once('ready', resolve));
  }

  const sessionId = 'test-session-123';
  const memory = createRedisMemory(sessionId);

  if (!memory) {
    logger.error("Failed to create memory for test.");
    return;
  }

  await memory.saveContext({ input: 'Hello from user' }, { output: 'Hello from AI' });
  await memory.saveContext({ input: 'How are you?' }, { output: 'I am fine, thank you!' });

  const history = await memory.loadMemoryVariables({});
  logger.info('Retrieved history:', JSON.stringify(history, null, 2));

  // Clean up (optional, depends on whether you want to persist test data)
  // const redis = new IORedis(config.redis.port, config.redis.host, { password: config.redis.password });
  // await redis.del(\`chat_history:\${sessionId}\`);
  // await redis.quit();

  await closeRedisConnection();
}

if (require.main === module) {
  // global.config = require('../config'); // Assuming config is loaded
  // global.logger = require('../utils/logger'); // Assuming logger is available
  (async () => {
    // Ensure config and logger are available if run directly
    if (!global.config) global.config = require('../config');
    if (!global.logger) global.logger = require('../utils/logger');
    await testMemory();
  })();
}
*/
