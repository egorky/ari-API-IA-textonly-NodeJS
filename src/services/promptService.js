const IORedis = require('ioredis');
const { v4: uuidv4 } = require('uuid'); // For generating unique prompt IDs
const config = require('../config');
const logger = require('../utils/logger');

let redisClient;

// Initialize Redis Client (similar to memoryService, but could be a shared client)
// For now, let's assume memoryService's client is the one to use or create a dedicated one.
// To keep it simple, we'll use the config directly here.
try {
    redisClient = new IORedis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        connectTimeout: 10000,
    });

    redisClient.on('connect', () => logger.info('PromptService: Connected to Redis.'));
    redisClient.on('error', (err) => logger.error('PromptService: Redis client error:', err));
    redisClient.on('ready', () => logger.info('PromptService: Redis client is ready.'));
    redisClient.on('end', () => logger.warn('PromptService: Redis connection ended.'));

} catch (error) {
    logger.error('PromptService: Failed to initialize Redis client:', error);
    redisClient = null;
}

const PROMPT_KEY_PREFIX = 'prompt:';

/**
 * Creates a new prompt.
 * @param {string} name A user-friendly name for the prompt.
 * @param {string} template The prompt template string.
 * @param {Array<string>} [allowedTools=[]] List of tool names allowed for this prompt.
 * @returns {Promise<object|null>} The created prompt object { id, name, template, allowedTools } or null on error.
 */
async function createPrompt(name, template, allowedTools = []) {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error('PromptService: Redis not ready, cannot create prompt.');
        return null;
    }
    const id = uuidv4();
    const promptKey = `${PROMPT_KEY_PREFIX}${id}`;
    const promptData = {
        id,
        name,
        template,
        allowedTools: JSON.stringify(allowedTools), // Store array as JSON string
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    try {
        await redisClient.hmset(promptKey, promptData);
        logger.info(`Prompt created: ${id} - ${name}`);
        return { ...promptData, allowedTools }; // Return with parsed allowedTools
    } catch (error) {
        logger.error(`Error creating prompt ${name}:`, error);
        return null;
    }
}

/**
 * Retrieves a prompt by its ID.
 * @param {string} id The ID of the prompt.
 * @returns {Promise<object|null>} The prompt object or null if not found or error.
 */
async function getPrompt(id) {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error('PromptService: Redis not ready, cannot get prompt.');
        return null;
    }
    const promptKey = `${PROMPT_KEY_PREFIX}${id}`;
    try {
        const promptData = await redisClient.hgetall(promptKey);
        if (Object.keys(promptData).length === 0) {
            return null; // Not found
        }
        promptData.allowedTools = JSON.parse(promptData.allowedTools || '[]');
        return promptData;
    } catch (error) {
        logger.error(`Error getting prompt ${id}:`, error);
        return null;
    }
}

/**
 * Updates an existing prompt.
 * @param {string} id The ID of the prompt to update.
 * @param {object} updates An object with fields to update (e.g., { name, template, allowedTools }).
 * @returns {Promise<object|null>} The updated prompt object or null on error.
 */
async function updatePrompt(id, updates) {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error('PromptService: Redis not ready, cannot update prompt.');
        return null;
    }
    const promptKey = `${PROMPT_KEY_PREFIX}${id}`;
    try {
        const existingPrompt = await getPrompt(id);
        if (!existingPrompt) return null; // Not found

        const dataToUpdate = { ...updates };
        if (updates.allowedTools) {
            dataToUpdate.allowedTools = JSON.stringify(updates.allowedTools);
        }
        dataToUpdate.updatedAt = new Date().toISOString();

        await redisClient.hmset(promptKey, dataToUpdate);
        const updatedPrompt = await getPrompt(id); // Fetch again to get consolidated view
        logger.info(`Prompt updated: ${id}`);
        return updatedPrompt;
    } catch (error) {
        logger.error(`Error updating prompt ${id}:`, error);
        return null;
    }
}

/**
 * Deletes a prompt by its ID.
 * @param {string} id The ID of the prompt.
 * @returns {Promise<boolean>} True if deleted, false otherwise.
 */
async function deletePrompt(id) {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error('PromptService: Redis not ready, cannot delete prompt.');
        return false;
    }
    const promptKey = `${PROMPT_KEY_PREFIX}${id}`;
    try {
        const result = await redisClient.del(promptKey);
        logger.info(`Prompt deleted: ${id}, result: ${result}`);
        return result > 0;
    } catch (error) {
        logger.error(`Error deleting prompt ${id}:`, error);
        return false;
    }
}

/**
 * Lists all prompts.
 * @returns {Promise<Array<object>>} An array of prompt objects.
 */
async function listPrompts() {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error('PromptService: Redis not ready, cannot list prompts.');
        return [];
    }
    try {
        const keys = await redisClient.keys(`${PROMPT_KEY_PREFIX}*`);
        if (keys.length === 0) return [];

        const prompts = [];
        for (const key of keys) {
            const promptData = await redisClient.hgetall(key);
            if (promptData && promptData.id) { // Basic check
                 promptData.allowedTools = JSON.parse(promptData.allowedTools || '[]');
                 prompts.push(promptData);
            }
        }
        logger.info(`Listed ${prompts.length} prompts.`);
        return prompts.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)); // Sort by newest first
    } catch (error) {
        logger.error('Error listing prompts:', error);
        return [];
    }
}

// Graceful shutdown for this Redis client instance if it's different
async function closePromptRedisConnection() {
    if (redisClient && redisClient.status !== 'end') {
        logger.info('PromptService: Closing Redis connection.');
        try {
            await redisClient.quit();
        } catch (error) {
            logger.error('PromptService: Error closing Redis connection:', error);
        }
    }
}

module.exports = {
    createPrompt,
    getPrompt,
    updatePrompt,
    deletePrompt,
    listPrompts,
    closePromptRedisConnection, // Export if app.js needs to call it
};
