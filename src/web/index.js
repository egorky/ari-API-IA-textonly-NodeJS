const express = require('express');
const basicAuth = require('express-basic-auth');
const config = require('../config');
const logger = require('../utils/logger');
const promptService = require('../services/promptService'); // Import prompt service

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
      <li><a href="/tools">Manage Tools/APIs (Not Implemented)</a></li>
    </ul>
  `);
});

// --- Prompt Management Routes ---

// List Prompts
app.get('/prompts', async (req, res) => {
  try {
    const prompts = await promptService.listPrompts();
    let html = `
      <h1>Prompt Management</h1>
      <a href="/prompts/new">Create New Prompt</a>
      <table border="1" style="width:100%; margin-top:20px;">
        <thead><tr><th>ID</th><th>Name</th><th>Template (excerpt)</th><th>Allowed Tools</th><th>Actions</th></tr></thead>
        <tbody>`;
    prompts.forEach(p => {
      html += `<tr>
                  <td>${p.id}</td>
                  <td>${p.name}</td>
                  <td>${p.template.substring(0, 100)}...</td>
                  <td>${p.allowedTools ? JSON.stringify(p.allowedTools) : '[]'}</td>
                  <td>
                    <a href="/prompts/edit/${p.id}">Edit</a> |
                    <form action="/prompts/delete/${p.id}" method="POST" style="display:inline;">
                        <button type="submit" onclick="return confirm('Are you sure you want to delete this prompt?');">Delete</button>
                    </form>
                  </td>
                </tr>`;
    });
    html += `</tbody></table><br><a href="/">Back to Home</a>`;
    res.send(html);
  } catch (error) {
    logger.error("Error listing prompts page:", error);
    res.status(500).send("Error loading prompts.");
  }
});

// Form for New Prompt
app.get('/prompts/new', (req, res) => {
  res.send(`
    <h1>Create New Prompt</h1>
    <form action="/prompts/create" method="POST">
      <div><label for="name">Name:</label><input type="text" id="name" name="name" required></div>
      <div><label for="template">Template:</label><textarea id="template" name="template" rows="10" cols="80" required></textarea></div>
      <div><label for="allowedTools">Allowed Tools (JSON array, e.g., ["getWeather"]):</label><input type="text" id="allowedTools" name="allowedTools" value="[]"></div>
      <button type="submit">Create Prompt</button>
    </form>
    <br><a href="/prompts">Cancel</a>
  `);
});

// Handle Create Prompt
app.post('/prompts/create', async (req, res) => {
  try {
    const { name, template } = req.body;
    let allowedTools = [];
    if (req.body.allowedTools) {
        try {
            allowedTools = JSON.parse(req.body.allowedTools);
            if (!Array.isArray(allowedTools)) throw new Error("Allowed tools must be an array.");
        } catch (e) {
            return res.status(400).send("Invalid JSON format for Allowed Tools. " + e.message);
        }
    }
    const newPrompt = await promptService.createPrompt(name, template, allowedTools);
    if (newPrompt) {
      res.redirect('/prompts');
    } else {
      res.status(500).send("Failed to create prompt.");
    }
  } catch (error) {
    logger.error("Error creating prompt:", error);
    res.status(500).send("Error creating prompt.");
  }
});

// Form for Editing Prompt
app.get('/prompts/edit/:id', async (req, res) => {
  try {
    const prompt = await promptService.getPrompt(req.params.id);
    if (!prompt) return res.status(404).send('Prompt not found.');
    res.send(`
      <h1>Edit Prompt: ${prompt.name}</h1>
      <form action="/prompts/update/${prompt.id}" method="POST">
        <div><label for="name">Name:</label><input type="text" id="name" name="name" value="${prompt.name}" required></div>
        <div><label for="template">Template:</label><textarea id="template" name="template" rows="10" cols="80" required>${prompt.template}</textarea></div>
        <div><label for="allowedTools">Allowed Tools (JSON array):</label><input type="text" id="allowedTools" name="allowedTools" value='${JSON.stringify(prompt.allowedTools || [])}'></div>
        <button type="submit">Update Prompt</button>
      </form>
      <br><a href="/prompts">Cancel</a>
    `);
  } catch (error) {
    logger.error("Error loading edit prompt form:", error);
    res.status(500).send("Error loading prompt for editing.");
  }
});

// Handle Update Prompt
app.post('/prompts/update/:id', async (req, res) => {
  try {
    const { name, template } = req.body;
    let allowedTools = undefined; // Only update if provided
    if (req.body.allowedTools) {
        try {
            allowedTools = JSON.parse(req.body.allowedTools);
            if (!Array.isArray(allowedTools)) throw new Error("Allowed tools must be an array.");
        } catch (e) {
            return res.status(400).send("Invalid JSON format for Allowed Tools. " + e.message);
        }
    }
    const updates = { name, template };
    if (allowedTools !== undefined) {
        updates.allowedTools = allowedTools;
    }
    const updatedPrompt = await promptService.updatePrompt(req.params.id, updates);
    if (updatedPrompt) {
      res.redirect('/prompts');
    } else {
      res.status(500).send("Failed to update prompt.");
    }
  } catch (error) {
    logger.error("Error updating prompt:", error);
    res.status(500).send("Error updating prompt.");
  }
});

// Handle Delete Prompt
app.post('/prompts/delete/:id', async (req, res) => {
  try {
    const success = await promptService.deletePrompt(req.params.id);
    if (success) {
      res.redirect('/prompts');
    } else {
      res.status(500).send("Failed to delete prompt.");
    }
  } catch (error) {
    logger.error("Error deleting prompt:", error);
    res.status(500).send("Error deleting prompt.");
  }
});


// --- Tool Management Placeholder ---
app.get('/tools', (req, res) => {
    res.status(501).send('Tool/API management page - Not Implemented Yet. <br><a href="/">Back to Home</a>');
});

function startWebServer() {
  app.listen(PORT, () => {
    logger.info(`Web server started on http://localhost:${PORT}`);
  });
  // Return app for potential extension or testing
  return app;
}

module.exports = { startWebServer, app };
