const IORedis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');

let redisClient;

try {
    redisClient = new IORedis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        connectTimeout: 10000,
    });

    redisClient.on('connect', () => logger.info('ToolService: Connected to Redis.'));
    redisClient.on('error', (err) => logger.error('ToolService: Redis client error:', err));
    redisClient.on('ready', () => logger.info('ToolService: Redis client is ready.'));
    redisClient.on('end', () => logger.warn('ToolService: Redis connection ended.'));

} catch (error) {
    logger.error('ToolService: Failed to initialize Redis client:', error);
    redisClient = null;
}

const TOOL_KEY_PREFIX = 'tool_def:';

/**
 * Validates and sanitizes tool data.
 * @param {object} toolData - The raw tool data from input.
 * @returns {object} The validated and sanitized tool data.
 * @throws {Error} if validation fails.
 */
function validateAndSanitizeToolData(toolData) {
    const { name, description, httpMethod, endpointUrl, parameters, headers } = toolData;
    if (!name || typeof name !== 'string' || name.trim() === '') {
        throw new Error('Tool name is required and must be a non-empty string.');
    }
    if (!description || typeof description !== 'string' || description.trim() === '') {
        throw new Error('Tool description is required and must be a non-empty string.');
    }
    if (!httpMethod || !['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(httpMethod.toUpperCase())) {
        throw new Error('Valid HTTP method (GET, POST, PUT, DELETE, PATCH) is required.');
    }
    if (!endpointUrl || typeof endpointUrl !== 'string' || !endpointUrl.startsWith('http')) {
        throw new Error('Valid endpoint URL (starting with http/https) is required.');
    }

    const sanitizedParams = (parameters && typeof parameters === 'string' ? JSON.parse(parameters) : parameters) || [];
    if (!Array.isArray(sanitizedParams)) {
        throw new Error('Parameters must be a JSON array of objects.');
    }
    for (const param of sanitizedParams) {
        if (!param.name || !param.type || !param.description) {
            throw new Error('Each parameter must have a name, type, and description.');
        }
    }

    const sanitizedHeaders = (headers && typeof headers === 'string' ? JSON.parse(headers) : headers) || [];
    if (!Array.isArray(sanitizedHeaders)) {
        throw new Error('Headers must be a JSON array of objects.');
    }
     for (const header of sanitizedHeaders) {
        if (!header.name || typeof header.value === 'undefined') { // Allow empty string for value
            throw new Error('Each header must have a name and value.');
        }
    }

    return {
        name: name.trim(),
        description: description.trim(),
        httpMethod: httpMethod.toUpperCase(),
        endpointUrl: endpointUrl.trim(),
        parameters: JSON.stringify(sanitizedParams), // Store as JSON string
        headers: JSON.stringify(sanitizedHeaders),   // Store as JSON string
    };
}


/**
 * Creates a new tool definition.
 * @param {object} toolData - Data for the new tool.
 * @returns {Promise<object|null>} The created tool object or null on error.
 */
async function createTool(toolData) {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error('ToolService: Redis not ready, cannot create tool.');
        return null;
    }
    try {
        const validatedData = validateAndSanitizeToolData(toolData);
        const id = uuidv4();
        const toolKey = `${TOOL_KEY_PREFIX}${id}`;
        const dataToSave = {
            id,
            ...validatedData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await redisClient.hmset(toolKey, dataToSave);
        logger.info(`Tool created: ${id} - ${validatedData.name}`);
        // Return with parsed parameters and headers
        return { ...dataToSave, parameters: JSON.parse(dataToSave.parameters), headers: JSON.parse(dataToSave.headers) };
    } catch (error) {
        logger.error('Error creating tool:', error.message);
        throw error; // Re-throw to be caught by route handler for user feedback
    }
}

/**
 * Retrieves a tool definition by its ID.
 * @param {string} id The ID of the tool.
 * @returns {Promise<object|null>} The tool object or null if not found or error.
 */
async function getTool(id) {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error('ToolService: Redis not ready, cannot get tool.');
        return null;
    }
    const toolKey = `${TOOL_KEY_PREFIX}${id}`;
    try {
        const toolData = await redisClient.hgetall(toolKey);
        if (Object.keys(toolData).length === 0) return null;
        toolData.parameters = JSON.parse(toolData.parameters || '[]');
        toolData.headers = JSON.parse(toolData.headers || '[]');
        return toolData;
    } catch (error) {
        logger.error(`Error getting tool ${id}:`, error);
        return null;
    }
}

/**
 * Updates an existing tool definition.
 * @param {string} id The ID of the tool to update.
 * @param {object} updates An object with fields to update.
 * @returns {Promise<object|null>} The updated tool object or null on error.
 */
async function updateTool(id, updates) {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error('ToolService: Redis not ready, cannot update tool.');
        return null;
    }
    const toolKey = `${TOOL_KEY_PREFIX}${id}`;
    try {
        const existingTool = await getTool(id);
        if (!existingTool) return null;

        const validatedUpdates = validateAndSanitizeToolData({ ...existingTool, ...updates, parameters: updates.parameters || existingTool.parameters, headers: updates.headers || existingTool.headers });

        const dataToUpdate = {
            ...validatedUpdates,
            updatedAt: new Date().toISOString(),
        };

        await redisClient.hmset(toolKey, dataToUpdate);
        const updatedTool = await getTool(id);
        logger.info(`Tool updated: ${id}`);
        return updatedTool;
    } catch (error) {
        logger.error(`Error updating tool ${id}:`, error.message);
        throw error; // Re-throw
    }
}

/**
 * Deletes a tool definition by its ID.
 * @param {string} id The ID of the tool.
 * @returns {Promise<boolean>} True if deleted, false otherwise.
 */
async function deleteTool(id) {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error('ToolService: Redis not ready, cannot delete tool.');
        return false;
    }
    const toolKey = `${TOOL_KEY_PREFIX}${id}`;
    try {
        const result = await redisClient.del(toolKey);
        logger.info(`Tool deleted: ${id}, result: ${result}`);
        return result > 0;
    } catch (error) {
        logger.error(`Error deleting tool ${id}:`, error);
        return false;
    }
}

/**
 * Lists all tool definitions.
 * @returns {Promise<Array<object>>} An array of tool objects.
 */
async function listTools() {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error('ToolService: Redis not ready, cannot list tools.');
        return [];
    }
    try {
        const keys = await redisClient.keys(`${TOOL_KEY_PREFIX}*`);
        if (keys.length === 0) return [];

        const tools = [];
        for (const key of keys) {
            const toolData = await redisClient.hgetall(key);
            if (toolData && toolData.id) {
                 toolData.parameters = JSON.parse(toolData.parameters || '[]');
                 toolData.headers = JSON.parse(toolData.headers || '[]');
                 tools.push(toolData);
            }
        }
        logger.info(`Listed ${tools.length} tools.`);
        return tools.sort((a,b) => (a.name > b.name) ? 1 : -1); // Sort by name
    } catch (error) {
        logger.error('Error listing tools:', error);
        return [];
    }
}

async function closeToolRedisConnection() {
    if (redisClient && redisClient.status !== 'end') {
        logger.info('ToolService: Closing Redis connection.');
        try { await redisClient.quit(); } catch (e) { logger.error('ToolService: Error closing Redis:', e); }
    }
}

module.exports = {
    createTool,
    getTool,
    updateTool,
    deleteTool,
    listTools,
    closeToolRedisConnection,
};
