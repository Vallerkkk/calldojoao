import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../static/runtime-utils.js', import.meta.url));
const { DraftStore, serialToggle } = await import('data:text/javascript;base64,' + source.toString('base64'));

test('drafts remain separate for channels and accounts, then clear on logout', () => {
  const drafts = new DraftStore();
  drafts.set('one:channel:a', 'primeira\nsegunda');
  drafts.set('two:channel:a', 'outra conta');
  assert.equal(drafts.get('one:channel:a'), 'primeira\nsegunda');
  assert.equal(drafts.get('two:channel:a'), 'outra conta');
  drafts.clear();
  assert.equal(drafts.get('one:channel:a'), '');
});

test('draft revisions distinguish newly typed text from an older pending send', () => {
  const drafts = new DraftStore();
  drafts.set('channel', 'olá');
  const revision = drafts.revision('channel');
  drafts.set('channel', 'olá');
  assert.equal(drafts.revision('channel'), revision);
  drafts.set('channel', '');
  drafts.set('channel', 'olá');
  assert.notEqual(drafts.revision('channel'), revision);
});

test('draft memory has a fixed bound', () => {
  const drafts = new DraftStore(2);
  for (const key of ['a', 'b', 'c']) drafts.set(key, key);
  assert.equal(drafts.get('a'), '');
  assert.equal(drafts.get('c'), 'c');
});

test('releasing push-to-talk during device startup finishes muted', async () => {
  let release;
  const states = [], target = {};
  const toggle = serialToggle(async (_target, state) => {
    states.push(state);
    if (state) await new Promise(resolve => { release = resolve; });
  });
  const down = toggle.set(target, true);
  await Promise.resolve();
  const up = toggle.set(target, false);
  release();
  await Promise.all([down, up]);
  assert.deepEqual(states, [true, false]);
});

test('a burst of toggles applies the latest requested state', async () => {
  const states = [], target = {};
  const toggle = serialToggle(async (_target, state) => { states.push(state); });
  await Promise.all([toggle.set(target, true), toggle.set(target, false), toggle.set(target, true)]);
  assert.equal(states.at(-1), true);
});

test('a failed device change does not leave future microphone commands stuck', async () => {
  const states = [], errors = [];
  const toggle = serialToggle(async (_target, state) => { if (state) throw Error('device lost'); states.push(state); }, error => errors.push(error.message));
  await toggle.set({}, true);
  await toggle.set({}, false);
  assert.deepEqual(errors, ['device lost']);
  assert.deepEqual(states, [false]);
});

test('joining another room preserves the queued mute for the previous microphone', async () => {
  const first = {}, second = {}, states = [];
  let release;
  const toggle = serialToggle(async (target, state) => {
    states.push([target === first ? 'first' : 'second', state]);
    if (target === first && state) await new Promise(resolve => { release = resolve; });
  });
  const enabling = toggle.set(first, true);
  await Promise.resolve();
  const muting = toggle.set(first, false);
  const joining = toggle.set(second, true);
  release();
  await Promise.all([enabling, muting, joining]);
  assert.deepEqual(states, [['first', true], ['first', false], ['second', true]]);
});
