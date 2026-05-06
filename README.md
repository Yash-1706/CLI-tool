# Assignment 02 — AI Agent CLI Tool

A conversational terminal agent that accepts natural-language instructions, reasons through them step-by-step, calls tools, and produces real output files — similar to how Cursor or Windsurf work.

## Demo

The agent can take a prompt like *"Clone the Scaler Academy website"* and generate a fully working HTML/CSS/JS page with header, hero section, and footer — all through a visible reasoning loop in the terminal.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  main()  — readline REPL, conversation history      │
│    └─ runAgentForInstruction()  — agent step loop   │
│         └─ getNextAgentMessage() — LLM call         │
│              └─ model fallback chain                 │
└─────────────────────────────────────────────────────┘

Step machine:  START → THINK → TOOL → OBSERVE → ... → OUTPUT
```

## Project Structure

```
assignment_02_agent/
  src/
    index.js          # CLI entry point, agent loop, LLM communication
    systemPrompt.js   # System prompt defining agent behavior
    tools.js          # Tool implementations (executeCommand, writeToFile, readFromFile)
  .env.example        # Template for environment variables
  .gitignore
  package.json
  README.md
```

## Tools

| Tool | Description |
|------|-------------|
| `writeToFile({ filePath, content })` | Write content to a file, creating parent directories automatically |
| `readFromFile({ filePath })` | Read and return file contents |
| `executeCommand(cmd)` | Run a PowerShell command and return stdout/stderr |

## Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Create `.env`** from `.env.example` and add your OpenRouter API key:
```env
USE_OPENROUTER=true
OPENROUTER_API_KEY=your_key_here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=qwen/qwen3-coder:free
MAX_COMPLETION_TOKENS=4096
```

3. **Start the CLI:**
```bash
npm start
```

## Usage

### Sample Prompts

```
Clone the Scaler Academy website with header, hero section, and footer.
Save the files in E:\GenAI\CLI-tool\scaler_clone.
```

### Commands

| Command | Action |
|---------|--------|
| `help` | Show sample prompts |
| `clear` | Reset conversation history |
| `exit` | Quit the CLI |

## Agent Loop & Reasoning

The agent follows a strict step machine visible in the terminal:

1. **START** — Acknowledge the user request
2. **THINK** — Plan what to do next (one small step)
3. **TOOL** — Call a tool (writeToFile, readFromFile, or executeCommand)
4. **OBSERVE** — Receive and process the tool result
5. Repeat THINK → TOOL → OBSERVE as needed
6. **OUTPUT** — Final summary when all work is complete

Each step is logged with color-coded labels and a step counter `[N/80]`.

## Key Features

- **Multi-model fallback chain** — If the primary model fails (rate limit, credits, etc.), automatically tries the next model
- **Robust JSON parsing** — Handles markdown fences, extra text, unescaped characters
- **File I/O tools** — Native `writeToFile` / `readFromFile` instead of fragile shell heredocs
- **Step counter** — Visual progress indicator `[step/max]`
- **Error recovery** — Detects JSON errors and asks the model to self-correct (up to 5 retries)
- **Conversation memory** — Full session history maintained across multiple prompts

## Rubric Alignment

| Criterion | How It's Met |
|-----------|-------------|
| **GitHub Repository** | Clean structure, modular code, comprehensive README |
| **YouTube Demo Video** | Run `npm start`, type prompt, watch agent loop, see browser output |
| **Agent Loop & Reasoning** | Explicit JSON step machine with tool/observe cycle, visible in terminal |
| **Quality of Cloned Website** | Scaler-like design: dark blue theme, responsive, header + hero + footer |
| **Code Quality & Documentation** | Modular architecture, error handling, JSDoc comments, this README |

## Notes

- The agent runs on Windows and uses PowerShell for shell commands.
- Free OpenRouter models work well. DeepSeek Chat v3 is recommended for best results.
- The agent automatically opens the generated HTML in your default browser.
- Session history persists within a single run. Use `clear` to reset.
