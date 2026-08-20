import type { BusinessCoordinates } from '../../../lib/types';

function formatCoordinate(value: number) {
  return value.toFixed(6);
}
function openStreetMapUrl({ latitude, longitude }: BusinessCoordinates) {
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(latitude))}&mlon=${encodeURIComponent(String(longitude))}#map=16/${encodeURIComponent(String(latitude))}/${encodeURIComponent(String(longitude))}`;
}

export function LocationMapFallback({
  coordinates,
  address,
  message = 'No pudimos cargar el mapa.',
}: {
  coordinates?: BusinessCoordinates;
  address?: string;
  message?: string;
}) {
  return (
    <div className="public-business-message business-location-map-fallback" role="alert">
      <p>{message}</p>
      {address && <p>{address}</p>}
      {coordinates ? (
        <>
          <p>
            Coordenadas exactas: {formatCoordinate(coordinates.latitude)},{' '}
            {formatCoordinate(coordinates.longitude)}.
          </p>
          <a
            className="accent-link"
            href={openStreetMapUrl(coordinates)}
            target="_blank"
            rel="noreferrer"
          >
            Abrir en OpenStreetMap
          </a>
        </>
      ) : (
        <p>La ubicación exacta no está disponible.</p>
      )}
      <p className="field-hint">
        ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>{' '}
        contributors
      </p>
    </div>
  );
}
