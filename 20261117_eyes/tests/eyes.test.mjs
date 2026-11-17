// The eyes model: real counts in, sensible measures out, and lights change where people walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPlace } from '../../20261116_final/tests/load.mjs';
import { makeModel, runScenario, lampsFor, streetTable } from '../src/eyes.js';

const data = JSON.parse(readFileSync(new URL('../data/morningside-eyes.json', import.meta.url)));
const model = makeModel(loadPlace('morningside'), data);
const base = { day: 'weekday', others: 1.5, darkAvoid: 1.5, pathLamps: true, outages: 'none' };

test('the station counts are real and plausible', () => {
  const day = (a) => a.reduce((s, v) => s + v, 0);
  assert.ok(day(data.entries.weekday) > 5000 && day(data.exits.weekday) > 5000);
  assert.ok(data.entries.weekday[17] > data.entries.weekday[3] * 20, 'evening peak over the small hours');
  assert.ok(model.station.length >= 1 && model.streetLamps.length > 50);
});

test('busier hours put more eyes on the street', () => {
  const r = runScenario(model, base);
  assert.ok(r.measures[18].watchedShare > r.measures[3].watchedShare);
  assert.ok(r.measures[3].exposedWalking > r.measures[18].exposedWalking);
  for (const m of r.measures) for (const k of ['watchedShare', 'litShare', 'darkUnwatchedShare', 'exposedWalking']) assert.ok(m[k] >= 0 && m[k] <= 1);
});

test('311 outages switch lights off and make the night darker', () => {
  const on = lampsFor(model, base).filter((l) => l.on).length;
  const off = lampsFor(model, { ...base, outages: 'all' }).filter((l) => l.on).length;
  assert.ok(off < on);
  const a = runScenario(model, base); const b = runScenario(model, { ...base, outages: 'all' });
  assert.ok(b.measures[23].darkUnwatchedShare >= a.measures[23].darkUnwatchedShare);
});

test('unlit paths make people walk around them at night', () => {
  const lit = runScenario(model, base); const dark = runScenario(model, { ...base, pathLamps: false });
  assert.ok(dark.detour > lit.detour);
  assert.ok(dark.measures[23].litShare < lit.measures[23].litShare);
});

test('a late-night shop adds eyes around it after the other shops close', () => {
  const shop = model.world.nodes[Math.floor(model.world.nodes.length / 2)];
  const a = runScenario(model, base); const b = runScenario(model, { ...base, lateShops: [shop] });
  assert.ok(b.hours[23].eyes[shop] > a.hours[23].eyes[shop] + 0.5);
  assert.ok(streetTable(model, b.light, b.hours[23]).length > 5);
});
