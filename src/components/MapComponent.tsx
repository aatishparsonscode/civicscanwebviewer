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

const MapComponent: React.FC<MapComponentProps> = ({ geojson, isSidebarOpen, setIsSidebarOpen, sidebarWidth }) => {
  const mapRef = useRef<L.Map>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const pathDensityLayerRef = useRef<L.GeoJSON | null>(null);
  const individualMarkersLayerRef = useRef<L.LayerGroup | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<ClusterData | null>(null);
  // Removed internal isSidebarOpen, screenSize states as they are now props
  const [currentZoom, setCurrentZoom] = useState(13);

  // Removed useEffect for screenSize, as sidebarWidth is now a prop from parent

  const closeSidebar = () => {
    setSelectedCluster(null);
    setIsSidebarOpen(false); // Update parent state
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
    if (clusterGroupRef.current && map.hasLayer(clusterGroupRef.current)) {
      map.removeLayer(clusterGroupRef.current);
    }
    if (individualMarkersLayerRef.current && map.hasLayer(individualMarkersLayerRef.current)) {
      map.removeLayer(individualMarkersLayerRef.current);
    }

    // Add layers based on zoom level
    if (zoom >= ZOOM_THRESHOLDS.INDIVIDUAL_MARKERS) {
      // Highest zoom: only individual markers
      if (individualMarkersLayerRef.current) {
        map.addLayer(individualMarkersLayerRef.current);
      }
    } else if (zoom >= ZOOM_THRESHOLDS.CLUSTERS_VISIBLE) {
      // Medium zoom: paths + clusters
      if (pathDensityLayerRef.current) {
        map.addLayer(pathDensityLayerRef.current);
      }
      if (clusterGroupRef.current) {
        map.addLayer(clusterGroupRef.current);
      }
    } else if (zoom >= ZOOM_THRESHOLDS.PATHS_VISIBLE) {
      // Low-medium zoom: only paths
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
      if (individualMarkersLayerRef.current) {
        mapRef.current.removeLayer(individualMarkersLayerRef.current);
        individualMarkersLayerRef.current = null;
      }
      mapRef.current.setView([47.6, -122.3], 13);
    }
  }, [geojson, finalPathSegments, minDensity, maxDensity, percentileThresholds, setIsSidebarOpen]); // Added setIsSidebarOpen to dependencies

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

        .detection-list {
          background: white;
          border: 1px solid #ddd;
          border-radius: 6px;
          padding: 12px;
          margin-top: 12px;
          max-height: 200px;
          overflow-y: auto;
        }

        .detection-item {
          padding: 8px 0;
          border-bottom: 1px dashed #eee;
          font-size: 0.9em;
        }

        .detection-item:last-child {
          border-bottom: none;
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
      
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2 style={{ margin: '0 0 10px 0', fontSize: '1.3em', color: '#333' }}>
            Cluster Details
          </h2>
          <button className="close-btn" onClick={closeSidebar}>
            Close
          </button>
          {selectedCluster && (
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
          {selectedCluster && selectedCluster.markers.map((feature, index) => {
            const props = feature.properties;
            return (
              <div key={index} className="frame-item">
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
                {props?.all_detections_in_frame && props.all_detections_in_frame.length > 0 && (
                  <div className="detection-list">
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95em', color: '#333' }}>
                      Detections ({props.detection_count_in_frame}):
                    </h4>
                    {props.all_detections_in_frame.map((det: any, detIndex: number) => (
                      <div key={detIndex} className="detection-item">
                        <div><strong>Defect {detIndex + 1}:</strong></div>
                        <div>Class ID: ${det.class_id ?? 'N/A'}, Confidence: ${det.confidence?.toFixed(2) ?? 'N/A'}</div>
                        <div>BBox: [${det.bbox ? det.bbox.map((coord: number) => coord.toFixed(0)).join(', ') : 'N/A'}]</div>
                      </div>
                    ))}
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