import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const dataDir = path.join(root, 'data');
const livePath = path.join(dataDir, 'workspace.json');
const seedPath = path.join(dataDir, 'seed.json');

function seed() { return JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
export function loadStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(livePath)) saveStore(seed());
  return JSON.parse(fs.readFileSync(livePath, 'utf8'));
}
export function saveStore(data) {
  fs.mkdirSync(dataDir, { recursive: true });
  const temp = `${livePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, livePath);
  try { fs.chmodSync(livePath, 0o600); } catch {}
}
export function updateStore(mutator) {
  const data = loadStore();
  const result = mutator(data);
  saveStore(data);
  return result;
}
export function appendAudit(data, action, details = {}) {
  data.audit.unshift({ id: randomUUID(), action, details, createdAt: new Date().toISOString() });
  data.audit = data.audit.slice(0, 500);
}
