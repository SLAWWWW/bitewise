import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks the Gemini SDK so we can control exactly what the model "proposes"
// without a real network call — specifically to reproduce the case where
// the model tries to soften the deterministic floor verdict.
const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', NUMBER: 'NUMBER' },
  GoogleGenAI: vi.fn().mockImplementation(function GoogleGenAI(this: { models: unknown }) {
    this.models = { generateContent: mockGenerateContent };
  }),
}));

describe('runFoodSafetyCheck — escalateOnly must not leave a mismatched score/reasoning behind', () => {
  const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    mockGenerateContent.mockReset();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = ORIGINAL_KEY;
  });

  it('discards the model\'s own score/reasoning when its softer verdict gets overridden by the floor', async () => {
    const { runFoodSafetyCheck } = await import('@/lib/agents/food-safety-agent');

    // Cooked chicken curry declared safe for 48h at ambient — the
    // deterministic floor for cooked_high_risk (1h ambient max) is 'bad'.
    // The model proposes 'good' anyway, with a reassuring score/reasoning —
    // exactly the disagreement escalateOnly exists to catch.
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'good',
        score: 92,
        reasoning: 'This looks perfectly safe to serve.',
        recommended_storage_type: null,
        recommended_expiry_hours: null,
      }),
    });

    const result = await runFoodSafetyCheck({
      itemName: 'Chicken Curry',
      foodType: 'cooked',
      storageType: 'ambient',
      quantityKg: 10,
      expiryHours: 48,
    });

    expect(result.used_ai).toBe(true);
    expect(result.verdict).toBe('bad');
    // The bug: score/reasoning must track the overridden verdict, not the
    // model's rejected 'good' proposal.
    expect(result.score).toBeLessThan(40);
    expect(result.reasoning).not.toBe('This looks perfectly safe to serve.');
  });

  it('keeps the model\'s own score/reasoning when it agrees with (or escalates beyond) the floor', async () => {
    const { runFoodSafetyCheck } = await import('@/lib/agents/food-safety-agent');

    // Canned vegetables, correctly floors to 'good' — model agrees.
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'good',
        score: 88,
        reasoning: 'Unopened canned goods, shelf-stable, no concerns.',
        recommended_storage_type: null,
        recommended_expiry_hours: null,
      }),
    });

    const result = await runFoodSafetyCheck({
      itemName: 'Canned Vegetables',
      foodType: 'canned',
      storageType: 'ambient',
      quantityKg: 10,
      expiryHours: 4380,
    });

    expect(result.verdict).toBe('good');
    expect(result.score).toBe(88);
    expect(result.reasoning).toBe('Unopened canned goods, shelf-stable, no concerns.');
  });
});
