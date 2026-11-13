import 'server-only';
import type { Queryable } from '@/src/db/types';
import { haversine } from '@/src/lib/geo';

export interface VolunteerProfile {
  id: string;
  user_id: string;
  display_name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  vehicle_type: 'BICYCLE' | 'MOTORBIKE' | 'CAR' | 'VAN';
  max_load_kg: string;
  refrigerated: boolean;
  home_area: string;
  available_dows: number[];
  available_start: string;
  available_end: string;
  availability_note: string | null;
  revision: number;
  active_routes: number;
  completed_routes: number;
}

export interface RouteLocation {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

export interface VolunteerRoute {
  id: string;
  delivery_id: string;
  delivery_code: string;
  state: string;
  display_state: string;
  delivery_state: string;
  revision: number;
  volunteer_user_id: string | null;
  volunteer_name: string | null;
  planned_pickup_at: string | null;
  planned_arrival_at: string | null;
  published_at: string;
  claimed_at: string | null;
  started_at: string | null;
  pickup_arrived_at: string | null;
  picked_up_at: string | null;
  dropoff_arrived_at: string | null;
  handoff_at: string | null;
  handoff_note: string | null;
  failure_code: string | null;
  failure_note: string | null;
  source: RouteLocation;
  destination: RouteLocation;
  lines: { description: string; quantity: string; unit: string }[];
  distance_km: number | null;
}

type RouteRow = Omit<VolunteerRoute, 'distance_km'>;

function withDistance(row: RouteRow): VolunteerRoute {
  const { source, destination } = row;
  const distance = source.lat == null || source.lng == null || destination.lat == null || destination.lng == null
    ? null
    : Number(haversine(source.lat, source.lng, destination.lat, destination.lng).toFixed(1));
  return { ...row, distance_km: distance };
}

export async function listVolunteers(c: Queryable): Promise<VolunteerProfile[]> {
  const rows = await c.query<VolunteerProfile>(`
    SELECT vp.id,vp.user_id,u.display_name,vp.status,vp.vehicle_type,vp.max_load_kg::text,
           vp.refrigerated,vp.home_area,vp.available_dows,vp.available_start::text,vp.available_end::text,
           vp.availability_note,vp.revision,
           count(vr.id) FILTER (WHERE vr.state NOT IN ('HANDOFF_RECORDED','FAILED','CANCELLED'))::int AS active_routes,
           count(vr.id) FILTER (WHERE vr.state='HANDOFF_RECORDED')::int AS completed_routes
      FROM lumbung.volunteer_profiles vp
      JOIN lumbung.users u ON u.id=vp.user_id
      LEFT JOIN lumbung.volunteer_routes vr ON vr.tenant_id=vp.tenant_id AND vr.volunteer_user_id=vp.user_id
     GROUP BY vp.id,u.display_name
     ORDER BY CASE vp.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,u.display_name COLLATE "C"`);
  return rows.rows;
}

export async function listVolunteerRoutes(
  c: Queryable,
  viewer: { userId: string; canManage: boolean },
  id: string | null = null,
): Promise<VolunteerRoute[]> {
  const rows = await c.query<{ row: RouteRow }>(`
    SELECT to_jsonb(vr)||jsonb_build_object(
      'delivery_code',d.code,
      'delivery_state',d.state,
      'display_state',CASE WHEN d.state IN ('RECEIVED','PARTIALLY_RECEIVED') AND vr.state='HANDOFF_RECORDED' THEN 'COMPLETED' ELSE vr.state END,
      'volunteer_name',u.display_name,
      'planned_pickup_at',d.planned_pickup_at,
      'planned_arrival_at',d.planned_arrival_at,
      'source',jsonb_build_object('name',coalesce(s.name,s.code),'address',s.address,'lat',s.lat,'lng',s.lng),
      'destination',jsonb_build_object('name',f.name,'address',f.address,'lat',f.lat,'lng',f.lng),
      'lines',coalesce((SELECT jsonb_agg(jsonb_build_object('description',p.name,'quantity',coalesce(dl.dispatched_qty,dl.allocated_qty)::text,'unit',dl.unit) ORDER BY dl.id)
        FROM lumbung.delivery_lines dl LEFT JOIN lumbung.products p ON p.id=dl.product_id
        WHERE dl.delivery_id=d.id AND NOT dl.cancelled),'[]'::jsonb)) AS row
      FROM lumbung.volunteer_routes vr
      JOIN lumbung.deliveries d ON d.tenant_id=vr.tenant_id AND d.id=vr.delivery_id
      JOIN lumbung.source_locations s ON s.tenant_id=d.tenant_id AND s.id=d.source_location_id
      JOIN lumbung.flos f ON f.tenant_id=d.tenant_id AND f.id=d.destination_flo_id
      LEFT JOIN lumbung.users u ON u.id=vr.volunteer_user_id
     WHERE ($1::uuid IS NULL OR vr.id=$1)
       AND ($3::boolean OR vr.state='OPEN' OR vr.volunteer_user_id=$2)
     ORDER BY CASE vr.state WHEN 'OPEN' THEN 0 WHEN 'CLAIMED' THEN 1 WHEN 'HANDOFF_RECORDED' THEN 8 WHEN 'FAILED' THEN 9 WHEN 'CANCELLED' THEN 10 ELSE 2 END,
              d.planned_pickup_at NULLS LAST,vr.published_at,vr.id`, [id, viewer.userId, viewer.canManage]);
  return rows.rows.map(({ row }) => withDistance(row));
}

export interface EligibleDelivery {
  id: string;
  code: string;
  revision: number;
  source_name: string;
  flo_name: string;
  planned_pickup_at: string | null;
  planned_arrival_at: string | null;
  contents: string;
}

export async function listEligibleDeliveries(c: Queryable): Promise<EligibleDelivery[]> {
  return (await c.query<EligibleDelivery>(`
    SELECT d.id,d.code,d.revision,coalesce(s.name,s.code) AS source_name,f.name AS flo_name,
           d.planned_pickup_at,d.planned_arrival_at,
           coalesce((SELECT string_agg(p.name||' · '||dl.allocated_qty::text||' '||dl.unit,', ' ORDER BY dl.id)
             FROM lumbung.delivery_lines dl LEFT JOIN lumbung.products p ON p.id=dl.product_id
             WHERE dl.delivery_id=d.id AND NOT dl.cancelled),'—') AS contents
      FROM lumbung.deliveries d
      JOIN lumbung.source_locations s ON s.id=d.source_location_id
      JOIN lumbung.flos f ON f.id=d.destination_flo_id
     WHERE d.route='DIRECT' AND d.state='READY_FOR_PICKUP'
       AND NOT EXISTS (SELECT 1 FROM lumbung.volunteer_routes vr WHERE vr.delivery_id=d.id)
     ORDER BY d.planned_pickup_at NULLS LAST,d.code`)).rows;
}
