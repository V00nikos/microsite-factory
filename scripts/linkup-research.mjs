#!/usr/bin/env node
// linkup-research.mjs — the ONLY research path inside the automated pipeline.
// Wraps Linkup POST /v1/search with outputType "structured" so results arrive
// already shaped like the researcher findings contract (CLAUDE.md).
//
// Usage:
//   node linkup-research.mjs --query "acme funding" [--depth standard|deep] [--include-domains a.com,b.com]
//
// Prints the structured JSON to stdout. Non-zero exit with the API error on failure.

const TIMEOUT_MS = 30_000;

function parseArgs(argv) {
  const args = { depth: "standard" };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--query":
        args.query = argv[++i];
        break;
      case "--depth":
        args.depth = argv[++i];
        break;
      case "--include-domains":
        args.includeDomains = argv[++i]
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);
        break;
      default:
        fail(`unknown argument: ${argv[i]}`);
    }
  }
  if (!args.query) fail("--query is required");
  if (!["standard", "deep"].includes(args.depth))
    fail(`--depth must be standard|deep, got: ${args.depth}`);
  return args;
}

function fail(msg, code = 1) {
  process.stderr.write(`linkup-research: ${msg}\n`);
  process.exit(code);
}

// LINKUP_API_KEY from process env, falling back to ~/.hermes/.env then repo .env
// (the Hermes terminal tool does not always export the gateway's env).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function envFallback(key) {
  if (process.env[key]) return process.env[key];
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const p of [join(homedir(), ".hermes", ".env"), join(repoRoot, ".env")]) {
    try {
      const line = readFileSync(p, "utf8")
        .split("\n")
        .find((l) => l.startsWith(`${key}=`));
      if (line) return line.slice(key.length + 1).trim();
    } catch {}
  }
  return undefined;
}

// Matches the findings[] portion of the frozen researcher output contract.
const structuredOutputSchema = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      description:
        "Specific, checkable claims about the target company. Only include claims directly supported by a source page found in this search. No source, no finding.",
      items: {
        type: "object",
        properties: {
          claim: {
            type: "string",
            description: "One specific, checkable statement about the company",
          },
          source_url: {
            type: "string",
            description: "URL of the page that supports the claim",
          },
          recency: {
            type: "string",
            description: "YYYY-MM of the source or the event it reports",
          },
          signal_type: {
            type: "string",
            enum: ["stack", "hiring", "funding", "news", "positioning"],
          },
          hook_strength: {
            type: "number",
            description:
              "1-5: how usable this is as a personalized outreach hook (5 = recent, specific, emotionally salient to the reader)",
          },
        },
        required: ["claim", "source_url", "recency", "signal_type", "hook_strength"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

const args = parseArgs(process.argv);
const apiKey = envFallback("LINKUP_API_KEY");
if (!apiKey) fail("LINKUP_API_KEY not set (env, ~/.hermes/.env, or repo .env)");

const body = {
  q: args.query,
  depth: args.depth,
  outputType: "structured",
  structuredOutputSchema: JSON.stringify(structuredOutputSchema),
};
if (args.includeDomains?.length) body.includeDomains = args.includeDomains;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

try {
  const res = await fetch("https://api.linkup.so/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  const text = await res.text();
  if (!res.ok) fail(`API error ${res.status}: ${text}`);
  // Validate it's JSON before printing so downstream never parses garbage.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(`API returned non-JSON: ${text.slice(0, 500)}`);
  }
  process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
} catch (err) {
  if (err.name === "AbortError") fail(`timed out after ${TIMEOUT_MS / 1000}s`);
  fail(err.message);
} finally {
  clearTimeout(timer);
}
