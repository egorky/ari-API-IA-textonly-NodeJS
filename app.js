const { ariConnect } = require('./src/ari');
const { closeRedisConnection: closeMemoryRedis } = require('./src/services/memoryService');
const { closePromptRedisConnection } = require('./src/services/promptService'); // Import prompt Redis closer
const { startWebServer } = require('./src/web');
const logger = require('./src/utils/logger');

// Assuming memoryService.getRedisClient() initializes its client.
// promptService also initializes its own client. We need to ensure both are checked/closed.
const { getRedisClient: getMemoryRedisClient } = require('./src/services/memoryService');


let ariClientInstance = null;

async function main() {
    logger.info('Application starting...');

    // Initialize/check Memory Redis
    const memoryRedisClient = getMemoryRedisClient(); // Ensure this initializes the client
    if (memoryRedisClient) {
        try {
            await new Promise(resolve => setTimeout(resolve, 500)); // Short delay
            if (memoryRedisClient.status !== 'ready' && memoryRedisClient.status !== 'connect') {
                 logger.warn(`Memory Redis initial status: ${memoryRedisClient.status}. Waiting...`);
                 await new Promise(resolve => setTimeout(resolve, 1500));
            }
            if (memoryRedisClient.status !== 'ready' && memoryRedisClient.status !== 'connect') {
                 logger.error(`Memory Redis not connected (status: ${memoryRedisClient.status}).`);
            } else {
                logger.info(`Memory Redis initial status: ${memoryRedisClient.status}`);
            }
        } catch (e) { logger.error("Error during Memory Redis check:", e); }
    } else {
        logger.error("Memory Redis client failed to initialize.");
    }

    // Prompt service Redis client is initialized internally by promptService.js
    // We can add a check here if promptService exposes its client status, or rely on its internal logging.
    logger.info("Prompt service Redis client initializes internally.");


    ariClientInstance = await ariConnect();
    startWebServer();
}

async function shutdown() {
    logger.info('Shutting down application...');
    if (ariClientInstance) {
        logger.info('Stopping ARI client...');
        try {
            await ariClientInstance.stop();
            logger.info('ARI client stopped.');
        } catch (err) {
            logger.error('Error stopping ARI client:', err);
        }
    }
    await closeMemoryRedis();       // Close memory service Redis
    await closePromptRedisConnection(); // Close prompt service Redis
    logger.info('Application shutdown complete.');
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(error => {
    logger.error("Unhandled error during application startup:", error);
    process.exit(1);
});
