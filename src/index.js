/**
 * index.js — Entry point for the Assignment 02 AI Agent CLI.
 *
 * Architecture:
 * ┌──────────────────────────────────────────────────┐
 * │  main()  — readline REPL, conversation history   │
 * │    └─ runAgentForInstruction()  — inner loop     │
 * │         └─ getNextAgentMessage() — LLM call      │
 * │              └─ model fallback chain              │
 * └──────────────────────────────────────────────────┘
 *
 * The agent follows a strict step machine:
 *   START → THINK → TOOL → OBSERVE → THINK → ... → OUTPUT
 *
 * Tools (defined in tools.js):
 *   - executeCommand(cmd)   — run PowerShell commands
 *   - writeToFile(args)     — write file to disk
 *   - readFromFile(args)    — read file from disk
 */

import "dotenv/config";
import OpenAI from "openai";
import chalk from "chalk";
import boxen from "boxen";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { toolMap, normalizeToolArgs } from "./tools.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const USE_GROQ = true;
const MAX_AGENT_STEPS = Number(process.env.MAX_AGENT_STEPS || 80);
const MAX_COMPLETION_TOKENS = Number(process.env.MAX_COMPLETION_TOKENS || 4096);
const TEMPERATURE = Number(process.env.TEMPERATURE || 0.2);

const API_KEY = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
const BASE_URL = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const SITE_URL = process.env.SITE_URL || "";
const SITE_NAME = process.env.SITE_NAME || "Assignment 02 Agent CLI";

const DEFAULT_GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
];

const PRIMARY_MODEL =
  process.env.GROQ_MODEL || DEFAULT_GROQ_MODELS[0];

const MODEL_CHAIN = normalizeModelChain(
  PRIMARY_MODEL,
  process.env.GROQ_MODELS,
  DEFAULT_GROQ_MODELS
);
const disabledModels = new Map();

if (!API_KEY) {
  console.error(
    chalk.red(
      "Missing API key. Set GROQ_API_KEY or OPENAI_API_KEY in .env"
    )
  );
  process.exit(1);
}

