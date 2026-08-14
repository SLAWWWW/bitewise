import { createServerClient } from '@/lib/supabase-server';
import {
  runDonorImpactAgent,
  buildDeterministicMessage,
  type DonorImpactInput,
} from '@/lib/agents/donor-impact-agent';

/**
 * Streams the Donor Impact Agent's work as it happens (SSE).
 *
 * GET /api/agents/donor-impact?donor_id=<uuid>
 *
 * Events:
 *   step  — { id, label, status, note? }   — emitted as each piece of work completes
 *   message — { impact: DonorImpactMessage } — the drafted text
 *   done  — {}
 *   error — { message }
 *
 * Advisory only: the agent drafts a message; a human reviews and sends it.
 * No data is mutated. No caching — cheap enough to regenerate on each click.
 */
export async function GET(request: Request) {
  const donorId = new URL(request.url).searchParams.get('donor_id');
  if (!donorId) {
    return new Response(JSON.stringify({ error: 'donor_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const fail = (message: string) => {
        send('error', { message });
        controller.close();
      };

      try {
        const supabase = createServerClient();

        // ── Step 1: load donor record ────────────────────────────────────────
        send('step', { id: 'load', label: 'Loading donor profile', status: 'running' });

        const { data: donor, error: donorError } = await supabase
          .from('donors')
          .select('id, name')
          .eq('id', donorId)
          .single();

        if (donorError || !donor) return fail('Donor not found.');

        send('step', {
          id: 'load',
          label: `Donor loaded: ${donor.name}`,
          status: 'done',
        });

        // ── Step 2: fetch donation history ───────────────────────────────────
        send('step', { id: 'history', label: 'Fetching donation history', status: 'running' });

        const { data: rawDonations, error: donationsError } = await supabase
          .from('food_listings')
          .select('item_name, food_type, quantity_kg, matched_at')
          .eq('donor_id', donorId)
          .eq('status', 'matched')
          .order('matched_at', { ascending: false });

        if (donationsError) {
          console.error('[donor-impact] donation history query failed:', donationsError.message);
          // Non-fatal — proceed with empty history so the fallback message still works.
        }

        const donations = (rawDonations ?? []).map((d) => ({
          item_name: (d.item_name as string) ?? 'donation',
          food_type: (d.food_type as string) ?? 'other',
          quantity_kg: (d.quantity_kg as number) ?? 0,
          matched_at: d.matched_at as string | null,
        }));

        send('step', {
          id: 'history',
          label: `${donations.length} approved donation${donations.length === 1 ? '' : 's'} found`,
          status: 'done',
          note:
            donations.length > 0
              ? `${donations.reduce((s, d) => s + d.quantity_kg, 0).toFixed(1)} kg total`
              : 'no matched donations yet',
        });

        // ── Step 3: call the AI (or deterministic fallback) ─────────────────
        const hasKey = !!process.env.GEMINI_API_KEY;
        send('step', {
          id: 'draft',
          label: hasKey ? 'Drafting personalised message with the AI' : 'Drafting message (AI unavailable — using template)',
          status: 'running',
        });

        const input: DonorImpactInput = {
          donorId: donor.id,
          donorName: donor.name as string,
          donations,
        };

        let impact = buildDeterministicMessage(input); // start with fallback
        try {
          impact = await runDonorImpactAgent(input);
        } catch (err) {
          console.error('[donor-impact] agent call failed, using deterministic fallback:', err);
        }

        send('step', {
          id: 'draft',
          label: impact.generated_by_ai
            ? 'Message drafted by the AI'
            : 'Message drafted (AI unavailable — template used)',
          status: 'done',
        });

        send('message', { impact });
        send('done', {});
        controller.close();
      } catch (error) {
        console.error('[donor-impact] stream failed:', error);
        send('error', { message: 'The Donor Impact Agent hit an unexpected error.' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
