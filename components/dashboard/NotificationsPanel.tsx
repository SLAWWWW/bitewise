'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, AlertCircle, Info, BellOff, ArrowRight } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { fetchJson } from '@/lib/utils/fetch-json';
import type { NotificationItem } from '@/lib/types';

const SEVERITY_META = {
  critical: { icon: AlertTriangle, color: 'var(--critical)' },
  warning: { icon: AlertCircle, color: 'var(--warning)' },
  info: { icon: Info, color: 'var(--info)' },
} as const;

/**
 * Everything across the network that needs a staff decision, in one feed —
 * pending approvals, expired stock awaiting recycling, dispatch runs
 * proposed/at-risk/in-flight, and fleet status. Every count here is computed
 * elsewhere already (see app/api/notifications/route.ts); this panel's only
 * job is to stop staff from needing to check five separate pages to find
 * out what's waiting on them right now.
 */
export function NotificationsPanel() {
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetchJson<{ notifications: NotificationItem[] }>('/api/notifications')
        .then((d) => {
          if (!cancelled) setNotifications(d.notifications ?? []);
        })
        .catch(() => {
          /* keep showing the previous list on a transient poll error */
        });
    }
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <GlassCard className="p-5 flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <span className="text-overline">Notifications</span>
        {notifications && notifications.length > 0 && (
          <span
            className="tnum"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-primary)',
              background: 'var(--bg-hover)',
              borderRadius: 999,
              padding: '2px 8px',
            }}
          >
            {notifications.length}
          </span>
        )}
      </div>

      {notifications === null && (
        <div className="flex flex-col gap-2">
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      )}

      {notifications?.length === 0 && (
        <div className="flex items-center gap-2.5 py-2" style={{ color: 'var(--text-tertiary)' }}>
          <BellOff size={15} />
          <span className="text-caption">Nothing needs attention right now.</span>
        </div>
      )}

      {notifications && notifications.length > 0 && (
        <div className="flex flex-col gap-2">
          {notifications.map((n) => {
            const meta = SEVERITY_META[n.severity];
            const Icon = meta.icon;
            return (
              <Link key={n.id} href={n.href} className="block">
                <div
                  className="flex items-start gap-2.5 p-3 rounded-lg hover-lift"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: `0.5px solid color-mix(in srgb, ${meta.color} 30%, var(--border-default))`,
                  }}
                >
                  <Icon size={14} color={meta.color} style={{ marginTop: 1, flexShrink: 0 }} />
                  <div className="flex flex-col gap-0.5 min-w-0" style={{ flex: 1 }}>
                    <span className="text-body" style={{ fontWeight: 600, fontSize: 13 }}>
                      {n.title}
                    </span>
                    <span className="text-caption" style={{ fontSize: 11.5 }}>
                      {n.detail}
                    </span>
                  </div>
                  <ArrowRight size={13} color="var(--text-tertiary)" style={{ marginTop: 2, flexShrink: 0 }} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
