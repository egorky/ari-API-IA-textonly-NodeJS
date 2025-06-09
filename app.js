const { ariConnect } = require('./src/ari');
const { closeRedisConnection: closeMemoryRedis, getRedisClient: getMemoryRedisClient } = require('./src/services/memoryService');
const { closePromptRedisConnection } = require('./src/services/promptService');
const { closeToolRedisConnection } = require('./src/services/toolService');
const { closeSystemConfigRedisConnection } = require('./src/services/systemConfigService'); // Import
const { refreshTools } = require('./src/services/aiService');
const { startWebServer } = require('./src/web');
const logger = require('./src/utils/logger');

let ariClientInstance = null;

async function main() {
    logger.info('Application starting...');
    const memoryRedisClient = getMemoryRedisClient(); // Ensure client is attempted to be initialized
    if (memoryRedisClient) {
        try {
            await new Promise(resolve => setTimeout(resolve, 500)); // Short delay for connection
            if (memoryRedisClient.status !== 'ready' && memoryRedisClient.status !== 'connect') {
                 logger.warn(`Memory Redis initial status: ${memoryRedisClient.status}. Waiting a bit longer...`);
                 await new Promise(resolve => setTimeout(resolve, 1500));
            }
            if (memoryRedisClient.status !== 'ready' && memoryRedisClient.status !== 'connect') {
                 logger.error(`Memory Redis still not connected (status: ${memoryRedisClient.status}).`);
            } else { logger.info(`Memory Redis initial status: ${memoryRedisClient.status}`); }
        } catch (e) { logger.error("Error during Memory Redis check:", e); }
    } else { logger.error("Memory Redis client primary instance failed to initialize."); }

    logger.info("Prompt, Tool, and SystemConfig service Redis clients initialize internally on first import.");
    // Delay to allow service Redis clients to connect before dependent operations
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
        await refreshTools();
        logger.info("Dynamic tools loaded/refreshed.");
    } catch (e) { logger.error("Error during initial tool refresh:", e); }

    ariClientInstance = await ariConnect();
    startWebServer();
}

async function shutdown() {
    logger.info('Shutting down application...');
    if (ariClientInstance) {
        try { await ariClientInstance.stop(); logger.info('ARI client stopped.'); }
        catch (err) { logger.error('Error stopping ARI client:', err); }
    }
    await closeMemoryRedis();
    await closePromptRedisConnection();
    await closeToolRedisConnection();
    await closeSystemConfigRedisConnection(); // Add this
    logger.info('All Redis connections closed. Application shutdown complete.');
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(error => {
    logger.error("Unhandled error during application startup:", error);
    process.exit(1);
});