const client = new OpenAI({
  apiKey: API_KEY,
  baseURL: BASE_URL || undefined,
  defaultHeaders: {
    ...(SITE_URL ? { "HTTP-Referer": SITE_URL } : {}),
    "X-Title": SITE_NAME,
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeModelChain(primary, envList, defaults) {
  const envModels = String(envList || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const chain = [primary, ...envModels, ...defaults].filter(Boolean);
  return [...new Set(chain)];
}

function renderBanner() {
  const title = chalk.bold.cyan("⚡ Assignment 02 — AI Agent CLI");
  const subtitle = chalk.gray(
    "Agent loop: START → THINK → TOOL → OBSERVE → OUTPUT"
  );
  const modelInfo = chalk.white(`Primary model : ${chalk.cyan(PRIMARY_MODEL)}`);
  const fallbackInfo = chalk.white(
    `Fallback chain: ${
      MODEL_CHAIN.slice(1).length > 0
        ? MODEL_CHAIN.slice(1).map((m) => chalk.dim(m)).join(" → ")
        : chalk.dim("None")
    }`
  );
  const toolInfo = chalk.white(
    `Tools         : ${chalk.yellow(Object.keys(toolMap).join(", "))}`
  );

  console.log(
    boxen([title, subtitle, "", modelInfo, fallbackInfo, toolInfo].join("\n"), {
      padding: 1,
      borderStyle: "round",
      borderColor: "blue",
    })
  );

  console.log(
    chalk.gray(
      "Type your instruction and press Enter. Type 'help' for sample prompts or 'exit' to quit.\n"
    )
  );
}

/** Color map for each agent step */
function stepColor(step) {
  const map = {
    START: chalk.cyan,
    THINK: chalk.magenta,
    TOOL: chalk.yellow,
    OBSERVE: chalk.blue,
    OUTPUT: chalk.green,
    INFO: chalk.gray,
    ERROR: chalk.red,
  };
  return map[step] || chalk.white;
}

/** Pretty-print a step tag + content */
function printStep(step, content = "") {
  const color = stepColor(step);
  const text = String(content ?? "").trim();
  console.log(`${color.bold(`[${step}]`)} ${text}`);
}

/** Truncate text for log display */
function truncate(text, length = 320) {
  const normalized = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= length
    ? normalized
    : `${normalized.slice(0, length)}…`;
}

// ─── JSON Parsing ────────────────────────────────────────────────────────────

/**
 * Aggressively parse the model's response into a step object.
 * Handles:
 * - Reasoning model <think>...</think> wrappers (qwen3-coder, etc.)
 * - Markdown fences (```json ... ```)
 * - Extra text around JSON
 * - Unescaped newlines / tabs inside strings
 */
function cleanJsonText(raw = "") {
  let text = String(raw).trim();

  // Strip <think>...</think> blocks from reasoning models
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Strip markdown fences
  text = text.replace(/^```json\s*/i, "");
  text = text.replace(/^```\s*/i, "");
  text = text.replace(/\s*```$/, "");

  return text.trim();
}

function tryParseJson(candidate) {
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && parsed.step) {
      return {
        step: String(parsed.step || "").toUpperCase(),
        content: parsed.content ? String(parsed.content) : "",
        tool_name: parsed.tool_name ? String(parsed.tool_name) : "",
        tool_args: parsed.tool_args ?? "",
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function parseAgentJson(rawText = "") {
  const cleaned = cleanJsonText(rawText);

  // Strategy 1: Direct parse
  let result = tryParseJson(cleaned);
  if (result) return result;

  // Strategy 2: Extract first { ... } block
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const extracted = cleaned.slice(firstBrace, lastBrace + 1);
    result = tryParseJson(extracted);
    if (result) return result;

    // Strategy 3: Fix unescaped newlines/tabs inside the JSON
    const fixed = extracted
      .replace(/\r?\n/g, "\\n")
      .replace(/\t/g, "\\t");
    result = tryParseJson(fixed);
    if (result) return result;

    // Strategy 4: Try to find a simpler JSON object (in case of nested/broken JSON)
    // Look for something like {"step":"THINK","content":"..."}
    const simpleMatch = cleaned.match(
      /\{\s*"step"\s*:\s*"[^"]+"\s*,\s*"content"\s*:\s*"[^"]*"(?:\s*,\s*"tool_name"\s*:\s*"[^"]*")?(?:\s*,\s*"tool_args"\s*:\s*(?:"[^"]*"|\{[^}]*\}))?\s*\}/
    );
    if (simpleMatch) {
      result = tryParseJson(simpleMatch[0]);
      if (result) return result;
    }
  }

  return null;
}

function normalizeParsedStep(parsed) {
  if (!parsed?.step) return "";
  const step = parsed.step.toUpperCase();
  if (["START", "THINK", "TOOL", "OBSERVE", "OUTPUT"].includes(step))
    return step;
  if (step.includes("FINAL") || step.includes("DONE") || step.includes("RESULT"))
    return "OUTPUT";
  if (step.includes("ACTION") || step.includes("EXECUTE")) return "TOOL";
  if (step.includes("PLAN") || step.includes("REASON")) return "THINK";
  return step;
}

function parseAndNormalize(rawText = "") {
  const parsed = parseAgentJson(rawText);
  if (!parsed) return null;
  return { ...parsed, step: normalizeParsedStep(parsed) };
}

// ─── Error Handling ──────────────────────────────────────────────────────────

function isResponseFormatUnsupported(err) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("response_format") && msg.includes("not supported");
}

function shouldTryFallbackModel(err) {
  const status = err?.status || err?.response?.status;
  if ([402, 408, 409, 429, 500, 502, 503, 504].includes(status)) return true;

  const msg = String(err?.message || "").toLowerCase();
  return [
    "insufficient credits",
    "requires more credits",
    "rate limit",
    "overloaded",
    "temporarily",
    "timeout",
    "unavailable",
    "capacity",
  ].some((token) => msg.includes(token));
}

function extractAffordableTokens(err) {
  const msg = String(err?.message || "");
  const match = msg.match(/can only afford\s+(\d+)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

// ─── LLM Communication ──────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Make a single API call to a model, handling json_object format fallback
 * and credit-limit token reduction.
 */
async function callModel(model, messages, tokenBudget) {
  try {
    const response = await client.chat.completions.create({
      model,
      messages,
      temperature: TEMPERATURE,
      max_tokens: tokenBudget,
      response_format: { type: "json_object" },
    });
    return response.choices[0]?.message?.content || "";
  } catch (err) {
    const affordable = extractAffordableTokens(err);
    if (affordable && affordable < tokenBudget) {
      const reduced = Math.max(512, affordable - 64);
      printStep("INFO", `Reducing tokens to ${reduced} for ${model} (credit limit).`);
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: TEMPERATURE,
        max_tokens: reduced,
        response_format: { type: "json_object" },
      });
      return response.choices[0]?.message?.content || "";
    }

    if (isResponseFormatUnsupported(err)) {
      printStep("INFO", `Model ${model} doesn't support json_object. Retrying plain mode.`);
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: TEMPERATURE,
        max_tokens: tokenBudget,
      });
      return response.choices[0]?.message?.content || "";
    }

    throw err;
  }
}

/**
 * Try each model in the chain until one succeeds.
 * Implements retry with exponential backoff for 429 (rate limit) errors.
 */
async function getNextAgentMessage(messages) {
  const MAX_RETRIES = 3;
  const failures = [];
  const candidateModels = MODEL_CHAIN.filter((m) => !disabledModels.has(m));

  if (candidateModels.length === 0) {
    const reasons = [...disabledModels.entries()]
      .map(([m, r]) => `${m}: ${r}`)
      .join(" | ");
    throw new Error(`All models disabled. ${reasons}`);
  }

  for (const model of candidateModels) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const content = await callModel(model, messages, MAX_COMPLETION_TOKENS);
        return { content, model };
      } catch (err) {
        const status = err?.status || err?.response?.status;
        const msg = String(err?.message || "").toLowerCase();

        // Disable model permanently if credits are exhausted
        if (msg.includes("requires more credits") || msg.includes("insufficient credits")) {
          disabledModels.set(model, "insufficient credits");
          break;
        }

        // Retry with backoff on 429 rate limits
        if (status === 429 && attempt < MAX_RETRIES) {
          const delay = Math.min(2000 * Math.pow(2, attempt - 1), 15000);
          printStep("INFO", `Rate limited on ${model}. Waiting ${(delay / 1000).toFixed(0)}s before retry ${attempt + 1}/${MAX_RETRIES}…`);
          await sleep(delay);
          continue;
        }

        // Record failure and try next model
        failures.push(`${model}: ${status || "ERR"} ${err?.message || "Unknown"}`);

        if (shouldTryFallbackModel(err) && model !== candidateModels.at(-1)) {
          printStep("INFO", `Model ${model} failed (${truncate(err.message, 120)}). Trying fallback…`);
        } else if (model !== candidateModels.at(-1)) {
          printStep("INFO", `Model ${model} failed. Trying next…`);
        }
        break; // break retry loop, move to next model
      }
    }
  }

  throw new Error(`All models failed. ${failures.join(" | ")}`);
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────

