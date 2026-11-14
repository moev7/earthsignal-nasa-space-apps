#!/usr/bin/env node
// Native Node >=22.13. EARTHSIGNAL_AUTH_DB must name an absolute DB path in a private directory.
// node scripts/collaborator.mjs provision|reset USERNAME [--stdin]
// node scripts/collaborator.mjs disable USERNAME / node scripts/collaborator.mjs list
// --stdin reads one password (optional trailing newline). Never pass a password as an argument.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { emitKeypressEvents } from "node:readline";
import { existsSync } from "node:fs";
const compiledAuth = new URL("../lib/local-auth.mjs", import.meta.url);

// Node 22.13 needs explicit type stripping; Node 22.18+ and newer enable it by default.
if (!existsSync(compiledAuth) && !process.features.typescript && !process.execArgv.includes("--experimental-strip-types")) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

function hiddenPassword(prompt) {
  if (!process.stdin.isTTY) throw new Error("Use --stdin for piped input.");
  process.stderr.write(prompt);
  emitKeypressEvents(process.stdin);
  const wasRaw = Boolean(process.stdin.isRaw);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let password = "";
    const finish = (error) => {
      process.stdin.off("keypress", keypress);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error); else resolve(password);
    };
    const keypress = (text, key = {}) => {
      if (key.ctrl && ["c", "d"].includes(key.name)) return finish(new Error("Password input cancelled."));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") { password = [...password].slice(0, -1).join(""); return; }
      if (key.ctrl || key.meta || key.name === "escape" || !text || /[\r\n\x1b]/.test(text)) return;
      password += text;
      if (Buffer.byteLength(password) > 1024) finish(new Error("Password input too long."));
    };
    process.stdin.on("keypress", keypress);
  });
}
async function stdinPassword() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 1026) throw new Error("Password input too long.");
    chunks.push(chunk);
  }
  // Preserve password spaces; remove just the line terminator added by password managers.
  const password = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)).replace(/\r?\n$/, "");
  if (/[\r\n]/.test(password)) throw new Error("Expected exactly one password.");
  return password;
}
let service;
try {
  const [command, username, flag, ...extra] = process.argv.slice(2);
  if (extra.length || !["provision", "reset", "disable", "list"].includes(command)
    || (command === "list" ? username !== undefined : !username)
    || (["provision", "reset"].includes(command) ? flag !== undefined && flag !== "--stdin" : flag !== undefined)) {
    throw new Error("Usage: collaborator.mjs provision|reset USERNAME [--stdin], disable USERNAME, or list. Passwords require at least 15 characters.");
  }
  const { LocalAuth, normalizeUsername } = await import(existsSync(compiledAuth) ? compiledAuth.href : "../lib/local-auth.ts");
  if (username !== undefined) normalizeUsername(username);
  service = new LocalAuth({ dbPath: process.env.EARTHSIGNAL_AUTH_DB ?? "" });
  if (command === "list") {
    process.stdout.write(`${JSON.stringify(service.list(), null, 2)}\n`);
  } else if (command === "disable") {
    service.disable(username);
    process.stdout.write("Collaborator disabled; sessions revoked.\n");
  } else {
    const password = flag === "--stdin" ? await stdinPassword() : await hiddenPassword("Password (hidden): ");
    if (flag !== "--stdin" && password !== await hiddenPassword("Confirm password (hidden): ")) throw new Error("Passwords did not match.");
    if (command === "provision") {
      const user = await service.provision(username, password);
      process.stdout.write(`${JSON.stringify(user)}\n`);
    } else {
      await service.reset(username, password);
      process.stdout.write("Password reset; sessions revoked; collaborator enabled.\n");
    }
  }
} catch {
  // Never print driver exceptions, user input, password material or database records.
  process.stderr.write("Collaborator command failed. Check command syntax, DB path/access, unique username and password length (15–1024 characters, at most 1024 UTF-8 bytes).\n");
  process.exitCode = 1;
} finally { service?.close(); }
