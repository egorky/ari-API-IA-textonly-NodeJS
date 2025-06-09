const IORedis = require('ioredis');
const config = require('../config'); // For initial Redis connection config
const logger = require('../utils/logger');

let redisClient;
const SYSTEM_CONFIG_KEY = 'system_config:main';

try {
    redisClient = new IORedis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        connectTimeout: 10000,
    });

    redisClient.on('connect', () => logger.info('SystemConfigService: Connected to Redis.'));
    redisClient.on('error', (err) => logger.error('SystemConfigService: Redis client error:', err));
    redisClient.on('ready', () => logger.info('SystemConfigService: Redis client is ready.'));
    redisClient.on('end', () => logger.warn('SystemConfigService: Redis connection ended.'));

} catch (error) {
    logger.error('SystemConfigService: Failed to initialize Redis client:', error);
    redisClient = null;
}

/**
 * Sets a system configuration value.
 * @param {string} key The configuration key (e.g., 'defaultAiProvider').
 * @param {string} value The value to set.
 * @returns {Promise<boolean>} True on success, false on error.
 */
async function setSystemConfig(key, value) {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error('SystemConfigService: Redis not ready, cannot set config.');
        return false;
    }
    try {
        await redisClient.hset(SYSTEM_CONFIG_KEY, key, value);
        logger.info(`System config updated: ${key} = ${value}`);
        return true;
    } catch (error) {
        logger.error(`Error setting system config ${key}:`, error);
        return false;
    }
}

/**
 * Gets a system configuration value.
 * @param {string} key The configuration key.
 * @returns {Promise<string|null>} The value, or null if not found or error.
 */
async function getSystemConfig(key) {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.error('SystemConfigService: Redis not ready, cannot get config.');
        return null;
    }
    try {
        return await redisClient.hget(SYSTEM_CONFIG_KEY, key);
    } catch (error) {
        logger.error(`Error getting system config ${key}:`, error);
        return null;
    }
}

async function closeSystemConfigRedisConnection() {
    if (redisClient && redisClient.status !== 'end') {
        logger.info('SystemConfigService: Closing Redis connection.');
        try { await redisClient.quit(); } catch (e) { logger.error('SystemConfigService: Error closing Redis:', e); }
    }
}

module.exports = {
    setSystemConfig,
    getSystemConfig,
    closeSystemConfigRedisConnection,
};