/**
 * Run the agent loop for a single user instruction.
 * Loops through START → THINK → TOOL → OBSERVE → ... → OUTPUT.
 */
async function runAgentForInstruction(messages) {
  let consecutiveJsonErrors = 0;
  const MAX_JSON_ERRORS = 5;

  for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
    const stepLabel = chalk.dim(`[${step}/${MAX_AGENT_STEPS}]`);
    process.stdout.write(`${stepLabel} `);

    const { content: rawContent, model } = await getNextAgentMessage(messages);
    const parsed = parseAndNormalize(rawContent);

    if (!parsed || !parsed.step) {
      consecutiveJsonErrors++;
      printStep(
        "ERROR",
        `Invalid JSON from ${model} (attempt ${consecutiveJsonErrors}/${MAX_JSON_ERRORS}). Asking for correction.`
      );

      if (consecutiveJsonErrors >= MAX_JSON_ERRORS) {
        printStep("ERROR", "Too many JSON errors in a row. Aborting this run.");
        console.log();
        return;
      }

      messages.push({
        role: "user",
        content: JSON.stringify({
          step: "OBSERVE",
          content:
            'Invalid JSON. You MUST respond with ONLY a JSON object: { "step": "START|THINK|TOOL|OUTPUT", "content": "..." }. No extra text.',
        }),
      });
      continue;
    }

    consecutiveJsonErrors = 0; // reset on success

    messages.push({
      role: "assistant",
      content: JSON.stringify(parsed),
    });

    // ── START ──
    if (parsed.step === "START") {
      printStep("START", parsed.content);
      continue;
    }

    // ── THINK ──
    if (parsed.step === "THINK") {
      printStep("THINK", parsed.content);
      continue;
    }

    // ── TOOL ──
    if (parsed.step === "TOOL") {
      const toolName = parsed.tool_name;
      const toolArgs = normalizeToolArgs(toolName, parsed.tool_args);

      // Show a compact version of the args for the log
      const argsPreview =
        toolName === "writeToFile"
          ? (() => {
              try {
                const a = JSON.parse(toolArgs);
                return `${a.filePath || a.file_path || "?"} (${
                  (a.content || "").length
                } chars)`;
              } catch {
                return truncate(toolArgs, 120);
              }
            })()
          : truncate(toolArgs, 220);

      printStep("TOOL", `${chalk.bold(toolName)}(${argsPreview})`);

      let result;
      if (!toolMap[toolName]) {
        result = `Tool '${toolName}' is not available. Available tools: ${Object.keys(
          toolMap
        ).join(", ")}`;
      } else {
        result = await toolMap[toolName](toolArgs);
      }

      const observation = {
        step: "OBSERVE",
        content:
          typeof result === "string" ? result : JSON.stringify(result),
      };

      printStep("OBSERVE", truncate(observation.content, 340));

      messages.push({
        role: "user",
        content: JSON.stringify(observation),
      });
      continue;
    }

    // ── OUTPUT ──
    if (parsed.step === "OUTPUT") {
      printStep("OUTPUT", parsed.content);
      console.log();
      return;
    }

    // ── Unknown step — nudge back ──
    messages.push({
      role: "user",
      content: JSON.stringify({
        step: "OBSERVE",
        content: `Invalid step '${parsed.step}'. Use START, THINK, TOOL, or OUTPUT.`,
      }),
    });
  }

  printStep(
    "OUTPUT",
    `Max steps (${MAX_AGENT_STEPS}) reached. The agent did not finish.`
  );
  console.log();
}

