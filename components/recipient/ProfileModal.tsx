'use client';

import { useState, type FormEvent } from 'react';
import { UserRound } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';

/**
 * Shown once, the first time a recipient tries to claim anything — not on
 * page load, so browsing stays frictionless. A name (and optional phone) is
 * the whole ask: no password, no email verification, nothing to log in with.
 * This is what makes a claim traceable to a real person instead of a bare
 * anonymous id, without becoming actual authentication.
 */
export function ProfileModal({
  onSubmit,
  onCancel,
  submitting,
}: {
  onSubmit: (name: string, phone: string) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    onSubmit(name.trim(), phone.trim());
  }

  return (
    <div
      className="palette-scrim"
      style={{ alignItems: 'center' }}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Claim this item"
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420 }}>
        <GlassCard className="p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <div
              className="flex items-center justify-center rounded-xl flex-shrink-0"
              style={{ width: 36, height: 36, background: 'var(--accent)' }}
            >
              <UserRound size={17} color="#fff" />
            </div>
            <div className="flex flex-col">
              <span className="text-title-2">Just your name to claim</span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                No account, no password — just enough for the branch to know who&apos;s collecting.
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <label className="form-label" htmlFor="profile-name">
                Your name
              </label>
              <input
                id="profile-name"
                className="input"
                required
                autoFocus
                placeholder="e.g. Priya"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="profile-phone">
                Phone <span style={{ color: 'var(--text-tertiary)' }}>(optional, in case the branch needs to reach you)</span>
              </label>
              <input
                id="profile-phone"
                className="input"
                type="tel"
                placeholder="e.g. 9123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className="flex gap-3 mt-1">
              <button type="button" className="btn btn-secondary flex-1" onClick={onCancel} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary flex-1" disabled={!name.trim() || submitting}>
                {submitting ? 'Saving…' : 'Continue to claim'}
              </button>
            </div>
          </form>
        </GlassCard>
      </div>
    </div>
  );
}
