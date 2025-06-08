const express = require('express');
const basicAuth = require('express-basic-auth');
const config = require('../config'); // Import the main config
const logger = require('../utils/logger');
const promptService = require('../services/promptService');
const toolService = require('../services/toolService');

// Import Redis client getters to check status
const { getRedisClient: getMemoryRedisClient } = require('../services/memoryService');
// promptService and toolService initialize their own clients, but don't export getters by default.
// For simplicity, we'll rely on their internal logging for status, or add getters if needed.
// For this step, let's assume we can check the memoryRedisClient as an example.

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const users = {};
users[config.web.username] = config.web.password;

app.use(basicAuth({
  users,
  challenge: true,
  unauthorizedResponse: 'Unauthorized access.'
}));

// --- Main Page ---
app.get('/', (req, res) => {
  res.send(`
    <h1>Welcome to the AI Control Center</h1>
    <p>You are logged in as: ${req.auth.user}</p>
    <p>Manage your AI system components:</p>
    <ul>
      <li><a href="/prompts">Manage Prompts</a></li>
      <li><a href="/tools">Manage Tools/APIs</a></li>
      <li><a href="/config-view">View Configuration</a></li>
    </ul>
  `);
});

// --- Configuration View Route ---
app.get('/config-view', async (req, res) => {
  let memoryRedisStatus = 'N/A';
  const memRedisClient = getMemoryRedisClient(); // This should return the initialized client
  if (memRedisClient) {
    memoryRedisStatus = memRedisClient.status;
  }
  // Note: To get status for promptService and toolService Redis, they'd need to expose their clients
  // or a status function. For now, we just show memory Redis.

  // Sanitize config for display (e.g., hide full API keys)
  const displayConfig = {
    ari: {
      url: config.ari.url,
      appName: config.ari.appName,
      username: config.ari.username,
    },
    ai: {
      defaultProvider: config.ai.defaultProvider,
      geminiApiKey: config.ai.geminiApiKey ? `Loaded (ends with ...${config.ai.geminiApiKey.slice(-4)})` : 'Not Set',
      openaiApiKey: config.ai.openaiApiKey ? `Loaded (ends with ...${config.ai.openaiApiKey.slice(-4)})` : 'Not Set',
    },
    redis: {
      host: config.redis.host,
      port: config.redis.port,
    },
    web: {
      username: config.web.username, // Username is fine to show
    }
  };

  let html = `
    <h1>System Configuration (Read-Only)</h1>
    <h2>ARI Configuration</h2>
    <pre>${JSON.stringify(displayConfig.ari, null, 2)}</pre>
    <h2>AI Configuration</h2>
    <pre>${JSON.stringify(displayConfig.ai, null, 2)}</pre>
    <h2>Redis Configuration</h2>
    <pre>${JSON.stringify(displayConfig.redis, null, 2)}</pre>
    <h2>Web Configuration</h2>
    <pre>${JSON.stringify(displayConfig.web, null, 2)}</pre>

    <h2>Service Status</h2>
    <p>Memory Service Redis Status: ${memoryRedisStatus}</p>
    <p>Prompt Service Redis Status: (See server logs for connection status)</p>
    <p>Tool Service Redis Status: (See server logs for connection status)</p>

    <br><a href="/">Back to Home</a>
  `;
  res.send(html);
});


// --- Prompt Management Routes (condensed) ---
app.get('/prompts', async (req, res) => {
    const prompts = await promptService.listPrompts();
    let html = '<h1>Prompt Management</h1><a href="/prompts/new">Create New Prompt</a><table border="1" style="width:100%; margin-top:20px;"><thead><tr><th>ID</th><th>Name</th><th>Template (excerpt)</th><th>Allowed Tools</th><th>Actions</th></tr></thead><tbody>';
    prompts.forEach(p => {
      html += `<tr><td>${p.id}</td><td>${p.name}</td><td>${p.template.substring(0,100)}...</td><td>${JSON.stringify(p.allowedTools)}</td>
      <td><a href="/prompts/edit/${p.id}">Edit</a> | <form action="/prompts/delete/${p.id}" method="POST" style="display:inline;"><button type="submit" onclick="return confirm('Delete ${p.name}?');">Delete</button></form></td></tr>`;
    });
    html += '</tbody></table><br><a href="/">Back to Home</a>';
    res.send(html);
});
app.get('/prompts/new', (req, res) => {
    res.send(`<h1>Create New Prompt</h1><form action="/prompts/create" method="POST">
      <div><label>Name:</label><input type="text" name="name" required></div>
      <div><label>Template:</label><textarea name="template" rows="10" cols="80" required></textarea></div>
      <div><label>Allowed Tools (JSON array, e.g., ["toolName"]):</label><input type="text" name="allowedTools" value="[]"></div>
      <button type="submit">Create</button></form><br><a href="/prompts">Cancel</a>`);
});
app.post('/prompts/create', async (req, res) => {
    try {
        const { name, template } = req.body;
        let allowedTools = [];
        if (req.body.allowedTools) try { allowedTools = JSON.parse(req.body.allowedTools); if (!Array.isArray(allowedTools)) throw new Error();} catch { return res.status(400).send("Invalid JSON for Allowed Tools.");}
        await promptService.createPrompt(name, template, allowedTools);
        res.redirect('/prompts');
    } catch (e) { res.status(500).send("Error: " + e.message); }
});
app.get('/prompts/edit/:id', async (req, res) => {
    const p = await promptService.getPrompt(req.params.id);
    if (!p) return res.status(404).send('Not found');
    res.send(`<h1>Edit Prompt: ${p.name}</h1><form action="/prompts/update/${p.id}" method="POST">
      <div><label>Name:</label><input type="text" name="name" value="${p.name}" required></div>
      <div><label>Template:</label><textarea name="template" rows="10" cols="80" required>${p.template}</textarea></div>
      <div><label>Allowed Tools (JSON array):</label><input type="text" name="allowedTools" value='${JSON.stringify(p.allowedTools || [])}'></div>
      <button type="submit">Update</button></form><br><a href="/prompts">Cancel</a>`);
});
app.post('/prompts/update/:id', async (req, res) => {
    try {
        const { name, template } = req.body;
        let allowedTools = undefined;
        if (req.body.allowedTools) try { allowedTools = JSON.parse(req.body.allowedTools); if (!Array.isArray(allowedTools)) throw new Error();} catch { return res.status(400).send("Invalid JSON for Allowed Tools.");}
        const updates = { name, template };
        if (allowedTools !== undefined) updates.allowedTools = allowedTools;
        await promptService.updatePrompt(req.params.id, updates);
        res.redirect('/prompts');
    } catch (e) { res.status(500).send("Error: " + e.message); }
});
app.post('/prompts/delete/:id', async (req, res) => {
    await promptService.deletePrompt(req.params.id); res.redirect('/prompts');
});

