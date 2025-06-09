const express = require('express');
const basicAuth = require('express-basic-auth');
const mainConfig = require('../config'); // Renamed to avoid conflict with route var
const logger = require('../utils/logger');
const promptService = require('../services/promptService');
const toolService = require('../services/toolService');
const systemConfigService = require('../services/systemConfigService'); // Import
const { getRedisClient: getMemoryRedisClient } = require('../services/memoryService');

const app = express();
const PORT = process.env.PORT || 3000;
// (middlewares and auth setup - unchanged)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const users = {}; users[mainConfig.web.username] = mainConfig.web.password;
app.use(basicAuth({ users, challenge: true, unauthorizedResponse: 'Unauthorized access.' }));

// --- Main Page (unchanged) ---
app.get('/', (req, res) => { /* ... */
  res.send(`<h1>AI Control Center</h1><p>Logged in as: ${req.auth.user}</p><ul>
      <li><a href="/prompts">Manage Prompts</a></li><li><a href="/tools">Manage Tools/APIs</a></li>
      <li><a href="/config-view">View & Set System Config</a></li></ul>`);
});

// --- Configuration View & Edit Route ---
app.get('/config-view', async (req, res) => {
  let memoryRedisStatus = 'N/A';
  const memRedisClient = getMemoryRedisClient();
  if (memRedisClient) memoryRedisStatus = memRedisClient.status;

  const defaultAiProviderFromEnv = mainConfig.ai.defaultProvider;
  const defaultAiProviderFromRedis = await systemConfigService.getSystemConfig('defaultAiProvider');
  const currentDefaultProvider = defaultAiProviderFromRedis || defaultAiProviderFromEnv;

  const displayConfig = {
    ari: { url: mainConfig.ari.url, appName: mainConfig.ari.appName, username: mainConfig.ari.username },
    ai: {
      dotEnvDefaultProvider: defaultAiProviderFromEnv,
      effectiveDefaultProvider: currentDefaultProvider,
      geminiApiKeyStatus: mainConfig.ai.geminiApiKey && mainConfig.ai.geminiApiKey !== 'YOUR_GEMINI_API_KEY' && mainConfig.ai.geminiApiKey.length > 10 ? `Loaded` : 'Not Set/Invalid',
      openaiApiKeyStatus: mainConfig.ai.openaiApiKey && mainConfig.ai.openaiApiKey !== 'YOUR_OPENAI_API_KEY' && mainConfig.ai.openaiApiKey.startsWith('sk-') ? `Loaded` : 'Not Set/Invalid',
    },
    redis: { host: mainConfig.redis.host, port: mainConfig.redis.port },
    web: { username: mainConfig.web.username }
  };

  let html = `<h1>System Configuration</h1>
    <form action="/config-view/update" method="POST" style="margin-bottom: 20px;">
      <h2>Set Default AI Provider</h2>
      <p>Current effective default: <strong>${currentDefaultProvider.toUpperCase()}</strong> (Source: ${defaultAiProviderFromRedis ? 'Redis' : '.env file'})</p>
      <select name="defaultAiProvider">
        <option value="openai" ${currentDefaultProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
        <option value="gemini" ${currentDefaultProvider === 'gemini' ? 'selected' : ''}>Gemini</option>
      </select>
      <button type="submit">Save Default Provider</button>
      <p><small>Note: Dialplan can still override this per call. API keys for selected provider must be valid in .env.</small></p>
    </form>
    <hr>
    <h2>Current Settings (Read-Only from .env)</h2>
    <h3>ARI</h3><pre>${JSON.stringify(displayConfig.ari, null, 2)}</pre>
    <h3>AI (.env Fallback & Key Status)</h3><pre>${JSON.stringify(displayConfig.ai, null, 2)}</pre>
    <h3>Redis</h3><pre>${JSON.stringify(displayConfig.redis, null, 2)}</pre>
    <h3>Web Auth</h3><pre>${JSON.stringify(displayConfig.web, null, 2)}</pre>
    <h2>Service Status</h2><p>Memory Service Redis Status: ${memoryRedisStatus}</p>
    <p>(Prompt, Tool, SystemConfig service Redis statuses are logged internally on startup)</p>
    <br><a href="/">Back to Home</a>`;
  res.send(html);
});

app.post('/config-view/update', async (req, res) => {
    const { defaultAiProvider } = req.body;
    if (defaultAiProvider && ['openai', 'gemini'].includes(defaultAiProvider)) {
        await systemConfigService.setSystemConfig('defaultAiProvider', defaultAiProvider);
        logger.info(`Admin updated default AI provider to: ${defaultAiProvider}`);
    }
    res.redirect('/config-view');
});

