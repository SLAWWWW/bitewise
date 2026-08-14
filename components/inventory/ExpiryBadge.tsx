import { differenceInHours, formatDistanceToNowStrict, isPast } from 'date-fns';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';

export function getExpiryStatus(expiryAt: string): {
  variant: BadgeVariant;
  label: string;
  hoursLeft: number;
} {
  const expiry = new Date(expiryAt);
  const now = new Date();
  const hoursLeft = differenceInHours(expiry, now);

  if (isPast(expiry)) {
    return { variant: 'critical', label: 'Expired', hoursLeft };
  }
  const timeLeft = formatDistanceToNowStrict(expiry);
  if (hoursLeft < 6) {
    return { variant: 'critical', label: `Critical · ${timeLeft} left`, hoursLeft };
  }
  if (hoursLeft < 24) {
    return { variant: 'urgent', label: `Urgent · ${timeLeft} left`, hoursLeft };
  }
  if (hoursLeft < 72) {
    return { variant: 'monitor', label: `Monitor · ${timeLeft} left`, hoursLeft };
  }
  return { variant: 'stable', label: `Stable · ${timeLeft} left`, hoursLeft };
}

export function ExpiryBadge({ expiryAt }: { expiryAt: string }) {
  const { variant, label } = getExpiryStatus(expiryAt);
  return <Badge variant={variant}>{label}</Badge>;
}
