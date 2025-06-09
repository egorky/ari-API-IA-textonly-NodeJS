const express = require('express');
const basicAuth = require('express-basic-auth');
const mainConfig = require('../config');
const logger = require('../utils/logger');
const promptService = require('../services/promptService');
const toolService = require('../services/toolService');
const systemConfigService = require('../services/systemConfigService');
const { getRedisClient: getMemoryRedisClient } = require('../services/memoryService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const users = {}; users[mainConfig.web.username] = mainConfig.web.password;
app.use(basicAuth({ users, challenge: true, unauthorizedResponse: 'Unauthorized access.' }));

// --- Main Page ---
app.get('/', (req, res) => {
  res.send(`
    <h1>AI Control Center</h1><p>Logged in as: ${req.auth.user}</p>
    <ul>
      <li><a href="/prompts">Manage Prompts</a></li>
      <li><a href="/tools">Manage Tools/APIs</a></li>
      <li><a href="/config-view">View & Set System Config</a></li>
    </ul>
  `);
});

// --- Configuration View & Edit Route (condensed for brevity, no changes here) ---
app.get('/config-view', async (req, res) => { /* ... existing code ... */
    let memoryRedisStatus = 'N/A'; const memRedisClient = getMemoryRedisClient(); if (memRedisClient) memoryRedisStatus = memRedisClient.status;
    const defaultAiProviderFromEnv = mainConfig.ai.defaultProvider;
    const defaultAiProviderFromRedis = await systemConfigService.getSystemConfig('defaultAiProvider');
    const currentDefaultProvider = defaultAiProviderFromRedis || defaultAiProviderFromEnv;
    const displayConfig = {
        ari: { url: mainConfig.ari.url, appName: mainConfig.ari.appName, username: mainConfig.ari.username },
        ai: { dotEnvDefaultProvider: defaultAiProviderFromEnv, effectiveDefaultProvider: currentDefaultProvider,
              geminiApiKeyStatus: mainConfig.ai.geminiApiKey && mainConfig.ai.geminiApiKey !== 'YOUR_GEMINI_API_KEY' && mainConfig.ai.geminiApiKey.length > 10 ? `Loaded` : 'Not Set/Invalid',
              openaiApiKeyStatus: mainConfig.ai.openaiApiKey && mainConfig.ai.openaiApiKey !== 'YOUR_OPENAI_API_KEY' && mainConfig.ai.openaiApiKey.startsWith('sk-') ? `Loaded` : 'Not Set/Invalid',
        },
        redis: { host: mainConfig.redis.host, port: mainConfig.redis.port }, web: { username: mainConfig.web.username }
    };
    let html = `<h1>System Configuration</h1> <form action="/config-view/update" method="POST" style="margin-bottom: 20px;"> <h2>Set Default AI Provider</h2> <p>Current effective default: <strong>${currentDefaultProvider.toUpperCase()}</strong> (Source: ${defaultAiProviderFromRedis ? 'Redis' : '.env file'})</p> <select name="defaultAiProvider"> <option value="openai" ${currentDefaultProvider === 'openai' ? 'selected' : ''}>OpenAI</option> <option value="gemini" ${currentDefaultProvider === 'gemini' ? 'selected' : ''}>Gemini</option> </select> <button type="submit">Save Default Provider</button> <p><small>Note: Dialplan can still override this per call. API keys for selected provider must be valid in .env.</small></p> </form> <hr> <h2>Current Settings (Read-Only from .env)</h2> <h3>ARI</h3><pre>${JSON.stringify(displayConfig.ari, null, 2)}</pre> <h3>AI (.env Fallback & Key Status)</h3><pre>${JSON.stringify(displayConfig.ai, null, 2)}</pre> <h3>Redis</h3><pre>${JSON.stringify(displayConfig.redis, null, 2)}</pre> <h3>Web Auth</h3><pre>${JSON.stringify(displayConfig.web, null, 2)}</pre> <h2>Service Status</h2><p>Memory Service Redis Status: ${memoryRedisStatus}</p> <p>(Prompt, Tool, SystemConfig service Redis statuses are logged internally on startup)</p> <br><a href="/">Back to Home</a>`;
    res.send(html);
});
app.post('/config-view/update', async (req, res) => { /* ... existing code ... */
    const { defaultAiProvider } = req.body;
    if (defaultAiProvider && ['openai', 'gemini'].includes(defaultAiProvider)) {
        await systemConfigService.setSystemConfig('defaultAiProvider', defaultAiProvider);
    }
    res.redirect('/config-view');
});

// --- Prompt Management Routes (condensed for brevity, no changes here) ---
app.get('/prompts', async (req, res) => { /* ... existing code ... */
    const prompts = await promptService.listPrompts();
    let html = '<h1>Prompt Management</h1><a href="/prompts/new">Create New Prompt</a><table border="1" style="width:100%; margin-top:20px; border-collapse: collapse;"><thead><tr><th>Name</th><th>Template (excerpt)</th><th>Allowed Tools</th><th>Actions</th></tr></thead><tbody>';
    prompts.forEach(p => { html += `<tr><td style="padding: 5px;">${p.name}</td><td style="padding: 5px;">${p.template.substring(0,100)}...</td><td style="padding: 5px;">${(p.allowedTools && p.allowedTools.length > 0 ? p.allowedTools.join(', ') : 'None')}</td><td style="padding: 5px;"><a href="/prompts/edit/${p.id}">Edit</a> | <form action="/prompts/delete/${p.id}" method="POST" style="display:inline;"><button type="submit" onclick="return confirm('Delete prompt \'${p.name.replace(/'/g, "\\'")}\'?');">Delete</button></form></td></tr>`; });
    html += '</tbody></table><br><a href="/">Back to Home</a>'; res.send(html);
});
app.get('/prompts/new', async (req, res) => { /* ... existing code ... */
    const allTools = await toolService.listTools(); let toolCheckboxes = '<h4>Allowed Tools:</h4>';
    if (allTools.length > 0) { allTools.forEach(tool => { toolCheckboxes += `<label style="display: block;"><input type="checkbox" name="allowedTools" value="${tool.name}"> ${tool.name} (${tool.description.substring(0,50)}...)</label>`; });
    } else { toolCheckboxes += '<p>No tools defined yet. Define tools first to allow them here.</p>'; }
    res.send(`<h1>Create New Prompt</h1> <form action="/prompts/create" method="POST"> <div style="margin-bottom: 10px;"><label for="name" style="display: block;">Name:</label><input type="text" id="name" name="name" required style="width: 50%;"></div> <div style="margin-bottom: 10px;"><label for="template" style="display: block;">Template:</label><textarea id="template" name="template" rows="15" style="width: 80%;" required></textarea></div> <div style="margin-bottom: 10px;">${toolCheckboxes}</div> <button type="submit">Create Prompt</button> </form> <br><a href="/prompts">Cancel</a>`);
});
app.post('/prompts/create', async (req, res) => { /* ... existing code ... */
    const { name, template } = req.body; let allowedToolsArray = req.body.allowedTools || []; if (typeof allowedToolsArray === 'string') allowedToolsArray = [allowedToolsArray];
    await promptService.createPrompt(name, template, allowedToolsArray); res.redirect('/prompts');
});
app.get('/prompts/edit/:id', async (req, res) => { /* ... existing code ... */
    const prompt = await promptService.getPrompt(req.params.id); if (!prompt) return res.status(404).send('Prompt not found.');
    const allTools = await toolService.listTools(); const currentAllowedTools = new Set(prompt.allowedTools || []); let toolCheckboxes = '<h4>Allowed Tools:</h4>';
    if (allTools.length > 0) { allTools.forEach(tool => { const checked = currentAllowedTools.has(tool.name) ? 'checked' : ''; toolCheckboxes += `<label style="display: block;"><input type="checkbox" name="allowedTools" value="${tool.name}" ${checked}> ${tool.name} (${tool.description.substring(0,50)}...)</label>`; });
    } else { toolCheckboxes += '<p>No tools defined yet.</p>'; }
    res.send(`<h1>Edit Prompt: ${prompt.name}</h1> <form action="/prompts/update/${prompt.id}" method="POST"> <div style="margin-bottom: 10px;"><label for="name" style="display: block;">Name:</label><input type="text" id="name" name="name" value="${prompt.name}" required style="width: 50%;"></div> <div style="margin-bottom: 10px;"><label for="template" style="display: block;">Template:</label><textarea id="template" name="template" rows="15" style="width: 80%;" required>${prompt.template}</textarea></div> <div style="margin-bottom: 10px;">${toolCheckboxes}</div> <button type="submit">Update Prompt</button> </form> <br><a href="/prompts">Cancel</a>`);
});
app.post('/prompts/update/:id', async (req, res) => { /* ... existing code ... */
    const { name, template } = req.body; let allowedToolsArray = req.body.allowedTools || []; if (typeof allowedToolsArray === 'string') allowedToolsArray = [allowedToolsArray];
    await promptService.updatePrompt(req.params.id, { name, template, allowedTools: allowedToolsArray }); res.redirect('/prompts');
});
app.post('/prompts/delete/:id', async (req, res) => { /* ... existing code ... */ await promptService.deletePrompt(req.params.id); res.redirect('/prompts'); });


// --- Tool/API Definition Routes ---
app.get('/tools', async (req, res) => { /* ... existing code ... */
    const tools = await toolService.listTools();
    let html = '<h1>Tool/API Definition Management</h1><a href="/tools/new">Define New Tool</a><table border="1" style="width:100%; margin-top:20px; border-collapse: collapse;"><thead><tr><th>Name</th><th>Method</th><th>Endpoint</th><th>Description (excerpt)</th><th>Actions</th></tr></thead><tbody>';
    tools.forEach(t => { html += `<tr><td style="padding: 5px;">${t.name}</td><td style="padding: 5px;">${t.httpMethod}</td><td style="padding: 5px;">${t.endpointUrl}</td><td style="padding: 5px;">${t.description.substring(0,100)}...</td><td style="padding: 5px;"><a href="/tools/edit/${t.id}">Edit</a> | <form action="/tools/delete/${t.id}" method="POST" style="display:inline;"><button type="submit" onclick="return confirm('Delete tool \'${t.name.replace(/'/g, "\\'")}\'?');">Delete</button></form></td></tr>`; });
    html += '</tbody></table><br><a href="/">Back to Home</a>'; res.send(html);
});
app.get('/tools/new', (req, res) => { /* ... existing code ... */
  res.send(`<h1>Define New Tool/API</h1> <form action="/tools/create" method="POST"> <div style="margin-bottom: 10px;"><label for="name" style="display: block;">Tool Name (for AI):</label><input type="text" id="name" name="name" required style="width: 50%;"></div> <div style="margin-bottom: 10px;"><label for="description" style="display: block;">Description (for AI, crucial for agent's decision making):</label><textarea id="description" name="description" rows="4" style="width: 80%;" required></textarea></div> <div style="margin-bottom: 10px;"><label for="httpMethod" style="display: block;">HTTP Method:</label> <select id="httpMethod" name="httpMethod"> <option value="GET">GET</option><option value="POST">POST</option><option value="PUT">PUT</option><option value="DELETE">DELETE</option><option value="PATCH">PATCH</option> </select> </div> <div style="margin-bottom: 10px;"><label for="endpointUrl" style="display: block;">Endpoint URL:</label><input type="text" id="endpointUrl" name="endpointUrl" required style="width: 80%;"></div> <div style="margin-bottom: 10px;"><label for="parameters" style="display: block;">Parameters (JSON array of objects: [{"name":"param1","type":"string","description":"desc1","required":true}]):</label> <textarea id="parameters" name="parameters" rows="6" style="width: 80%;">[]</textarea></div> <div style="margin-bottom: 10px;"><label for="headers" style="display: block;">Static Headers (JSON array of objects: [{"name":"X-API-Key","value":"YOUR_KEY"}]):</label> <textarea id="headers" name="headers" rows="4" style="width: 80%;">[]</textarea></div> <p><small>Security Note: API keys in headers are stored as entered. Manage sensitive keys carefully.</small></p> <button type="submit">Create Tool</button> </form> <br><a href="/tools">Cancel</a>`);
});
app.post('/tools/create', async (req, res) => { /* ... existing code ... */ try {await toolService.createTool(req.body); res.redirect('/tools');} catch (error) { res.status(400).send("Error creating tool: " + error.message + '<br><a href="/tools/new">Try again</a>'); }});

// CORRECTED /tools/edit/:id route
app.get('/tools/edit/:id', async (req, res) => {
  try {
    const tool = await toolService.getTool(req.params.id);
    if (!tool) return res.status(404).send('Tool not found.');

    // Safely stringify parameters and headers, ensuring they are arrays
    const parametersJsonString = JSON.stringify(Array.isArray(tool.parameters) ? tool.parameters : []);
    const headersJsonString = JSON.stringify(Array.isArray(tool.headers) ? tool.headers : []);

    res.send(`
      <h1>Edit Tool: ${tool.name}</h1>
      <form action="/tools/update/${tool.id}" method="POST">
        <div style="margin-bottom: 10px;">
          <label for="name" style="display: block;">Tool Name:</label>
          <input type="text" id="name" name="name" value="${tool.name}" required style="width: 50%;">
        </div>
        <div style="margin-bottom: 10px;">
          <label for="description" style="display: block;">Description:</label>
          <textarea id="description" name="description" rows="4" style="width: 80%;" required>${tool.description}</textarea>
        </div>
        <div style="margin-bottom: 10px;">
          <label for="httpMethod" style="display: block;">HTTP Method:</label>
          <select id="httpMethod" name="httpMethod">
            <option value="GET" ${tool.httpMethod === 'GET' ? 'selected':''}>GET</option>
            <option value="POST" ${tool.httpMethod === 'POST' ? 'selected':''}>POST</option>
            <option value="PUT" ${tool.httpMethod === 'PUT' ? 'selected':''}>PUT</option>
            <option value="DELETE" ${tool.httpMethod === 'DELETE' ? 'selected':''}>DELETE</option>
            <option value="PATCH" ${tool.httpMethod === 'PATCH' ? 'selected':''}>PATCH</option>
          </select>
        </div>
        <div style="margin-bottom: 10px;">
          <label for="endpointUrl" style="display: block;">Endpoint URL:</label>
          <input type="text" id="endpointUrl" name="endpointUrl" value="${tool.endpointUrl}" required style="width: 80%;">
        </div>
        <div style="margin-bottom: 10px;">
          <label for="parameters" style="display: block;">Parameters (JSON array):</label>
          <textarea id="parameters" name="parameters" rows="6" style="width: 80%;">${parametersJsonString}</textarea>
        </div>
        <div style="margin-bottom: 10px;">
          <label for="headers" style="display: block;">Static Headers (JSON array):</label>
          <textarea id="headers" name="headers" rows="4" style="width: 80%;">${headersJsonString}</textarea>
        </div>
        <p><small>Security Note: API keys in headers are stored as entered. Manage sensitive keys carefully.</small></p>
        <button type="submit">Update Tool</button>
      </form>
      <br><a href="/tools">Cancel</a>
    `);
  } catch (error) {
    logger.error("Error loading edit tool form:", error);
    res.status(500).send("Error loading tool for editing: " + error.message);
  }
});

app.post('/tools/update/:id', async (req, res) => { /* ... existing code ... */ try {await toolService.updateTool(req.params.id, req.body); res.redirect('/tools');} catch (error) { res.status(400).send("Error updating tool: " + error.message + `<br><a href="/tools/edit/${req.params.id}">Try again</a>`); }});
app.post('/tools/delete/:id', async (req, res) => { /* ... existing code ... */ await toolService.deleteTool(req.params.id); res.redirect('/tools');});

// --- Server Start ---
function startWebServer() { app.listen(PORT, () => logger.info(`Web server on http://localhost:${PORT}`)); return app; }
module.exports = { startWebServer, app };
