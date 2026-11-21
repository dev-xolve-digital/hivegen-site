import { describe, it, expect } from 'vitest';
import { createMemoryStore } from '../../src/server/store/memory';
import { storeContract } from '../contract/store.contract';

describe('memory store', () => {
  storeContract(async () => ({ store: createMemoryStore(), done: async () => {} }));

  it('hands out copies, so a caller cannot change what is stored', async () => {
    const store = createMemoryStore();
    const input = { publicId: 'p1', name: 'Ann', email: 'ann@example.com', buyerType: 'agent' as const, volume: '1–5', pageVersion: 'main' as const, attribution: { utm_source: 'x' } };
    const saved = await store.createLead(input, new Date('2026-12-01T10:00:00Z'));
    input.attribution.utm_source = 'changed-after';
    saved.name = 'Changed';
    saved.attribution.utm_source = 'changed-too';
    (await store.getLead(saved.id))!.name = 'Changed again';
    expect(await store.getLead(saved.id)).toMatchObject({ name: 'Ann', attribution: { utm_source: 'x' } });
  });
});
