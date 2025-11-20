// @ts-nocheck

// frontend/src/components/MapComponent.tsx
'use client'; // This directive ensures the component is rendered on the client side

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import L from 'leaflet';

// Import Leaflet CSS (crucial for map styling)
import 'leaflet/dist/leaflet.css';

// Import MarkerClusterGroup CSS
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

// Import the MarkerClusterGroup
import 'leaflet.markercluster';

// Import Esri Leaflet for Esri basemaps
import * as EsriLeaflet from 'esri-leaflet';

// Import Turf.js modules
import * as turf from '@turf/turf';

// FIX: This is a common workaround for Leaflet's default icon paths in bundlers like Webpack/Next.js
// Without this, default markers might appear as broken images.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

interface MapComponentProps {
  geojson: any | null; // GeoJSON data from your S3 metadata file
  isSidebarOpen: boolean; // Prop from parent
  setIsSidebarOpen: (isOpen: boolean) => void; // Prop from parent
  sidebarWidth: number; // Prop from parent
  onSegmentSelected?: (segment: any | null) => void;
}

interface ClusterData {
  markers: any[];
  totalDetections: number;
}

const TIMESTAMP_GAP_THRESHOLD_MS = 10 * 1000; // 10 seconds in milliseconds, to define continuous drive paths
const FIXED_SPATIAL_SEGMENT_LENGTH_FEET = 500; // Length of segments for density calculation
const DETECTION_BUFFER_RADIUS_FEET = 25; // How far from a segment to look for detections

// Zoom level thresholds for layer visibility
const ZOOM_THRESHOLDS = {
  PATHS_VISIBLE: 11,     // Paths visible at zoom 11 and above
  CLUSTERS_VISIBLE: 16,  // Clusters visible at zoom 13 and above
  INDIVIDUAL_MARKERS: 19 // Individual markers only at zoom 16 and above
};

