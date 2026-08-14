'use client';

import { useCallback, useRef, useState } from 'react';
import {
  MessageCircleHeart,
  Loader2,
  Check,
  AlertTriangle,
  Sparkles,
  ClipboardCopy,
  Wrench,
} from 'lucide-react';
import type { DonorImpactMessage } from '@/lib/types';

interface StreamStep {
  id: string;
  label: string;
  status: 'running' | 'done';
  note?: string;
}

export function DonorImpactPanel({ donorId }: { donorId: string }) {
  const [steps, setSteps] = useState<StreamStep[]>([]);
  const [impact, setImpact] = useState<DonorImpactMessage | null>(null);
  const [state, setState] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async () => {
    if (state === 'streaming') return;
    setState('streaming');
    setSteps([]);
    setImpact(null);
    setError(null);
    setCopied(false);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(`/api/agents/donor-impact?donor_id=${donorId}`, {
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error('Could not reach the Donor Impact Agent.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const evLine = frame.split('\n').find((l) => l.startsWith('event: '));
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!evLine || !dataLine) continue;

          const event = evLine.slice(7).trim();
          const data = JSON.parse(dataLine.slice(6));

          if (event === 'step') {
            setSteps((prev) => {
              const next = [...prev];
              const at = next.findIndex((s) => s.id === data.id);
              if (at >= 0) next[at] = data;
              else next.push(data);
              return next;
            });
          } else if (event === 'message') {
            setImpact(data.impact as DonorImpactMessage);
          } else if (event === 'error') {
            setError(data.message);
            setState('error');
          } else if (event === 'done') {
            setState((s) => (s === 'error' ? s : 'done'));
          }
        }
      }
      setState((s) => (s === 'error' ? s : 'done'));
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError('The Donor Impact Agent could not be reached.');
      setState('error');
    }
  }, [donorId, state]);

  const copy = useCallback(() => {
    if (!impact) return;
    navigator.clipboard.writeText(impact.message).then(() => {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2500);
    });
  }, [impact]);

  if (state === 'idle') {
    return (
      <button
        type="button"
        className="btn btn-secondary flex items-center justify-center gap-2"
        onClick={run}
        aria-label="Draft a personalised impact update for this donor"
      >
        <MessageCircleHeart size={15} />
        Draft impact update
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Live agent thinking steps */}
      {(state === 'streaming' || steps.length > 0) && !impact && (
        <div className="glass-card-nested p-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            {state === 'streaming' ? (
              <Loader2 size={14} color="var(--accent)" className="animate-spin" />
            ) : (
              <Check size={14} color="var(--success)" />
            )}
            <span className="text-overline" style={{ color: 'var(--accent)' }}>
              Donor Impact Agent
            </span>
          </div>

          {steps.map((s) => (
            <div key={s.id} className="flex items-start gap-2 rise-in">
              {s.status === 'running' ? (
                <Loader2
                  size={12}
                  color="var(--accent)"
                  className="animate-spin"
                  style={{ marginTop: 3, flexShrink: 0 }}
                />
              ) : (
                <Check
                  size={12}
                  color="var(--success)"
                  style={{ marginTop: 3, flexShrink: 0 }}
                />
              )}
              <span className="text-caption" style={{ minWidth: 0 }}>
                {s.label}
                {s.note && (
                  <span style={{ color: 'var(--text-tertiary)' }}> · {s.note}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-2 text-caption" style={{ color: 'var(--critical)' }}>
          <AlertTriangle size={13} style={{ marginTop: 2, flexShrink: 0 }} />
          {error}
        </div>
      )}

      {/* Drafted message card */}
      {impact && (
        <div className="glass-card-nested p-4 flex flex-col gap-3 rise-in">
          {/* Header row: label + AI/fallback badge */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-overline">Drafted message</span>
              {impact.generated_by_ai ? (
                <span className="badge badge-stable">
                  <Sparkles size={9} />
                  AI-drafted
                </span>
              ) : (
                <span className="badge badge-urgent">
                  <AlertTriangle size={9} />
                  Template fallback
                </span>
              )}
            </div>

            {/* Copy button */}
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
              style={{
                background: copied ? 'color-mix(in srgb, var(--success) 18%, var(--bg-elevated))' : 'var(--bg-hover)',
                border: `0.5px solid ${copied ? 'color-mix(in srgb, var(--success) 45%, transparent)' : 'var(--border-default)'}`,
                fontSize: 12,
                color: copied ? 'var(--success)' : 'var(--text-secondary)',
                transition: 'all 0.2s',
                cursor: 'pointer',
              }}
              aria-label="Copy message to clipboard"
            >
              {copied ? (
                <>
                  <Check size={12} color="var(--success)" />
                  Copied
                </>
              ) : (
                <>
                  <ClipboardCopy size={12} />
                  Copy
                </>
              )}
            </button>
          </div>

          {/* The message text */}
          <p className="text-body" style={{ lineHeight: 1.65 }}>
            {impact.message}
          </p>

          {/* Tool calls trace (collapsed by default — only shown when AI ran) */}
          {impact.tool_calls && impact.tool_calls.length > 0 && (
            <div className="glass-card-nested scroll-x" style={{ padding: '8px 10px' }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Wrench size={11} color="var(--text-tertiary)" />
                <span className="text-caption" style={{ fontSize: 10.5 }}>
                  Contribution data used
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {impact.tool_calls.map((call, i) => (
                  <div key={i} className="flex items-baseline gap-2" style={{ whiteSpace: 'nowrap' }}>
                    <span className="text-caption mono" style={{ color: 'var(--accent)', fontSize: 11 }}>
                      {call.name}()
                    </span>
                    <span className="text-caption mono" style={{ fontSize: 11 }}>
                      → {JSON.stringify(call.result)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <span className="text-caption" style={{ color: 'var(--text-tertiary)', fontSize: 10.5 }}>
            Advisory only — review before sending
          </span>
        </div>
      )}

      {/* Allow regenerating */}
      {state === 'done' && (
        <button
          type="button"
          onClick={() => {
            setState('idle');
            setSteps([]);
            setImpact(null);
            setError(null);
          }}
          className="text-caption"
          style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
        >
          Regenerate →
        </button>
      )}
    </div>
  );
}
