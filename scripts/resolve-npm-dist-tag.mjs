#!/usr/bin/env node

function fail(message) {
  process.stderr.write(`resolve-npm-dist-tag: ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--version") fail("usage: --version <semver>");

const version = args[1];
const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
if (!match) fail("invalid npm release version");

const prerelease = match[4];
if (prerelease) {
  for (const identifier of prerelease.split(".")) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
      fail("invalid npm release version");
    }
  }
}

process.stdout.write(`${prerelease ? "beta" : "latest"}\n`);
