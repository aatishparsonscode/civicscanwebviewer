'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import * as turf from '@turf/turf';
import Hls from 'hls.js';
import RoadGridVisualization from '../../components/RoadGridVisualization';
import { calculatePCI, type PCIResult, type PixelPercentageData } from '../../utils/pciCalculator';

// Dynamically import MapComponent to ensure it only loads on the client side
// We'll also pass sidebar state to it
const DynamicMapComponent = dynamic(() => import('../../components/MapComponent'), {
  ssr: false, // Do not render on server side
  loading: () => <p className="text-center text-gray-500 text-lg">Loading map...</p>,
});

const S3_HTTP_BASE_URL = 'https://civicscan-data-dev-usw2.s3.us-west-2.amazonaws.com';
const S3_URI_BASE = 's3://civicscan-data-dev-usw2/';
const DEFAULT_RESULTS_PREFIX = 'customer_outputs/franklin_county/data/';
const DEFAULT_RESULTS_LABEL = DEFAULT_RESULTS_PREFIX.replace(/^customer_outputs\//, '').replace(/\/$/, '');
const PREFIX_QUERY_PARAM_KEYS = ['prefix', 'output', 'dataset', 'postfix', 'path', 'customer_output', 'county'];

type TargetMode = 'metadata' | 'data';

interface S3TargetConfig {
  prefix: string;
  mode: TargetMode;
  datasetLabel: string;
}

interface GeojsonListingResult {
  urls: string[];
  jobPrefixes: string[];
}

interface JobVideoSegmentsEntry {
  jobId: string;
  jobPrefix: string;
  sourceUrl: string;
  segmentsIndex: any;
}

interface LatLng {
  lat: number;
  lng: number;
}

interface GpsFrameEntry {
  frame_id: number;
  timestamp: number;
  latitude: number;
  longitude: number;
  altitude: number;
  accuracy: number;
  speed_mph?: number;
}

interface GpsFrameMappingEntry {
  jobId: string;
  jobPrefix: string;
  frames: GpsFrameEntry[];
}

const DEFAULT_TARGET_CONFIG: S3TargetConfig = {
  prefix: DEFAULT_RESULTS_PREFIX,
  mode: 'data',
  datasetLabel: DEFAULT_RESULTS_LABEL,
};

const convertS3UriToHttp = (uri: string | null | undefined) => {
  if (!uri || typeof uri !== 'string') return uri;
  if (!uri.startsWith('s3://')) return uri;

  const remainder = uri.slice('s3://'.length);
  const slashIndex = remainder.indexOf('/');
  if (slashIndex === -1) {
    return uri;
  }

  const bucket = remainder.slice(0, slashIndex);
  const key = remainder.slice(slashIndex + 1);
  if (!key) {
    return uri;
  }

  const normalizedKey = key.replace(/^\/+/, '');
  const httpBase = bucket === 'civicscan-data-dev-usw2'
    ? S3_HTTP_BASE_URL
    : `https://${bucket}.s3.amazonaws.com`;

  return `${httpBase}/${normalizedKey}`;
};

const normalizeS3HttpUrl = (url: string | null | undefined) => {
  if (!url || typeof url !== 'string') {
    return url;
  }

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/+/, '');

    if (parsed.hostname === 's3.amazonaws.com') {
      const firstSlash = pathname.indexOf('/');
      if (firstSlash !== -1) {
        const bucket = pathname.slice(0, firstSlash);
        const key = pathname.slice(firstSlash + 1);
        if (bucket === 'civicscan-data-dev-usw2') {
          return `${S3_HTTP_BASE_URL}/${key}`;
        }
        return `https://${bucket}.s3.amazonaws.com/${key}`;
      }
    }

    if (parsed.hostname === 'civicscan-data-dev-usw2.s3.amazonaws.com') {
      const key = pathname;
      return `${S3_HTTP_BASE_URL}/${key}`;
    }
  } catch {
    return url;
  }

  return url;
};

const sanitizeRawS3Input = (raw: string | null): string | null => {
  if (!raw) return null;

  let sanitized = raw.trim();
  if (!sanitized) {
    return null;
  }

  sanitized = sanitized.replace(/^s3:\/\//i, '');
  sanitized = sanitized.replace(/^https?:\/\/[^/]+/i, '');
  sanitized = sanitized.replace(/^civicscan-data-dev-usw2(\.s3[\w.-]+\.amazonaws\.com)?\//i, '');
  sanitized = sanitized.replace(/^customer_outputs\/?/i, '');
  sanitized = sanitized.replace(/^\/+/, '');
  sanitized = sanitized.replace(/\/{2,}/g, '/');
  sanitized = sanitized.split(/[?#]/)[0];

  if (!sanitized) {
    return null;
  }

  return sanitized;
};

const deriveTargetConfig = (relativePath: string): S3TargetConfig => {
  const cleaned = relativePath.replace(/^\/+/, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  const segments = cleaned.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1] || cleaned;
  const looksLikeResultsFolder = lastSegment.startsWith('results_') || cleaned.startsWith('results_');
  const endsWithDataSegment = lastSegment === 'data';
  const isPlainSlug = segments.length === 1;

  if (endsWithDataSegment) {
    const datasetLabel = cleaned.replace(/\/data$/i, '');
    return {
      prefix: `customer_outputs/${cleaned}/`,
      mode: 'data',
      datasetLabel: datasetLabel || cleaned,
    };
  }

  if (isPlainSlug && !looksLikeResultsFolder) {
    return {
      prefix: `customer_outputs/${cleaned}/data/`,
      mode: 'data',
      datasetLabel: cleaned,
    };
  }

  return {
    prefix: `customer_outputs/${cleaned}/`,
    mode: 'metadata',
    datasetLabel: cleaned,
  };
};

const normalizeRequestedTarget = (raw: string | null): S3TargetConfig | null => {
  const sanitized = sanitizeRawS3Input(raw);
  if (!sanitized) {
    return null;
  }

  const relativePath = sanitized.replace(/^customer_outputs\/?/i, '');
  if (!relativePath) {
    return null;
  }

  return deriveTargetConfig(relativePath);
};

const extractJobIdFromSourceUrl = (sourceUrl: string | null | undefined) => {
  if (!sourceUrl || typeof sourceUrl !== 'string') {
    return null;
  }
  const match = sourceUrl.match(/customer_outputs\/[^/]+\/([^/]+)/i);
  if (match && match[1]) {
    return match[1].replace(/\/+$/, '');
  }
  return null;
};

const getTargetConfigFromSearchParams = (params: ReturnType<typeof useSearchParams>) => {
  if (!params) {
    return DEFAULT_TARGET_CONFIG;
  }

  for (const key of PREFIX_QUERY_PARAM_KEYS) {
    const normalized = normalizeRequestedTarget(params.get(key));
    if (normalized) {
      return normalized;
    }
  }

  return DEFAULT_TARGET_CONFIG;
};

const coerceToTimestamp = (value: any): number | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const numericValue = Number(value);
    if (!Number.isNaN(numericValue)) {
      return numericValue;
    }
    const parsedDate = Date.parse(value);
    if (!Number.isNaN(parsedDate)) {
      return parsedDate;
    }
  }

  return null;
};

const computeGlobalTimestamp = (fetchedGeojson: any, feature: any) => {
  const baseTimestamp = coerceToTimestamp(fetchedGeojson?.metadata?.scan_info?.timestamp);
  const frameNumber = coerceToTimestamp(feature?.properties?.frame_number);

  if (baseTimestamp !== null && frameNumber !== null) {
    return baseTimestamp + frameNumber;
  }

  const candidates = [
    feature?.properties?.gps_timestamp,
    feature?.properties?.gpsTimestamp,
    feature?.properties?.timestamp,
    feature?.properties?.capture_time,
    feature?.properties?.captureTimestamp,
    feature?.properties?.globalTimestamp,
  ];

  for (const candidate of candidates) {
    const coerced = coerceToTimestamp(candidate);
    if (coerced !== null) {
      return coerced;
    }
  }

  return Date.now();
};

const buildDetectionDedupKey = (detection: any, fallbackFrameId?: number | string) => {
  if (!detection) return null;
  const defectId = detection.defect_id || detection.id;
  if (defectId) {
    return `defect:${defectId}`;
  }

  const frame = detection.frame_id ?? detection.frame_number ?? fallbackFrameId ?? 'frame-unknown';
  const track = detection.track_id ?? detection.track ?? 'track-unknown';
  const className = detection.class_name ?? detection.defect_type ?? 'class-unknown';
  const confidence = typeof detection.confidence === 'number' && Number.isFinite(detection.confidence)
    ? detection.confidence.toFixed(4)
    : 'conf-na';
  const bbox = Array.isArray(detection.bbox)
    ? detection.bbox.map((coord: number) => (Number.isFinite(coord) ? coord.toFixed(2) : 'x')).join(',')
    : 'bbox-na';

  return `${frame}|${track}|${className}|${confidence}|${bbox}`;
};

const dedupeDetectionsArray = (detections: any[], fallbackFrameId?: number | string) => {
  if (!Array.isArray(detections) || detections.length < 2) {
    return detections;
  }

  const seen = new Set<string>();
  const result: any[] = [];

  detections.forEach((det) => {
    const key = buildDetectionDedupKey(det, fallbackFrameId);
    if (key) {
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
    }
    result.push(det);
  });

  return result;
};

const normalizeFeatureProperties = (feature: any, mode: TargetMode) => {
  if (!feature) return feature;
  feature.properties = feature.properties || {};
  const properties = feature.properties;

  const coerceToNumber = (value: any): number | null => {
    if (value === null || value === undefined) return null;
    const numeric = Number(value);
    return Number.isNaN(numeric) ? null : numeric;
  };

  const frameIdNumber = coerceToNumber(properties.frame_id);
  if (frameIdNumber !== null) {
    properties.frame_id = frameIdNumber;
  }

  const frameNumberValue = properties.frame_number !== undefined ? coerceToNumber(properties.frame_number) : frameIdNumber;
  if (frameNumberValue !== null) {
    properties.frame_number = frameNumberValue;
  }

  const numericGpsTimestamp = coerceToTimestamp(properties.gps_timestamp);
  if (numericGpsTimestamp !== null) {
    properties.gps_timestamp = numericGpsTimestamp;
  }

  const ensureHttpImage = (value: string | null | undefined) => convertS3UriToHttp(value);

  if (properties.images && typeof properties.images === 'object') {
    const {
      thumbnail,
      polygon_overlay,
      measurement_overlay,
      original_frame,
    } = properties.images;

    properties.compressed_annotated_image_url = properties.compressed_annotated_image_url || ensureHttpImage(thumbnail || polygon_overlay || original_frame);
    properties.annotated_image_url = properties.annotated_image_url || ensureHttpImage(polygon_overlay || measurement_overlay || thumbnail);
    properties.original_image_url = properties.original_image_url || ensureHttpImage(original_frame || thumbnail);
  } else {
    properties.compressed_annotated_image_url = ensureHttpImage(properties.compressed_annotated_image_url);
    properties.annotated_image_url = ensureHttpImage(properties.annotated_image_url);
    properties.original_image_url = ensureHttpImage(properties.original_image_url);
  }

  if (mode === 'data') {
    if (!Array.isArray(properties.all_detections_in_frame) || properties.all_detections_in_frame.length === 0) {
      properties.all_detections_in_frame = [{
        class_id: properties.class_name || properties.defect_type,
        defect_id: properties.defect_id,
        severity: properties.severity,
        severity_score: properties.severity_score,
        track_id: properties.track_id,
        frame_id: properties.frame_id ?? properties.frame_number,
        confidence: properties.confidence,
        area_px: properties.area_px,
        spatial_zone: properties.spatial_zone,
        spatial_bin: properties.spatial_bin,
      }];
    }
    properties.detection_count_in_frame = Math.max(properties.detection_count_in_frame || properties.all_detections_in_frame.length, 1);
  } else if (properties.detection_count_in_frame === undefined && Array.isArray(properties.all_detections_in_frame)) {
    properties.detection_count_in_frame = properties.all_detections_in_frame.length;
  }

  if (Array.isArray(properties.all_detections_in_frame)) {
    properties.all_detections_in_frame = dedupeDetectionsArray(
      properties.all_detections_in_frame,
      properties.frame_id ?? properties.frame_number
    );
    properties.detection_count_in_frame = properties.all_detections_in_frame.length;
  }

  if (!properties.frame_type && (properties.defect_type || properties.class_name)) {
    properties.frame_type = properties.defect_type || properties.class_name;
  }

  return feature;
};

const coerceToFiniteNumber = (value: any): number | null => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const deriveFrameIdentifier = (properties: any) => {
  if (!properties) return null;
  const candidates = [
    properties.frame_id,
    properties.frame_number,
    properties.frameId,
    properties.frameNumber,
    properties.frame,
    properties.frame_index,
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      const numeric = Number(trimmed);
      return {
        key: trimmed,
        numeric: Number.isFinite(numeric) ? numeric : null,
      };
    }

    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return {
        key: candidate.toString(),
        numeric: candidate,
      };
    }
  }

  return null;
};

