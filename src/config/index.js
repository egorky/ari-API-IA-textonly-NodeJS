require('dotenv').config();

const config = {
  ari: {
    url: process.env.ARI_URL,
    username: process.env.ARI_USERNAME,
    password: process.env.ARI_PASSWORD,
    appName: process.env.ARI_APP_NAME,
  },
  ai: {
    defaultProvider: process.env.DEFAULT_AI_PROVIDER,
    geminiApiKey: process.env.GEMINI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT, 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  web: {
    username: process.env.WEB_USER,
    password: process.env.WEB_PASSWORD,
  }
};

module.exports = config;
