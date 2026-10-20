'use client';

import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from 'react-leaflet';
import type { TravelPlan } from '@/lib/types';

const DAY_COLORS = ['#f8922a', '#0ea5e9', '#8b5cf6', '#10b981', '#e11d48', '#ca8a04', '#0891b2', '#7c3aed'];

/** OpenStreetMap tiles + itinerary stops (coloured per day), attractions and stays. No image assets needed. */
export default function MapView({ plan }: { plan: TravelPlan }) {
  const center = plan.research?.destination ?? { lat: 22.5, lon: 79 };
  const attractions = (plan.research?.attractions ?? []).filter((a) => a.lat != null && a.lon != null);
  const stays = (plan.accommodation?.options ?? []).filter((s) => s.lat != null && s.lon != null);
  const days = plan.itinerary?.days ?? [];

  return (
    <MapContainer center={[center.lat, center.lon]} zoom={12} scrollWheelZoom className="h-[520px] w-full">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {attractions.map((a) => (
        <CircleMarker key={`a-${a.name}`} center={[a.lat!, a.lon!]} radius={6} pathOptions={{ color: '#57534e', fillColor: '#fff', fillOpacity: 1, weight: 2 }}>
          <Popup><b>{a.name}</b><br />{a.category}</Popup>
        </CircleMarker>
      ))}
      {stays.map((s) => (
        <CircleMarker key={`s-${s.name}`} center={[s.lat!, s.lon!]} radius={9}
          pathOptions={{ color: '#b45309', fillColor: s.name === plan.accommodation?.recommendedOption ? '#f59e0b' : '#fde68a', fillOpacity: 0.95, weight: 2 }}>
          <Popup><b>🏨 {s.name}</b><br />{s.area} · ₹{s.priceMinINR.toLocaleString('en-IN')}–{s.priceMaxINR.toLocaleString('en-IN')}/night</Popup>
        </CircleMarker>
      ))}
      {days.map((d, i) => {
        const pts = d.items.filter((it) => it.lat != null && it.lon != null).map((it) => [it.lat!, it.lon!] as [number, number]);
        const color = DAY_COLORS[i % DAY_COLORS.length];
        return (
          <div key={d.day}>
            {pts.length > 1 && <Polyline positions={pts} pathOptions={{ color, weight: 3, opacity: 0.7, dashArray: '6 6' }} />}
            {d.items.filter((it) => it.lat != null && it.lon != null).map((it, j) => (
              <CircleMarker key={`${d.day}-${j}`} center={[it.lat!, it.lon!]} radius={7} pathOptions={{ color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }}>
                <Popup><b>Day {d.day} · {it.time}</b><br />{it.title}</Popup>
              </CircleMarker>
            ))}
          </div>
        );
      })}
    </MapContainer>
  );
}