const extractDetectionSummary = (feature: any, detectionOverride?: any) => {
  const fallbackProps = feature?.properties || {};
  const props = detectionOverride || fallbackProps;
  const images = props.images || fallbackProps.images || {};
  const toHttp = (value: string | null | undefined) => convertS3UriToHttp(value) || null;

  const detectionTimestamp = coerceToTimestamp(
    props.gps_timestamp ??
    props.globalTimestamp ??
    props.capture_time ??
    props.captureTimestamp ??
    fallbackProps.gps_timestamp ??
    fallbackProps.globalTimestamp
  );

  return {
    defect_id: props.defect_id ?? fallbackProps.defect_id,
    defect_type: props.defect_type || props.class_name || fallbackProps.defect_type || fallbackProps.class_name,
    class_name: props.class_name || props.defect_type || fallbackProps.class_name || fallbackProps.defect_type,
    severity: props.severity ?? fallbackProps.severity,
    severity_score: props.severity_score ?? fallbackProps.severity_score,
    track_id: props.track_id ?? fallbackProps.track_id,
    frame_id: props.frame_id ?? props.frame_number ?? fallbackProps.frame_id ?? fallbackProps.frame_number,
    confidence: coerceToFiniteNumber(props.confidence ?? fallbackProps.confidence),
    area_px: coerceToFiniteNumber(props.area_px ?? fallbackProps.area_px),
    area_mm2: coerceToFiniteNumber(props.area_mm2 ?? fallbackProps.area_mm2),
    length_mm: coerceToFiniteNumber(props.length_mm ?? fallbackProps.length_mm),
    width_mm: props.width_mm ?? fallbackProps.width_mm,
    spatial_zone: props.spatial_zone ?? fallbackProps.spatial_zone,
    spatial_bin: props.spatial_bin ?? fallbackProps.spatial_bin,
    gps_timestamp: detectionTimestamp,
    bbox: props.bbox ?? fallbackProps.bbox,
    thumbnail_url: toHttp(
      props.thumbnail ||
      props.thumbnail_url ||
      fallbackProps.thumbnail ||
      fallbackProps.thumbnail_url ||
      fallbackProps.compressed_annotated_image_url
    ),
    polygon_overlay_url: toHttp(
      props.polygon_overlay ||
      props.polygon_overlay_url ||
      images.polygon_overlay ||
      fallbackProps.polygon_overlay ||
      fallbackProps.polygon_overlay_url
    ),
    measurement_overlay_url: toHttp(
      props.measurement_overlay ||
      props.measurement_overlay_url ||
      images.measurement_overlay ||
      fallbackProps.measurement_overlay ||
      fallbackProps.measurement_overlay_url
    ),
    original_frame_url: toHttp(
      props.original_frame ||
      props.original_frame_url ||
      fallbackProps.original_frame ||
      fallbackProps.original_frame_url ||
      fallbackProps.original_image_url
    ),
    annotated_image_url: toHttp(
      props.annotated_image_url ||
      fallbackProps.annotated_image_url ||
      props.polygon_overlay ||
      fallbackProps.polygon_overlay ||
      props.measurement_overlay ||
      fallbackProps.measurement_overlay
    ),
    coordinates: feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null,
  };
};

const gatherDetectionsForFeature = (feature: any) => {
  const props = feature?.properties || {};
  if (Array.isArray(props.all_detections_in_frame) && props.all_detections_in_frame.length > 0) {
    return props.all_detections_in_frame.map((det: any) => extractDetectionSummary(feature, det));
  }
  return [extractDetectionSummary(feature)];
};

