'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as turf from '@turf/turf';

// S3 URL conversion
const S3_HTTP_BASE_URL = 'https://civicscan-data-dev-usw2.s3.us-west-2.amazonaws.com';

const convertS3UriToHttp = (uri: string | null | undefined): string | null | undefined => {
  if (!uri || typeof uri !== 'string') return uri;
  if (!uri.startsWith('s3://')) return uri;

  const remainder = uri.slice('s3://'.length);
  const slashIndex = remainder.indexOf('/');
  if (slashIndex === -1) return uri;

  const bucket = remainder.slice(0, slashIndex);
  const key = remainder.slice(slashIndex + 1);
  if (!key) return uri;

  const normalizedKey = key.replace(/^\/+/, '');
  const httpBase = bucket === 'civicscan-data-dev-usw2'
    ? S3_HTTP_BASE_URL
    : `https://${bucket}.s3.amazonaws.com`;

  return `${httpBase}/${normalizedKey}`;
};

interface DefectData {
  defect_id: string;
  defect_type: string;
  gps_coordinates: {
    latitude: number;
    longitude: number;
  };
  location: {
    centroid_px: [number, number];
  };
  severity: {
    joint_severity: string;
  };
  images?: {
    thumbnail?: string;
    polygon_overlay?: string;
  };
  measurements_pixel?: {
    width_px?: {
      values?: number[];
      mean?: number;
      min?: number;
      max?: number;
      count?: number;
    };
    length_px?: number;
    area_px?: number; // For alligator cracks
  };
}

interface ProcessedTrack {
  track_id: number;
  coordinates: [number, number][]; // [longitude, latitude]
  defects?: DefectData[];
  start_feet?: number;
  end_feet?: number;
  defect_types?: string[];
}

interface RoadGridVisualizationProps {
  tracks: ProcessedTrack[];
  segmentStartFeet: number;
  segmentEndFeet: number;
  segmentStartCoord?: [number, number]; // [longitude, latitude]
  segmentEndCoord?: [number, number];   // [longitude, latitude]
  pciDetails?: {
    pci_score?: number;
    pci_rating?: string;
    total_deduct_value?: number;
    deduct_breakdown?: {
      transverse: number;
      longitudinal: number;
      alligator: number;
      pothole: number;
    };
    damage_metrics?: {
      total_damage_length_ft: number;
      damage_percentage: number;
      defect_count_by_type: Record<string, number>;
      severity_distribution: Record<string, Record<string, number>>;
    };
  };
}

interface GridCell {
  row: number;
  col: number;
  defects: DefectData[];
  intensity: number; // 0-1 for heat map
  severity: 'none' | 'minimal' | 'low' | 'medium' | 'high';
}

const GRID_COLS = 6;
const GRID_ROWS = 10;
const FRAME_WIDTH_4K = 3840;

/**
 * Calculate pixel area for a defect
 * - Alligator cracks: use area_px directly
 * - Longitudinal/Transverse: calculate width × length
 */
function getDefectPixelArea(defect: DefectData): number {
  const measurements = defect.measurements_pixel;

  // 1. If area_px exists (alligator cracks), use it directly
  if (measurements?.area_px) {
    return measurements.area_px;
  }

  // 2. Calculate from width × length (longitudinal/transverse)
  if (measurements?.width_px && measurements?.length_px) {
    const width = measurements.width_px.mean ||
                  (measurements.width_px.values?.[0]) ||
                  1;
    return width * measurements.length_px;
  }

  // 3. Fallback: minimal area if no measurements
  return 10; // Default small area
}

// Defect type colors
const DEFECT_COLORS: Record<string, string> = {
  alligator: '#ef4444', // red
  longitudinal: '#f59e0b', // amber
  transverse: '#3b82f6', // blue
  pothole: '#8b5cf6', // purple
  default: '#6b7280', // gray
};

// Severity sizes
const SEVERITY_SIZES: Record<string, number> = {
  low: 6,
  medium: 9,
  high: 12,
};

