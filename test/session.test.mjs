import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore } from '../web/session.mjs';
import { challengeWords, createPhrase } from '../server/challenges.mjs';

const memory = () => { const entries = new Map(); return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key), entries }; };
test('refresh restores the same session without extending its fixed one-hour expiry', () => {
 const storage = memory(), origin = 'https://backend.example'; let now = 100000;
 const first = createSessionStore(storage, origin, () => now), expires = now + 3600000;
 assert.equal(first.save('a'.repeat(43), expires), true);
 now += 3599000;
 const refreshed = createSessionStore(storage, origin, () => now);
 assert.deepEqual(refreshed.read(), { service: origin, token: 'a'.repeat(43), expires });
 now += 1000;
 assert.equal(createSessionStore(storage, origin, () => now).read(), null);
 assert.equal(storage.entries.size, 0);
});
test('logout, malformed storage, and a different backend cannot restore a local session', () => {
 const storage = memory(), store = createSessionStore(storage, 'https://one.example', () => 1);
 store.save('a'.repeat(43), 3600001); store.clear(); assert.equal(store.read(), null);
 store.save('a'.repeat(43), 3600001);
 assert.equal(createSessionStore(storage, 'https://two.example', () => 1).read(), null);
 storage.setItem('serverh.staff.session.v1', '{bad json'); assert.equal(store.read(), null);
 storage.setItem('serverh.staff.session.v1', JSON.stringify({ service:'https://one.example', token:'forged', expires:3600001 })); assert.equal(store.read(), null);
 assert.equal(createSessionStore(undefined, 'https://one.example').save('a'.repeat(43), Date.now()+1000), false);
});
test('verification produces exactly four alphabetic words from a large cryptographic word pool', () => {
 assert.ok(challengeWords.length >= 2048); assert.equal(new Set(challengeWords).size, challengeWords.length);
 for (let i = 0; i < 100; i++) {
  const phrase = createPhrase(); assert.match(phrase, /^[a-z]+ [a-z]+ [a-z]+ [a-z]+$/);
  assert.ok(phrase.split(' ').every(word => challengeWords.includes(word)));
 }
});
