/**
 * Minimal, self-owned type augmentation for the slice of leaflet.markercluster
 * this app uses. We vendor it locally (rather than depend on a flaky upstream
 * @types package) so the cluster API is correctly typed and stays stable.
 */
import 'leaflet.markercluster';

declare module 'leaflet' {
  interface MarkerClusterGroupOptions extends LayerOptions {
    showCoverageOnHover?: boolean;
    zoomToBoundsOnClick?: boolean;
    spiderfyOnMaxZoom?: boolean;
    chunkedLoading?: boolean;
    maxClusterRadius?: number;
    disableClusteringAtZoom?: number;
  }

  interface MarkerClusterGroup extends FeatureGroup {
    addLayer(layer: Layer): this;
    addLayers(layers: Layer[]): this;
    removeLayer(layer: Layer): this;
    removeLayers(layers: Layer[]): this;
    clearLayers(): this;
    hasLayer(layer: Layer): boolean;
  }

  function markerClusterGroup(options?: MarkerClusterGroupOptions): MarkerClusterGroup;
}
