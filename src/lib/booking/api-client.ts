import { generateSlots, type Slot } from './slots';
import type { BookingRules } from '../content/schemas';

export type BuyerType = 'agency' | 'videographer' | 'agent' | 'other';
export interface LeadInput {
  name: string; email: string; phone?: string; buyerType: BuyerType; volume: string;
  footageUrl?: string; pageVersion: string; utm: Record<string, string>;
}
export interface BookingApi {
  createLead(input: LeadInput): Promise<{ leadId: string }>;
  getSlots(): Promise<Slot[]>;
  confirm(leadId: string, slot: Slot): Promise<{ start: string }>;
}
/** Thrown by confirm() when someone else booked the time first. */
export class SlotTakenError extends Error { constructor() { super('slot_taken'); this.name = 'SlotTakenError'; } }

/** Phase 1 stand-in for the real booking server: real slot rules, nothing leaves the browser. */
export function demoApi(rules: BookingRules, now: () => Date = () => new Date()): BookingApi {
  const taken = new Set<string>();
  let n = 0;
  return {
    async createLead() { n += 1; return { leadId: `demo-${n}` }; },
    async getSlots() { return generateSlots(rules, now()).filter((s) => !taken.has(s.start)); },
    async confirm(_leadId, slot) {
      if (taken.has(slot.start)) throw new SlotTakenError();
      taken.add(slot.start);
      return { start: slot.start };
    },
  };
}