// ─── Help ────────────────────────────────────────────────────────────────────

function printHelp() {
  const lines = [
    chalk.bold("Sample prompts you can try:\n"),
    `${chalk.cyan("1)")} Clone the Scaler Academy website with header, hero section, and footer.`,
    `${chalk.cyan("2)")} Build a frontend clone of Scaler Academy using HTML, CSS, JS. Save files in E:\\GenAI\\CLI-tool\\scaler_clone.`,
    `${chalk.cyan("3)")} Create a responsive landing page with a dark blue theme and modern design.`,
    "",
    chalk.dim("The agent will break the task into steps, write files, and open the result in your browser."),
  ];

  console.log(
    boxen(lines.join("\n"), {
      padding: 1,
      borderStyle: "round",
      borderColor: "gray",
    })
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const rl = readline.createInterface({ input, output });
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  renderBanner();

  try {
    while (true) {
      let userInstruction = "";

      try {
        userInstruction = (await rl.question(chalk.bold.cyan("you › "))).trim();
      } catch (err) {
        if (
          String(err?.message || "")
            .toLowerCase()
            .includes("readline was closed")
        ) {
          break;
        }
        throw err;
      }

      if (!userInstruction) continue;

      const normalized = userInstruction.toLowerCase();
      if (normalized === "exit" || normalized === "quit") {
        printStep("INFO", "Goodbye! 👋");
        break;
      }
      if (normalized === "help") {
        printHelp();
        continue;
      }
      if (normalized === "clear") {
        // Reset conversation but keep system prompt
        messages.length = 1;
        console.clear();
        renderBanner();
        printStep("INFO", "Conversation cleared.");
        continue;
      }

      messages.push({ role: "user", content: userInstruction });

      try {
        await runAgentForInstruction(messages);
      } catch (err) {
        printStep("ERROR", err.message || "Agent run failed.");
        printStep(
          "INFO",
          "Session is still active. Try another prompt or check your API key / model settings."
        );
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  printStep("ERROR", err.message || "Fatal error");
  process.exit(1);
});
