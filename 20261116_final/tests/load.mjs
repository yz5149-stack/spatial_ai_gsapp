// Loads a place in Node: data/<id>.json merged with its entry in src/data/places.js
import { readFileSync } from 'node:fs';
import { PLACES } from '../src/data/places.js';
export function loadPlace(id) {
  const meta = PLACES.find((p) => p.id === id);
  const data = JSON.parse(readFileSync(new URL(`../data/${id}.json`, import.meta.url)));
  return { ...data, ...meta };
}