const aggregateDetectionsByFrame = (features: any[]): any[] => {
  if (!Array.isArray(features) || features.length === 0) {
    return features || [];
  }

  const frameCounts = new Map<string, number>();
  const featureEntries = features.map(feature => {
    const frameInfo = deriveFrameIdentifier(feature?.properties);
    if (frameInfo?.key) {
      const prevCount = frameCounts.get(frameInfo.key) || 0;
      frameCounts.set(frameInfo.key, prevCount + 1);
    }
    return { feature, frameInfo };
  });

  const needsAggregation = Array.from(frameCounts.values()).some(count => count > 1);
  if (!needsAggregation) {
    return features;
  }

  const framesMap = new Map<string, any>();
  const orphanFeatures: any[] = [];

  featureEntries.forEach(({ feature, frameInfo }) => {
    if (!frameInfo?.key) {
      orphanFeatures.push(feature);
      return;
    }

    const detectionSummaries = gatherDetectionsForFeature(feature);
    const sourceUrl = feature?.properties?.sourceUrl;

    let frameFeature = framesMap.get(frameInfo.key);
    if (!frameFeature) {
      const baseProps = { ...(feature.properties || {}) };
      frameFeature = {
        type: feature.type || 'Feature',
        geometry: feature.geometry ? { ...feature.geometry } : null,
        properties: {
          ...baseProps,
          frame_id: frameInfo.numeric ?? baseProps.frame_id ?? baseProps.frame_number ?? null,
          frame_number: baseProps.frame_number ?? frameInfo.numeric ?? baseProps.frame_id ?? null,
          all_detections_in_frame: [],
          detection_count_in_frame: 0,
          sourceUrls: sourceUrl ? [sourceUrl] : [],
          __coordinateAccumulator: { latSum: 0, lngSum: 0, count: 0 },
          __detectionRegistry: Object.create(null),
        },
      };
      framesMap.set(frameInfo.key, frameFeature);
    } else if (sourceUrl) {
      frameFeature.properties.sourceUrls = frameFeature.properties.sourceUrls || [];
      if (!frameFeature.properties.sourceUrls.includes(sourceUrl)) {
        frameFeature.properties.sourceUrls.push(sourceUrl);
      }
    }

    detectionSummaries.forEach((summary: any) => {
      const detectionKey = buildDetectionDedupKey(
        summary,
        frameFeature.properties.frame_id ?? frameFeature.properties.frame_number
      );
      const registry = frameFeature.properties.__detectionRegistry || Object.create(null);
      frameFeature.properties.__detectionRegistry = registry;
      if (detectionKey && registry[detectionKey]) {
        return;
      }
      if (detectionKey) {
        registry[detectionKey] = true;
      }

      frameFeature.properties.all_detections_in_frame.push(summary);
      frameFeature.properties.detection_count_in_frame = frameFeature.properties.all_detections_in_frame.length;

      const coords = summary.coordinates;
      if (coords && coords.length === 2 && coords.every(value => typeof value === 'number' && Number.isFinite(value))) {
        const accumulator = frameFeature.properties.__coordinateAccumulator;
        accumulator.lngSum += coords[0];
        accumulator.latSum += coords[1];
        accumulator.count += 1;
      }

      if (!frameFeature.properties.compressed_annotated_image_url && summary.thumbnail_url) {
        frameFeature.properties.compressed_annotated_image_url = summary.thumbnail_url;
      }

      if (!frameFeature.properties.annotated_image_url && (summary.annotated_image_url || summary.polygon_overlay_url)) {
        frameFeature.properties.annotated_image_url = summary.annotated_image_url || summary.polygon_overlay_url;
      }

      if (!frameFeature.properties.original_image_url && summary.original_frame_url) {
        frameFeature.properties.original_image_url = summary.original_frame_url;
      }

      const gpsTimestamp = summary.gps_timestamp;
      if (gpsTimestamp !== null && gpsTimestamp !== undefined) {
        if (!frameFeature.properties.globalTimestamp || gpsTimestamp < frameFeature.properties.globalTimestamp) {
          frameFeature.properties.globalTimestamp = gpsTimestamp;
        }
      }
    });
  });

  const aggregatedFeatures = Array.from(framesMap.values()).map(feature => {
    const accumulator = feature.properties.__coordinateAccumulator;
    if (accumulator && accumulator.count > 0) {
      feature.geometry = {
        type: 'Point',
        coordinates: [
          accumulator.lngSum / accumulator.count,
          accumulator.latSum / accumulator.count,
        ],
      };
    }

    delete feature.properties.__coordinateAccumulator;
    delete feature.properties.__detectionRegistry;
    if (Array.isArray(feature.properties.sourceUrls) && feature.properties.sourceUrls.length > 0) {
      feature.properties.sourceUrl = feature.properties.sourceUrls[0];
    }
    delete feature.properties.sourceUrls;
    return feature;
  });

  aggregatedFeatures.sort((a, b) => {
    const frameA = Number(a?.properties?.frame_number ?? a?.properties?.frame_id ?? Number.MAX_SAFE_INTEGER);
    const frameB = Number(b?.properties?.frame_number ?? b?.properties?.frame_id ?? Number.MAX_SAFE_INTEGER);
    if (!Number.isFinite(frameA) && !Number.isFinite(frameB)) return 0;
    if (!Number.isFinite(frameA)) return 1;
    if (!Number.isFinite(frameB)) return -1;
    return frameA - frameB;
  });

  return aggregatedFeatures.concat(orphanFeatures);
};

const isParentTrackDataset = (features: any[]): boolean => {
  if (!Array.isArray(features)) return false;
  return features.some(feature => {
    const source = feature?.properties?.sourceUrl || '';
    return feature?.properties?.child_tracks || feature?.properties?.is_parent_track || /parent_tracks/i.test(source);
  });
};

const buildDefectImageUrls = (images: any = {}) => {
  const thumbnail = convertS3UriToHttp(
    images.thumbnail ||
    images.polygon_overlay ||
    images.measurement_overlay ||
    images.original_frame
  );

  const annotated = convertS3UriToHttp(
    images.polygon_overlay ||
    images.measurement_overlay ||
    images.thumbnail ||
    images.original_frame
  );

  const original = convertS3UriToHttp(
    images.original_frame ||
    images.measurement_overlay ||
    images.polygon_overlay ||
    images.thumbnail
  );

  const measurement = convertS3UriToHttp(images.measurement_overlay);

  return { thumbnail, annotated, original, measurement };
};

