const { ariConnect } = require('./src/ari');
const { closeRedisConnection: closeMemoryRedis, getRedisClient: getMemoryRedisClient } = require('./src/services/memoryService');
const { closePromptRedisConnection } = require('./src/services/promptService');
const { closeToolRedisConnection } = require('./src/services/toolService');
const { refreshTools } = require('./src/services/aiService'); // Import refreshTools
const { startWebServer } = require('./src/web');
const logger = require('./src/utils/logger');

let ariClientInstance = null;

async function main() {
    logger.info('Application starting...');

    // Initialize/check Memory Redis
    const memoryRedisClient = getMemoryRedisClient();
    if (memoryRedisClient) {
        try {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (memoryRedisClient.status !== 'ready' && memoryRedisClient.status !== 'connect') {
                 logger.warn(`Memory Redis initial status: ${memoryRedisClient.status}. Waiting...`);
                 await new Promise(resolve => setTimeout(resolve, 1500));
            }
            if (memoryRedisClient.status !== 'ready' && memoryRedisClient.status !== 'connect') {
                 logger.error(`Memory Redis not connected (status: ${memoryRedisClient.status}).`);
            } else { logger.info(`Memory Redis initial status: ${memoryRedisClient.status}`); }
        } catch (e) { logger.error("Error during Memory Redis check:", e); }
    } else { logger.error("Memory Redis client failed to initialize."); }

    logger.info("Prompt service & Tool service Redis clients initialize internally.");
    // It's important that Redis clients for toolService are ready before refreshTools is called.
    // The services initialize their clients on import. A small delay might help ensure connection.
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for service Redis clients

    try {
        await refreshTools(); // Load tools after services are initialized
        logger.info("Dynamic tools loaded/refreshed.");
    } catch (e) {
        logger.error("Error during initial tool refresh:", e);
    }

    ariClientInstance = await ariConnect();
    startWebServer();
}

async function shutdown() {
    logger.info('Shutting down application...');
    if (ariClientInstance) {
        logger.info('Stopping ARI client...');
        try { await ariClientInstance.stop(); logger.info('ARI client stopped.'); }
        catch (err) { logger.error('Error stopping ARI client:', err); }
    }
    await closeMemoryRedis();
    await closePromptRedisConnection();
    await closeToolRedisConnection();
    logger.info('Application shutdown complete.');
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(error => {
    logger.error("Unhandled error during application startup:", error);
    process.exit(1);
});
