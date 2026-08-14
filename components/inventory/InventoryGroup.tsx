import { Snowflake, Package, Users } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/Badge';
import { ExpiryBadge } from '@/components/inventory/ExpiryBadge';
import type { InventoryItemWithBranch } from '@/lib/types';

const STATUS_LABEL: Record<string, string> = {
  in_stock: 'In Stock',
  reserved: 'Reserved',
  distributed: 'Distributed',
  expired: 'Expired',
  escalated: 'Routed to partner beneficiaries',
};

function StorageIcon({ storageType }: { storageType: string }) {
  if (storageType === 'cold' || storageType === 'frozen') {
    return <Snowflake size={14} color="var(--accent)" />;
  }
  return <Package size={14} color="var(--text-tertiary)" />;
}

export function InventoryGroup({
  branchName,
  area,
  color,
  items,
}: {
  branchName: string;
  area?: string | null;
  color: string;
  items: InventoryItemWithBranch[];
}) {
  return (
    <GlassCard className="p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-sm flex-shrink-0" style={{ width: 8, height: 8, background: color }} />
          <span className="text-title-2">{branchName}</span>
          {area && <span className="text-caption">· {area}</span>}
        </div>
        <span className="text-caption">
          {items.length} item{items.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.id} className="glass-card-nested p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <StorageIcon storageType={item.storage_type} />
              <div className="flex flex-col min-w-0">
                <span className="text-body truncate" style={{ fontWeight: 500 }}>
                  {item.item_name}
                </span>
                <span className="text-caption capitalize">
                  {item.food_type} · {item.quantity}
                  {item.unit === 'kg' ? 'kg' : ` ${item.unit}`}
                  {item.status !== 'escalated' && ` · ${STATUS_LABEL[item.status] ?? item.status}`}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {item.status === 'escalated' && (
                <Badge variant="info" icon={<Users size={11} />}>
                  Partner beneficiaries
                </Badge>
              )}
              <ExpiryBadge expiryAt={item.expiry_at} />
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-caption">No inventory at this branch.</p>}
      </div>
    </GlassCard>
  );
}
