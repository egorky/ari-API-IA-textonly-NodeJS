# NodeJS ARI AI Agent Framework

## 1. Overview

This project is a Node.js application that acts as an Asterisk ARI (Asterisk REST Interface) client. It connects to an Asterisk PBX to control call flow and integrates with AI models (Google Gemini and OpenAI) via LangChain.js to provide intelligent responses. The system uses Redis for session memory (conversation history) and for storing configurable AI prompts and tool/API definitions.

A key feature is a web interface that allows users to:
*   Manage AI prompts (templates that guide the AI's behavior).
*   Define external APIs/tools that the AI can be instructed to use.
*   View current system configuration.

The AI can operate in a simple conversational mode or in an agent mode where it can dynamically choose to use the defined tools to answer user queries or perform actions.

## 2. Core Technologies

*   **Node.js:** Runtime environment.
*   **Asterisk:** VoIP PBX. The application connects via ARI.
*   **ARI Client:** `ari-client` library for Node.js.
*   **AI Models:** Google Gemini, OpenAI (GPT series).
*   **LangChain.js:** Framework for building LLM-powered applications, used for AI model interaction, prompt templating, agent creation, and tool management.
*   **Redis:** In-memory data store used for:
    *   Storing conversation history (LangChain memory).
    *   Storing AI prompt definitions.
    *   Storing external API/tool definitions.
*   **Express.js:** Web framework for the configuration interface.
*   **Axios:** For making HTTP requests when dynamically defined tools are executed.

## 3. Prerequisites

*   **Node.js:** Version 18.x or later recommended.
*   **npm:** Node Package Manager (comes with Node.js).
*   **Redis Server:** Running and accessible.
*   **Asterisk:** Version 13.x or later with ARI enabled and configured.
    *   Ensure `http.conf` in Asterisk has ARI enabled (`enabled = yes`).
    *   Ensure an ARI user is configured in `ari.conf`.
*   **API Keys:**
    *   Google Gemini API Key (if using Gemini).
    *   OpenAI API Key (if using OpenAI).

## 4. Setup and Installation

1.  **Clone the repository (if applicable):**
    ```bash
    # git clone <repository_url>
    # cd <repository_directory>
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file in the root of the project by copying `.env.example` (if provided) or creating it from scratch. Fill in the necessary values:

    ```ini
    # Asterisk ARI Connection
    ARI_URL=http://localhost:8088 # URL to your Asterisk's ARI HTTP interface
    ARI_USERNAME=your_ari_user    # Username configured in ari.conf
    ARI_PASSWORD=your_ari_password  # Password for the ARI user
    ARI_APP_NAME=ai-app           # Name for this Stasis application in Asterisk

    # AI Provider (gemini or openai)
    DEFAULT_AI_PROVIDER=openai     # Default AI if not specified by dialplan
                                   # Use 'gemini' for Google Gemini

    # Google Gemini API Key
    GEMINI_API_KEY=YOUR_GEMINI_API_KEY

    # OpenAI API Key
    OPENAI_API_KEY=YOUR_OPENAI_API_KEY

    # Redis Connection
    REDIS_HOST=localhost
    REDIS_PORT=6379
    REDIS_PASSWORD= # Leave blank if no password, otherwise provide it

    # Web Interface Basic Auth
    WEB_USER=admin
    WEB_PASSWORD=changeme # Secure password for web UI access

    # Web Server Port (Optional)
    # PORT=3000
    ```

## 5. Running the Application

Once configured, start the application with:

```bash
node app.js
```

You should see log messages indicating successful connection to Redis and Asterisk ARI. The web interface will also be started (typically on port 3000 unless `PORT` is set in `.env`).

## 6. Asterisk Dialplan Configuration

To send calls to this ARI application, you need to configure your Asterisk dialplan (`extensions.conf`). The application listens for calls entering a Stasis application named whatever is set in `ARI_APP_NAME` (e.g., `ai-app`).

**Example `extensions.conf` entry:**

```
[your-context]
exten => s,1,NoOp(Call entering AI ARI application)
    ; Answer the call if not already answered
    ; Gosub(sub-answer-if-needed,s,1)

    ; Set variables to be passed to the ARI application
    ; These are read by the Node.js app using channel.getChannelVar()
    same => n,Set(AI_INITIAL_PROMPT=Welcome to our support line. How can I help you today?)
    ; same => n,Set(AI_SYSTEM_PROMPT=You are a friendly and concise support agent.)
    ; same => n,Set(AI_PROVIDER=openai) ; Optional: 'openai' or 'gemini', overrides .env default
    same => n,Set(AI_USE_AGENT=true)  ; Optional: 'true' to use agent with tools, 'false' or omit for simple chat

    ; Send the call to the Stasis (ARI) application
    same => n,Stasis(${ARI_APP_NAME}) ; ARI_APP_NAME must match .env

    ; After Stasis returns, AI_RESPONSE channel variable should be set
    same => n,NoOp(AI Response: ${AI_RESPONSE})

    ; Example: Play back the AI's response using Asterisk TTS (if configured)
    ; same => n,Playback(tts:${AI_RESPONSE})
    ; Or use a custom TTS script/AGI

    same => n,Hangup()

; Optional subroutine to answer
; [sub-answer-if-needed]
; exten => s,1,NoOp(Checking if call needs answering)
;    same => n,GotoIf($["${CHANNEL(state)}" = "Up"]?answered)
;    same => n,Answer()
;    same => n,NoOp(Call answered)
;    same => n(answered),Return()
```

**Key Dialplan Variables Passed to ARI:**
*   `AI_INITIAL_PROMPT` (String): The initial text/question to send to the AI.
*   `AI_SYSTEM_PROMPT` (String, Optional): A system message to define the AI's role or persona.
*   `AI_PROVIDER` (String, Optional): `openai` or `gemini`. Overrides the `DEFAULT_AI_PROVIDER` in `.env`.
*   `AI_USE_AGENT` (String, Optional): Set to `true` to enable the AI agent that can use tools. Otherwise, a simpler conversational AI is used.

**Channel Variable Returned by ARI:**
*   `AI_RESPONSE` (String): The final response from the AI.

## 7. Web Interface Usage

Access the web interface by navigating to `http://localhost:PORT` (e.g., `http://localhost:3000`) in your browser. You will be prompted for the username and password defined in your `.env` file (`WEB_USER`, `WEB_PASSWORD`).

The web interface has three main sections:

### 7.1. Manage Prompts

*   **View Prompts:** Lists all saved AI prompts, showing their ID, name, an excerpt of the template, and defined allowed tools.
*   **Create New Prompt:**
    *   **Name:** A user-friendly name for the prompt.
    *   **Template:** The actual prompt template text. This is what gets sent to the AI, potentially with placeholders that LangChain or the application might fill.
        *   For agents, this template should instruct the AI on its role, how to reason, and when to consider using tools.
        *   It should also include placeholders like `{input}` for the user's query and `{chat_history}` for conversation context, and `{agent_scratchpad}` for agent intermediate steps (if using ReAct style agents, OpenAI Functions agent handles this differently).
    *   **Allowed Tools (JSON Array):** A JSON array of strings specifying the names of tools (defined in the "Manage Tools/APIs" section) that an AI using this prompt is allowed to invoke. Example: `["getWeatherTool", "customerDatabaseLookup"]`. An empty array `[]` means no tools are specifically whitelisted for this prompt (the agent might still use any globally available tool if not restricted otherwise).
*   **Edit Prompt:** Modify existing prompt details.
*   **Delete Prompt:** Remove a prompt definition.

**Note on JavaScript Snippets in Prompts:** The original requirement for JS snippets is handled by making the prompt templates powerful enough for LangChain. Direct, arbitrary JS execution from user input is a security risk and is **not** implemented. The "Allowed Tools" mechanism is the safe way to extend AI capabilities.

### 7.2. Manage Tools/APIs

This section allows you to define external APIs that the AI agent can learn to use. The AI will refer to these tools by the "Tool Name" you provide.

*   **View Tools:** Lists all defined tools/APIs.
*   **Define New Tool / Edit Tool:**
    *   **Tool Name (for AI):** A concise, descriptive name the AI will use to identify and call the tool (e.g., `getCurrentWeather`, `fetchCustomerDetails`).
    *   **Description (for AI):** Crucial. A detailed explanation for the AI about what the tool does, what kind of questions it can answer, what its inputs mean, and what its output format is. This description guides the AI in deciding when and how to use the tool.
    *   **HTTP Method:** `GET`, `POST`, `PUT`, `DELETE`, `PATCH`.
    *   **Endpoint URL:** The full URL for the API endpoint.
    *   **Parameters (JSON Array):** Defines the parameters the API endpoint expects. The AI will attempt to fill these based on its understanding of the user's query and the parameter descriptions. Each object in the array should have:
        *   `name` (string): The name of the parameter (e.g., `city`, `userId`).
        *   `type` (string): Expected data type (e.g., `string`, `number`, `boolean`). This helps the AI format its input.
        *   `description` (string): Description for the AI on what this parameter is and what kind of value to provide.
        *   `required` (boolean): Whether the parameter is mandatory for the API call.
        Example: `[{"name":"location","type":"string","description":"The city and state, e.g. San Francisco, CA","required":true}]`
    *   **Static Headers (JSON Array):** Defines static HTTP headers to be sent with every request to this API (e.g., for authentication). Each object in the array should have:
        *   `name` (string): Header name (e.g., `Authorization`, `X-API-Key`).
        *   `value` (string): Header value (e.g., `Bearer YOUR_SECRET_TOKEN`).
        **Security Warning:** API keys or sensitive tokens entered here are stored as part of the tool definition in Redis. Ensure Redis is secured. For production, consider referencing secrets stored more securely (e.g., via environment variables on the server, or a secrets manager).

### 7.3. View Configuration

A read-only page displaying some of the current application configurations loaded from the `.env` file (with sensitive parts like full API keys masked) and the status of the Redis client for the memory service.

## 8. How Prompts and Tools Work Together

1.  A call arrives in Asterisk and is directed to the ARI application.
2.  Dialplan variables (`AI_INITIAL_PROMPT`, `AI_SYSTEM_PROMPT`, `AI_USE_AGENT`) are passed.
3.  If `AI_USE_AGENT` is true:
    *   The `aiService.js` (specifically `getAIAgentResponse`) loads all tool definitions from Redis (via `toolService.js`).
    *   It dynamically creates LangChain `DynamicTool` instances from these definitions.
    *   The system prompt (either from dialplan or a default, or potentially a specific prompt loaded by ID in future enhancements) is used to instruct the agent.
    *   The agent uses the user's input (`AI_INITIAL_PROMPT`), conversation history (from Redis), the system prompt, and the descriptions of available tools to decide whether to call a tool or respond directly.
    *   If it decides to use a tool, it figures out the input for the tool based on the user's query and the tool's parameter definitions.
    *   The `DynamicTool`'s function in `aiService.js` executes the actual HTTP request to the defined API endpoint with the necessary parameters and headers.
    *   The API's response is returned to the agent.
    *   The agent then formulates a final textual response to the user, possibly incorporating the tool's output.
4.  If `AI_USE_AGENT` is false (or not set):
    *   `getAIResponseWithMemory` is used for a simpler conversational response without tool usage.
5.  The final AI text response is set as the `AI_RESPONSE` channel variable.

## 9. Future Enhancements / Considerations

*   **Dynamic Prompt Selection:** Allow specifying a Prompt ID from the dialplan to use a specific managed prompt.
*   **Enhanced Security for Tool API Keys:** Integrate with a secrets manager or use environment variables for API keys instead of storing them directly in Redis tool definitions.
*   **More Sophisticated Parameter Mapping for Tools:** The current dynamic tool execution logic for mapping AI input to tool parameters is basic. More complex APIs might require more advanced mapping logic.
*   **Streaming Responses:** For both ARI (audio playback) and AI responses, streaming could improve perceived responsiveness.
*   **Advanced Logging & Monitoring:** Integrate more detailed logging and a monitoring dashboard.
*   **Web Interface Enhancements:** Use a proper templating engine (like EJS) for views, add UI validation, pagination for long lists, etc.
*   **Error Handling:** More robust error handling and user feedback across all components.
*   **Testing:** Comprehensive unit, integration, and end-to-end tests.

This README provides a starting point for understanding, setting up, and using the application.