const MapComponent: React.FC<MapComponentProps> = ({
  geojson,
  isSidebarOpen,
  setIsSidebarOpen,
  sidebarWidth,
  onSegmentSelected,
}) => {
  const mapRef = useRef<L.Map>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const pathDensityLayerRef = useRef<L.GeoJSON | null>(null);
  const crackLinesLayerRef = useRef<L.GeoJSON | null>(null);
  const individualMarkersLayerRef = useRef<L.LayerGroup | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<ClusterData | null>(null);
  const [selectedTrackGroup, setSelectedTrackGroup] = useState<any | null>(null);
  const [segmentModalOpen, setSegmentModalOpen] = useState(false);
  const [hoveredThumbnail, setHoveredThumbnail] = useState<string | null>(null);
  const [hoveredSegmentInfo, setHoveredSegmentInfo] = useState<any | null>(null);

  const openSegmentPage = (group: any) => {
    if (typeof window === 'undefined' || !group) return;
    const tracks = Array.isArray(group.overlapping_tracks) ? group.overlapping_tracks : [];
    if (tracks.length === 0) return;

    const segmentStart = Number(group.start_feet) || 0;
    const inferredEnd = tracks.reduce((max: number, t: any) => Math.max(max, Number(t.end_feet) || 0), 0);
    const segmentEnd = Number.isFinite(Number(group.end_feet)) ? Number(group.end_feet) : inferredEnd;
    const maxEnd = Math.max(1, segmentEnd - segmentStart);
    const grouped = tracks.reduce((acc: any[], t: any) => {
      const parentId = t.parent_track_id ?? t.track_id ?? `track-${acc.length}`;
      let existing = acc.find((g: any) => g.parent_track_id === parentId);
      if (!existing) {
        existing = { parent_track_id: parentId, spans: [] as any[] };
        acc.push(existing);
      }
      existing.spans.push({
        start_feet: Number(t.start_feet) || 0,
        end_feet: Number(t.end_feet) || 0,
        thumbnail_url: t.thumbnail_url,
        track_damage: t.track_damage,
        track_id: t.track_id,
        defect_types: t.defect_types,
        severity_labels: t.severity_labels,
      });
      return acc;
    }, []);

    const rowsHtml = grouped.map((g, idx) => {
      const spans = g.spans.sort((a: any, b: any) => a.start_feet - b.start_feet);
      const rowStart = Math.min(...spans.map((s: any) => Math.max(0, Math.min(segmentEnd, s.start_feet) - segmentStart)));
      const rowEnd = Math.max(...spans.map((s: any) => Math.max(0, Math.min(segmentEnd, s.end_feet) - segmentStart)));
      const rowLength = Math.max(0, rowEnd - rowStart);
      const defectSet = new Set<string>();
      spans.forEach((s: any) => {
        (Array.isArray(s.defect_types) ? s.defect_types : []).forEach((dt: any) => {
          if (dt) defectSet.add(String(dt));
        });
      });
      const defectLabel = defectSet.size ? Array.from(defectSet).join(', ') : 'unknown';
      const overlapStart = Math.max(0, Math.min(segmentEnd, Math.min(...spans.map((s: any) => s.start_feet))) - segmentStart);
      const overlapEnd = Math.max(0, Math.min(segmentEnd, Math.max(...spans.map((s: any) => s.end_feet))) - segmentStart);
      const filledLeft = (overlapStart / maxEnd) * 100;
      const filledWidth = Math.max(2, ((overlapEnd - overlapStart) / maxEnd) * 100);
      const dotsHtml = spans
        .map((s: any) => {
          if (!s.thumbnail_url && !s.track_id) return null;
          const clampStart = Math.max(segmentStart, s.start_feet);
          const clampEnd = Math.min(segmentEnd, s.end_feet);
          const mid = ((clampStart + clampEnd) / 2) - segmentStart;
          const pos = (mid / maxEnd) * 100;
          if (!Number.isFinite(pos)) return null;
          const damageType = Array.isArray(s.defect_types) && s.defect_types.length > 0 ? s.defect_types.join(', ') : 'unknown';
          const title = `Track ${s.track_id ?? 'n/a'}: ${damageType}`;
          return `<div class="dot" style="left:${pos}%;" title="${title}"></div>`;
        })
        .filter(Boolean)
        .join('');
      const barHtml = `
        <div class="base"></div>
        <div class="bar" style="left:${filledLeft}%;width:${filledWidth}%;" title="Parent coverage"></div>
        ${dotsHtml}
      `;

      const thumbs = spans
        .map((s: any) => s.thumbnail_url)
        .filter((u: any) => typeof u === 'string' && u.trim())
        .map((u: string, ti: number) => {
          const span = spans[ti] || {};
          const damageType = Array.isArray(span.defect_types) && span.defect_types.length > 0 ? span.defect_types.join(', ') : 'unknown';
          const severityLabel = Array.isArray(span.severity_labels) && span.severity_labels.length > 0 ? span.severity_labels.join(', ') : 'unknown';
          const clampStart = Math.max(segmentStart, span.start_feet || 0);
          const clampEnd = Math.min(segmentEnd, span.end_feet || 0);
          const lengthFt = span.measured_length_feet ?? (Number.isFinite(clampStart) && Number.isFinite(clampEnd) ? Math.max(0, clampEnd - clampStart) : null);
          const lengthLabel = lengthFt ? `${lengthFt.toFixed(1)}ft` : 'N/A';
          return `<div class="thumb-card"><img src="${u}" alt="thumb-${ti}" class="thumb-full" /><div class="thumb-caption">Defects: ${damageType} · Severity: ${severityLabel} · Length: ${lengthLabel}</div></div>`;
        })
        .join('');

      return `
        <div class="row">
          <div class="row-left">
            <div class="row-label">Defects: ${defectLabel} · ${rowLength.toFixed(1)}ft (${rowStart.toFixed(1)}ft - ${rowEnd.toFixed(1)}ft)</div>
            <div class="row-bar">${barHtml}</div>
          </div>
          <div class="row-right">
            ${thumbs || '<div class="thumb-caption">No images available</div>'}
          </div>
        </div>
      `;
    }).join('');

    const html = `
      <html>
        <head>
          <title>Segment Coverage</title>
          <style>
            body { font-family: Inter, Arial, sans-serif; padding: 20px; background: #f9fafb; color: #111827; }
            .header { margin-bottom: 16px; }
            .row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
            .row-left { flex: 1 1 45%; min-width: 280px; }
            .row-right { flex: 1 1 45%; min-width: 320px; display: flex; flex-direction: column; gap: 12px; }
            .row-label { font-size: 14px; margin-bottom: 6px; color: #374151; }
            .row-bar { position: relative; height: 18px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
            .base { position: absolute; top: 0; bottom: 0; left: 0; right: 0; background: #e5e7eb; }
            .bar { position: absolute; top: 0; bottom: 0; background: #2563eb; opacity: 0.9; border-radius: 8px; }
            .dot { position: absolute; top: 50%; width: 10px; height: 10px; margin-top: -5px; border-radius: 50%; background: #ff7f0e; border: 1px solid #ffffff; box-shadow: 0 0 4px rgba(0,0,0,0.3); }
            .summary { margin-top: 16px; font-size: 14px; color: #4b5563; }
            .thumbs { display: flex; flex-direction: column; gap: 12px; }
            .thumb-card { display: flex; flex-direction: column; gap: 6px; width: 100%; }
            .thumb-full { width: 100%; aspect-ratio: 16 / 9; border-radius: 8px; border: 1px solid #e5e7eb; object-fit: cover; object-position: center; box-shadow: 0 4px 10px rgba(0,0,0,0.08); }
            .thumb-caption { font-size: 13px; color: #1f2937; max-width: 100%; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2 style="margin:0;">Segment Coverage</h2>
            <div class="summary">
              Tracks: ${Array.isArray(group.track_ids) ? group.track_ids.join(', ') : 'N/A'} |
              Damage: ${group.damage_count ?? 'N/A'} |
              Range: ${group.start_feet?.toFixed ? group.start_feet.toFixed(1) : 'N/A'}ft - ${group.end_feet?.toFixed ? group.end_feet.toFixed(1) : 'N/A'}ft
            </div>
          </div>
          ${rowsHtml}
        </body>
      </html>
    `;

    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };
  const [expandedDetectionFrames, setExpandedDetectionFrames] = useState<Set<string>>(() => new Set());
  // Removed internal isSidebarOpen, screenSize states as they are now props
  const [currentZoom, setCurrentZoom] = useState(13);
  const sortedSidebarFrames = useMemo(() => {
    if (!selectedCluster?.markers) {
      return [];
    }
    return [...selectedCluster.markers].sort((a: any, b: any) => {
      const frameA = Number(a?.properties?.frame_number ?? a?.properties?.frame_id ?? Number.MAX_SAFE_INTEGER);
      const frameB = Number(b?.properties?.frame_number ?? b?.properties?.frame_id ?? Number.MAX_SAFE_INTEGER);
      if (!Number.isFinite(frameA) && !Number.isFinite(frameB)) return 0;
      if (!Number.isFinite(frameA)) return 1;
      if (!Number.isFinite(frameB)) return -1;
      return frameA - frameB;
    });
  }, [selectedCluster]);

  // Removed useEffect for screenSize, as sidebarWidth is now a prop from parent

  const closeSidebar = () => {
    setSelectedCluster(null);
    setSelectedTrackGroup(null);
    setSegmentModalOpen(false);
    setIsSidebarOpen(false); // Update parent state
    if (typeof onSegmentSelected === 'function') {
      onSegmentSelected(null);
    }
  };

  const toggleDetectionGrid = (frameKey: string) => {
    setExpandedDetectionFrames(prev => {
      const next = new Set(prev);
      if (next.has(frameKey)) {
        next.delete(frameKey);
      } else {
        next.add(frameKey);
      }
      return next;
    });
  };

  // Removed getSidebarWidth as it's now passed as a prop

  const sortMarkersChronologically = (markers: any[]) => {
    return markers.sort((a, b) => {
      if (a.properties?.globalTimestamp && b.properties?.globalTimestamp) {
        return new Date(a.properties.globalTimestamp).getTime() - new Date(b.properties.globalTimestamp).getTime();
      }
      if (a.properties?.timestamp && b.properties?.timestamp) {
        return new Date(a.properties.timestamp).getTime() - new Date(b.properties.timestamp).getTime();
      }
      if (a.properties?.frame_number && b.properties?.frame_number) {
        return a.properties.frame_number - b.properties.frame_number;
      }
      if (a.properties?.gps_index && b.properties?.gps_index) {
        return a.properties.gps_index - b.properties.gps_index;
      }
      return 0;
    });
  };

  // sidebarWidth is now a prop directly

  const getMarkerDetectionColor = (detectionCount: number) => {
    if (detectionCount >= 20) return '#8B0000';
    if (detectionCount >= 10) return '#FF0000';
    if (detectionCount >= 5) return '#FFA500';
    if (detectionCount >= 1) return '#FFFF00';
    return '#0000FF';
  };

  const getMarkerDetectionRadius = (detectionCount: number) => {
    if (detectionCount >= 20) return 12;
    if (detectionCount >= 10) return 10;
    if (detectionCount >= 5) return 8;
    if (detectionCount >= 1) return 6;
    return 4;
  };

  const damagePercentiles = useMemo(() => {
    const values: number[] = [];
    if (geojson?.features) {
      geojson.features.forEach((f: any) => {
        const damage = Number(f?.properties?.damage_count);
        if (Number.isFinite(damage)) {
          values.push(damage);
        }
      });
    }
    if (values.length === 0) {
      return { p50: 0, p75: 0, p90: 0, p95: 0, max: 0 };
    }
    const sorted = values.sort((a, b) => a - b);
    const quantile = (q: number) => {
      if (sorted.length === 0) return 0;
      const pos = (sorted.length - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
      if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
      }
      return sorted[base];
    };
    return {
      p50: quantile(0.5),
      p75: quantile(0.75),
      p90: quantile(0.9),
      p95: quantile(0.95),
      max: sorted[sorted.length - 1],
    };
  }, [geojson]);

  const getTrackColor = (feature: any) => {
    const damageCount = Number(feature?.properties?.damage_count ?? 0);
    if (!Number.isFinite(damageCount) || damageCount <= 0) return '#16a34a'; // green
    const { p50, p75, p90, p95 } = damagePercentiles;
    if (damageCount <= p50) return '#65a30d'; // yellow-green
    if (damageCount <= p75) return '#facc15'; // yellow
    if (damageCount <= p90) return '#f97316'; // orange
    if (damageCount <= p95) return '#ea580c'; // orange-red
    return '#b91c1c'; // darkest red (top ~5%)
  };

  // Function to interpolate color for a gradient (NO LONGER USED WITH PERCENTILES, BUT KEPT FOR REFERENCE)
  const interpolateColor = (value: number, min: number, max: number, color1: string, color2: string) => {
    const hexToRgb = (hex: string) => {
      const bigint = parseInt(hex.slice(1), 16);
      return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
    };
    const rgbToHex = (r: number, g: number, b: number) =>
      `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;

    const rgb1 = hexToRgb(color1);
    const rgb2 = hexToRgb(color2);

    // Handle cases where min === max to avoid division by zero or NaN
    const normalizedValue = max === min ? 0 : (value - min) / (max - min);
    // Clamp the normalized value between 0 and 1
    const clampedNormalizedValue = Math.max(0, Math.min(1, normalizedValue));

    const r = Math.round(rgb1[0] + (rgb2[0] - rgb1[0]) * clampedNormalizedValue);
    const g = Math.round(rgb1[1] + (rgb2[1] - rgb1[1]) * clampedNormalizedValue);
    const b = Math.round(rgb1[2] + (rgb2[2] - rgb1[2]) * clampedNormalizedValue);

    return rgbToHex(r, g, b);
  };

  // Function to update layer visibility based on zoom level
  const updateLayerVisibility = (zoom: number) => {
    if (!mapRef.current) return;

    const map = mapRef.current;

    // Remove all layers first
    if (pathDensityLayerRef.current && map.hasLayer(pathDensityLayerRef.current)) {
      map.removeLayer(pathDensityLayerRef.current);
    }
    if (crackLinesLayerRef.current && map.hasLayer(crackLinesLayerRef.current)) {
      map.removeLayer(crackLinesLayerRef.current);
    }
    if (clusterGroupRef.current && map.hasLayer(clusterGroupRef.current)) {
      map.removeLayer(clusterGroupRef.current);
    }
    if (individualMarkersLayerRef.current && map.hasLayer(individualMarkersLayerRef.current)) {
      map.removeLayer(individualMarkersLayerRef.current);
    }

    // Add layers based on zoom level
    if (zoom >= ZOOM_THRESHOLDS.INDIVIDUAL_MARKERS) {
      // Highest zoom: only individual markers
      if (crackLinesLayerRef.current) {
        map.addLayer(crackLinesLayerRef.current);
      }
      if (individualMarkersLayerRef.current) {
        map.addLayer(individualMarkersLayerRef.current);
      }
    } else if (zoom >= ZOOM_THRESHOLDS.CLUSTERS_VISIBLE) {
      // Medium zoom: paths + clusters
      if (pathDensityLayerRef.current) {
        map.addLayer(pathDensityLayerRef.current);
      }
      if (crackLinesLayerRef.current) {
        map.addLayer(crackLinesLayerRef.current);
      }
      if (clusterGroupRef.current) {
        map.addLayer(clusterGroupRef.current);
      }
    } else if (zoom >= ZOOM_THRESHOLDS.PATHS_VISIBLE) {
      // Low-medium zoom: only paths
      if (crackLinesLayerRef.current) {
        map.addLayer(crackLinesLayerRef.current);
      }
      if (pathDensityLayerRef.current) {
        map.addLayer(pathDensityLayerRef.current);
      }
    }
    // Below PATHS_VISIBLE zoom: no layers shown
  };

  // Memoize the processed path segments AND their min/max densities
  const processedPathSegments = useMemo(() => {
    if (!geojson || !geojson.features || geojson.features.length < 2) {
      return { segments: null, minDensity: 0, maxDensity: 0, percentileThresholds: {p50: 0, p70: 0, p85: 0} };
    }

    // IMPORTANT: When forming continuous paths, we use ALL features that have valid globalTimestamp
    // We do NOT filter by detection_count_in_frame here, as requested.
    const sortedFeatures = geojson.features
      .filter((f: any) => f.geometry && f.geometry.type === 'Point' && f.properties?.globalTimestamp)
      .sort((a: any, b: any) => new Date(a.properties.globalTimestamp).getTime() - new Date(b.properties.globalTimestamp).getTime());

    if (sortedFeatures.length < 2) {
      return { segments: null, minDensity: 0, maxDensity: 0, percentileThresholds: {p50: 0, p70: 0, p85: 0} };
    }

    // 1. Form continuous time-based paths (multi-line strings) from ALL relevant points
    const continuousPaths: turf.Feature<turf.LineString>[] = [];
    let currentPathCoords: turf.Position[] = [];
    let prevTimestamp: number | null = null;

    sortedFeatures.forEach((feature: any, index: number) => {
      const currentCoords = feature.geometry.coordinates;
      const currentTimestamp = new Date(feature.properties.globalTimestamp).getTime();

      if (index === 0) {
        currentPathCoords.push(currentCoords);
      } else {
        const timeDiff = currentTimestamp - (prevTimestamp as number);
        if (timeDiff <= TIMESTAMP_GAP_THRESHOLD_MS) {
          currentPathCoords.push(currentCoords);
        } else {
          // Time gap too large, finalize current continuous path
          if (currentPathCoords.length >= 2) {
            continuousPaths.push(turf.lineString(currentPathCoords));
          }
          // Start a new continuous path
          currentPathCoords = [currentCoords];
        }
      }
      prevTimestamp = currentTimestamp;
    });

    // Add the very last continuous path if it exists
    if (currentPathCoords.length >= 2) {
      continuousPaths.push(turf.lineString(currentPathCoords));
    }

    // 3. Subdivide continuous paths into fixed spatial segments and calculate density
    const finalSpatialSegments: turf.Feature<turf.LineString>[] = [];
    let currentMaxDensity = 0;

    continuousPaths.forEach(path => {
      // Chunk each continuous path into fixed-length segments
      const chunkedPath = turf.lineChunk(
        path, 
        FIXED_SPATIAL_SEGMENT_LENGTH_FEET, 
        { units: 'feet' }
      );

      // Iterate through each small, fixed-length segment
      chunkedPath.features.forEach(segmentFeature => {
        const segmentLine = segmentFeature.geometry as turf.LineString;
        if (segmentLine.coordinates.length < 2) {
          return; // Skip invalid line segments (e.g., if a chunk only has one point)
        }

        const actualSegmentLengthFeet = turf.length(segmentLine, { units: 'feet' });
        
        // Create a buffer around the segment to find relevant detections
        const segmentBuffer = turf.buffer(segmentFeature, DETECTION_BUFFER_RADIUS_FEET, { units: 'feet' });

        let segmentDetectionCount = 0;

        // Iterate through ALL original features to find detections within this segment's buffer
        // Note: Here we use the original 'geojson.features' array (not sortedFeatures)
        // to avoid re-sorting for each segment, but we still check for detection_count_in_frame
        geojson.features.forEach((originalFeature: any) => {
          if (originalFeature.geometry && originalFeature.geometry.type === 'Point' && originalFeature.properties?.detection_count_in_frame > 0) {
            const detectionPoint = turf.point(originalFeature.geometry.coordinates);
            // Check if the detection point is within the segment's buffer
            if (turf.booleanPointInPolygon(detectionPoint, segmentBuffer)) {
              segmentDetectionCount += originalFeature.properties.detection_count_in_frame;
            }
          }
        });
        
        const crackDensity = actualSegmentLengthFeet > 0 ? segmentDetectionCount / actualSegmentLengthFeet : 0;
        currentMaxDensity = Math.max(currentMaxDensity, crackDensity);

        finalSpatialSegments.push(
          turf.feature(segmentLine, {
            detections_in_segment: segmentDetectionCount,
            crack_density: crackDensity,
            actual_length_feet: actualSegmentLengthFeet
          })
        );
      });
    });
    
    // Calculate min density from all processed segments
    const allDensities = finalSpatialSegments.map(s => s.properties?.crack_density || 0);
    const minDensity = allDensities.length > 0 ? Math.min(...allDensities) : 0;
    const maxDensity = currentMaxDensity;
    
    // --- Calculate Percentile Thresholds ---
    const sortedDensities = [...allDensities].sort((a, b) => a - b);
    const getPercentile = (percentile: number) => {
      if (sortedDensities.length === 0) return 0;
      const index = Math.ceil((percentile / 100) * sortedDensities.length) - 1;
      return sortedDensities[Math.max(0, index)];
    };

    const p50 = getPercentile(50); // 50th percentile
    const p70 = getPercentile(70); // 70th percentile
    const p85 = getPercentile(85); // 85th percentile

    console.log('Min Density:', minDensity, 'Max Density:', maxDensity); // For debugging
    console.log('Percentiles: P50=', p50, 'P70=', p70, 'P85=', p85); // For debugging
    
    return { 
      segments: turf.featureCollection(finalSpatialSegments), 
      minDensity: minDensity, 
      maxDensity: maxDensity,
      percentileThresholds: { p50, p70, p85 } // Return percentiles
    };

  }, [geojson]);

  const { segments: finalPathSegments, minDensity, maxDensity, percentileThresholds } = processedPathSegments;

  // Create marker creation function to avoid duplication
  const createMarker = (feature: any, isForCluster: boolean = false) => {
    if (feature.geometry && feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates;
      const detectionCount = feature.properties?.detection_count_in_frame || 0;

      const marker = L.circleMarker([lat, lng], {
        radius: getMarkerDetectionRadius(detectionCount),
        color: getMarkerDetectionColor(detectionCount),
        fillColor: getMarkerDetectionColor(detectionCount),
        fillOpacity: 0.8,
        weight: 2,
      });

      (marker as any).feature = feature;

      if (feature.properties) {
        const properties = feature.properties;

        let clickPopupContent = `
          <div style="max-width: 330px; font-family: 'Inter', sans-serif;">
            <h3 style="margin: 0 0 10px 0; color: #333; font-size: 1.1em;">Frame Details</h3>
            <p style="margin: 2px 0;"><strong>Distance:</strong> ${properties.actual_distance_feet?.toFixed(1) ?? 'N/A'} ft</p>
            <p style="2px 0;"><strong>Speed:</strong> ${properties.speed_mph?.toFixed(1) ?? 'N/A'} mph</p>
            <p style="margin: 2px 0;"><strong>Frame Type:</strong> ${properties.frame_type ?? 'N/A'}</p>
            <p style="margin: 2px 0;"><strong>Frame #:</strong> ${properties.frame_number ?? 'N/A'}</p>
            <p style="margin: 2px 0;"><strong>GPS Index:</strong> ${properties.gps_index ?? 'N/A'}</p>
            <p style="margin: 2px 0;"><strong>Timestamp:</strong> ${properties.globalTimestamp ? new Date(properties.globalTimestamp).toLocaleString() : 'N/A'}</p>
        `;

        if (properties.compressed_annotated_image_url) {
          clickPopupContent += `
            <img src="${properties.compressed_annotated_image_url}" alt="Annotated Frame Image" style="max-width: 100%; height: auto; border-radius: 6px; margin-top: 10px; max-height: 250px; object-fit: contain;" />
            <div style="margin-top: 8px; font-size: 0.9em;">
              <a href="${properties.annotated_image_url}" target="_blank" rel="noopener noreferrer" style="display: block; margin-bottom: 4px; color: #0066cc; text-decoration: none;">View High-Res Annotated</a>
              <a href="${properties.original_image_url}" target="_blank" rel="noopener noreferrer" style="display: block; color: #0066cc; text-decoration: none;">View Original Frame</a>
            </div>
          `;
        } else if (properties.compressed_annotated_image_path_in_zip) {
           clickPopupContent += `
              <p style="color: #555; font-size: 0.9em; margin-top: 10px;">Images available in downloaded ZIP:</p>
              <ul style="list-style-type: disc; margin-left: 20px; font-size: 0.9em;">
                  <li>Annotated: <code>${properties.annotated_image_path_in_zip}</code></li>
                  <li>Original: <code>${properties.original_image_path_in_zip}</code></li>
              </ul>
           `;
        } else {
          clickPopupContent += `<p style="color: #cc0000; margin-top: 10px;">No image URL available for direct display.</p>`;
        }

        if (properties.all_detections_in_frame && properties.all_detections_in_frame.length > 0) {
          clickPopupContent += `
            <h4 style="margin: 15px 0 5px 0; color: #333; font-size: 1em;">Detections in this Frame (${properties.detection_count_in_frame ?? 'N/A'}):</h4>
            <div style="max-height: 150px; overflow-y: auto; border: 1px solid #eee; padding: 8px; border-radius: 4px; background-color: #f9f9f9;">
              <ul style="list-style-type: none; padding: 0; margin: 0;">
          `;
          properties.all_detections_in_frame.forEach((det: any, index: number) => {
            clickPopupContent += `
              <li style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: ${index < properties.all_detections_in_frame.length - 1 ? '1px dashed #ddd' : 'none'};">
                <p style="margin: 0;"><strong>Defect ${index + 1}:</strong></p>
                <p style="margin: 0 0 2px 10px; font-size: 0.9em;">Class ID: ${det.class_id ?? 'N/A'}, Confidence: ${det.confidence?.toFixed(2) ?? 'N/A'}</p>
                <p style="margin: 0 0 0 10px; font-size: 0.9em;">BBox: [${det.bbox ? det.bbox.map((coord: number) => coord.toFixed(0)).join(', ') : 'N/A'}]</p>
              </li>
            `;
          });
          clickPopupContent += `
              </ul>
            </div>
          `;
        } else {
          clickPopupContent += `<p style="margin-top: 10px; color: #555;">No defects detected in this frame.</p>`;
        }

        clickPopupContent += `</div>`;

        // Only add tooltip if not for cluster (to avoid performance issues)
        if (!isForCluster) {
          let hoverTooltipContent = `
              <div style="font-family: 'Inter', sans-serif; font-size: 0.9em; text-align: center;">
                  <p style="margin: 0;"><strong>Frame #:</strong> ${properties.frame_number ?? 'N/A'}</p>
                  <p style="margin: 0;"><strong>Detections:</strong> ${properties.detection_count_in_frame ?? 'N/A'}</p>
          `;

          if (properties.compressed_annotated_image_url) {
            hoverTooltipContent += `
              <img src="${properties.compressed_annotated_image_url}" alt="Annotated Frame Image" style="max-width: 600px; height: auto; border-radius: 4px; margin-top: 5px; object-fit: contain;" />
            `;
          } else if (properties.compressed_annotated_image_path_in_zip) {
            hoverTooltipContent += `<p style="margin-top: 5px; color: #aaa;">Image in ZIP</p>`;
          } else {
            hoverTooltipContent += `<p style="margin-top: 5px; color: #aaa;">No image preview</p>`;
          }
          
          hoverTooltipContent += `</div>`;

          marker.bindTooltip(hoverTooltipContent, {
              permanent: false,
              direction: 'top',
              offset: L.point(0, -35),
              className: 'custom-hover-tooltip',
              maxWidth: 600,
              opacity: 0.95,
              sticky: false
          });
        }

        marker.bindPopup(clickPopupContent, {
            maxWidth: 340,
            autoClose: false,
            closeOnClick: false,
            className: 'custom-click-popup',
            offset: L.point(0, -10)
        });

        marker.on('click', function () {
            marker.openPopup();
        });
      }

      return marker;
    }
    return null;
  };

  useEffect(() => {
    if (mapRef.current) {
      // Clear existing layers
      if (clusterGroupRef.current) {
        mapRef.current.removeLayer(clusterGroupRef.current);
      }
      if (pathDensityLayerRef.current) {
        mapRef.current.removeLayer(pathDensityLayerRef.current);
      }
      if (crackLinesLayerRef.current) {
        mapRef.current.removeLayer(crackLinesLayerRef.current);
      }
      if (individualMarkersLayerRef.current) {
        mapRef.current.removeLayer(individualMarkersLayerRef.current);
      }

      // Create path density layer
      if (finalPathSegments && finalPathSegments.features.length > 0) {
        // --- Use percentile thresholds for coloring ---
        const { p50, p70, p85 } = percentileThresholds;

        const pathLayer = L.geoJson(finalPathSegments, {
          style: function (feature) {
            const density = feature?.properties?.crack_density || 0;
            let color = '#00FF00'; // Green: bottom 50%

            if (density > p85) {
              color = '#FF0000'; // Red: top 15% (above 85th percentile)
            } else if (density > p70) {
              color = '#FFA500'; // Orange: next 15% (between 70th and 85th percentile)
            } else if (density > p50) {
              color = '#FFFF00'; // Yellow: next 20% (between 50th and 70th percentile)
            }
            // Densities <= p50 remain green

            return {
              color: color,
              weight: 8,
              opacity: 0.8,
              lineCap: 'round'
            };
          },
          onEachFeature: function (feature, layer) {
            if (feature.properties) {
              layer.bindPopup(`
                <strong>Path Segment:</strong><br/>
                <strong>Detections:</strong> ${feature.properties.detections_in_segment ?? 'N/A'}<br/>
                <strong>Density:</strong> ${feature.properties.crack_density?.toFixed(2) ?? 'N/A'} detections/ft<br/>
                <strong>Length:</strong> ${feature.properties.actual_length_feet?.toFixed(1) ?? 'N/A'} ft
              `);
            }
          }
        });
        pathDensityLayerRef.current = pathLayer;
      }

      // Parent track crack grid/segments (LineString or Polygon)
      const crackFeatures = geojson?.features
        ?.filter((f: any) => f.geometry?.type === 'LineString' || f.geometry?.type === 'Polygon') || [];

      if (crackFeatures.length > 0) {
        const crackLayer = L.geoJSON(crackFeatures as any, {
          style: (feat: any) => ({
            color: getTrackColor(feat),
            weight: feat.geometry?.type === 'Polygon' ? 1.5 : 6,
            opacity: 0.85,
            fillColor: getTrackColor(feat),
            fillOpacity: feat.geometry?.type === 'Polygon' ? 0.35 : 0,
          }),
          onEachFeature: (feat: any, layer: any) => {
            const props = feat?.properties || {};
            const damage = props.damage_count ?? 0;
            const tracks = Array.isArray(props.track_ids) ? props.track_ids.join(', ') : 'N/A';

            // Format coordinates for display
            const startCoord = props.start_coord;
            const endCoord = props.end_coord;
            const startLat = Array.isArray(startCoord) && startCoord.length >= 2 ? startCoord[1].toFixed(6) : 'N/A';
            const startLng = Array.isArray(startCoord) && startCoord.length >= 2 ? startCoord[0].toFixed(6) : 'N/A';
            const endLat = Array.isArray(endCoord) && endCoord.length >= 2 ? endCoord[1].toFixed(6) : 'N/A';
            const endLng = Array.isArray(endCoord) && endCoord.length >= 2 ? endCoord[0].toFixed(6) : 'N/A';

            layer.bindTooltip(`
              <div style="font-family: 'Inter', sans-serif; font-size: 12px;">
                <strong>Segment</strong><br/>
                Damage: ${damage}<br/>
                Start: ${startLat}, ${startLng}<br/>
                End: ${endLat}, ${endLng}
              </div>
            `, { sticky: true });

            layer.bindPopup(`
              <div style="font-family: 'Inter', sans-serif;">
                <strong>Segment</strong><br/>
                Tracks: ${tracks}<br/>
                Damage: ${damage}<br/>
                Defect types: ${Array.isArray(props.defect_types) && props.defect_types.length > 0 ? props.defect_types.join(', ') : 'N/A'}<br/>
                <br/>
                <strong>Start:</strong> ${startLat}, ${startLng}<br/>
                <strong>End:</strong> ${endLat}, ${endLng}
              </div>
            `);
            layer.on('click', () => {
              const payload = {
                damage_count: damage,
                track_ids: props.track_ids || [],
                defect_type: props.defect_type || 'Aggregated',
                overlapping_tracks: props.overlapping_tracks || [],
                start_coord: props.start_coord,
                end_coord: props.end_coord,
                start_feet: props.start_feet,
                end_feet: props.end_feet,
                job_ids: props.job_ids || [],
              };
              setSelectedTrackGroup(payload);
              if (typeof onSegmentSelected === 'function') {
                onSegmentSelected(payload);
              }
            });
          }
        });
        crackLinesLayerRef.current = crackLayer;
      } else {
        crackLinesLayerRef.current = null;
      }

      // Create cluster group
      const clusterGroup = (L as any).markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: false,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: false,
        disableClusteringAtZoom: ZOOM_THRESHOLDS.INDIVIDUAL_MARKERS,
        
        iconCreateFunction: function(cluster: any) {
          const childMarkers = cluster.getAllChildMarkers();
          const totalDetectionsInCluster = childMarkers.reduce((sum: number, marker: any) => {
            return sum + (marker.feature?.properties?.detection_count_in_frame || 0);
          }, 0);

          let c = ' marker-cluster-';
          let size = 40;
          
          if (totalDetectionsInCluster < 10) {
            c += 'small';
            size = 35;
          } else if (totalDetectionsInCluster < 100) {
            c += 'medium';
            size = 40;
          } else {
            c += 'large';
            size = 45;
          }

          return new L.DivIcon({
            html: '<div><span>' + totalDetectionsInCluster + '</span></div>',
            className: 'marker-cluster' + c,
            iconSize: new L.Point(size, size)
          });
        }
      });

      clusterGroup.on('clusterclick', function(event: any) {
        const cluster = event.layer;
        const childMarkers = cluster.getAllChildMarkers();
        
        const sortedMarkers = sortMarkersChronologically(
          childMarkers.map((marker: any) => marker.feature)
        );

        const clusterData: ClusterData = {
          markers: sortedMarkers,
          totalDetections: childMarkers.reduce((sum: number, marker: any) => {
            return sum + (marker.feature?.properties?.detection_count_in_frame || 0);
          }, 0)
        };

        setSelectedCluster(clusterData);
        setSelectedTrackGroup(null);
        if (typeof onSegmentSelected === 'function') {
          onSegmentSelected(null);
        }
        setIsSidebarOpen(true); // Update parent state
        L.DomEvent.stopPropagation(event.originalEvent);
      });

      // Create individual markers layer group
      const individualMarkersLayer = L.layerGroup();

      // Add markers to both cluster group and individual markers layer
      if (geojson?.features) {
        geojson.features
        .filter((feature: any) => feature.properties?.detection_count_in_frame > 0)
        .forEach((feature: any) => {
          // Create marker for cluster group
          const clusterMarker = createMarker(feature, true);
          if (clusterMarker) {
            clusterGroup.addLayer(clusterMarker);
          }

          // Create marker for individual markers layer (with tooltip)
          const individualMarker = createMarker(feature, false);
          if (individualMarker) {
            individualMarkersLayer.addLayer(individualMarker);
          }
        });
      }

      clusterGroupRef.current = clusterGroup;
      individualMarkersLayerRef.current = individualMarkersLayer;

      // Set up zoom event listener
      mapRef.current.on('zoomend', () => {
        if (mapRef.current) {
          const zoom = mapRef.current.getZoom();
          setCurrentZoom(zoom);
          updateLayerVisibility(zoom);
        }
      });

      // Initial layer visibility setup
      const initialZoom = mapRef.current.getZoom();
      setCurrentZoom(initialZoom);
      updateLayerVisibility(initialZoom);

      // Fit bounds
      const allLayers = [];
      if (clusterGroup.getLayers().length > 0) {
        allLayers.push(clusterGroup);
      }
      if (pathDensityLayerRef.current) {
        allLayers.push(pathDensityLayerRef.current);
      }
      if (crackLinesLayerRef.current) {
        allLayers.push(crackLinesLayerRef.current);
      }

      if (allLayers.length > 0) {
        const combinedGroup = new L.featureGroup(allLayers);
        if (combinedGroup.getBounds().isValid()) {
          mapRef.current.fitBounds(combinedGroup.getBounds(), { padding: [20, 20] });
        } else {
          mapRef.current.setView([47.6, -122.3], 13);
        }
      } else {
        mapRef.current.setView([47.6, -122.3], 13);
      }
    } else if (mapRef.current) {
      // If geojson is null, clear all layers and reset view
      if (clusterGroupRef.current) {
        mapRef.current.removeLayer(clusterGroupRef.current);
        clusterGroupRef.current = null;
      }
      if (pathDensityLayerRef.current) {
        mapRef.current.removeLayer(pathDensityLayerRef.current);
        pathDensityLayerRef.current = null;
      }
      if (crackLinesLayerRef.current) {
        mapRef.current.removeLayer(crackLinesLayerRef.current);
        crackLinesLayerRef.current = null;
      }
      if (individualMarkersLayerRef.current) {
        mapRef.current.removeLayer(individualMarkersLayerRef.current);
        individualMarkersLayerRef.current = null;
      }
      mapRef.current.setView([47.6, -122.3], 13);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson, finalPathSegments, minDensity, maxDensity, percentileThresholds, setIsSidebarOpen, onSegmentSelected]); // Added setIsSidebarOpen to dependencies

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      {/* Zoom level indicator */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'rgba(255, 255, 255, 0.9)',
        padding: '8px 12px',
        borderRadius: '4px',
        fontSize: '0.9em',
        fontFamily: 'Inter, sans-serif',
        zIndex: 1000,
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
      }}>
        Zoom: {currentZoom} | 
        {currentZoom >= ZOOM_THRESHOLDS.INDIVIDUAL_MARKERS ? ' Individual Markers' :
         currentZoom >= ZOOM_THRESHOLDS.CLUSTERS_VISIBLE ? ' Paths + Clusters' :
         currentZoom >= ZOOM_THRESHOLDS.PATHS_VISIBLE ? ' Paths Only' : ' No Layers'}
      </div>

      <style jsx>{`
        /* Custom cluster styles */
        .marker-cluster-small {
          background-color: rgba(181, 226, 140, 0.8);
          border: 3px solid rgba(110, 204, 57, 1);
        }
        .marker-cluster-small div {
          background-color: rgba(110, 204, 57, 0.9);
          border-radius: 50%;
          width: 29px;
          height: 29px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .marker-cluster-medium {
          background-color: rgba(241, 211, 87, 0.8);
          border: 3px solid rgba(240, 194, 12, 1);
        }
        .marker-cluster-medium div {
          background-color: rgba(240, 194, 12, 0.9);
          border-radius: 50%;
          width: 34px;
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .marker-cluster-large {
          background-color: rgba(253, 156, 115, 0.8);
          border: 3px solid rgba(241, 128, 23, 1);
        }
        .marker-cluster-large div {
          background-color: rgba(241, 128, 23, 0.9);
          border-radius: 50%;
          width: 39px;
          height: 39px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .marker-cluster div span {
          color: white;
          font-weight: bold;
          font-size: 12px;
          text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.7);
        }
        .marker-cluster:hover {
          cursor: pointer;
          transform: scale(1.1);
          transition: transform 0.2s ease;
        }
        .marker-cluster {
          border-radius: 50%;
          transition: transform 0.2s ease;
        }

        /* Custom popup styling for better readability */
        .leaflet-popup-content-wrapper {
            border-radius: 8px;
            padding: 10px;
            font-family: 'Inter', sans-serif;
            font-size: 0.9em;
        }
        .leaflet-popup-content {
            margin: 0;
            padding: 0;
        }
        .custom-hover-popup .leaflet-popup-content-wrapper {
            background-color: rgba(255, 255, 255, 0.95);
            box-shadow: 0 3px 14px rgba(0,0,0,0.2);
            border: 1px solid #ddd;
        }
        .custom-click-popup .leaflet-popup-content-wrapper {
            background-color: #fff;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
            border: 1px solid #ccc;
        }
        .leaflet-popup-tip {
            background: #fff;
        }
        
        /* Enhanced tooltip styling for BIGGER images */
        .custom-hover-tooltip {
            background-color: rgba(0, 0, 0, 0.85);
            color: white;
            border-radius: 8px;
            padding: 12px 16px;
            font-size: 0.85em;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            border: 1px solid rgba(255, 255, 255, 0.1);
            max-width: 380px;
            z-index: 1000;
            pointer-events: none; /* Prevent tooltip from interfering with mouse events */
        }
        
        .custom-hover-tooltip .leaflet-tooltip-tip {
            border-top-color: rgba(0, 0, 0, 0.85);
        }
        
        /* Additional styling for better tooltip appearance */
        .leaflet-tooltip {
            transform: translateY(-15px); /* Additional offset to move tooltip further from cursor */
        }
        
        .custom-hover-tooltip img {
            display: block;
            margin: 8px auto 0;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 6px;
        }

        /* Sidebar styles */
        .sidebar {
          position: fixed; /* Keep fixed to float over content */
          top: 0;
          right: ${isSidebarOpen ? '0' : `-${sidebarWidth}px`}; /* Use prop for positioning */
          width: ${sidebarWidth}px; /* Use prop for width */
          box-shadow: -2px 0 15px rgba(0,0,0,0.2);
          height: 100vh;
          background: white;
          z-index: 9999; /* Higher than map container to always be on top */
          transition: right 0.3s ease;
          overflow-y: auto;
          font-family: 'Inter', sans-serif;
        }

        .sidebar-header {
          padding: 20px;
          border-bottom: 1px solid #eee;
          position: sticky;
          top: 0;
          background: white;
          z-index: 10;
        }

        .sidebar-content {
          padding: 20px;
        }

        .frame-item {
          border: 2px solid #e0e0e0;
          border-radius: 12px;
          margin-bottom: 24px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .frame-item img {
          max-width: ${sidebarWidth - 100}px; /* Use prop for dynamic image width */
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          margin: 12px 0;
          border-radius: 8px;
        }

        .close-btn {
          background: #ff4444;
          color: white;
          border: none;
          border-radius: 6px;
          padding: 8px 16px;
          cursor: pointer;
          font-size: 14px;
          float: right;
        }

        .close-btn:hover {
          background: #cc0000;
        }

        .detection-row-wrapper {
          margin-top: 16px;
          border: 1px dashed #e5e7eb;
          border-radius: 10px;
          padding: 12px;
          background: #f9fafb;
          position: relative;
          overflow: visible;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .detection-row-wrapper.expanded {
          border-color: #a5b4fc;
          box-shadow: 0 8px 20px rgba(99, 102, 241, 0.1);
        }

        .detection-row-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.85em;
          color: #4b5563;
          margin-bottom: 8px;
        }

        .detection-preview-row {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 4px;
          cursor: pointer;
        }

        .detection-thumb {
          width: 56px;
          height: 56px;
          border-radius: 8px;
          border: 1px solid #d1d5db;
          background: linear-gradient(145deg, #fff, #e5e7eb);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.7em;
          font-weight: 600;
          color: #374151;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
          flex-shrink: 0;
        }

        .detection-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 8px;
        }

        .detection-grid-popup {
          display: none;
          position: absolute;
          top: 100%;
          left: 0;
          width: min(420px, calc(100vw - 80px));
          background: white;
          border: 1px solid #d1d5db;
          border-radius: 12px;
          padding: 16px;
          box-shadow: 0 15px 35px rgba(0,0,0,0.18);
          margin-top: 10px;
          z-index: 20;
        }

        .detection-row-wrapper.expanded .detection-grid-popup {
          display: block;
        }

        .detection-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 12px;
        }

        .detection-grid-item {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 0.8em;
          color: #1f2937;
        }

        .detection-grid-item img {
          width: 100%;
          height: 100px;
          object-fit: cover;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        }

        .detection-grid-meta {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .detection-toggle-btn {
          border: none;
          background: #e0e7ff;
          color: #3730a3;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.75em;
          font-weight: 600;
          transition: background 0.2s ease, color 0.2s ease;
          cursor: pointer;
          margin-left: 8px;
        }

        .detection-toggle-btn:hover {
          background: #c7d2fe;
          color: #312e81;
        }

        /* Overlay to darken background when sidebar is open */
        .sidebar-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.3);
          z-index: 1000; /* Lower than sidebar, higher than map */
          display: ${isSidebarOpen ? 'block' : 'none'};
        }
        .chronological-indicator {
          background: linear-gradient(90deg, #4CAF50, #2196F3);
          color: white;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 0.8em;
          font-weight: 600;
          display: inline-block;
          margin-bottom: 12px;
        }

        @media (max-width: 768px) {
          .sidebar {
            width: 90vw;
            right: ${isSidebarOpen ? '0' : '-90vw'};
          }
          .frame-item img {
            max-width: calc(90vw - 80px);
          }
        }
      `}</style>
      
      {/* Sidebar overlay */}
      <div className="sidebar-overlay" onClick={closeSidebar}></div>

      {/* Segment modal */}
      {segmentModalOpen && selectedTrackGroup && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 20000,
          paddingTop: '60px',
        }}
        onClick={() => setSegmentModalOpen(false)}
        >
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '20px',
            width: '600px',
            maxWidth: '90vw',
            maxHeight: '80vh',
            overflowY: 'auto',
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
            position: 'relative',
          }}
          onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Segment Coverage</h3>
              <button className="close-btn" onClick={() => setSegmentModalOpen(false)}>Close</button>
            </div>
            {Array.isArray(selectedTrackGroup.overlapping_tracks) && selectedTrackGroup.overlapping_tracks.length > 0 ? (
              (() => {
                const maxEnd = selectedTrackGroup.overlapping_tracks.reduce((max: number, t: any) => Math.max(max, Number(t.end_feet) || 0), 0) || 1;
                return (
                  <div>
                    <div style={{ marginBottom: 8, color: '#555', fontSize: '0.9em' }}>
                      X-axis: feet along combined path · Y-axis: parent/track IDs
                    </div>
                    <div style={{ border: '1px solid #e5e7eb', padding: '12px', borderRadius: '8px', position: 'relative' }}>
                      {hoveredThumbnail && (
                        <div style={{
                          position: 'absolute',
                          top: '-10px',
                          right: '-10px',
                          background: 'white',
                          border: '1px solid #d1d5db',
                          borderRadius: '8px',
                          padding: '6px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                          zIndex: 10,
                        }}>
                          <img src={hoveredThumbnail} alt="thumbnail" style={{ maxWidth: '280px', maxHeight: '220px', objectFit: 'contain', borderRadius: '6px' }} />
                        </div>
                      )}
                      {(() => {
                        const grouped = (selectedTrackGroup.overlapping_tracks || []).reduce((acc: any[], t: any) => {
                          const parentId = t.parent_track_id ?? t.track_id ?? `track-${acc.length}`;
                          let existing = acc.find((g: any) => g.parent_track_id === parentId);
                          if (!existing) {
                            existing = { parent_track_id: parentId, spans: [] as any[] };
                            acc.push(existing);
                          }
                          existing.spans.push({
                            start_feet: Number(t.start_feet) || 0,
                            end_feet: Number(t.end_feet) || 0,
                            thumbnail_url: t.thumbnail_url,
                            track_damage: t.track_damage,
                            track_id: t.track_id,
                            defect_types: t.defect_types,
                          });
                          return acc;
                        }, []);

                        return grouped.map((group: any, idx: number) => {
                          const spans = group.spans.sort((a: any, b: any) => a.start_feet - b.start_feet);
                          const groupStart = Math.min(...spans.map((s: any) => s.start_feet));
                          const groupEnd = Math.max(...spans.map((s: any) => s.end_feet));
                          const label = group.parent_track_id ?? `track-${idx}`;
                          let lastDrawnEnd = groupStart;
                          return (
                            <div key={idx} style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: '0.9em', marginBottom: 4, color: '#374151' }}>
                                {label} ({groupStart.toFixed(1)}ft - {groupEnd.toFixed(1)}ft)
                              </div>
                              <div style={{ position: 'relative', height: '18px', background: '#f3f4f6', borderRadius: '8px' }}>
                                {spans.map((s: any, spanIdx: number) => {
                                  const rawStart = s.start_feet;
                                  const rawEnd = s.end_feet;
                                  const adjStart = Math.max(rawStart, lastDrawnEnd);
                                  const adjEnd = Math.max(adjStart + 0.01, rawEnd); // ensure positive width
                                  const widthPct = Math.max(2, ((adjEnd - adjStart) / maxEnd) * 100);
                                  const leftPct = (adjStart / maxEnd) * 100;
                                  lastDrawnEnd = adjEnd;
                                  return (
                                    <div
                                      key={spanIdx}
                                      style={{
                                        position: 'absolute',
                                        left: `${leftPct}%`,
                                        width: `${widthPct}%`,
                                        top: 0,
                                        bottom: 0,
                                        background: '#2563eb',
                                        borderRadius: '8px',
                                        opacity: 0.9,
                                      }}
                                      onMouseEnter={() => {
                                        if (s.thumbnail_url) setHoveredThumbnail(s.thumbnail_url);
                                        const damageType = Array.isArray(s.defect_types) && s.defect_types.length > 0
                                          ? s.defect_types.join(', ')
                                          : 'unknown';
                                        setHoveredSegmentInfo({
                                          label: label,
                                          range: `${adjStart.toFixed(1)}ft - ${adjEnd.toFixed(1)}ft`,
                                          damage: s.track_damage,
                                          trackId: s.track_id,
                                          damageType,
                                        });
                                      }}
                                      onMouseLeave={() => {
                                        setHoveredThumbnail(null);
                                        setHoveredSegmentInfo(null);
                                      }}
                                    />
                                  );
                                })}
                              </div>
                              {hoveredSegmentInfo && hoveredSegmentInfo.label === label && (
                                <div style={{ marginTop: 6, fontSize: '0.85em', color: '#374151' }}>
                                  Defect {hoveredSegmentInfo.trackId ?? label}: {hoveredSegmentInfo.damageType ?? 'unknown'} ({hoveredSegmentInfo.range}) · Damage: {hoveredSegmentInfo.damage ?? 'N/A'}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                );
              })()
            ) : (
              <div style={{ color: '#6b7280' }}>No track coverage data for this segment.</div>
            )}
          </div>
        </div>
      )}
      
      {/* Sidebar */}
          <div className="sidebar">
            <div className="sidebar-header">
              <h2 style={{ margin: '0 0 10px 0', fontSize: '1.3em', color: '#333' }}>
                {selectedTrackGroup ? 'Track Details' : 'Cluster Details'}
              </h2>
          <button className="close-btn" onClick={closeSidebar}>
            Close
          </button>
          {selectedTrackGroup && (
            <div style={{ clear: 'both', marginTop: '16px' }}>
              <p style={{ margin: '4px 0', fontSize: '0.95em' }}>
                <strong>Tracks:</strong> {Array.isArray(selectedTrackGroup.track_ids) ? selectedTrackGroup.track_ids.join(', ') : 'N/A'}
              </p>
              <p style={{ margin: '4px 0', fontSize: '0.95em' }}>
                <strong>Damage Count:</strong> {selectedTrackGroup.damage_count ?? 0}
              </p>
              <p style={{ margin: '4px 0', fontSize: '0.95em' }}>
                <strong>Type:</strong> {selectedTrackGroup.defect_type ?? 'Aggregated'}
              </p>
            </div>
          )}
          {selectedCluster && !selectedTrackGroup && (
            <div style={{ clear: 'both', marginTop: '16px' }}>
              <p style={{ margin: '4px 0', fontSize: '0.95em' }}>
                <strong>Total Frames:</strong> {selectedCluster.markers.length}
              </p>
              <div style={{padding:10}}>
                <p style={{fontSize: '0.95em' }}>
                  <strong>Total Detections:</strong> {selectedCluster.totalDetections}
                </p>
                <button className="close-btn" onClick={closeSidebar}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
        
        <div className="sidebar-content">
          {selectedTrackGroup && (
              <div className="frame-item">
                <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1em', color: '#333' }}>
                  Aggregated Segment
                </h3>
                <div style={{ fontSize: '0.9em', color: '#666' }}>
                  <p style={{ margin: '2px 0' }}>
                    <strong>Tracks:</strong> {Array.isArray(selectedTrackGroup.track_ids) ? selectedTrackGroup.track_ids.join(', ') : 'N/A'}
                  </p>
                  <p style={{ margin: '2px 0' }}>
                    <strong>Damage Count:</strong> {selectedTrackGroup.damage_count ?? 0}
                  </p>
                  <p style={{ margin: '2px 0' }}>
                    <strong>Type:</strong> {selectedTrackGroup.defect_type ?? 'N/A'}
                  </p>
                  <p style={{ margin: '2px 0' }}>
                    <strong>Start Coord:</strong> {Array.isArray(selectedTrackGroup.start_coord) ? selectedTrackGroup.start_coord.map((c: number) => c.toFixed(5)).join(', ') : 'N/A'}
                  </p>
                  <p style={{ margin: '2px 0' }}>
                    <strong>End Coord:</strong> {Array.isArray(selectedTrackGroup.end_coord) ? selectedTrackGroup.end_coord.map((c: number) => c.toFixed(5)).join(', ') : 'N/A'}
                  </p>
                </div>
              </div>
            )}
          {selectedCluster && !selectedTrackGroup && sortedSidebarFrames.map((feature, index) => {
            const props = feature.properties;
            const detections = Array.isArray(props?.all_detections_in_frame) ? props.all_detections_in_frame : [];
            const frameKey = String(props?.frame_number ?? props?.frame_id ?? `frame-${index}`);
            const isGridExpanded = expandedDetectionFrames.has(frameKey);
            const handleToggleGrid = () => toggleDetectionGrid(frameKey);
            return (
              <div key={props?.frame_number ?? props?.frame_id ?? index} className="frame-item">
                <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1em', color: '#333' }}>
                  Frame #{props?.frame_number ?? 'N/A'}
                </h3>
                
                <div style={{ fontSize: '0.9em', color: '#666' }}>
                  <p style={{ margin: '2px 0' }}>
                    <strong>Distance:</strong> {props?.actual_distance_feet?.toFixed(1) ?? 'N/A'} ft
                  </p>
                  <p style={{ margin: '2px 0' }}>
                    <strong>Speed:</strong> {props?.speed_mph?.toFixed(1) ?? 'N/A'} mph
                  </p>
                  <p style={{ margin: '2px 0' }}>
                    <strong>Detections:</strong> {props?.detection_count_in_frame ?? 'N/A'}
                  </p>
                  <p style={{ margin: '2px 0' }}>
                    <strong>Frame Type:</strong> ${props?.frame_type ?? 'N/A'}
                  </p>
                  <p style={{ margin: '2px 0' }}>
                    <strong>GPS Index:</strong> ${props?.gps_index ?? 'N/A'}
                  </p>
                  <p style={{ margin: '2px 0' }}>
                    <strong>Timestamp:</strong> ${props.globalTimestamp ? new Date(props.globalTimestamp).toLocaleString() : 'N/A'}
                  </p>
                </div>

                {/* Display image if available */}
                {props?.compressed_annotated_image_url && (
                  <div>
                    <img 
                      src={props.compressed_annotated_image_url} 
                      alt={`Frame ${props.frame_number}`} 
                    />
                    <div style={{ fontSize: '0.85em', marginTop: '8px' }}>
                      <a 
                        href={props.annotated_image_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{ display: 'block', color: '#0066cc', marginBottom: '4px' }}
                      >
                        View High-Res Annotated
                      </a>
                      <a 
                        href={props.original_image_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{ display: 'block', color: '#0066cc' }}
                      >
                        View Original Frame
                      </a>
                    </div>
                  </div>
                )}

                {/* Show detections if available */}
                {detections.length > 0 && (
                  <div className={`detection-row-wrapper ${isGridExpanded ? 'expanded' : ''}`}>
                    <div className="detection-row-header">
                      <span><strong>Detections:</strong> {detections.length}</span>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75em', color: '#6b7280' }}>
                          {isGridExpanded ? 'Click thumbnails to hide grid' : 'Click thumbnails to expand grid'}
                        </span>
                        <button
                          type="button"
                          className="detection-toggle-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleToggleGrid();
                          }}
                        >
                          {isGridExpanded ? 'Hide grid' : 'Show grid'}
                        </button>
                      </div>
                    </div>
                    <div
                      className="detection-preview-row"
                      role="button"
                      tabIndex={0}
                      onClick={handleToggleGrid}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleToggleGrid();
                        }
                      }}
                    >
                      {detections.map((det: any, detIndex: number) => {
                        const previewSrc = det?.thumbnail_url || det?.polygon_overlay_url || det?.annotated_image_url;
                        const label = det?.class_name || det?.defect_type || `#${detIndex + 1}`;
                        return (
                          <div key={`${props?.frame_number ?? index}-preview-${det?.defect_id ?? detIndex}`} className="detection-thumb" title={label}>
                            {previewSrc ? (
                              <img src={previewSrc} alt={label} />
                            ) : (
                              label.slice(0, 3).toUpperCase()
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="detection-grid-popup">
                      <div style={{ fontWeight: 600, marginBottom: '10px', color: '#111827', fontSize: '0.85em' }}>
                        Frame {props?.frame_number ?? 'N/A'} detections
                      </div>
                      <div className="detection-grid">
                        {detections.map((det: any, detIndex: number) => {
                          const gridImage = det?.polygon_overlay_url || det?.measurement_overlay_url || det?.thumbnail_url || det?.annotated_image_url || det?.original_frame_url;
                          const displayLabel = det?.class_name || det?.defect_type || `Detection ${detIndex + 1}`;
                          const confidenceLabel = typeof det?.confidence === 'number' ? det.confidence.toFixed(2) : 'N/A';
                          return (
                            <div key={`${props?.frame_number ?? index}-grid-${det?.defect_id ?? detIndex}`} className="detection-grid-item">
                              {gridImage && (
                                <img src={gridImage} alt={displayLabel} />
                              )}
                              <div className="detection-grid-meta">
                                <strong>{`#${detIndex + 1} ${displayLabel}`}</strong>
                                <span>Confidence: {confidenceLabel}</span>
                                {det?.track_id && <span>Track: {det.track_id}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      
      <MapContainer
        center={[47.6, -122.3]}
        zoom={13}
        zoomControl={true}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', borderRadius: '8px' }} // MapContainer always fills its parent
        ref={mapRef}
        maxZoom={20}
      >
        {/* Esri World Imagery (Satellite) - Base Layer */}
        <TileLayer
          attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxNativeZoom={19}
          maxZoom={20}
        />

        {/* Esri World Reference (Labels/Roads) - Overlay Layer */}
        <TileLayer
          attribution='Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
          maxNativeZoom={19}
          maxZoom={20}
          opacity={0.7}
        />
      </MapContainer>
    </div>
  );
};

export default MapComponent;
