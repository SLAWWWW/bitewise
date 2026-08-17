import { describe, it, expect } from 'vitest';
import { buildDeterministicMessage, type DonorImpactInput } from '@/lib/agents/donor-impact-agent';

// The Donor Impact Agent's deterministic fallback had zero test coverage —
// the newest agent, added under time pressure, and the only one whose
// pure/no-AI path (used whenever GEMINI_API_KEY is unset or the model call
// fails) had never been directly exercised.

describe('buildDeterministicMessage', () => {
  it('drafts a first-donation message when the donor has no history yet', () => {
    const input: DonorImpactInput = { donorId: 'd1', donorName: 'Test Kitchen', donations: [] };
    const result = buildDeterministicMessage(input);

    expect(result.generated_by_ai).toBe(false);
    expect(result.message).toContain('Test Kitchen');
    expect(result.message.toLowerCase()).toContain('first donation');
    expect(result.generated_at).toBeTruthy();
  });

  it('singularizes "donation" for exactly one past donation', () => {
    const input: DonorImpactInput = {
      donorId: 'd2',
      donorName: 'Solo Donor',
      donations: [{ item_name: 'Bread Loaves', food_type: 'bread', quantity_kg: 12, matched_at: '2026-08-01T00:00:00Z' }],
    };
    const result = buildDeterministicMessage(input);

    expect(result.message).toContain('1 donation');
    expect(result.message).not.toContain('1 donations');
  });

  it('pluralizes "donations" and cites real totals for multiple donations', () => {
    const input: DonorImpactInput = {
      donorId: 'd3',
      donorName: 'Marina Bay Sands',
      donations: [
        { item_name: 'Bagels', food_type: 'dairy', quantity_kg: 50, matched_at: '2026-08-13T00:00:00Z' },
        { item_name: 'Yoghurt Cups', food_type: 'dairy', quantity_kg: 71, matched_at: '2026-08-10T00:00:00Z' },
        { item_name: 'Snack Packs', food_type: 'other', quantity_kg: 40, matched_at: '2026-08-05T00:00:00Z' },
      ],
    };
    const result = buildDeterministicMessage(input);

    expect(result.message).toContain('3 donations');
    expect(result.message).toContain('161kg'); // 50 + 71 + 40, en-SG formatted
    expect(result.message).toContain('dairy'); // most-donated food type by kg
    expect(result.message).toContain('Bagels'); // most recent by matched_at
    expect(result.message).toMatch(/\d+ meals/);
    expect(result.message).toMatch(/kg of CO₂/);
  });

  it('never mentions the model by name, only ever "we"/"Willing Hearts"', () => {
    const input: DonorImpactInput = {
      donorId: 'd4',
      donorName: 'Anonymous Co',
      donations: [{ item_name: 'Rice', food_type: 'grain', quantity_kg: 5, matched_at: null }],
    };
    const result = buildDeterministicMessage(input);

    expect(result.message.toLowerCase()).not.toContain('gemini');
    expect(result.message.toLowerCase()).not.toContain(' ai ');
  });
});