const convertParentTracksToFeatures = (
  features: any[],
  gpsFrameMappings?: Record<string, GpsFrameMappingEntry>,
  videoSegments?: Record<string, JobVideoSegmentsEntry>
) => {
  const segments: any[] = [];
  const METERS_TO_FEET = 3.28084;
  const SEGMENT_LENGTH_FEET = 528; // 0.1 mile

  // Build a map of frame_id -> segment_id based on GPS coordinates
  const buildFrameToSegmentMap = (frames: GpsFrameEntry[]): { frameToSegment: Map<number, number>; segmentCoords: Map<number, { start: [number, number]; end: [number, number] }> } => {
    const frameToSegment = new Map<number, number>();
    const segmentCoords = new Map<number, { start: [number, number]; end: [number, number] }>();

    if (frames.length < 2) {
      frames.forEach((frame, idx) => {
        frameToSegment.set(frame.frame_id, 0);
      });
      if (frames.length > 0) {
        segmentCoords.set(0, {
          start: [frames[0].longitude, frames[0].latitude],
          end: [frames[frames.length - 1].longitude, frames[frames.length - 1].latitude],
        });
      }
      return { frameToSegment, segmentCoords };
    }

    // Calculate cumulative distance along the route
    let cumulativeDistanceFeet = 0;
    const frameDistances: { frame: GpsFrameEntry; distanceFeet: number }[] = [];

    frames.forEach((frame, idx) => {
      if (idx === 0) {
        frameDistances.push({ frame, distanceFeet: 0 });
      } else {
        const prevFrame = frames[idx - 1];
        const from = turf.point([prevFrame.longitude, prevFrame.latitude]);
        const to = turf.point([frame.longitude, frame.latitude]);
        const distanceFeet = turf.distance(from, to, { units: 'feet' });
        cumulativeDistanceFeet += distanceFeet;
        frameDistances.push({ frame, distanceFeet: cumulativeDistanceFeet });
      }
    });

    // Assign each frame to a segment based on cumulative distance
    const segmentFrames = new Map<number, GpsFrameEntry[]>();

    frameDistances.forEach(({ frame, distanceFeet }) => {
      const segmentId = Math.floor(distanceFeet / SEGMENT_LENGTH_FEET);
      frameToSegment.set(frame.frame_id, segmentId);

      if (!segmentFrames.has(segmentId)) {
        segmentFrames.set(segmentId, []);
      }
      segmentFrames.get(segmentId)!.push(frame);
    });

    // Build segment start/end coordinates
    segmentFrames.forEach((framesInSegment, segmentId) => {
      if (framesInSegment.length > 0) {
        const firstFrame = framesInSegment[0];
        const lastFrame = framesInSegment[framesInSegment.length - 1];
        segmentCoords.set(segmentId, {
          start: [firstFrame.longitude, firstFrame.latitude],
          end: [lastFrame.longitude, lastFrame.latitude],
        });
      }
    });

    return { frameToSegment, segmentCoords };
  };

  // Get frame IDs from a track (parent or child)
  const getTrackFrameIds = (track: any): number[] => {
    const frameIds: number[] = [];
    const frameRange = track.frame_range;

    if (Array.isArray(frameRange) && frameRange.length >= 2) {
      const start = Number(frameRange[0]);
      const end = Number(frameRange[1]);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        for (let i = start; i <= end; i++) {
          frameIds.push(i);
        }
      }
    }

    // Also check defects for frame IDs
    const defects = Array.isArray(track.defects) ? track.defects : [];
    defects.forEach((defect: any) => {
      const defectFrameId = Number(defect.frame_id ?? defect.frame);
      if (Number.isFinite(defectFrameId) && !frameIds.includes(defectFrameId)) {
        frameIds.push(defectFrameId);
      }
    });

    return frameIds;
  };

  // Get segments that a track overlaps based on its frame IDs
  const getTrackSegments = (frameIds: number[], frameToSegment: Map<number, number>): Set<number> => {
    const segmentIds = new Set<number>();
    frameIds.forEach(frameId => {
      const segmentId = frameToSegment.get(frameId);
      if (segmentId !== undefined) {
        segmentIds.add(segmentId);
      }
    });
    return segmentIds;
  };

  // Build a frame_id -> speed_mph lookup map from GPS frame mappings
  const frameToSpeedMap = new Map<number, number>();
  if (gpsFrameMappings) {
    Object.values(gpsFrameMappings).forEach(mapping => {
      mapping.frames.forEach(frame => {
        if (frame.speed_mph !== undefined) {
          frameToSpeedMap.set(frame.frame_id, frame.speed_mph);
        }
      });
    });
  }

  // Process all parent tracks and their children
  const allParentTracks: any[] = [];
  const allChildTracks: any[] = [];

  features.forEach(feature => {
    if (!feature?.properties) return;
    const parentProps = feature.properties;
    const childTracks = Array.isArray(parentProps.child_tracks) ? parentProps.child_tracks : [];
    const parentJobId = extractJobIdFromSourceUrl(parentProps.sourceUrl);

    // Store parent track info
    const parentTrackId = parentProps.parent_track_id ?? parentProps.track_id;
    const parentFrameIds = getTrackFrameIds(parentProps);

    const processedChildren: any[] = [];

    childTracks.forEach((childTrack: any, idx: number) => {
      const defects = Array.isArray(childTrack.defects) ? childTrack.defects : [];
      const parentMeasuredLength = Number(childTrack.measured_real_length);
      let trackDamage = 0;
      const defectTypes = new Set<string>();
      let representativeThumbnail: string | null = null;
      const severityLabels = new Set<string>();

      // Add measured_real_length to each defect for PCI calculation
      const enrichedDefects = defects.map((defect: any) => ({
        ...defect,
        measured_real_length: Number.isFinite(parentMeasuredLength) ? parentMeasuredLength : undefined
      }));

      enrichedDefects.forEach((defect: any) => {
        const defectType = (defect.defect_type || '').toLowerCase();
        if (defectType) {
          defectTypes.add(defectType);
        }

        // Only count damage if defect is not a sealed_crack AND speed >= 5 mph
        if (defectType !== 'sealed_crack') {
          const defectFrameId = Number(defect.frame_id ?? defect.frame);
          const frameSpeed = Number.isFinite(defectFrameId) ? frameToSpeedMap.get(defectFrameId) : undefined;

          // Count damage only if speed is >= 5 mph (or if speed data is unavailable, count it to be safe)
          if (frameSpeed === undefined || frameSpeed >= 5) {
            trackDamage += 1;
          }
        }

        const sev =
          defect?.severity?.joint_severity ??
          defect?.severity?.pixel_severity ??
          defect?.severity ??
          null;
        if (sev) {
          severityLabels.add(String(sev));
        }

        if (!representativeThumbnail) {
          const images = defect.images || {};
          representativeThumbnail =
            convertS3UriToHttp(images.thumbnail) ||
            convertS3UriToHttp(images.polygon_overlay) ||
            convertS3UriToHttp(images.measurement_overlay) ||
            convertS3UriToHttp(images.original_frame) ||
            null;
        }
      });

      const startTimestamp = defects.reduce<number | null>((min, defect) => {
        const ts = coerceToTimestamp(defect?.gps_coordinates?.timestamp ?? defect?.timestamp);
        if (ts === null) return min;
        if (min === null) return ts;
        return ts < min ? ts : min;
      }, null) ?? coerceToTimestamp(childTrack?.frame_range?.[0]) ?? idx;

      const measuredLengthFeet = Number(childTrack.measured_real_length) * METERS_TO_FEET;
      let trackLengthFeet = measuredLengthFeet;
      if (!Number.isFinite(trackLengthFeet) || trackLengthFeet <= 0) {
        trackLengthFeet = Number(childTrack.gps_length_m) * METERS_TO_FEET;
      }
      if (!Number.isFinite(trackLengthFeet) || trackLengthFeet <= 0) {
        const coords = Array.isArray(childTrack.coordinates) ? childTrack.coordinates : [];
        if (coords.length > 1) {
          trackLengthFeet = turf.length(turf.lineString(coords as any), { units: 'feet' });
        } else {
          trackLengthFeet = 0;
        }
      }

      const coords = Array.isArray(childTrack.coordinates) ? childTrack.coordinates : [];
      const trackJobId = typeof childTrack.job_id === 'string' && childTrack.job_id
        ? childTrack.job_id
        : parentJobId;

      const childFrameIds = getTrackFrameIds(childTrack);

      const processedChild = {
        ...childTrack,
        defects: enrichedDefects, // Use enriched defects with measured_real_length
        job_id: trackJobId,
        parent_track_id: parentTrackId,
        track_damage: trackDamage,
        track_start_ts: startTimestamp,
        track_length_feet: trackLengthFeet,
        measured_length_feet: Number.isFinite(measuredLengthFeet) ? measuredLengthFeet : null,
        coordinates: coords,
        defect_types: Array.from(defectTypes),
        representative_thumbnail: representativeThumbnail,
        severity_labels: Array.from(severityLabels),
        source_geojson_url: parentProps.sourceUrl,
        frame_ids: childFrameIds,
      };

      processedChildren.push(processedChild);
      allChildTracks.push(processedChild);
    });

    allParentTracks.push({
      parent_track_id: parentTrackId,
      job_id: parentJobId,
      frame_ids: parentFrameIds,
      children: processedChildren,
      source_geojson_url: parentProps.sourceUrl,
    });
  });

  // Build frame-to-segment mappings for each job
  const jobFrameToSegment = new Map<string, { frameToSegment: Map<number, number>; segmentCoords: Map<number, { start: [number, number]; end: [number, number] }> }>();

  if (gpsFrameMappings && Object.keys(gpsFrameMappings).length > 0) {
    Object.entries(gpsFrameMappings).forEach(([jobId, entry]) => {
      const mapping = buildFrameToSegmentMap(entry.frames);
      jobFrameToSegment.set(jobId, mapping);
    });
  }

  // Assign tracks to segments using parent-first logic
  const segmentData = new Map<string, {
    damage: number;
    trackIds: Set<any>;
    defectTypes: Set<string>;
    tracks: any[];
    jobIds: Set<string>;
  }>();

  const createSegmentKey = (jobId: string, segmentId: number) => `${jobId}:${segmentId}`;

  allParentTracks.forEach(parent => {
    const jobId = parent.job_id || '';
    const jobMapping = jobFrameToSegment.get(jobId);

    if (!jobMapping) {
      // No GPS mapping available, fall back to segment 0
      const segKey = createSegmentKey(jobId, 0);
      if (!segmentData.has(segKey)) {
        segmentData.set(segKey, {
          damage: 0,
          trackIds: new Set(),
          defectTypes: new Set(),
          tracks: [],
          jobIds: new Set(),
        });
      }
      const segData = segmentData.get(segKey)!;
      parent.children.forEach((child: any) => {
        segData.damage += child.track_damage;
        segData.trackIds.add(child.track_id);
        segData.trackIds.add(parent.parent_track_id);
        child.defect_types.forEach((dt: string) => segData.defectTypes.add(dt));
        segData.tracks.push(child);
        if (child.job_id) segData.jobIds.add(child.job_id);
      });
      return;
    }

    const { frameToSegment } = jobMapping;

    // Get segments that parent track spans
    const parentSegments = getTrackSegments(parent.frame_ids, frameToSegment);

    if (parentSegments.size <= 1) {
      // Parent fits in one segment - assign all children to that segment
      const segmentId = parentSegments.size === 1 ? Array.from(parentSegments)[0] : 0;
      const segKey = createSegmentKey(jobId, segmentId);

      if (!segmentData.has(segKey)) {
        segmentData.set(segKey, {
          damage: 0,
          trackIds: new Set(),
          defectTypes: new Set(),
          tracks: [],
          jobIds: new Set(),
        });
      }

      const segData = segmentData.get(segKey)!;
      parent.children.forEach((child: any) => {
        segData.damage += child.track_damage;
        segData.trackIds.add(child.track_id);
        segData.trackIds.add(parent.parent_track_id);
        child.defect_types.forEach((dt: string) => segData.defectTypes.add(dt));
        segData.tracks.push({ ...child, assigned_segment: segmentId });
        if (child.job_id) segData.jobIds.add(child.job_id);
      });
    } else {
      // Parent spans multiple segments - assign each child individually
      parent.children.forEach((child: any) => {
        const childSegments = getTrackSegments(child.frame_ids, frameToSegment);

        // If child has no frame mappings, use parent's first segment
        const segmentsToAssign = childSegments.size > 0
          ? childSegments
          : new Set([Array.from(parentSegments)[0]]);

        // Assign child to ALL segments it overlaps
        segmentsToAssign.forEach(segmentId => {
          const segKey = createSegmentKey(jobId, segmentId);

          if (!segmentData.has(segKey)) {
            segmentData.set(segKey, {
              damage: 0,
              trackIds: new Set(),
              defectTypes: new Set(),
              tracks: [],
              jobIds: new Set(),
            });
          }

          const segData = segmentData.get(segKey)!;
          segData.damage += child.track_damage;
          segData.trackIds.add(child.track_id);
          segData.trackIds.add(parent.parent_track_id);
          child.defect_types.forEach((dt: string) => segData.defectTypes.add(dt));
          segData.tracks.push({ ...child, assigned_segment: segmentId });
          if (child.job_id) segData.jobIds.add(child.job_id);
        });
      });
    }
  });

  // Build segment features with geometry from GPS coordinates
  console.log(`\n🛣️  Processing ${segmentData.size} segments for PCI calculation...`);
  let segmentsProcessed = 0;

  segmentData.forEach((data, segKey) => {
    const [jobId, segmentIdStr] = segKey.split(':');
    const segmentId = parseInt(segmentIdStr, 10);
    const jobMapping = jobFrameToSegment.get(jobId);
    const segmentCoords = jobMapping?.segmentCoords.get(segmentId);

    // Build line geometry from segment coordinates or from track coordinates
    let geometry: any = null;
    if (segmentCoords) {
      geometry = {
        type: 'LineString',
        coordinates: [segmentCoords.start, segmentCoords.end],
      };
    } else if (data.tracks.length > 0) {
      // Fallback: use coordinates from first track
      const firstTrack = data.tracks[0];
      if (firstTrack.coordinates && firstTrack.coordinates.length > 0) {
        geometry = {
          type: 'LineString',
          coordinates: firstTrack.coordinates,
        };
      }
    }

    if (!geometry) {
      return; // Skip segments with no geometry
    }

    const startCoord = geometry.coordinates[0];
    const endCoord = geometry.coordinates[geometry.coordinates.length - 1];

    // Find matching segment in segments_index.json to get pixel percentage data
    let pixelData: any = {};
    let pixelPercentages: PixelPercentageData = {};

    if (videoSegments && videoSegments[jobId]?.segmentsIndex?.segments) {
      const matchingSegment = videoSegments[jobId].segmentsIndex.segments.find(
        (seg: any) => seg.segment_id === (segmentId + 1) // segment_id in JSON is 1-indexed
      );
      if (matchingSegment) {
        // Extract pixel percentages for PCI calculation
        pixelPercentages = matchingSegment.pixel_percentage_with_projections || {};

        // Store full pixel data for segment properties
        pixelData = {
          pixel_percentage_with_projections: matchingSegment.pixel_percentage_with_projections,
          total_defect_percentage_with_projections: matchingSegment.total_defect_percentage_with_projections,
          total_sealed_percentage_with_projections: matchingSegment.total_sealed_percentage_with_projections,
          pixel_coverage_percentage_by_type: matchingSegment.pixel_coverage_percentage_by_type,
          total_defect_percentage: matchingSegment.total_defect_percentage,
          total_sealed_percentage: matchingSegment.total_sealed_percentage,
        };
      } else {
        console.warn(`No segment data found for segment ${segmentId} (Job: ${jobId})`);
      }
    }

    // Calculate PCI using pixel-based formula
    const pciResult = calculatePCI(pixelPercentages, {
      verbose: false, // Set to true for detailed per-segment logging
      segmentId: `${segmentId} (Job: ${jobId})`
    });
    segmentsProcessed++;

    segments.push({
      type: 'Feature',
      geometry,
      properties: {
        damage_count: data.damage,
        track_ids: Array.from(data.trackIds),
        segment_id: segmentId + 1, // 1-indexed to match segments_index.json
        job_id: jobId,
        segment_length_feet: SEGMENT_LENGTH_FEET,
        start_feet: segmentId * SEGMENT_LENGTH_FEET,
        end_feet: (segmentId + 1) * SEGMENT_LENGTH_FEET,
        defect_types: Array.from(data.defectTypes),
        overlapping_tracks: data.tracks,
        start_coord: startCoord,
        end_coord: endCoord,
        job_ids: Array.from(data.jobIds),
        // PCI data
        pci_score: pciResult.pci_score,
        pci_rating: pciResult.pci_rating,
        pci_details: {
          total_deduct_value: pciResult.total_deduct_value,
          deduct_breakdown: pciResult.deduct_breakdown,
          damage_metrics: pciResult.damage_metrics,
        },
        // Pixel percentage data from segments_index.json
        ...pixelData,
      },
    });
  });

  // Sort segments by segment_id for consistent ordering
  segments.sort((a, b) => {
    const jobCompare = (a.properties.job_id || '').localeCompare(b.properties.job_id || '');
    if (jobCompare !== 0) return jobCompare;
    return (a.properties.segment_id || 0) - (b.properties.segment_id || 0);
  });

  console.log(`\n✅ PCI calculation complete for ${segmentsProcessed} segments`);

  // Summary statistics
  const pciScores = segments.map(s => s.properties.pci_score).filter(score => score !== undefined);
  if (pciScores.length > 0) {
    const avgPCI = pciScores.reduce((sum, score) => sum + score, 0) / pciScores.length;
    const minPCI = Math.min(...pciScores);
    const maxPCI = Math.max(...pciScores);

    console.log('📊 PCI Summary Statistics:', {
      totalSegments: pciScores.length,
      averagePCI: avgPCI.toFixed(1),
      minPCI: minPCI.toFixed(1),
      maxPCI: maxPCI.toFixed(1),
      distribution: {
        excellent: pciScores.filter(s => s >= 85).length,
        good: pciScores.filter(s => s >= 70 && s < 85).length,
        fair: pciScores.filter(s => s >= 55 && s < 70).length,
        poor: pciScores.filter(s => s >= 40 && s < 55).length,
        veryPoor: pciScores.filter(s => s >= 25 && s < 40).length,
        failed: pciScores.filter(s => s < 25).length,
      }
    });

    // Debug: Check first segment's PCI data
    if (segments.length > 0) {
      const firstSeg = segments[0];
      console.log('[PCI Debug] First segment raw data:', {
        segment_id: firstSeg.properties.segment_id,
        pci_score: firstSeg.properties.pci_score,
        pci_rating: firstSeg.properties.pci_rating,
        damage_count: firstSeg.properties.damage_count,
        pci_details: firstSeg.properties.pci_details,
      });
    }

    // Create a table view of segments
    const tableData = segments.map(s => ({
      Segment: s.properties.segment_id,
      Job: s.properties.job_id?.substring(0, 8) || 'N/A',
      'PCI Score': s.properties.pci_score?.toFixed(1) || 'N/A',
      Rating: s.properties.pci_rating || 'N/A',
      Defects: s.properties.damage_count || 0,
      'Damage %': s.properties.pci_details?.damage_metrics?.damage_percentage?.toFixed(1) || '0',
      'Deduct': s.properties.pci_details?.total_deduct_value?.toFixed(1) || '0',
    }));

    console.log('\n📋 Segment-by-Segment Results:');
    console.table(tableData);
  }

  return { lineFeatures: segments, defectPointFeatures: [] };
};

