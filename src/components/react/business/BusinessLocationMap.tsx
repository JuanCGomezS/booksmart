import { divIcon, type LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { BusinessCoordinates } from '../../../lib/types';
import { LocationMapFallback } from './LocationMapFallback';

const DEFAULT_CENTER: LatLngExpression = [4.5709, -74.2973];
const DEFAULT_ZOOM = 6;
const LOCATION_ZOOM = 16;

const markerIcon = divIcon({
  className: 'business-location-marker',
  html: '<span aria-hidden="true"></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

function centerFor(coordinates?: BusinessCoordinates): LatLngExpression {
  return coordinates ? [coordinates.latitude, coordinates.longitude] : DEFAULT_CENTER;
}

function RecenterMap({ coordinates }: { coordinates?: BusinessCoordinates }) {
  const map = useMap();
  useEffect(() => { map.setView(centerFor(coordinates), coordinates ? LOCATION_ZOOM : DEFAULT_ZOOM); }, [coordinates, map]);
  return null;
}

function MapClickHandler({ onChange }: { onChange: (coordinates: BusinessCoordinates) => void }) {
  useMapEvents({ click(event) { onChange({ latitude: event.latlng.lat, longitude: event.latlng.lng }); } });
  return null;
}

function BaseMap({ coordinates, children, interactive, address, retryable = false }: { coordinates?: BusinessCoordinates; children?: ReactNode; interactive?: boolean; address?: string; retryable?: boolean }) {
  const [tileError, setTileError] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const retry = () => { setTileError(false); setMapAttempt((value) => value + 1); };
  if (tileError) return <div><LocationMapFallback coordinates={coordinates} address={address} />{retryable && <button type="button" className="btn-outline mt-3 px-3 py-2 text-sm" onClick={retry}>Reintentar mapa</button>}</div>;
  return <MapContainer key={mapAttempt} center={centerFor(coordinates)} zoom={coordinates ? LOCATION_ZOOM : DEFAULT_ZOOM} className="business-location-map" scrollWheelZoom={false} dragging keyboard aria-label={interactive ? 'Mapa para seleccionar la ubicación exacta del negocio' : 'Mapa de la ubicación del negocio'}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} eventHandlers={{ tileerror: () => setTileError(true) }} />
    <RecenterMap coordinates={coordinates} />
    {coordinates && <Marker position={centerFor(coordinates)} icon={markerIcon} />}
    {children}
  </MapContainer>;
}

function validCoordinates(latitudeText: string, longitudeText: string): BusinessCoordinates | undefined {
  if (!latitudeText.trim() || !longitudeText.trim()) return undefined;
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return { latitude, longitude };
}

export function BusinessLocationPicker({ value, onChange }: { value?: BusinessCoordinates; onChange: (coordinates: BusinessCoordinates) => void }) {
  const [latitude, setLatitude] = useState(value ? String(value.latitude) : '');
  const [longitude, setLongitude] = useState(value ? String(value.longitude) : '');
  const [error, setError] = useState('');
  const hintId = useId();

  useEffect(() => { setLatitude(value ? String(value.latitude) : ''); setLongitude(value ? String(value.longitude) : ''); }, [value?.latitude, value?.longitude]);

  const commit = (nextLatitude = latitude, nextLongitude = longitude) => {
    const coordinates = validCoordinates(nextLatitude, nextLongitude);
    if (!coordinates) { setError('Ingrese una latitud entre -90 y 90 y una longitud entre -180 y 180.'); return; }
    setError('');
    onChange(coordinates);
  };
  const updateFromMap = (coordinates: BusinessCoordinates) => { setLatitude(String(coordinates.latitude)); setLongitude(String(coordinates.longitude)); setError(''); onChange(coordinates); };

  return <div className="business-location-picker">
    <div className="business-location-picker-copy"><strong>Ubicación exacta</strong><span>Haz clic en el mapa o ingresa las coordenadas para colocar el punto del negocio.</span></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="field-label" htmlFor="business-location-latitude">Latitud<input id="business-location-latitude" className="field-input mt-1" type="number" inputMode="decimal" min="-90" max="90" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} onBlur={() => commit()} onKeyDown={(event) => { if (event.key === 'Enter') commit(); }} aria-describedby={hintId} aria-invalid={Boolean(error)} /></label>
      <label className="field-label" htmlFor="business-location-longitude">Longitud<input id="business-location-longitude" className="field-input mt-1" type="number" inputMode="decimal" min="-180" max="180" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} onBlur={() => commit()} onKeyDown={(event) => { if (event.key === 'Enter') commit(); }} aria-describedby={hintId} aria-invalid={Boolean(error)} /></label>
    </div>
    <p id={hintId} className={error ? 'error-message mt-2 text-sm' : 'field-hint mt-2'} role={error ? 'alert' : undefined}>{error || 'Latitud: -90 a 90. Longitud: -180 a 180.'}</p>
    <BaseMap coordinates={value} interactive><MapClickHandler onChange={updateFromMap} /></BaseMap>
    <p className="field-hint">OpenStreetMap. Usa el punto de acceso para clientes; la dirección sigue siendo una referencia adicional.</p>
  </div>;
}

export function BusinessLocationMap({ coordinates, address, retryable = false }: { coordinates: BusinessCoordinates; address?: string; retryable?: boolean }) {
  return <BaseMap coordinates={coordinates} address={address} interactive={false} retryable={retryable} />;
}