// --- Prompt Management Routes (condensed, no functional change) ---
app.get('/prompts', async (req, res) => { /* ... */
    const prompts = await promptService.listPrompts();
    let html = '<h1>Prompt Management</h1><a href="/prompts/new">Create New Prompt</a><table border="1">...'; prompts.forEach(p => { html += `<tr><td>${p.name}</td><td>${p.template.substring(0,50)}...</td><td>${(p.allowedTools||[]).join(', ')}</td><td><a href="/prompts/edit/${p.id}">Edit</a> | <form action="/prompts/delete/${p.id}" method="POST" style="display:inline;"><button type="submit" onclick="return confirm('Delete ${p.name}?');">Del</button></form></td></tr>`;}); html += '</table><a href="/">Home</a>'; res.send(html);
});
app.get('/prompts/new', async (req, res) => { /* ... */
    const tools = await toolService.listTools(); let checkboxes = ''; tools.forEach(t => checkboxes += `<label><input type="checkbox" name="allowedTools" value="${t.name}">${t.name}</label><br>`);
    res.send(`<h1>New Prompt</h1><form action="/prompts/create" method="POST"><label>Name:</label><input name="name"><br><label>Template:</label><textarea name="template"></textarea><br>Allowed Tools:<br>${checkboxes}<button>Create</button></form><a href="/prompts">Cancel</a>`);
});
app.post('/prompts/create', async (req, res) => { /* ... */
    let tools = req.body.allowedTools || []; if(typeof tools === 'string') tools = [tools];
    await promptService.createPrompt(req.body.name, req.body.template, tools); res.redirect('/prompts');
});
app.get('/prompts/edit/:id', async (req, res) => { /* ... */
    const p = await promptService.getPrompt(req.params.id); if(!p)return res.sendStatus(404);
    const tools = await toolService.listTools(); const currentTools = new Set(p.allowedTools||[]); let checkboxes = '';
    tools.forEach(t => checkboxes += `<label><input type="checkbox" name="allowedTools" value="${t.name}" ${currentTools.has(t.name)?'checked':''}>${t.name}</label><br>`);
    res.send(`<h1>Edit: ${p.name}</h1><form action="/prompts/update/${p.id}" method="POST"><label>Name:</label><input name="name" value="${p.name}"><br><label>Template:</label><textarea name="template">${p.template}</textarea><br>Allowed Tools:<br>${checkboxes}<button>Update</button></form><a href="/prompts">Cancel</a>`);
});
app.post('/prompts/update/:id', async (req, res) => { /* ... */
    let tools = req.body.allowedTools || []; if(typeof tools === 'string') tools = [tools];
    await promptService.updatePrompt(req.params.id, {name:req.body.name, template:req.body.template, allowedTools:tools }); res.redirect('/prompts');
});
app.post('/prompts/delete/:id', async (req, res) => { /* ... */ await promptService.deletePrompt(req.params.id); res.redirect('/prompts'); });

// --- Tool/API Definition Routes (condensed, no functional change) ---
app.get('/tools', async (req, res) => { /* ... */
    const tools = await toolService.listTools(); let html='<h1>Tools</h1><a href="/tools/new">New Tool</a><table>...'; tools.forEach(t => {html += `<tr><td>${t.name}</td><td>${t.httpMethod}</td><td>${t.endpointUrl.substring(0,30)}...</td><td><a href="/tools/edit/${t.id}">Edit</a> | <form action="/tools/delete/${t.id}" method="POST" style="display:inline;"><button type="submit" onclick="return confirm('Delete ${t.name}?');">Del</button></form></td></tr>`;}); html+='</table><a href="/">Home</a>'; res.send(html);
});
app.get('/tools/new', (req, res) => { /* ... */
    res.send(`<h1>New Tool</h1><form action="/tools/create" method="POST"><label>Name:</label><input name="name"><br><label>Desc:</label><textarea name="description"></textarea><br><label>Method:</label><select name="httpMethod"><option>GET</option><option>POST</option></select><br><label>URL:</label><input name="endpointUrl"><br><label>Params JSON:</label><textarea name="parameters">[]</textarea><br><label>Headers JSON:</label><textarea name="headers">[]</textarea><br><button>Create</button></form><a href="/tools">Cancel</a>`);
});
app.post('/tools/create', async (req, res) => { /* ... */ try {await toolService.createTool(req.body); res.redirect('/tools');} catch(e){res.status(400).send(e.message);} });
app.get('/tools/edit/:id', async (req, res) => { /* ... */
    const t = await toolService.getTool(req.params.id); if(!t)return res.sendStatus(404);
    res.send(`<h1>Edit: ${t.name}</h1><form action="/tools/update/${t.id}" method="POST">...</form><a href="/tools">Cancel</a>`); // Form highly condensed for brevity
});
app.post('/tools/update/:id', async (req, res) => { /* ... */ try {await toolService.updateTool(req.params.id, req.body); res.redirect('/tools');} catch(e){res.status(400).send(e.message);} });
app.post('/tools/delete/:id', async (req, res) => { /* ... */ await toolService.deleteTool(req.params.id); res.redirect('/tools'); });

function startWebServer() { app.listen(PORT, () => logger.info(`Web server on http://localhost:${PORT}`)); return app; }
module.exports = { startWebServer, app };
