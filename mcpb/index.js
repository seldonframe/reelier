#!/usr/bin/env node
// Thin launcher: the real server is the published npm package `reelier`.
// Clients normally use manifest.json's mcp_config (npx -y reelier serve);
// this entry point exists for hosts that execute the bundle directly.
const { spawn } = require("node:child_process");
const child = spawn("npx", ["-y", "reelier@0.13.0", "serve"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error("Failed to launch reelier serve via npx:", err.message);
  process.exit(1);
});