export default function RoadGridVisualization({
  tracks,
  segmentStartFeet,
  segmentEndFeet,
  segmentStartCoord,
  segmentEndCoord,
  pciDetails,
}: RoadGridVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gridCells, setGridCells] = useState<GridCell[][]>([]);
  const [selectedCell, setSelectedCell] = useState<GridCell | null>(null);

  // Clear selected cell when segment changes
  useEffect(() => {
    setSelectedCell(null);
  }, [segmentStartFeet, segmentEndFeet, segmentStartCoord, segmentEndCoord]);

  // Calculate grid data from tracks
  useEffect(() => {
    const cells: GridCell[][] = Array.from({ length: GRID_ROWS }, (_, row) =>
      Array.from({ length: GRID_COLS }, (_, col) => ({
        row,
        col,
        defects: [],
        intensity: 0,
        severity: 'none' as const,
      }))
    );

    const segmentLengthFeet = segmentEndFeet - segmentStartFeet;
    if (segmentLengthFeet <= 0) {
      setGridCells(cells);
      return;
    }

    // Process all defects from all tracks
    tracks.forEach((track) => {
      const defects = track.defects || [];
      const trackCoords = track.coordinates || [];

      if (trackCoords.length === 0 || defects.length === 0) return;

      defects.forEach((defect) => {
        // Calculate vertical position (GPS-based)
        const defectGPS = defect.gps_coordinates;

        // Skip defects without GPS coordinates
        if (!defectGPS || typeof defectGPS.latitude !== 'number' || typeof defectGPS.longitude !== 'number') {
          console.warn('[Grid Warning] Defect missing GPS coordinates:', defect.defect_id);
          return;
        }

        // If we have segment coordinates, calculate distance from segment start
        let rowFraction = 0.5; // Default to middle if no coordinates

        if (segmentStartCoord && segmentEndCoord) {
          // Calculate distance from segment start to defect
          const segmentStartPoint = turf.point(segmentStartCoord);
          const defectPoint = turf.point([defectGPS.longitude, defectGPS.latitude]);
          const distanceFromStartFeet = turf.distance(segmentStartPoint, defectPoint, { units: 'feet' });

          // Filter defects: only include those within segment range (±10 ft buffer for GPS accuracy)
          const BUFFER_FEET = 10;
          const minDistance = Math.max(0, segmentStartFeet - BUFFER_FEET);
          const maxDistance = segmentEndFeet + BUFFER_FEET;

          // Calculate absolute distance from road start
          const defectAbsoluteDistanceFeet = segmentStartFeet + distanceFromStartFeet;

          // Skip defects outside this segment's range
          if (defectAbsoluteDistanceFeet < minDistance || defectAbsoluteDistanceFeet > maxDistance) {
            return; // Skip this defect
          }

          // Map to grid row (0 = start of segment, GRID_ROWS-1 = end of segment)
          rowFraction = distanceFromStartFeet / segmentLengthFeet;

          // Debug: log first few mappings
          if (cells[0][0].defects.length < 3) {
            console.log('[Grid Debug] Defect mapping:', {
              defect_id: defect.defect_id,
              distanceFromStart: distanceFromStartFeet.toFixed(2) + 'ft',
              defectAbsoluteDistance: defectAbsoluteDistanceFeet.toFixed(2) + 'ft',
              segmentRange: `${segmentStartFeet}-${segmentEndFeet}`,
              segmentLength: segmentLengthFeet.toFixed(2) + 'ft',
              rowFraction: rowFraction.toFixed(3),
              calculatedRow: Math.floor(rowFraction * GRID_ROWS),
              col: Math.floor((defect.location.centroid_px[0] / FRAME_WIDTH_4K) * GRID_COLS)
            });
          }
        } else {
          // Fallback: use track coordinates to estimate position
          console.warn('[Grid Warning] Segment coordinates unavailable - cannot filter defects by distance. Showing all defects from tracks.');

          const trackCoords = track.coordinates || [];
          if (trackCoords.length > 1) {
            // Find closest coordinate in track
            let minDistance = Infinity;
            let closestIndex = 0;

            trackCoords.forEach((coord, idx) => {
              const distance = Math.sqrt(
                Math.pow(coord[1] - defectGPS.latitude, 2) +
                  Math.pow(coord[0] - defectGPS.longitude, 2)
              );
              if (distance < minDistance) {
                minDistance = distance;
                closestIndex = idx;
              }
            });

            // Calculate distance along track (as fraction)
            rowFraction = trackCoords.length > 1 ? closestIndex / (trackCoords.length - 1) : 0.5;
          }
        }

        // Invert row: 0 at bottom (start), GRID_ROWS-1 at top (end)
        const row = Math.min(GRID_ROWS - 1, Math.max(0, GRID_ROWS - 1 - Math.floor(rowFraction * GRID_ROWS)));

        // Calculate horizontal position (pixel-based)
        const centroidX = defect.location.centroid_px[0];
        const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor((centroidX / FRAME_WIDTH_4K) * GRID_COLS)));

        // Add defect to cell
        cells[row][col].defects.push(defect);

        // Weight by pixel area instead of fixed count
        const pixelArea = getDefectPixelArea(defect);
        cells[row][col].intensity += pixelArea / 1000; // Normalize: 1000 sq px = 1 unit

        // Debug: log first few area calculations
        if (cells[0][0].defects.length < 3) {
          console.log('[Grid Area Debug]', {
            defect_id: defect.defect_id,
            defect_type: defect.defect_type,
            area_px: defect.measurements_pixel?.area_px,
            width_px: defect.measurements_pixel?.width_px?.mean,
            length_px: defect.measurements_pixel?.length_px,
            calculated_area: pixelArea.toFixed(2),
            normalized_intensity: (pixelArea / 1000).toFixed(3)
          });
        }
      });
    });

    // Calculate severity based on distribution across the segment
    // Collect total pixel area per cell
    const cellAreas: number[] = [];
    cells.forEach((row) => row.forEach((cell) => {
      let totalArea = 0;
      cell.defects.forEach(defect => {
        totalArea += getDefectPixelArea(defect);
      });

      if (totalArea > 0) {
        cellAreas.push(totalArea);
      }

      // Store normalized area as intensity
      cell.intensity = totalArea / 1000;
    }));

    // Calculate percentile thresholds based on pixel area
    if (cellAreas.length > 0) {
      // Sort areas to find percentiles
      const sortedAreas = [...cellAreas].sort((a, b) => a - b);
      const len = sortedAreas.length;

      // Calculate 20th, 50th and 80th percentile thresholds
      const p20Index = Math.floor(len * 0.2);
      const p50Index = Math.floor(len * 0.5);
      const p80Index = Math.floor(len * 0.8);

      const minimalThreshold = sortedAreas[0]; // Any defects
      const lowThreshold = sortedAreas[p20Index]; // Above 20th percentile
      const mediumThreshold = sortedAreas[p50Index]; // Above 50th percentile
      const highThreshold = sortedAreas[p80Index]; // Above 80th percentile

      // Assign severity based on percentiles of pixel area
      cells.forEach((row) => row.forEach((cell) => {
        let totalArea = 0;
        cell.defects.forEach(defect => {
          totalArea += getDefectPixelArea(defect);
        });

        if (totalArea === 0) {
          cell.severity = 'none';
        } else if (totalArea >= highThreshold) {
          cell.severity = 'high'; // Top 20% (80-100th percentile)
        } else if (totalArea >= mediumThreshold) {
          cell.severity = 'medium'; // 50-80th percentile
        } else if (totalArea >= lowThreshold) {
          cell.severity = 'low'; // 20-50th percentile
        } else {
          cell.severity = 'minimal'; // Bottom 20% (0-20th percentile)
        }
      }));
    } else {
      // No defects in any cells
      cells.forEach((row) => row.forEach((cell) => {
        cell.severity = 'none';
      }));
    }

    // Normalize intensities for heat map gradient
    let maxIntensity = 0;
    cells.forEach((row) => row.forEach((cell) => {
      maxIntensity = Math.max(maxIntensity, cell.intensity);
    }));

    if (maxIntensity > 0) {
      cells.forEach((row) => row.forEach((cell) => {
        cell.intensity = cell.intensity / maxIntensity;
      }));
    }

    setGridCells(cells);
  }, [tracks, segmentStartFeet, segmentEndFeet, segmentStartCoord, segmentEndCoord]);

  // Draw heat map on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cellWidth = canvas.width / GRID_COLS;
    const cellHeight = canvas.height / GRID_ROWS;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw heat map based on severity (number of cracks)
    gridCells.forEach((row, rowIdx) => {
      row.forEach((cell, colIdx) => {
        if (cell.severity !== 'none') {
          const x = colIdx * cellWidth;
          const y = rowIdx * cellHeight;

          // Color based on severity (crack count percentiles)
          let color: string;
          switch (cell.severity) {
            case 'minimal': // Bottom 20%
              color = 'rgba(229, 231, 235, 0.8)'; // Light grey
              break;
            case 'low': // 20-50th percentile
              color = 'rgba(255, 237, 74, 0.6)'; // Yellow
              break;
            case 'medium': // 50-80th percentile
              color = 'rgba(255, 159, 64, 0.7)'; // Orange
              break;
            case 'high': // Top 20%
              color = 'rgba(239, 68, 68, 0.8)'; // Red
              break;
            default:
              color = 'rgba(0, 0, 0, 0)';
          }

          ctx.fillStyle = color;
          ctx.fillRect(x, y, cellWidth, cellHeight);
        }
      });
    });
  }, [gridCells]);

  const handleCellClick = (cell: GridCell) => {
    if (cell.defects.length > 0) {
      setSelectedCell(cell);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        {/* Grid container with labels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flexShrink: 0 }}>
          <div style={{ fontSize: '0.7rem', color: '#6b7280', textAlign: 'center', fontWeight: 500 }}>
            End of Road Segment →
          </div>
          <div className="relative" style={{ width: '200px', height: '333px', minWidth: '200px', minHeight: '333px', border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden', background: '#f9fafb' }}>
        {/* Heat map canvas */}
        <canvas
          ref={canvasRef}
          width={600}
          height={1000}
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: 'pixelated' }}
        />

        {/* SVG overlay for grid lines, clickable cells, and markers */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox={`0 0 ${GRID_COLS} ${GRID_ROWS}`}
          preserveAspectRatio="none"
        >
          {/* Clickable cell rectangles */}
          {gridCells.flatMap((row, rowIdx) =>
            row.map((cell, colIdx) => (
              <rect
                key={`cell-${rowIdx}-${colIdx}`}
                x={colIdx}
                y={rowIdx}
                width={1}
                height={1}
                fill="transparent"
                className={cell.defects.length > 0 ? 'cursor-pointer hover:fill-white hover:opacity-10' : ''}
                onClick={() => handleCellClick(cell)}
              />
            ))
          )}

          {/* Grid lines */}
          {Array.from({ length: GRID_ROWS + 1 }).map((_, i) => (
            <line
              key={`h-${i}`}
              x1={0}
              y1={i}
              x2={GRID_COLS}
              y2={i}
              stroke="#374151"
              strokeWidth={0.02}
              opacity={0.3}
              pointerEvents="none"
            />
          ))}
          {Array.from({ length: GRID_COLS + 1 }).map((_, i) => (
            <line
              key={`v-${i}`}
              x1={i}
              y1={0}
              x2={i}
              y2={GRID_ROWS}
              stroke="#374151"
              strokeWidth={0.02}
              opacity={0.3}
              pointerEvents="none"
            />
          ))}

        </svg>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#6b7280', textAlign: 'center', fontWeight: 500 }}>
            ← Start of Road Segment
          </div>
        </div>

        {/* Cell Details Panel */}
        {selectedCell && selectedCell.defects.length > 0 && (
          <div className="flex-1 overflow-y-auto" style={{ maxHeight: '600px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#111827', marginBottom: '0.25rem' }}>
                  Road Section ({selectedCell.col + 1}, {selectedCell.row + 1})
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>{selectedCell.defects.length} crack{selectedCell.defects.length > 1 ? 's' : ''} detected</p>
              </div>
              <button
                onClick={() => setSelectedCell(null)}
                style={{ fontSize: '1.5rem', lineHeight: 1, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {selectedCell.defects.map((defect, idx) => (
                <div key={defect.defect_id} style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '0.75rem', background: '#f9fafb' }}>
                  {defect.images?.polygon_overlay && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <img
                        src={convertS3UriToHttp(defect.images.polygon_overlay) || defect.images.polygon_overlay}
                        alt={`Defect overlay ${defect.defect_id}`}
                        style={{ width: '100%', borderRadius: '8px', border: '1px solid #d1d5db' }}
                        onError={(e) => {
                          console.error('[Grid] Failed to load image:', defect.images?.polygon_overlay);
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.85rem', color: '#374151' }}>
                      <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{defect.defect_type}</span>
                      {' · '}
                      <span>Severity: {defect.severity.joint_severity}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                      ID: {defect.defect_id}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                      GPS: {defect.gps_coordinates.latitude.toFixed(6)}, {defect.gps_coordinates.longitude.toFixed(6)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Summary Footer */}
      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem', fontSize: '0.75rem', color: '#6b7280' }}>
        {(() => {
          const totalSections = GRID_COLS * GRID_ROWS;
          const sectionsWithCracks = gridCells.flat().filter(cell => cell.defects.length > 0).length;
          const totalCracks = gridCells.flat().reduce((sum, cell) => sum + cell.defects.length, 0);

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* PCI Information */}
              {pciDetails?.pci_score !== undefined && (
                <div style={{
                  background: '#f0fdf4',
                  border: '1px solid #86efac',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#111827' }}>PCI Score: {pciDetails.pci_score}</span>
                      <span style={{
                        marginLeft: '0.5rem',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        background: pciDetails.pci_score >= 70 ? '#d1fae5' : pciDetails.pci_score >= 55 ? '#fef3c7' : '#fee2e2',
                        color: pciDetails.pci_score >= 70 ? '#065f46' : pciDetails.pci_score >= 55 ? '#92400e' : '#991b1b'
                      }}>
                        {pciDetails.pci_rating}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>
                      Total Deduct: {pciDetails.total_deduct_value}
                    </div>
                  </div>

                  {pciDetails.deduct_breakdown && (
                    <div style={{ fontSize: '0.7rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      {pciDetails.deduct_breakdown.transverse > 0 && (
                        <div><span style={{ fontWeight: 600 }}>Transverse:</span> -{pciDetails.deduct_breakdown.transverse}</div>
                      )}
                      {pciDetails.deduct_breakdown.longitudinal > 0 && (
                        <div><span style={{ fontWeight: 600 }}>Longitudinal:</span> -{pciDetails.deduct_breakdown.longitudinal}</div>
                      )}
                      {pciDetails.deduct_breakdown.alligator > 0 && (
                        <div><span style={{ fontWeight: 600 }}>Alligator:</span> -{pciDetails.deduct_breakdown.alligator}</div>
                      )}
                      {pciDetails.deduct_breakdown.pothole > 0 && (
                        <div><span style={{ fontWeight: 600 }}>Pothole:</span> -{pciDetails.deduct_breakdown.pothole}</div>
                      )}
                    </div>
                  )}

                  {pciDetails.damage_metrics && (
                    <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>
                      Damage: {pciDetails.damage_metrics.total_damage_length_ft.toFixed(1)} ft ({pciDetails.damage_metrics.damage_percentage.toFixed(1)}% of segment)
                    </div>
                  )}
                </div>
              )}

              {/* Grid Statistics */}
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>Road Coverage:</span> {sectionsWithCracks}/{totalSections} sections with cracks
                </div>
                <div>
                  <span style={{ fontWeight: 600 }}>Total Cracks:</span> {totalCracks}
                </div>
                <div>
                  <span style={{ fontWeight: 600 }}>Damage Severity:</span>{' '}
                  <span style={{ color: '#d1d5db' }}>■</span> Minimal (0-20%){' · '}
                  <span style={{ color: '#facc15' }}>■</span> Low (20-50%){' · '}
                  <span style={{ color: '#fb923c' }}>■</span> Medium (50-80%){' · '}
                  <span style={{ color: '#ef4444' }}>■</span> High (80-100%)
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
