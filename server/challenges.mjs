import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';

export const challengeWords = Object.freeze(readFileSync(new URL('./challenge-words.txt', import.meta.url), 'utf8').split(/\r?\n/).filter(word => word && !word.startsWith('#')));
if (challengeWords.length < 2048 || new Set(challengeWords).size !== challengeWords.length || challengeWords.some(word => !/^[a-z]{3,8}$/.test(word))) throw new Error('The verification word pool is invalid.');
export function createPhrase() {
  return Array.from({ length: 4 }, () => challengeWords[randomInt(challengeWords.length)]).join(' ');
}