// --- Tool/API Definition Routes (condensed) ---
app.get('/tools', async (req, res) => {
    const tools = await toolService.listTools();
    let html = '<h1>Tool/API Definition Management</h1><a href="/tools/new">Define New Tool</a><table border="1" style="width:100%; margin-top:20px;"><thead><tr><th>ID</th><th>Name</th><th>Description (excerpt)</th><th>Method</th><th>Endpoint</th><th>Actions</th></tr></thead><tbody>';
    tools.forEach(t => {
      html += `<tr><td>${t.id}</td><td>${t.name}</td><td>${t.description.substring(0,100)}...</td><td>${t.httpMethod}</td><td>${t.endpointUrl}</td>
      <td><a href="/tools/edit/${t.id}">Edit</a> | <form action="/tools/delete/${t.id}" method="POST" style="display:inline;"><button type="submit" onclick="return confirm('Delete ${t.name}?');">Delete</button></form></td></tr>`;
    });
    html += '</tbody></table><br><a href="/">Back to Home</a>';
    res.send(html);
});
app.get('/tools/new', (req, res) => {
  res.send(`<h1>Define New Tool/API</h1><form action="/tools/create" method="POST">
    <div><label>Tool Name (for AI):</label><input type="text" name="name" required></div>
    <div><label>Description (for AI):</label><textarea name="description" rows="3" cols="80" required></textarea></div>
    <div><label>HTTP Method:</label><select name="httpMethod"><option value="GET">GET</option><option value="POST">POST</option><option value="PUT">PUT</option><option value="DELETE">DELETE</option><option value="PATCH">PATCH</option></select></div>
    <div><label>Endpoint URL:</label><input type="text" name="endpointUrl" required></div>
    <div><label>Parameters (JSON array):</label><textarea name="parameters" rows="5" cols="80">[]</textarea></div>
    <div><label>Static Headers (JSON array):</label><textarea name="headers" rows="3" cols="80">[]</textarea></div>
    <button type="submit">Create Tool</button></form><br><a href="/tools">Cancel</a>`);
});
app.post('/tools/create', async (req, res) => {
  try { await toolService.createTool(req.body); res.redirect('/tools'); }
  catch (error) { res.status(400).send("Error: " + error.message + '<br><a href="/tools/new">Try again</a>'); }
});
app.get('/tools/edit/:id', async (req, res) => {
    const tool = await toolService.getTool(req.params.id);
    if (!tool) return res.status(404).send('Not found');
    res.send(`<h1>Edit Tool: ${tool.name}</h1><form action="/tools/update/${tool.id}" method="POST">
      <div><label>Tool Name:</label><input type="text" name="name" value="${tool.name}" required></div>
      <div><label>Description:</label><textarea name="description" rows="3" cols="80" required>${tool.description}</textarea></div>
      <div><label>HTTP Method:</label><select name="httpMethod" value="${tool.httpMethod}">
      <option value="GET" ${tool.httpMethod === 'GET' ? 'selected':''}>GET</option><option value="POST" ${tool.httpMethod === 'POST' ? 'selected':''}>POST</option>
      <option value="PUT" ${tool.httpMethod === 'PUT' ? 'selected':''}>PUT</option><option value="DELETE" ${tool.httpMethod === 'DELETE' ? 'selected':''}>DELETE</option>
      <option value="PATCH" ${tool.httpMethod === 'PATCH' ? 'selected':''}>PATCH</option></select></div>
      <div><label>Endpoint URL:</label><input type="text" name="endpointUrl" value="${tool.endpointUrl}" required></div>
      <div><label>Parameters (JSON array):</label><textarea name="parameters" rows="5" cols="80">${JSON.stringify(tool.parameters || [])}</textarea></div>
      <div><label>Static Headers (JSON array):</label><textarea name="headers" rows="3" cols="80">${JSON.stringify(tool.headers || [])}</textarea></div>
      <button type="submit">Update</button></form><br><a href="/tools">Cancel</a>`);
});
app.post('/tools/update/:id', async (req, res) => {
  try { await toolService.updateTool(req.params.id, req.body); res.redirect('/tools'); }
  catch (error) { res.status(400).send(`Error: ${error.message}<br><a href="/tools/edit/${req.params.id}">Try again</a>`); }
});
app.post('/tools/delete/:id', async (req, res) => {
    await toolService.deleteTool(req.params.id); res.redirect('/tools');
});

// --- Server Start ---
function startWebServer() {
  app.listen(PORT, () => {
    logger.info(`Web server started on http://localhost:${PORT}`);
  });
  return app;
}

module.exports = { startWebServer, app };
