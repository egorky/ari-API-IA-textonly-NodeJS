# NodeJS ARI AI Agent Framework

## 1. Overview

This project is a Node.js application that acts as an Asterisk ARI (Asterisk REST Interface) client. It connects to an Asterisk PBX to control call flow and integrates with AI models (Google Gemini and OpenAI) via LangChain.js to provide intelligent responses. The system uses Redis for session memory (conversation history) and for storing configurable AI prompts, tool/API definitions, and basic system settings.

A key feature is a web interface that allows users to:
*   Manage AI prompts (templates that guide the AI's behavior), including selecting which defined tools a prompt can use.
*   Define external APIs/tools that the AI can be instructed to use.
*   View current system configuration and set the default AI provider (OpenAI/Gemini).

The AI can operate in a simple conversational mode or in an agent mode where it can dynamically choose to use the defined tools to answer user queries or perform actions.

## 2. Core Technologies
<!-- Unchanged -->
*   **Node.js:** Runtime environment.
*   **Asterisk:** VoIP PBX. The application connects via ARI.
*   **ARI Client:** `ari-client` library for Node.js.
*   **AI Models:** Google Gemini, OpenAI (GPT series).
*   **LangChain.js:** Framework for building LLM-powered applications, used for AI model interaction, prompt templating, agent creation, and tool management.
*   **Redis:** In-memory data store used for:
    *   Storing conversation history (LangChain memory).
    *   Storing AI prompt definitions.
    *   Storing external API/tool definitions.
    *   Storing system-wide configurations (e.g., default AI provider).
*   **Express.js:** Web framework for the configuration interface.
*   **Axios:** For making HTTP requests when dynamically defined tools are executed.

## 3. Prerequisites
<!-- Unchanged -->
*   **Node.js:** Version 18.x or later recommended.
*   **npm:** Node Package Manager (comes with Node.js).
*   **Redis Server:** Running and accessible.
*   **Asterisk:** Version 13.x or later with ARI enabled and configured.
*   **API Keys:** Google Gemini API Key, OpenAI API Key.

## 4. Setup and Installation
<!-- Unchanged, .env example is still valid -->
1.  **Clone the repository (if applicable).**
2.  **Install dependencies:** `npm install`
3.  **Configure Environment Variables:** Create `.env` file.
    ```ini
    # Asterisk ARI Connection
    ARI_URL=http://localhost:8088
    ARI_USERNAME=your_ari_user
    ARI_PASSWORD=your_ari_password
    ARI_APP_NAME=ai-app

    # AI Provider (gemini or openai) - This is the fallback if not set in Web UI
    DEFAULT_AI_PROVIDER=openai

    # Google Gemini API Key
    GEMINI_API_KEY=YOUR_GEMINI_API_KEY

    # OpenAI API Key
    OPENAI_API_KEY=YOUR_OPENAI_API_KEY

    # Redis Connection
    REDIS_HOST=localhost
    REDIS_PORT=6379
    REDIS_PASSWORD=

    # Web Interface Basic Auth
    WEB_USER=admin
    WEB_PASSWORD=changeme

    # PORT=3000 (Optional web server port)
    ```

## 5. Running the Application
<!-- Unchanged -->
`node app.js`

## 6. Asterisk Dialplan Configuration
<!-- Unchanged, variables are still relevant -->
**Example `extensions.conf` entry:**
```
[your-context]
exten => s,1,NoOp(Call entering AI ARI application)
    same => n,Set(AI_INITIAL_PROMPT=Welcome. How can I help?)
    ; same => n,Set(AI_SYSTEM_PROMPT=You are a concise support agent.)
    ; same => n,Set(AI_PROVIDER=openai) ; Optional: 'openai' or 'gemini', overrides default.
    same => n,Set(AI_USE_AGENT=true)  ; Optional: 'true' to use agent with tools.
    same => n,Stasis(${ARI_APP_NAME})
    same => n,NoOp(AI Response: ${AI_RESPONSE})
    ; same => n,Playback(tts:${AI_RESPONSE})
    same => n,Hangup()
```
**Key Dialplan Variables Passed to ARI:**
*   `AI_INITIAL_PROMPT` (String)
*   `AI_SYSTEM_PROMPT` (String, Optional)
*   `AI_PROVIDER` (String, Optional): Overrides default AI provider for the current call.
*   `AI_USE_AGENT` (String, Optional)

**Channel Variable Returned by ARI:**
*   `AI_RESPONSE` (String)

## 7. Web Interface Usage

Access: `http://localhost:PORT` (e.g., `http://localhost:3000`). Login with `WEB_USER`, `WEB_PASSWORD` from `.env`.

### 7.1. Manage Prompts

*   **View Prompts:** Lists saved AI prompts.
*   **Create New Prompt / Edit Prompt:**
    *   **Name:** User-friendly name.
    *   **Template:** The AI prompt template text. Include `{input}`, `{chat_history}` (for conversational memory), and `{agent_scratchpad}` (if using ReAct style agents - OpenAI Functions agent handles this differently).
    *   **Allowed Tools:** Select from a list of currently defined tools (from "Manage Tools/APIs" section) using checkboxes. These are the tools the AI (when using this prompt) is permitted to consider.
*   **Delete Prompt:** Removes a prompt.

### 7.2. Manage Tools/APIs
<!-- Largely unchanged, but emphasize "description" importance -->
Define external APIs for the AI agent.
*   **View Tools:** Lists defined tools.
*   **Define New Tool / Edit Tool:**
    *   **Tool Name (for AI):** Concise name (e.g., `getCurrentWeather`).
    *   **Description (for AI):** **Crucial.** Detailed explanation for the AI: what it does, when to use it, input meaning, output format. This guides the AI's decision to use the tool.
    *   **HTTP Method:** `GET`, `POST`, etc.
    *   **Endpoint URL:** Full API URL.
    *   **Parameters (JSON Array):** API parameters. AI fills these.
        Example: `[{"name":"location","type":"string","description":"The city and state, e.g. San Francisco, CA","required":true}]`
    *   **Static Headers (JSON Array):** Static HTTP headers (e.g., for auth).
        Example: `[{"name":"X-API-Key","value":"YOUR_KEY"}]`
        **Security Warning:** API keys here are stored in Redis. Secure Redis and consider alternatives for highly sensitive keys.

### 7.3. View & Set System Configuration

*   **View Configuration:** Displays read-only current settings from `.env` (API keys masked) and effective settings from Redis.
*   **Set Default AI Provider:** Allows selecting 'OpenAI' or 'Gemini' as the system-wide default AI provider. This setting is stored in Redis and overrides the `DEFAULT_AI_PROVIDER` from `.env`. The dialplan can still override this on a per-call basis. Ensure the API key for the selected provider is valid in `.env`.
*   **Service Status:** Shows basic Redis client status for the memory service.

## 8. How Prompts and Tools Work Together
<!-- Minor update for default provider source -->
1.  Call arrives, dialplan variables passed.
2.  Default AI provider is determined (Redis > `.env` > dialplan override).
3.  If `AI_USE_AGENT` is true:
    *   `aiService.js` loads all tool definitions from Redis (via `toolService.js`).
    *   Dynamically creates LangChain `DynamicTool` instances.
    *   The agent uses user input, history, system prompt, and tool descriptions to decide actions.
    *   If a tool is chosen (and is in the prompt's "Allowed Tools" if applicable), the `DynamicTool` executes the HTTP request.
    *   Agent formulates response based on tool output or direct reasoning.
4.  If `AI_USE_AGENT` is false: Simpler conversational response.
5.  `AI_RESPONSE` variable set.

## 9. Future Enhancements / Considerations
<!-- Unchanged, still relevant -->
*   **Dynamic Prompt Selection by ID from Dialplan.**
*   **Enhanced Security for Tool API Keys** (secrets manager).
*   **Advanced Parameter Mapping & Body Configuration for Tools** (Postman-like raw JSON body, form-data, etc.).
*   **Streaming Responses.**
*   **Advanced Logging & Monitoring Dashboard.**
*   **Web UI Enhancements** (templating engine, UI validation, pagination).
*   **More Robust Error Handling.**
*   **Comprehensive Testing Suite.**

This README provides a guide to the application's current state.
