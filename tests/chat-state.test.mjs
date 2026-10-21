import test from 'node:test';
import assert from 'node:assert/strict';
import {ConversationCache, MessageOutbox, conversationKey, requestWithDeadline} from '../static/chat-state.js';

test('cache separates accounts, DMs and channels and copies the message map', () => {
  const cache = new ConversationCache(), target = {id: 'same'};
  const key = conversationKey('alice', target), messages = new Map([['one', {id: 'one'}]]);
  cache.save(key, {messages, scroll: {top: 150}}); messages.clear();
  assert.equal(cache.get(key).messages.size, 1);
  assert.equal(cache.get(conversationKey('bob', target)), undefined);
  assert.equal(cache.get(conversationKey('alice', {...target, private: true})), undefined);
  cache.get(key).messages.clear(); assert.equal(cache.get(key).messages.size, 1);
  cache.clear(); assert.equal(cache.get(key), undefined);
});
test('cache enforces expiry, LRU and a total message budget', () => {
  let now = 0; const cache = new ConversationCache({limit: 2, rows: 3, ttl: 50, now: () => now});
  const view = {messages: new Map([['a', {id: 'a'}]])};
  cache.save('one', view); cache.save('two', view); cache.get('one'); cache.save('three', view);
  assert.equal(cache.get('two'), undefined);
  cache.patch('one', {id: 'b'}); cache.patch('one', {id: 'c'}); assert.equal(cache.get('three'), undefined);
  now = 51; assert.equal(cache.get('one'), undefined);
});
test('cache purges revoked scopes and accepts targeted edits and deletions', () => {
  const cache = new ConversationCache(); cache.save('allowed', {messages: new Map()}); cache.save('revoked', {messages: new Map()});
  cache.patch('allowed', {id: 'a', content: 'editada'}); assert.equal(cache.get('allowed').messages.get('a').content, 'editada');
  cache.remove('allowed', 'a'); assert.equal(cache.get('allowed').messages.size, 0);
  cache.retain(key => key === 'allowed'); assert.equal(cache.get('revoked'), undefined);
});
test('outbox scopes pending rows and reconciles an acknowledgement before the HTTP response', () => {
  const box = new MessageOutbox(), target = {id: 'room'};
  const pending = box.add('alice', target, 'oi', null);
  assert.equal(box.rows('alice', target)[0].local_state, 'sending'); assert.equal(box.rows('bob', target).length, 0);
  const found = box.observe('alice', target, {id: 'real', author_id: 'alice', content: 'oi', created_at: pending.created_at});
  assert.equal(found, pending); assert.equal(box.rows('alice', target).length, 0);
  box.remove(pending.id); assert.equal(box.items.size, 0);
});
test('outbox does not acknowledge another author, scope, thread or ambiguous duplicate', () => {
  const box = new MessageOutbox(), target = {id: 'room'}, a = box.add('alice', target, 'oi', null);
  const message = {id: 'server', author_id: 'alice', content: 'oi', created_at: a.created_at};
  assert.equal(box.observe('alice', {id: 'other'}, message), undefined);
  assert.equal(box.observe('alice', target, {...message, author_id: 'bob'}), undefined);
  assert.equal(box.observe('alice', target, {...message, thread_root: 'root'}), undefined);
  box.add('alice', target, 'oi', null); assert.equal(box.observe('alice', target, message), undefined);
  box.clear(); assert.equal(box.items.size, 0);
});
test('outbox has a fixed bound and keeps failed messages available', () => {
  const box = new MessageOutbox(1), target = {id: 'room'}; box.add('alice', target, 'texto', null).status = 'error';
  assert.equal(box.rows('alice', target)[0].content, 'texto'); assert.throws(() => box.add('alice', target, 'mais', null));
});

test('an earlier identical message cannot acknowledge a new pending send', () => {
  const box=new MessageOutbox(),target={id:'room'},pending=box.add('alice',target,'oi',null);
  pending.knownIds=new Set(['earlier']);
  const message={id:'earlier',author_id:'alice',content:'oi',created_at:pending.created_at};
  assert.equal(box.observe('alice',target,message),undefined);
  assert.equal(box.rows('alice',target).length,1);
  assert.equal(box.observe('alice',target,{...message,id:'new'}),pending);
});

test('a cancelled request never starts its query or fetch factory', async () => {
  const controller=new AbortController();controller.abort();let started=false;
  await assert.rejects(requestWithDeadline(()=>{started=true;},{signal:controller.signal}),{name:'AbortError'});
  assert.equal(started,false);
});

test('factories receive cancellation and synchronous failures clean up', async () => {
  let signal;
  await assert.rejects(requestWithDeadline(value=>{signal=value;return new Promise(()=>{});},{timeout:10}),{name:'TimeoutError'});
  assert.equal(signal.aborted,true);
  await assert.rejects(requestWithDeadline(()=>{throw Error('query failed');}),/query failed/);
  assert.equal(await requestWithDeadline(()=>Promise.resolve('recovered')),'recovered');
});
test('read deadline releases a request that never settles', async () => {
  let signal;
  const query = {abortSignal(value) { signal = value; return new Promise(() => {}); }};
  await assert.rejects(requestWithDeadline(query, {timeout: 10}), {name: 'TimeoutError'}); assert.equal(signal.aborted, true);
});
test('navigation cancellation aborts an earlier read and normal reads clean up', async () => {
  const controller = new AbortController(); const task = requestWithDeadline(new Promise(() => {}), {signal: controller.signal}); controller.abort();
  await assert.rejects(task, {name: 'AbortError'});
  assert.deepEqual(await requestWithDeadline(Promise.resolve({data: [1]})), {data: [1]});
});
