'use strict';
/**
 * Sequential ingestion orchestrator with resume-friendly steps.
 * Usage:
 *   node scripts/ingest/run.js                # all sources in order
 *   node scripts/ingest/run.js --only=mondo,hpo
 *   node scripts/ingest/run.js --skip=openfda
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const STEPS = [
  ['mondo', 'mondo.js'],
  ['hpo', 'hpo.js'],
  ['orphadata', 'orphadata.js'],
  ['uberon', 'uberon.js'],
  ['taxonomy', 'taxonomy.js'],
  ['labs', 'labs.js'],
  ['openfda', 'openfda.js'],
  ['doid', 'doid.js'],
  ['ncbi_gene', 'ncbi-gene.js'],
  ['icd10cm', 'icd10cm.js'],
  ['reactome', 'reactome.js'],
  ['uniprot', 'uniprot.js'],
  ['vi', 'vi-terms.js'],
  ['reindex', 'reindex.js']
];

const args = process.argv.slice(2);
const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean);
const skip = args.find(a => a.startsWith('--skip='))?.slice(7).split(',').filter(Boolean) || [];

const results = [];
for (const [name, file] of STEPS) {
  if (only && !only.includes(name)) continue;
  if (skip.includes(name)) { results.push([name, 'skipped']); continue; }
  if (name === 'reindex' && only && !only.includes('reindex')) continue;
  console.log(`\n=== ${name} ===`);
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', env: process.env });
  const ok = res.status === 0;
  results.push([name, ok ? 'ok' : `failed (${res.status})`]);
  console.log(`=== ${name}: ${ok ? 'ok' : 'failed'} (${((Date.now() - started) / 1000).toFixed(1)}s) ===`);
}

console.log('\nTổng kết:');
for (const [name, status] of results) console.log(`- ${name}: ${status}`);
if (results.some(([, status]) => status.startsWith('failed'))) process.exitCode = 1;