const ensureTrailingSlash = (value: string) => (value.endsWith('/') ? value : `${value}/`);

const rewriteMasterPlaylistUrl = (originalUrl: string | null | undefined, jobPrefix: string) => {
  if (!originalUrl) {
    return originalUrl;
  }

  const normalizedJobPrefix = ensureTrailingSlash(jobPrefix);
  const videosBase = `${normalizedJobPrefix}data/videos/`;

  try {
    const parsed = new URL(originalUrl);
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const gpsIdx = pathname.indexOf('gps_videos/');
    if (gpsIdx !== -1) {
      const relative = pathname.slice(gpsIdx + 'gps_videos/'.length);
      return `${S3_HTTP_BASE_URL}/${videosBase}${relative}`;
    }
  } catch {
    // fall through to normalization below
  }

  return normalizeS3HttpUrl(originalUrl);
};

const normalizeSegmentsIndexPayload = (segmentsIndex: any, jobPrefix: string) => {
  if (!segmentsIndex || typeof segmentsIndex !== 'object') {
    return segmentsIndex;
  }

  const normalizedSegments = Array.isArray(segmentsIndex.segments)
    ? segmentsIndex.segments.map((segment: any) => {
        const normalizedHls = segment?.hls
          ? {
              ...segment.hls,
              master_playlist_url: rewriteMasterPlaylistUrl(segment.hls.master_playlist_url, jobPrefix),
            }
          : segment.hls;
        return {
          ...segment,
          hls: normalizedHls,
        };
      })
    : segmentsIndex.segments;

  return {
    ...segmentsIndex,
    segments: normalizedSegments,
  };
};


const deriveJobIdsFromTrackGroup = (group: any): string[] => {
  if (!group) return [];
  const ids = new Set<string>();
  const directIds = Array.isArray(group?.job_ids) ? group.job_ids : [];
  directIds.forEach((id: any) => {
    if (typeof id === 'string' && id.trim()) {
      ids.add(id.trim());
    }
  });
  const tracks = Array.isArray(group?.overlapping_tracks) ? group.overlapping_tracks : [];
  tracks.forEach((track: any) => {
    if (typeof track?.job_id === 'string' && track.job_id.trim()) {
      ids.add(track.job_id.trim());
      return;
    }
    if (typeof track?.source_geojson_url === 'string') {
      const derived = extractJobIdFromSourceUrl(track.source_geojson_url);
      if (derived) {
        ids.add(derived);
      }
    }
  });
  return Array.from(ids);
};

