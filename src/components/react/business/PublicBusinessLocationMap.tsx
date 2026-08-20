import React, { Component, lazy, useState } from 'react';
import type { BusinessCoordinates } from '../../../lib/types';
import { LocationMapFallback } from './LocationMapFallback';

function createBusinessLocationMap() {
  return lazy(() =>
    import('./BusinessLocationMap').then(({ BusinessLocationMap: Map }) => ({ default: Map })),
  );
}

class MapErrorBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function PublicBusinessLocationMap({
  coordinates,
  address,
}: {
  coordinates: BusinessCoordinates;
  address?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [BusinessLocationMap, setBusinessLocationMap] = useState(createBusinessLocationMap);
  const retry = () => {
    setBusinessLocationMap(() => createBusinessLocationMap());
    setAttempt((value) => value + 1);
  };
  const fallback = (
    <div>
      <LocationMapFallback
        coordinates={coordinates}
        address={address}
        message="El mapa no está disponible ahora."
      />
      <button type="button" className="btn-outline mt-3 px-3 py-2 text-sm" onClick={retry}>
        Reintentar mapa
      </button>
    </div>
  );
  return (
    <MapErrorBoundary key={attempt} fallback={fallback}>
      <React.Suspense
        fallback={
          <p className="public-business-message" role="status">
            Cargando mapa...
          </p>
        }
      >
        <BusinessLocationMap coordinates={coordinates} address={address} retryable />
      </React.Suspense>
    </MapErrorBoundary>
  );
}
