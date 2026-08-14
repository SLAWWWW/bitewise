'use client';

import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import type { Donor } from '@/lib/types';

export interface ActiveRoute {
  id: string;
  donorLat: number;
  donorLng: number;
  branchLat: number;
  branchLng: number;
  color: string;
}

export interface MapBranch {
  id: string;
  name: string;
  area: string | null;
  lat: number;
  lng: number;
  capacity_kg: number;
  current_load_kg: number;
  color: string;
}

const SG_CENTER: [number, number] = [1.3521, 103.8198];

function donorIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid rgba(0,113,227,0.35);box-shadow:0 0 0 3px rgba(0,113,227,0.15);"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

function branchIcon(branch: MapBranch, justMatched: boolean) {
  const ratio = branch.capacity_kg > 0 ? Math.min(1, branch.current_load_kg / branch.capacity_kg) : 0;
  const size = 14 + Math.round((branch.capacity_kg / 600) * 10);
  const fillHeight = Math.max(2, Math.round(size * ratio));
  const pulse = justMatched
    ? `<div class="pulse-marker" style="position:absolute;inset:-6px;border:2px solid ${branch.color};border-radius:6px;"></div>`
    : '';
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;">
        ${pulse}
        <div style="width:${size}px;height:${size}px;border:2px solid ${branch.color};border-radius:4px;background:rgba(255,255,255,0.9);position:relative;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.18);">
          <div style="position:absolute;bottom:0;left:0;right:0;height:${fillHeight}px;background:${branch.color};opacity:0.6;"></div>
        </div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function CityMap({
  donors,
  branches,
  activeRoute,
}: {
  donors: Donor[];
  branches: MapBranch[];
  activeRoute?: ActiveRoute | null;
}) {
  return (
    <MapContainer
      center={SG_CENTER}
      zoom={11}
      scrollWheelZoom={false}
      style={{ width: '100%', height: '100%', borderRadius: 12 }}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; OpenStreetMap contributors'
      />
      {donors.map((donor) => (
        <Marker key={donor.id} position={[donor.lat, donor.lng]} icon={donorIcon()}>
          <Popup>
            <div className="text-body" style={{ fontWeight: 600 }}>
              {donor.name}
            </div>
            <div className="text-caption">
              {donor.type} · {donor.total_kg_donated}kg donated
            </div>
          </Popup>
        </Marker>
      ))}
      {branches.map((branch) => {
        const justMatched =
          !!activeRoute &&
          Math.abs(activeRoute.branchLat - branch.lat) < 1e-6 &&
          Math.abs(activeRoute.branchLng - branch.lng) < 1e-6;
        return (
          <Marker
            key={branch.id}
            position={[branch.lat, branch.lng]}
            icon={branchIcon(branch, justMatched)}
          >
            <Popup>
              <div className="text-body" style={{ fontWeight: 600 }}>
                {branch.name}
              </div>
              <div className="text-caption">
                {branch.area} · {branch.current_load_kg}/{branch.capacity_kg}kg
              </div>
            </Popup>
          </Marker>
        );
      })}
      {activeRoute && (
        <Polyline
          key={activeRoute.id}
          positions={[
            [activeRoute.donorLat, activeRoute.donorLng],
            [activeRoute.branchLat, activeRoute.branchLng],
          ]}
          pathOptions={{
            color: activeRoute.color,
            weight: 2.5,
            dashArray: '6 6',
            className: 'route-line',
          }}
        />
      )}
    </MapContainer>
  );
}
