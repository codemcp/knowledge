#!/usr/bin/env node

/**
 * Test runner for Agentic Knowledge.
 *
 * Runs the test suite for every workspace package plus the root e2e suite and
 * prints an aggregated summary.
 *
 * Design notes:
 * - Child output is streamed straight through to this process's stdout/stderr
 *   so failing assertions, stack traces and vitest diffs always end up in the
 *   CI log. It is also buffered so the counts can be parsed for the summary.
 * - Success/failure is decided by the child *exit code*, never by parsing.
 *   Parsing is best-effort presentation only; a summary line we fail to
 *   recognise can therefore never turn a red run green.
 */

import { spawn } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

function stripAnsiCodes(value) {
  return typeof value === "string" ? value.replace(ANSI_PATTERN, "") : "";
}

/**
 * Spawn a command, streaming its output while also capturing it.
 *
 * @returns {Promise<{exitCode: number, output: string}>}
 */
function runCommand(command, args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let output = "";

    const forward = (stream, sink) => {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        output += chunk;
        sink.write(chunk);
      });
    };

    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);

    child.on("error", (error) => {
      process.stderr.write(`\nFailed to run ${command}: ${error.message}\n`);
      resolvePromise({ exitCode: 1, output });
    });

    child.on("close", (code, signal) => {
      resolvePromise({
        exitCode: code ?? (signal ? 1 : 0),
        output,
      });
    });
  });
}

/**
 * Parse the vitest `Tests ...` summary line.
 *
 * Handles every combination vitest emits, e.g.
 *   Tests  12 passed (12)
 *   Tests  1 failed | 30 passed (31)
 *   Tests  1 failed | 11 skipped (12)
 *   Tests  2 failed | 100 passed | 5 skipped (107)
 *
 * @returns {{passed: number, failed: number, skipped: number, todo: number, total: number} | null}
 */
function parseTestCounts(rawOutput) {
  const lines = stripAnsiCodes(rawOutput).split("\n");

  // Take the LAST matching line. "Test Files" never matches because `Tests`
  // requires the trailing "s" followed by whitespace.
  let summaryLine = null;
  for (const line of lines) {
    const match = line.match(/^\s*Tests\s+(\S.*?)\s*$/);
    if (match) {
      summaryLine = match[1];
    }
  }

  if (summaryLine === null) {
    return null;
  }

  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0 };
  let sawAnyCount = false;

  for (const match of summaryLine.matchAll(
    /(\d+)\s+(passed|failed|skipped|todo)/g,
  )) {
    counts[match[2]] += Number(match[1]);
    sawAnyCount = true;
  }

  if (!sawAnyCount) {
    return null;
  }

  const totalMatch = summaryLine.match(/\((\d+)\)\s*$/);
  counts.total = totalMatch
    ? Number(totalMatch[1])
    : counts.passed + counts.failed + counts.skipped + counts.todo;

  return counts;
}

/** Discover every workspace package that exposes a `test` script. */
function getWorkspacePackages() {
  const packagesDir = join(repoRoot, "packages");
  if (!existsSync(packagesDir)) {
    return [];
  }

  const packages = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) {
      continue;
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.scripts?.test) {
        packages.push({
          label: manifest.name ?? entry.name,
          cwd: join(packagesDir, entry.name),
        });
      }
    } catch {
      process.stderr.write(`Skipping unreadable manifest: ${manifestPath}\n`);
    }
  }

  return packages;
}

function formatCounts(counts) {
  if (!counts) {
    return "no summary reported";
  }

  const parts = [`${counts.passed}/${counts.total} passed`];
  if (counts.failed > 0) {
    parts.push(`${counts.failed} failed`);
  }
  if (counts.skipped > 0) {
    parts.push(`${counts.skipped} skipped`);
  }
  if (counts.todo > 0) {
    parts.push(`${counts.todo} todo`);
  }
  return parts.join(", ");
}

async function main() {
  const targets = [
    ...getWorkspacePackages(),
    { label: "e2e", cwd: repoRoot, args: ["vitest", "run", "test/e2e/"] },
  ];

  const results = [];

  for (const target of targets) {
    const heading = `Running ${target.label} tests`;
    console.log(`\n${"─".repeat(60)}`);
    console.log(heading);
    console.log(`${"─".repeat(60)}`);

    const { exitCode, output } = await runCommand(
      "pnpm",
      target.args ?? ["test"],
      target.cwd,
    );

    results.push({
      label: target.label,
      exitCode,
      counts: parseTestCounts(output),
    });
  }

  const line = "=".repeat(60);
  console.log(`\n${line}`);
  console.log("TEST SUMMARY");
  console.log(line);

  const totals = { passed: 0, failed: 0, skipped: 0, total: 0 };

  for (const result of results) {
    const ok = result.exitCode === 0;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${result.label}: ${formatCounts(result.counts)}` +
        (ok ? "" : ` (exit code ${result.exitCode})`),
    );

    if (result.counts) {
      totals.passed += result.counts.passed;
      totals.failed += result.counts.failed;
      totals.skipped += result.counts.skipped;
      totals.total += result.counts.total;
    }
  }

  console.log(`\n${"-".repeat(60)}`);
  console.log("TOTAL RESULTS:");
  console.log(`   - Suites run:   ${results.length}`);
  console.log(`   - Tests passed: ${totals.passed}`);
  console.log(`   - Tests failed: ${totals.failed}`);
  console.log(`   - Tests skipped: ${totals.skipped}`);
  console.log(`   - Total tests:  ${totals.total}`);

  const failedSuites = results.filter((result) => result.exitCode !== 0);
  const unparsedSuites = results.filter((result) => result.counts === null);

  console.log(line);

  if (failedSuites.length > 0) {
    console.error("\nFAILED SUITES:");
    for (const suite of failedSuites) {
      console.error(`   - ${suite.label} (exit code ${suite.exitCode})`);
    }
    console.error(
      "\nScroll up to the matching section above for the full failure output.",
    );
    console.error(line);
    process.exitCode = 1;
    return;
  }

  if (totals.total === 0) {
    console.error("\nNO TESTS WERE EXECUTED.");
    console.error(line);
    process.exitCode = 1;
    return;
  }

  if (unparsedSuites.length > 0) {
    // Exit code says the suite passed, so this is a reporting warning only.
    console.log(
      `\nNote: could not parse a test summary for: ${unparsedSuites
        .map((suite) => suite.label)
        .join(", ")}`,
    );
  }

  console.log("\nAll tests passed.");
  console.log(line);
}

main().catch((error) => {
  console.error("\n" + "=".repeat(60));
  console.error("TEST RUNNER CRASHED");
  console.error("=".repeat(60));
  console.error(error instanceof Error ? error.stack : String(error));
  console.error("=".repeat(60));
  process.exitCode = 1;
});
