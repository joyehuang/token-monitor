'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererDir = path.join(__dirname, '..', '..', 'src', 'electron', 'renderer');
const app = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');

function definedElementKeys(source) {
  return new Set([...source.matchAll(/(\w+):\s*document\.(?:getElementById|querySelector)/g)].map((match) => match[1]));
}

function referencedElementKeys(source) {
  return new Set([...source.matchAll(/\bels\.(\w+)/g)].map((match) => match[1]));
}

// A dropped `els` entry is invisible until the app boots: the first UNGUARDED
// `els.x.addEventListener` throws during renderer setup, so every panel below it
// stays empty and the widget looks like it lost all its data. Nothing else in the
// suite loads app.js against the real DOM, so guard the binding table directly.
test('every els.* reference is bound in the element map', () => {
  const defined = definedElementKeys(app);
  const missing = [...referencedElementKeys(app)].filter((key) => !defined.has(key));
  assert.deepEqual(missing, [], `els keys referenced but never bound: ${missing.join(', ')}`);
});

// A key bound to an id index.html does not have resolves to null, which throws
// the same way an unbound key does. Only referenced keys are checked: the map
// carries a few bindings nothing reads, and a null those never touch is inert.
test('every referenced els key resolves to an element in index.html', () => {
  const referenced = referencedElementKeys(app);
  const missing = [...app.matchAll(/(\w+):\s*document\.getElementById\('([^']+)'\)/g)]
    .filter((match) => referenced.has(match[1]) && !html.includes(`id="${match[2]}"`))
    .map((match) => match[2]);
  assert.deepEqual(missing, [], `element ids referenced by app.js but absent from index.html: ${missing.join(', ')}`);
});
