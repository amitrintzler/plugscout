#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const ALLOWLIST = [
  /^\.github\/workflows\/.+/u,
  /^docs\/.+/u,
  /^tests\/.+/u,
  /^scripts\/.+/u,
  /^\.gitignore$/u,
  /^README\.md$/u
];

function changedFiles() {
  const output = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
    .split('\n')
    .filter((line) => line.length >= 4);

  if (output.length === 0) {
    return [];
  }

  const files = new Set();
  output.forEach((line) => {
    const rawPath = line.slice(3).trim();
    const candidate = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) : rawPath;
    if (candidate.length > 0) {
      if (candidate.startsWith('.toolkit/')) {
        return;
      }
      files.add(candidate);
    }
  });
  return Array.from(files);
}

function isAllowed(file) {
  return ALLOWLIST.some((pattern) => pattern.test(file));
}

const files = changedFiles();
if (files.length === 0) {
  process.stdout.write('No file changes to validate.\n');
  process.exit(0);
}

const disallowed = files.filter((file) => !isAllowed(file));
if (disallowed.length > 0) {
  process.stderr.write('Zero-impact gate failed. Disallowed changed files:\n');
  disallowed.forEach((file) => process.stderr.write(`- ${file}\n`));
  process.exit(1);
}

process.stdout.write(`Zero-impact gate passed for ${files.length} file(s).\n`);
