#!/usr/bin/env node
/**
 * Runs the frontend test suite in small batches, each in its own fresh
 * vitest process, instead of one giant `vitest run`.
 *
 * Why: a single vitest process running even one directory's worth of
 * files (9 files, src/pages/lms/__tests__) crashed with "JavaScript heap
 * out of memory" around 4GB — several page test files pull in heavy
 * libraries (jsPDF, xlsx, html2canvas) and jsdom environments that don't
 * fully release between files in the same process. Restarting the
 * process every few files caps peak memory instead of chasing the leak.
 *
 * This auto-discovers every *.test.js/.test.jsx under src/ so adding a
 * new test file needs no changes here — unlike a hardcoded per-directory
 * phase list, which silently misses new test folders.
 *
 * Usage:
 *   node scripts/run-tests-phased.mjs             # run everything, batches of 3 files
 *   node scripts/run-tests-phased.mjs --batch=5    # bigger/smaller batches (memory/speed tradeoff)
 *   node scripts/run-tests-phased.mjs src/pages/lms  # only discover test files under this path
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const TEST_FILE_RE = /\.test\.jsx?$/

function findTestFiles(path) {
  const stat = statSync(path)
  if (stat.isFile()) {
    return TEST_FILE_RE.test(path) ? [relative(process.cwd(), path).replace(/\\/g, '/')] : []
  }
  const results = []
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(path, entry)
    const entryStat = statSync(full)
    if (entryStat.isDirectory()) {
      results.push(...findTestFiles(full))
    } else if (TEST_FILE_RE.test(entry)) {
      results.push(relative(process.cwd(), full).replace(/\\/g, '/'))
    }
  }
  return results
}

const args = process.argv.slice(2)
let batchSize = 3
const searchRoots = []
for (const arg of args) {
  const batchMatch = arg.match(/^--batch=(\d+)$/)
  if (batchMatch) {
    batchSize = Number(batchMatch[1])
  } else {
    searchRoots.push(arg)
  }
}
if (searchRoots.length === 0) searchRoots.push('src')

const allFiles = searchRoots.flatMap((root) => findTestFiles(root)).sort()

if (allFiles.length === 0) {
  console.error(`No *.test.js(x) files found under: ${searchRoots.join(', ')}`)
  process.exit(1)
}

const batches = []
for (let i = 0; i < allFiles.length; i += batchSize) {
  batches.push(allFiles.slice(i, i + batchSize))
}

console.log(`Running ${allFiles.length} test file(s) in ${batches.length} batch(es) of up to ${batchSize} file(s) each.\n`)

let failed = false
const failedBatches = []
for (const [index, batch] of batches.entries()) {
  console.log(`\n=== Batch ${index + 1}/${batches.length}: ${batch.join(', ')} ===`)
  const result = spawnSync('npx', ['vitest', 'run', ...batch], { stdio: 'inherit', shell: true })
  if (result.status !== 0) {
    failed = true
    failedBatches.push(batch)
    console.error(`\n=== Batch ${index + 1} FAILED (exit ${result.status}) ===`)
    // Keep going so one broken/OOM batch doesn't hide failures in the rest.
  }
}

console.log(`\n=== Phased run complete: ${batches.length - failedBatches.length}/${batches.length} batches passed ===`)
if (failedBatches.length) {
  console.log('Failed batches:')
  for (const batch of failedBatches) console.log(`  - ${batch.join(', ')}`)
}

process.exit(failed ? 1 : 0)
