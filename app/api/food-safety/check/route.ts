import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runFoodSafetyCheck } from '@/lib/agents/food-safety-agent';
import { isRateLimited, clientKey } from '@/lib/rate-limit';
import type { FoodSafetyCheckResponse } from '@/lib/types';

const CheckRequestSchema = z.object({
  item_name: z.string().min(1).max(200),
  food_type: z.enum(['bread', 'cooked', 'produce', 'canned', 'dairy', 'beverage', 'grain', 'other']),
  storage_type: z.enum(['ambient', 'cold', 'frozen']),
  quantity_kg: z.number().positive().max(10000),
  expiry_hours: z.number().positive().max(8760),
  note: z.string().max(500).optional().default(''),
});

/**
 * The same standardized check `POST /api/listings` runs server-side as the
 * submission gate, exposed standalone so `/donate` can show the donor an
 * instant verdict before they commit — same corpus, same scoring, so the
 * two surfaces can never disagree about a given item.
 */
export async function POST(request: Request) {
  // Public live-preview endpoint, one Gemini call per request — the easiest
  // single place to burn through the shared free-tier quota if someone
  // scripts repeated calls (or a client bug re-fires without debounce).
  if (isRateLimited(`food-safety-check:${clientKey(request)}`, 12)) {
    return NextResponse.json(
      { success: false, message: 'Too many checks — please wait a minute and try again.' },
      { status: 429 }
    );
  }

  const body = await request.json();
  const parsed = CheckRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await runFoodSafetyCheck({
      itemName: parsed.data.item_name,
      foodType: parsed.data.food_type,
      storageType: parsed.data.storage_type,
      quantityKg: parsed.data.quantity_kg,
      expiryHours: parsed.data.expiry_hours,
      note: parsed.data.note,
    });
    const response: FoodSafetyCheckResponse = { success: true, result };
    return NextResponse.json(response);
  } catch (error) {
    console.error('[food-safety/check] failed:', error);
    const response: FoodSafetyCheckResponse = { success: false, message: 'Safety check is temporarily unavailable — submit and staff will review manually.' };
    return NextResponse.json(response, { status: 200 });
  }
}
