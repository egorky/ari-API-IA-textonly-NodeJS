// A simple logger utility
// For a real application, consider using a library like Winston or Pino

const logger = {
  info: (...args) => {
    console.log(\`[INFO] \${new Date().toISOString()}:\`, ...args);
  },
  warn: (...args) => {
    console.warn(\`[WARN] \${new Date().toISOString()}:\`, ...args);
  },
  error: (...args) => {
    console.error(\`[ERROR] \${new Date().toISOString()}:\`, ...args);
  },
  debug: (...args) => {
    // Disable debug logging by default, can be enabled if needed
    // console.log(\`[DEBUG] \${new Date().toISOString()}:\`, ...args);
  }
};

module.exports = logger;
