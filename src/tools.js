/**
 * tools.js — All tool implementations the agent can call.
 *
 * Each function is async, accepts a single string or object arg,
 * and returns a string result (stdout / stderr / confirmation).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const execFileAsync = promisify(execFile);

// ─── executeCommand ──────────────────────────────────────────────────────────
/**
 * Run an arbitrary PowerShell command and return stdout + stderr.
 */
export async function executeCommand(cmd = "") {
  const command = String(cmd || "").trim();
  if (!command) return "Command is empty.";

  try {
    const { stdout, stderr } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { cwd: process.cwd(), windowsHide: true, maxBuffer: 15 * 1024 * 1024 }
    );

    const chunks = [];
    if (stdout?.trim()) chunks.push(`stdout:\n${stdout.trim()}`);
    if (stderr?.trim()) chunks.push(`stderr:\n${stderr.trim()}`);
    return chunks.length > 0
      ? chunks.join("\n\n")
      : "Command executed successfully with no output.";
  } catch (err) {
    const parts = [`Command failed: ${err.message}`];
    if (err.stdout?.trim()) parts.push(`stdout:\n${err.stdout.trim()}`);
    if (err.stderr?.trim()) parts.push(`stderr:\n${err.stderr.trim()}`);
    return parts.join("\n\n");
  }
}

// ─── writeToFile ─────────────────────────────────────────────────────────────
/**
 * Write content to a file on disk, creating parent dirs as needed.
 * Accepts either a string (JSON) or an object { filePath, content }.
 */
export async function writeToFile(args = "") {
  let filePath, content;

  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      filePath = parsed.filePath || parsed.file_path || parsed.path || parsed.file;
      content = parsed.content || parsed.text || parsed.data || "";
    } catch {
      return `Error: args must be JSON with "filePath" and "content". Received: ${args.slice(0, 200)}`;
    }
  } else if (typeof args === "object" && args !== null) {
    filePath = args.filePath || args.file_path || args.path || args.file;
    content = args.content || args.text || args.data || "";
  }

  if (!filePath) return 'Error: missing "filePath" in args.';

  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
    return `File written successfully: ${filePath} (${Buffer.byteLength(content, "utf-8")} bytes)`;
  } catch (err) {
    return `Error writing file: ${err.message}`;
  }
}

// ─── readFromFile ────────────────────────────────────────────────────────────
/**
 * Read and return the contents of a file.
 */
export async function readFromFile(args = "") {
  let filePath;

  if (typeof args === "string") {
    // Try JSON first, then treat as raw path
    try {
      const parsed = JSON.parse(args);
      filePath = parsed.filePath || parsed.file_path || parsed.path || parsed.file;
    } catch {
      filePath = args.trim();
    }
  } else if (typeof args === "object" && args !== null) {
    filePath = args.filePath || args.file_path || args.path || args.file;
  }

  if (!filePath) return 'Error: missing file path.';

  try {
    const data = await readFile(filePath, "utf-8");
    return data;
  } catch (err) {
    return `Error reading file: ${err.message}`;
  }
}

// ─── Tool registry ───────────────────────────────────────────────────────────
export const toolMap = {
  executeCommand,
  writeToFile,
  readFromFile,
};

/**
 * Normalize messy tool_args from the LLM into something our tools understand.
 */
export function normalizeToolArgs(toolName, toolArgs) {
  if (!toolArgs) return "";

  // writeToFile / readFromFile expect an object or JSON string
  if (toolName === "writeToFile" || toolName === "readFromFile") {
    if (typeof toolArgs === "object") return JSON.stringify(toolArgs);
    return toolArgs; // already a string (hopefully JSON)
  }

  // executeCommand expects a plain string
  if (typeof toolArgs === "string") return toolArgs;

  if (typeof toolArgs === "object") {
    if (typeof toolArgs.cmd === "string") return toolArgs.cmd;
    if (typeof toolArgs.command === "string") return toolArgs.command;
    const stringVals = Object.values(toolArgs).filter(
      (v) => typeof v === "string" && v.trim()
    );
    if (stringVals.length === 1) return stringVals[0];
    return JSON.stringify(toolArgs);
  }

  return "";
}
