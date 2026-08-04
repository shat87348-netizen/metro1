import DeckGL from '@deck.gl/react';
import type { Layer, MapViewState, PickingInfo } from '@deck.gl/core';
import { Map } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

/** 免费暗色底图（CARTO Dark Matter），无需 access token */
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 121.4737,
  latitude: 31.2304,
  zoom: 11,
  pitch: 45,
  bearing: 30,
};

export const INITIAL_ZOOM = INITIAL_VIEW_STATE.zoom;

function getTooltip({ object }: PickingInfo): { text: string } | null {
  if (!object) return null;
  if ('lineNames' in object) {
    const en = object.nameEn ? `${object.nameEn}\n` : '';
    return { text: `${object.name}\n${en}${object.lineNames.join(' · ')}` };
  }
  if ('name' in object) return { text: object.name };
  return null;
}

interface Props {
  layers: Layer[];
  onZoomChange: (zoom: number) => void;
}

export default function MetroMap({ layers, onZoomChange }: Props) {
  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      getTooltip={getTooltip}
      onViewStateChange={({ viewState }) => {
        const zoom = (viewState as MapViewState).zoom;
        if (typeof zoom === 'number') onZoomChange(zoom);
      }}
    >
      <Map mapStyle={BASEMAP_STYLE} />
    </DeckGL>
  );
}
