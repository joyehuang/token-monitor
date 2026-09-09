#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectCodexUsageProfiles } = require('../src/shared/codexUsageProfiles');

const NOW = new Date('2026-09-09T12:00:00.000Z');

function usageLine(sessionNumber) {
  return [
    JSON.stringify({ timestamp: '2026-09-09T01:00:00.000Z', type: 'session_meta', payload: { id: `synthetic-${sessionNumber}` } }),
    JSON.stringify({
      timestamp: '2026-09-09T01:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 10 } } }
    })
  ].join('\n');
}

function cacheOffsetBounds(cachePath) {
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  return Object.values(cache.profiles['codex-work'].files).every((entry) => entry.offset <= entry.size);
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-codex-scanner-check-'));
  try {
    const parserRoot = path.join(temp, 'parser');
    const parserFile = path.join(parserRoot, '.codex', 'sessions', '2026', '09', '09', 'boundary.jsonl');
    const parserCache = path.join(temp, 'parser-cache.json');
    fs.mkdirSync(path.dirname(parserFile), { recursive: true });
    fs.writeFileSync(parserFile, '{}\n'.repeat(22000) + usageLine(1).split('\n')[1]);
    const parserOptions = {
      profiles: [{ id: 'codex-work', label: 'Work', path: parserRoot }],
      cachePath: parserCache,
      now: NOW
    };
    const first = collectCodexUsageProfiles(parserOptions);
    const firstOffsetBounded = cacheOffsetBounds(parserCache);
    fs.appendFileSync(parserFile, '\n{}\n{}\n');
    const appended = collectCodexUsageProfiles(parserOptions);
    const appendedOffsetBounded = cacheOffsetBounds(parserCache);
    const cold = collectCodexUsageProfiles({ ...parserOptions, cachePath: null });

    const budgetRoot = path.join(temp, 'budget');
    const budgetSessions = path.join(budgetRoot, '.codex', 'sessions', '2026', '09', '09');
    fs.mkdirSync(budgetSessions, { recursive: true });
    for (let index = 0; index < 3; index += 1) {
      fs.writeFileSync(path.join(budgetSessions, `${index}.jsonl`), `${usageLine(index + 2)}\n`);
    }
    const budgetOptions = {
      profiles: [{ id: 'codex-work', label: 'Work', path: budgetRoot }],
      cachePath: path.join(temp, 'budget-cache.json'),
      now: NOW,
      maxFiles: 2
    };
    const rounds = Array.from({ length: 4 }, () => collectCodexUsageProfiles(budgetOptions));

    const tailsRoot = path.join(temp, 'tails');
    const tailsSessions = path.join(tailsRoot, '.codex', 'sessions', '2026', '09', '09');
    fs.mkdirSync(tailsSessions, { recursive: true });
    fs.writeFileSync(path.join(tailsSessions, 'a.jsonl'), 'x'.repeat(300));
    fs.writeFileSync(path.join(tailsSessions, 'b.jsonl'), 'y'.repeat(300));
    const readBytes = [];
    for (let round = 0; round < 2; round += 1) {
      let total = 0;
      collectCodexUsageProfiles({
        profiles: [{ id: 'codex-work', label: 'Work', path: tailsRoot }],
        cachePath: path.join(temp, 'tails-cache.json'),
        now: NOW,
        maxBytesPerFile: 200,
        maxBytesPerProfile: 250,
        maxLineBytes: 1024,
        onReadBytes: (value) => { total += value; }
      });
      readBytes.push(total);
    }

    const finalBudget = rounds.at(-1);
    const report = {
      parser: {
        firstTokens: first.bundle.today.totalTokens,
        afterAppendTokens: appended.bundle.today.totalTokens,
        coldTokens: cold.bundle.today.totalTokens,
        offsetsWithinReadBounds: firstOffsetBounded && appendedOffsetBounded,
        malformedLines: appended.status[0].malformedLines
      },
      discovery: {
        roundTokens: rounds.map((result) => result.bundle.today.totalTokens),
        finalTokens: finalBudget.bundle.today.totalTokens,
        discoveredFiles: finalBudget.status[0].files,
        state: finalBudget.status[0].state,
        pendingFilesLowerBound: finalBudget.status[0].pendingFiles,
        truncated: finalBudget.status[0].truncated === true
      },
      byteBudget: {
        configuredBytesPerRound: 250,
        actualReadBytesPerRound: readBytes,
        respected: readBytes.every((value) => value <= 250)
      }
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