const normalizeCoordPair = (coord: any): LatLng | null => {
  if (!coord) return null;
  if (Array.isArray(coord) && coord.length >= 2) {
    const [lng, lat] = coord;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  if (typeof coord === 'object' && coord !== null) {
    const lat = Number(coord.lat ?? coord.latitude);
    const lng = Number(coord.lon ?? coord.lng ?? coord.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  return null;
};

const distanceBetweenCoordsMeters = (a: LatLng | null, b: LatLng | null) => {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const pointA = turf.point([a.lng, a.lat]);
  const pointB = turf.point([b.lng, b.lat]);
  const kilometers = turf.distance(pointA, pointB, { units: 'kilometers' });
  return kilometers * 1000;
};

const getTrackGroupMidpoint = (group: any): LatLng | null => {
  if (!group) return null;
  const start = normalizeCoordPair(group.start_coord);
  const end = normalizeCoordPair(group.end_coord);
  if (start && end) {
    return {
      lat: (start.lat + end.lat) / 2,
      lng: (start.lng + end.lng) / 2,
    };
  }
  return start || end || null;
};

const getVideoSegmentMidpoint = (segment: any): LatLng | null => {
  if (!segment) return null;
  const start = normalizeCoordPair(segment.gps_start);
  const end = normalizeCoordPair(segment.gps_end);
  if (start && end) {
    return {
      lat: (start.lat + end.lat) / 2,
      lng: (start.lng + end.lng) / 2,
    };
  }
  return start || end || null;
};


function MapPageContent() {
  const [geojson, setGeojson] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [jobVideoSegments, setJobVideoSegments] = useState<Record<string, JobVideoSegmentsEntry>>({});
  const [gpsFrameMappings, setGpsFrameMappings] = useState<Record<string, GpsFrameMappingEntry>>({});
  const [selectedTrackGroupForVideo, setSelectedTrackGroupForVideo] = useState<any | null>(null);
  const [activeVideoSegmentId, setActiveVideoSegmentId] = useState<number | string | null>(null);
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);

  // State for sidebar in parent to control map width
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [screenSize, setScreenSize] = useState({ width: 0, height: 0 }); // Added to dynamically calc sidebar width
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const searchParams = useSearchParams();
  const targetConfig = useMemo(() => getTargetConfigFromSearchParams(searchParams), [searchParams]);
  const targetS3Uri = `${S3_URI_BASE}${targetConfig.prefix}`;
  const targetDisplayLabel = targetConfig.datasetLabel;
  const visibleDetectionCount = useMemo(() => {
    if (!geojson?.features) return 0;
    return geojson.features.reduce((sum: number, feature: any) => {
      const frameCount = feature?.properties?.detection_count_in_frame;
      if (typeof frameCount === 'number' && Number.isFinite(frameCount)) {
        return sum + frameCount;
      }
      if (Array.isArray(feature?.properties?.all_detections_in_frame)) {
        return sum + feature.properties.all_detections_in_frame.length;
      }
      return sum;
    }, 0);
  }, [geojson]);
  const videoSegmentJobKeys = useMemo(() => Object.keys(jobVideoSegments), [jobVideoSegments]);
  const selectedTrackGroupJobIds = useMemo(
    () => deriveJobIdsFromTrackGroup(selectedTrackGroupForVideo),
    [selectedTrackGroupForVideo]
  );
  const activeVideoJobEntry = useMemo(() => {
    for (const jobId of selectedTrackGroupJobIds) {
      const entry = jobVideoSegments[jobId];
      if (entry) {
        return entry;
      }
    }
    return null;
  }, [selectedTrackGroupJobIds, jobVideoSegments]);
  const matchedVideoSegment = useMemo(() => {
    if (!selectedTrackGroupForVideo || !activeVideoJobEntry?.segmentsIndex?.segments) {
      return null;
    }
    const midpoint = getTrackGroupMidpoint(selectedTrackGroupForVideo);
    if (!midpoint) {
      return null;
    }
    let bestSegment: any = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    (activeVideoJobEntry.segmentsIndex.segments || []).forEach((segment: any) => {
      const segmentMidpoint = getVideoSegmentMidpoint(segment);
      const distanceMeters = distanceBetweenCoordsMeters(midpoint, segmentMidpoint);
      if (distanceMeters < bestDistance) {
        bestDistance = distanceMeters;
        bestSegment = segment;
      }
    });
    return bestSegment;
  }, [selectedTrackGroupForVideo, activeVideoJobEntry]);
  const activeVideoSegment = useMemo(() => {
    if (!activeVideoJobEntry?.segmentsIndex?.segments) {
      return null;
    }
    const segments: any[] = activeVideoJobEntry.segmentsIndex.segments;
    if (activeVideoSegmentId !== null) {
      const found = segments.find((segment: any) => segment.segment_id === activeVideoSegmentId);
      if (found) {
        return found;
      }
    }
    return segments[0] || null;
  }, [activeVideoJobEntry, activeVideoSegmentId]);

  useEffect(() => {
    const updateScreenSize = () => {
      setScreenSize({ width: window.innerWidth, height: window.innerHeight });
    };
    updateScreenSize();
    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, []);

  useEffect(() => {
    if (!selectedTrackGroupForVideo) {
      setActiveVideoSegmentId(null);
      return;
    }
    if (matchedVideoSegment?.segment_id !== undefined && matchedVideoSegment?.segment_id !== null) {
      setActiveVideoSegmentId(matchedVideoSegment.segment_id);
      return;
    }
    const fallbackId = activeVideoJobEntry?.segmentsIndex?.segments?.[0]?.segment_id;
    setActiveVideoSegmentId(
      typeof fallbackId === 'number' || typeof fallbackId === 'string' ? fallbackId : null
    );
  }, [selectedTrackGroupForVideo, matchedVideoSegment, activeVideoJobEntry]);

  useEffect(() => {
    if (!selectedTrackGroupForVideo) {
      console.log('[map] No active track group for video.');
      return;
    }
    console.log('[map] Active track group updated.', {
      jobIds: selectedTrackGroupJobIds,
      damage: selectedTrackGroupForVideo.damage_count,
      startFeet: selectedTrackGroupForVideo.start_feet,
      endFeet: selectedTrackGroupForVideo.end_feet,
    });
  }, [selectedTrackGroupForVideo, selectedTrackGroupJobIds]);

  useEffect(() => {
    if (matchedVideoSegment) {
      console.log('[map] Matched HLS segment to selected track group.', {
        segmentId: matchedVideoSegment.segment_id,
        frameRange: matchedVideoSegment.frame_range,
      });
    } else if (selectedTrackGroupForVideo) {
      console.warn('[map] Could not match any video segments to selected track group.', {
        jobId: activeVideoJobEntry?.jobId,
      });
    }
  }, [matchedVideoSegment, selectedTrackGroupForVideo, activeVideoJobEntry]);

  useEffect(() => {
    const videoElement = videoPlayerRef.current;
    if (!videoElement) return;

    const masterUrl = activeVideoSegment?.hls?.master_playlist_url;
    let hlsInstance: Hls | null = null;

    const handleVideoError = (event: Event) => {
      console.error('[map] Native video element error.', videoElement.error, event);
    };

    videoElement.addEventListener('error', handleVideoError);

    if (!masterUrl) {
      console.warn('[map] No master playlist URL for active segment.', {
        segmentId: activeVideoSegment?.segment_id,
      });
      videoElement.pause();
      videoElement.removeAttribute('src');
      videoElement.load();
      return () => {
        videoElement.removeEventListener('error', handleVideoError);
      };
    }

    const canUseNative = videoElement.canPlayType('application/vnd.apple.mpegurl');
    const canUseHlsJs = Hls.isSupported();

    console.log('[map] Attaching video playback source.', {
      segmentId: activeVideoSegment?.segment_id,
      masterUrl,
      canUseNative,
      canUseHlsJs,
    });

    if (canUseHlsJs) {
      console.log('[map] Using hls.js for playback.');
      hlsInstance = new Hls({ enableWorker: true });
      hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
        console.error('[map] HLS.js error.', data);
      });
      // Force highest quality level and prevent ABR from switching
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (hlsInstance && data.levels.length > 0) {
          const highestLevel = data.levels.length - 1;
          hlsInstance.currentLevel = highestLevel;
          hlsInstance.loadLevel = highestLevel;
          console.log(`[map] Forcing highest quality level: ${highestLevel} (${data.levels[highestLevel]?.height}p)`);
        }
      });
      hlsInstance.loadSource(masterUrl);
      hlsInstance.attachMedia(videoElement);
    } else if (canUseNative) {
      console.log('[map] Falling back to native HLS playback.');
      videoElement.src = masterUrl;
      videoElement.play().catch(() => {});
    } else {
      console.warn('[map] Neither native HLS nor hls.js supported; falling back to assigning src.');
      videoElement.src = masterUrl;
    }

    return () => {
      videoElement.removeEventListener('error', handleVideoError);
      if (hlsInstance) {
        hlsInstance.destroy();
      }
    };
  }, [activeVideoSegment?.hls?.master_playlist_url, activeVideoSegment?.segment_id]);

  const getSidebarWidth = () => {
    if (screenSize.width >= 1920) return 2400; // 1600 * 1.5
    if (screenSize.width >= 1600) return 2100; // 1400 * 1.5
    if (screenSize.width >= 1200) return 1500; // 1000 * 1.5
    return 1200; // 800 * 1.5
  };
  const sidebarWidth = getSidebarWidth(); // Calculate once per render cycle when screen size changes
  const handleSegmentSelectionChange = useCallback((segment: any | null) => {
    setSelectedTrackGroupForVideo(segment);
    if (!segment) {
      console.log('[map] Segment selection cleared; closing video preview.');
      setActiveVideoSegmentId(null);
    } else {
      const derivedJobIds = deriveJobIdsFromTrackGroup(segment);
      console.log('[map] Segment selected from map click.', {
        jobIds: derivedJobIds,
        damage: segment.damage_count,
        startFeet: segment.start_feet,
        endFeet: segment.end_feet,
      });
    }
  }, []);

  useEffect(() => {
    setGeojson(null);
    setSuccessMessage(null);
    setError(null);
    setSelectedTrackGroupForVideo(null);
    setActiveVideoSegmentId(null);
  }, [targetConfig.prefix]);

  const parseS3Xml = (xmlText: string) => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
    return xmlDoc;
  };

  const removeTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

  const fetchS3ListingXml = async (prefix: string, delimiter?: string) => {
    const params = new URLSearchParams();
    params.set('prefix', prefix);
    if (delimiter) {
      params.set('delimiter', delimiter);
    }
    const url = `${S3_HTTP_BASE_URL}/?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to list S3 objects under ${prefix} (HTTP ${res.status})`);
    }
    return parseS3Xml(await res.text());
  };

  const listCommonPrefixes = async (prefix: string): Promise<string[]> => {
    const xmlDoc = await fetchS3ListingXml(prefix, '/');
    return [...xmlDoc.getElementsByTagName('CommonPrefixes')]
      .map(cp => cp.getElementsByTagName('Prefix')[0]?.textContent)
      .filter((text): text is string => Boolean(text));
  };

  const listGeojsonKeysAtPrefix = async (prefix: string): Promise<string[]> => {
    const xmlDoc = await fetchS3ListingXml(prefix);
    const contents = [...xmlDoc.getElementsByTagName('Contents')];

    const geojsonKeys = contents
      .map(node => node.getElementsByTagName('Key')[0]?.textContent || '')
      .filter(key => key.toLowerCase().endsWith('.geojson'));

    const parentTrackKeys = geojsonKeys.filter(key => /parent_tracks/i.test(key));
    return parentTrackKeys.length > 0 ? parentTrackKeys : geojsonKeys;
  };

  const deriveJobIdFromPrefix = (prefix: string) => {
    const trimmed = removeTrailingSlashes(prefix);
    const segments = trimmed.split('/').filter(Boolean);
    return segments[segments.length - 1] || trimmed;
  };

  const loadVideoSegmentsForJobPrefixes = async (jobPrefixes: string[]): Promise<Record<string, JobVideoSegmentsEntry>> => {
    if (!Array.isArray(jobPrefixes) || jobPrefixes.length === 0) {
      return {};
    }

    const entries: Record<string, JobVideoSegmentsEntry> = {};

    await Promise.all(jobPrefixes.map(async jobPrefix => {
      const normalizedJobPrefix = ensureTrailingSlash(jobPrefix);
      const jobId = deriveJobIdFromPrefix(normalizedJobPrefix);
      const segmentsKey = `${normalizedJobPrefix}data/videos/segments_index.json`;
      const url = `${S3_HTTP_BASE_URL}/${segmentsKey}`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        const normalizedSegmentsIndex = normalizeSegmentsIndexPayload(json, normalizedJobPrefix);
        entries[jobId] = {
          jobId,
          jobPrefix: normalizedJobPrefix,
          sourceUrl: url,
          segmentsIndex: normalizedSegmentsIndex,
        };
      } catch (err) {
        console.warn(`No video segments index for ${normalizedJobPrefix}`, err);
      }
    }));

    return entries;
  };

  const parseGpsFrameMappingCsv = (csvText: string): GpsFrameEntry[] => {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    // Skip header row
    const dataLines = lines.slice(1);
    const frames: GpsFrameEntry[] = [];

    dataLines.forEach(line => {
      const parts = line.split(',');
      if (parts.length >= 6) {
        const frame_id = parseInt(parts[0], 10);
        const timestamp = parseFloat(parts[1]);
        const latitude = parseFloat(parts[2]);
        const longitude = parseFloat(parts[3]);
        const altitude = parseFloat(parts[4]);
        const accuracy = parseFloat(parts[5]);

        if (
          Number.isFinite(frame_id) &&
          Number.isFinite(latitude) &&
          Number.isFinite(longitude)
        ) {
          frames.push({
            frame_id,
            timestamp: Number.isFinite(timestamp) ? timestamp : 0,
            latitude,
            longitude,
            altitude: Number.isFinite(altitude) ? altitude : 0,
            accuracy: Number.isFinite(accuracy) ? accuracy : 0,
          });
        }
      }
    });

    // Sort frames by frame_id first
    const sortedFrames = frames.sort((a, b) => a.frame_id - b.frame_id);

    // Calculate speed for each frame based on distance and time between consecutive points
    for (let i = 0; i < sortedFrames.length; i++) {
      if (i === 0) {
        sortedFrames[i].speed_mph = undefined; // First frame has no previous point
      } else {
        const prevFrame = sortedFrames[i - 1];
        const currFrame = sortedFrames[i];

        // Calculate distance in feet using Turf.js
        const from = turf.point([prevFrame.longitude, prevFrame.latitude]);
        const to = turf.point([currFrame.longitude, currFrame.latitude]);
        const distanceFeet = turf.distance(from, to, { units: 'feet' });

        // Calculate time difference in seconds
        const timeDiffSeconds = currFrame.timestamp - prevFrame.timestamp;

        // Calculate speed in mph: (feet/second) * (3600 seconds/hour) * (1 mile/5280 feet)
        if (timeDiffSeconds > 0) {
          const feetPerSecond = distanceFeet / timeDiffSeconds;
          const mph = feetPerSecond * 3600 / 5280;
          currFrame.speed_mph = mph;
        } else {
          currFrame.speed_mph = 0;
        }
      }
    }

    return sortedFrames;
  };

  const loadGpsFrameMappingsForJobPrefixes = async (jobPrefixes: string[]): Promise<Record<string, GpsFrameMappingEntry>> => {
    if (!Array.isArray(jobPrefixes) || jobPrefixes.length === 0) {
      return {};
    }

    const entries: Record<string, GpsFrameMappingEntry> = {};

    await Promise.all(jobPrefixes.map(async jobPrefix => {
      const normalizedJobPrefix = ensureTrailingSlash(jobPrefix);
      const jobId = deriveJobIdFromPrefix(normalizedJobPrefix);
      const csvKey = `${normalizedJobPrefix}data/gps_frame_mapping.csv`;
      const url = `${S3_HTTP_BASE_URL}/${csvKey}`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const csvText = await res.text();
        const frames = parseGpsFrameMappingCsv(csvText);

        if (frames.length > 0) {
          entries[jobId] = {
            jobId,
            jobPrefix: normalizedJobPrefix,
            frames,
          };
          console.log(`[map] Loaded ${frames.length} GPS frames for job ${jobId}`);
        }
      } catch (err) {
        console.warn(`No GPS frame mapping for ${normalizedJobPrefix}`, err);
      }
    }));

    return entries;
  };

  async function listMetadataGeojsonUrls(prefix: string): Promise<GeojsonListingResult> {
    const prefixes = await listCommonPrefixes(prefix);

    return {
      urls: prefixes.map(folder => `${S3_HTTP_BASE_URL}/${folder}metadata/results_metadata_grouped.geojson`),
      jobPrefixes: [],
    };
  }

  async function listDataGeojsonUrls(prefix: string): Promise<GeojsonListingResult> {
    const directKeys = await listGeojsonKeysAtPrefix(prefix);
    if (directKeys.length > 0) {
      return {
        urls: directKeys.map(key => `${S3_HTTP_BASE_URL}/${key}`),
        jobPrefixes: [],
      };
    }

    const normalizedPrefix = prefix.replace(/\/{2,}/g, '/');
    if (!/\/data\/?$/i.test(normalizedPrefix)) {
      return { urls: [], jobPrefixes: [] };
    }

    const jobBasePrefix = ensureTrailingSlash(normalizedPrefix.replace(/\/?data\/?$/i, ''));
    const jobPrefixes = (await listCommonPrefixes(jobBasePrefix)).map(ensureTrailingSlash);
    if (jobPrefixes.length === 0) {
      return { urls: [], jobPrefixes: [] };
    }

    const nestedKeys: string[] = [];
    for (const jobPrefix of jobPrefixes) {
      const normalizedJobPrefix = ensureTrailingSlash(jobPrefix);
      const candidatePrefixes = [
        `${normalizedJobPrefix}data/`,
        normalizedJobPrefix,
      ];

      for (const candidatePrefix of candidatePrefixes) {
        const jobKeys = await listGeojsonKeysAtPrefix(candidatePrefix);
        if (jobKeys.length > 0) {
          nestedKeys.push(...jobKeys);
          break;
        }
      }
    }

    const uniqueKeys = Array.from(new Set(nestedKeys));
    return {
      urls: uniqueKeys.map(key => `${S3_HTTP_BASE_URL}/${key}`),
      jobPrefixes,
    };
  }

  async function listGeojsonUrlsForTarget(config: S3TargetConfig): Promise<GeojsonListingResult> {
    if (config.mode === 'data') {
      return listDataGeojsonUrls(config.prefix);
    }
    return listMetadataGeojsonUrls(config.prefix);
  }

  const handleLoadMap = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setGeojson(null);
    setJobVideoSegments({});
    setGpsFrameMappings({});
    setSelectedTrackGroupForVideo(null);
    setActiveVideoSegmentId(null);

    try {
      const { urls: geojsonUrls, jobPrefixes } = await listGeojsonUrlsForTarget(targetConfig);

      if (geojsonUrls.length === 0) {
        const emptyMessage = targetConfig.mode === 'data'
          ? `No GeoJSON files found in ${targetS3Uri}`
          : `No scan folders found under ${targetS3Uri}`;
        setError(emptyMessage);
        setLoading(false);
        return;
      }

      let allFeatures: any[] = [];
      const failedUrls: string[] = [];
      const videoSegmentsPromise = loadVideoSegmentsForJobPrefixes(jobPrefixes);
      const gpsFrameMappingsPromise = loadGpsFrameMappingsForJobPrefixes(jobPrefixes);

      const fetchPromises = geojsonUrls.map(async (geojsonUrl, index) => {
        try {
          const response = await fetch(geojsonUrl);
          if (!response.ok){
            console.log(`HTTP ${response.status}`);
            throw new Error(`HTTP ${response.status}`);
          } 
          const fetchedGeojson = await response.json();
          if (!Array.isArray(fetchedGeojson?.features)) {
            throw new Error('GeoJSON missing feature array');
          }

          const normalizedFeatures = fetchedGeojson.features.map((feature: any) => {
            feature.properties = feature.properties || {};
            feature.properties.sourceUrl = geojsonUrl;
            feature.properties.sourceIndex = index;
            feature.properties.globalTimestamp = computeGlobalTimestamp(fetchedGeojson, feature);
            return normalizeFeatureProperties(feature, targetConfig.mode);
          });

          allFeatures = allFeatures.concat(normalizedFeatures);

        } catch (err: any) {
          failedUrls.push(geojsonUrl);
          console.error(`Error loading ${geojsonUrl}`, err);
        }
      });

      await Promise.allSettled(fetchPromises);
      const [loadedVideoSegments, loadedGpsFrameMappings] = await Promise.all([
        videoSegmentsPromise,
        gpsFrameMappingsPromise,
      ]);
      setJobVideoSegments(loadedVideoSegments);
      setGpsFrameMappings(loadedGpsFrameMappings);
      console.log(`[map] Loaded video segments for ${Object.keys(loadedVideoSegments).length} job(s).`);
      console.log(`[map] Loaded GPS frame mappings for ${Object.keys(loadedGpsFrameMappings).length} job(s).`);

      if (isParentTrackDataset(allFeatures)) {
        const { lineFeatures, defectPointFeatures } = convertParentTracksToFeatures(allFeatures, loadedGpsFrameMappings, loadedVideoSegments);
        const combinedFeatures = [...lineFeatures, ...defectPointFeatures];

        if (combinedFeatures.length > 0) {
          const combinedGeoJSON = {
            type: 'FeatureCollection',
            features: combinedFeatures,
            metadata: {
              totalParentTracks: lineFeatures.length,
              totalDefectsLoaded: defectPointFeatures.length,
              failedSources: failedUrls,
              processedAt: new Date().toISOString(),
            },
          };
          setGeojson(combinedGeoJSON);
          setSuccessMessage('Data loaded');
        } else {
          setError('No parent tracks or defects found in provided data.');
        }
        return;
      }

      const aggregatedFrameFeatures = aggregateDetectionsByFrame(allFeatures);

      if (aggregatedFrameFeatures.length > 0) {
        const combinedGeoJSON = {
          type: 'FeatureCollection',
          features: aggregatedFrameFeatures,
          metadata: {
            totalFramesLoaded: aggregatedFrameFeatures.length,
            totalDetectionsLoaded: allFeatures.length,
            failedSources: failedUrls,
            processedAt: new Date().toISOString(),
          },
        };
        setGeojson(combinedGeoJSON);
        setSuccessMessage('Data loaded');
      } else {
        setError('No defects found in any results.');
      }
    } catch (err: any) {
      console.error('Unexpected failure:', err);
      setError(`Unexpected error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const activeVideoJobId = activeVideoJobEntry?.jobId || selectedTrackGroupJobIds[0] || null;
  const clearSelectedSegment = () => {
    setSelectedTrackGroupForVideo(null);
    setActiveVideoSegmentId(null);
  };

  return (
    <>
      {/* Compact controls bar */}
      <div style={{ 
        position: 'fixed',
        top: '50px', // Just below navbar
        left: '0',
        right: '0',
        zIndex: 1000,
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
        padding: controlsCollapsed ? '0.4rem 1rem' : '1rem'
      }}>
        <div style={{ 
          maxWidth: '1200px', 
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', flex: '1', minWidth: '200px' }}>
            <h1 style={{
              fontSize: '1.3rem',
              fontWeight: 'bold',
              color: '#1e40af',
              fontFamily: 'Inter, sans-serif',
              margin: '0'
            }}>
              Pavement Defect Map
            </h1>
            <button
              onClick={() => setControlsCollapsed(!controlsCollapsed)}
              style={{
                background: '#e5e7eb',
                color: '#1f2937',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                padding: '0.25rem 0.5rem',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              {controlsCollapsed ? 'Show Controls' : 'Hide'}
            </button>
          </div>

          {!controlsCollapsed && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap'
            }}>
              <button
                onClick={handleLoadMap}
                disabled={loading}
                style={{
                  background: loading ? '#9ca3af' : '#2563eb',
                  color: 'white',
                  fontWeight: '600',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease-in-out',
                  fontSize: '0.9rem',
                  minWidth: '120px'
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.currentTarget.style.background = '#1d4ed8';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading) {
                    e.currentTarget.style.background = '#2563eb';
                  }
                }}
              >
                {loading ? 'Loading...' : 'Load Maps'}
              </button>

              {loading && (
                <span style={{
                  color: '#6b7280',
                  fontSize: '0.9rem',
                  fontWeight: '500'
                }}>
                  Fetching data...
                </span>
              )}

              {error && (
                <span style={{
                  color: '#dc2626',
                  fontSize: '0.9rem',
                  fontWeight: '500'
                }}>
                  {error}
                </span>
              )}

              {successMessage && (
                <span style={{
                  color: '#059669',
                  fontSize: '0.9rem',
                  fontWeight: '600'
                }}>
                  ✓ {successMessage}
                </span>
              )}
            </div>
          )}
          
          {selectedTrackGroupForVideo && (
            <div style={{
              background: '#ffffff',
              borderRadius: '12px',
              padding: '1rem',
              paddingBottom: '300px',
              boxShadow: '0 15px 35px rgba(15, 23, 42, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>Selected Segment</span>
                  <strong style={{ fontSize: '1rem', color: '#111827' }}>
                    {activeVideoJobId ? `Job ${activeVideoJobId}` : 'Unknown job'}
                  </strong>
                  <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                    Damage: {selectedTrackGroupForVideo.damage_count ?? 0} · Tracks: {Array.isArray(selectedTrackGroupForVideo.track_ids) ? selectedTrackGroupForVideo.track_ids.length : 0}
                    {selectedTrackGroupForVideo.pci_score !== undefined && (
                      <> · PCI: {selectedTrackGroupForVideo.pci_score} ({selectedTrackGroupForVideo.pci_rating})</>
                    )}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {selectedTrackGroupJobIds.length > 1 && (
                    <span style={{ fontSize: '0.75rem', color: '#4338ca', background: '#e0e7ff', padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                      {selectedTrackGroupJobIds.length} jobs overlap
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={clearSelectedSegment}
                    style={{
                      background: '#fee2e2',
                      color: '#b91c1c',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '0.35rem 0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Close preview
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ flex: '1 1 360px', minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ borderRadius: '10px', overflow: 'hidden', background: '#0f172a', position: 'relative' }}>
                    <video
                      ref={videoPlayerRef}
                      controls
                      playsInline
                      style={{ width: '100%', height: '450px', background: '#000', objectFit: 'contain' }}
                    />
                    {activeVideoSegment?.hls?.master_playlist_url && (
                      <a
                        href={activeVideoSegment.hls.master_playlist_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          background: 'rgba(15, 23, 42, 0.7)',
                          color: '#e0e7ff',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          textDecoration: 'none'
                        }}
                      >
                        Open playlist
                      </a>
                    )}
                  </div>
                  {activeVideoSegment ? (
                    <div style={{ fontSize: '0.85rem', color: '#111827', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <strong style={{ color: '#1f2937' }}>Segment {activeVideoSegment.segment_id}</strong>
                      <span>Frames: {Array.isArray(activeVideoSegment.frame_range) ? `${activeVideoSegment.frame_range[0]} - ${activeVideoSegment.frame_range[1]}` : 'N/A'}</span>
                      <span>Duration: {activeVideoSegment.duration_seconds?.toFixed ? `${activeVideoSegment.duration_seconds.toFixed(1)}s` : 'N/A'}</span>
                      <span>
                        Distance: {activeVideoSegment.distance_start_miles?.toFixed ? `${activeVideoSegment.distance_start_miles.toFixed(2)}mi` : 'N/A'}
                        {' '}→{' '}
                        {activeVideoSegment.distance_end_miles?.toFixed ? `${activeVideoSegment.distance_end_miles.toFixed(2)}mi` : 'N/A'}
                      </span>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.85rem', color: '#b91c1c' }}>
                      No video metadata available for this job yet.
                    </div>
                  )}
                </div>
                <div style={{ flex: '1 1 360px', minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#111827' }}>Road Surface Visualization</div>
                  {selectedTrackGroupForVideo?.overlapping_tracks && selectedTrackGroupForVideo.overlapping_tracks.length > 0 ? (
                    <RoadGridVisualization
                      key={`grid-${selectedTrackGroupForVideo.start_feet}-${selectedTrackGroupForVideo.end_feet}-${selectedTrackGroupForVideo.damage_count}`}
                      tracks={selectedTrackGroupForVideo.overlapping_tracks}
                      segmentStartFeet={Number(selectedTrackGroupForVideo.start_feet) || 0}
                      segmentEndFeet={Number(selectedTrackGroupForVideo.end_feet) || Number(selectedTrackGroupForVideo.start_feet) + 528}
                      segmentStartCoord={selectedTrackGroupForVideo.start_coord}
                      segmentEndCoord={selectedTrackGroupForVideo.end_coord}
                      pciDetails={selectedTrackGroupForVideo.pci_details}
                    />
                  ) : (
                    <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>No track data available for this segment.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main content area: Map + Sidebar */}
      <div style={{
        position: 'fixed',
        top: '0', // Below navbar + controls
        left: '0',
        right: '0',
        bottom: '0',
        display: 'flex', // Use flexbox here
        backgroundColor: '#e5e7eb', // This background color will be visible if map isn't full width
      }}>
        <div style={{
          flexGrow: 1, // Allows map container to take up available space
          transition: 'margin-right 0.3s ease', // Smooth transition for map shrinking/expanding
          marginRight: isSidebarOpen ? `${sidebarWidth}px` : '0', // Pushes map to the left
        }}>
          {/* Pass sidebar state and width to MapComponent */}
          <DynamicMapComponent
            geojson={geojson}
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            sidebarWidth={sidebarWidth}
            onSegmentSelected={handleSegmentSelectionChange}
          />
        </div>
      </div>

      <style jsx>{`
        /* Additional responsive styles */
        @media (max-width: 768px) {
          h1 {
            font-size: 2rem !important;
          }
          
          .container {
            padding: 0.5rem !important;
          }
        }
      `}</style>
    </>
  );
}

export default function MultiS3GeoJSONMapPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">
      <p className="text-center text-gray-500 text-lg">Loading...</p>
    </div>}>
      <MapPageContent />
    </Suspense>
  );
}
