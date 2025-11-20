'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import * as turf from '@turf/turf';
import Hls from 'hls.js';

// Dynamically import MapComponent to ensure it only loads on the client side
// We'll also pass sidebar state to it
const DynamicMapComponent = dynamic(() => import('../../components/MapComponent'), {
  ssr: false, // Do not render on server side
  loading: () => <p className="text-center text-gray-500 text-lg">Loading map...</p>,
});

const S3_HTTP_BASE_URL = 'https://civicscan-data-dev-usw2.s3.us-west-2.amazonaws.com';
const S3_URI_BASE = 's3://civicscan-data-dev-usw2/';
const DEFAULT_RESULTS_PREFIX = 'customer_outputs/cal15/data/';
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

interface SegmentCoverageRowData {
  id: string;
  description: string;
  coverageLeftPct: number;
  coverageWidthPct: number;
  dots: { leftPct: number; tooltip: string }[];
  thumbnails: { url: string; caption: string }[];
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

const convertParentTracksToFeatures = (features: any[]) => {
  const segments: any[] = [];
  const METERS_TO_FEET = 3.28084;
  const SEGMENT_LENGTH_FEET = 500;

  const allTracks: any[] = [];

  features.forEach(feature => {
    if (!feature?.properties) return;
    const parentProps = feature.properties;
    const childTracks = Array.isArray(parentProps.child_tracks) ? parentProps.child_tracks : [];
    const parentJobId = extractJobIdFromSourceUrl(parentProps.sourceUrl);

    childTracks.forEach((childTrack: any, idx: number) => {
      const defects = Array.isArray(childTrack.defects) ? childTrack.defects : [];
      let trackDamage = 0;
      const defectTypes = new Set<string>();
      let representativeThumbnail: string | null = null;
      const severityLabels = new Set<string>();

      defects.forEach((defect: any) => {
        const defectType = (defect.defect_type || '').toLowerCase();
        if (defectType) {
          defectTypes.add(defectType);
        }
        if (defectType !== 'sealed_crack') {
          trackDamage += 1;
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

      allTracks.push({
        ...childTrack,
        job_id: trackJobId,
        parent_track_id: parentProps.parent_track_id ?? parentProps.track_id,
        track_damage: trackDamage,
        track_start_ts: startTimestamp,
        track_length_feet: trackLengthFeet,
        measured_length_feet: Number.isFinite(measuredLengthFeet) ? measuredLengthFeet : null,
        coordinates: coords,
        defect_types: Array.from(defectTypes),
        representative_thumbnail: representativeThumbnail,
        severity_labels: Array.from(severityLabels),
        source_geojson_url: parentProps.sourceUrl,
      });
    });
  });

  const orderedTracks = allTracks
    .filter(t => t.coordinates && t.coordinates.length > 0)
    .sort((a, b) => {
      if (a.track_start_ts === null && b.track_start_ts === null) return 0;
      if (a.track_start_ts === null) return 1;
      if (b.track_start_ts === null) return -1;
      return a.track_start_ts - b.track_start_ts;
    });

  if (orderedTracks.length === 0) {
    return { lineFeatures: [], defectPointFeatures: [] };
  }

  let cumulativeFeet = 0;
  orderedTracks.forEach(track => {
    track.start_feet = cumulativeFeet;
    track.end_feet = cumulativeFeet + (Number.isFinite(track.track_length_feet) ? track.track_length_feet : 0);
    cumulativeFeet = track.end_feet;
  });

  const orderedCoords: any[] = [];
  orderedTracks.forEach((t) => {
    t.coordinates.forEach((coord: any, idx: number) => {
      if (idx === 0 && orderedCoords.length > 0) {
        return;
      }
      if (Array.isArray(coord) && coord.length === 2) {
        orderedCoords.push(coord);
      }
    });
  });

  if (orderedCoords.length < 2) {
    return { lineFeatures: [], defectPointFeatures: [] };
  }

  const line = turf.lineString(orderedCoords);
  const chunked = turf.lineChunk(line, SEGMENT_LENGTH_FEET, { units: 'feet' });

  let segStartFeet = 0;
  chunked.features.forEach((segFeature: any) => {
      const segLengthFeet = turf.length(segFeature, { units: 'feet' });
      const segEndFeet = segStartFeet + segLengthFeet;

      if (!Number.isFinite(segLengthFeet) || segLengthFeet <= 0) {
        return;
      }

      let damage = 0;
      const trackIds = new Set<any>();
      const defectTypes = new Set<string>();
      const segmentTracks: any[] = [];

      orderedTracks.forEach(track => {
        const overlaps = !(track.start_feet >= segEndFeet || track.end_feet <= segStartFeet);
        if (overlaps) {
          damage += track.track_damage;
          if (track.track_id !== undefined) trackIds.add(track.track_id);
          if (track.parent_track_id !== undefined) trackIds.add(track.parent_track_id);
          (Array.isArray(track.defect_types) ? track.defect_types : []).forEach((dt: any) => {
            if (dt) defectTypes.add(String(dt));
          });
          segmentTracks.push({
            track_id: track.track_id,
            parent_track_id: track.parent_track_id,
            start_feet: track.start_feet,
            end_feet: track.end_feet,
            thumbnail_url: track.representative_thumbnail,
            track_damage: track.track_damage,
            defect_types: track.defect_types,
            severity_labels: track.severity_labels,
            measured_length_feet: track.measured_length_feet ?? track.track_length_feet,
            job_id: track.job_id,
            source_geojson_url: track.source_geojson_url,
          });
        }
      });
      const segmentJobIds = Array.from(
        new Set(segmentTracks.map(t => t.job_id).filter((id): id is string => Boolean(id)))
      );

      segments.push({
        type: 'Feature',
        geometry: segFeature.geometry,
        properties: {
          damage_count: damage,
          track_ids: Array.from(trackIds),
          start_feet: segStartFeet,
          end_feet: segEndFeet,
          segment_length_feet: segLengthFeet,
          defect_types: Array.from(defectTypes),
          overlapping_tracks: segmentTracks,
          start_coord: Array.isArray(segFeature.geometry?.coordinates) ? segFeature.geometry.coordinates[0] : null,
          end_coord: Array.isArray(segFeature.geometry?.coordinates) ? segFeature.geometry.coordinates[segFeature.geometry.coordinates.length - 1] : null,
          job_ids: segmentJobIds,
        },
      });

    segStartFeet = segEndFeet;
  });

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

interface LengthFilterState {
  min: string;
  max: string;
}

const parseLengthFilterValue = (value: string | null | undefined): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numericValue = Number(trimmed);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const filterGeojsonByLength = (geojson: any, filter: LengthFilterState) => {
  if (!geojson || !Array.isArray(geojson.features)) {
    return geojson;
  }

  const minLength = parseLengthFilterValue(filter?.min);
  const maxLength = parseLengthFilterValue(filter?.max);
  const filterActive = minLength !== null || maxLength !== null;

  if (!filterActive) {
    return geojson;
  }

  let filteredDetectionTotal = 0;

  const filteredFeatures = geojson.features.reduce((acc: any[], feature: any) => {
    if (feature?.geometry?.type && feature.geometry.type !== 'Point') {
      acc.push(feature);
      return acc;
    }

    const detections = Array.isArray(feature?.properties?.all_detections_in_frame)
      ? feature.properties.all_detections_in_frame
      : [];

    const filteredDetections = detections.filter((det: any) => {
      const detectionLength = coerceToFiniteNumber(det?.length_mm ?? det?.lengthMm);
      if (detectionLength === null) {
        return false;
      }
      if (minLength !== null && detectionLength < minLength) return false;
      if (maxLength !== null && detectionLength > maxLength) return false;
      return true;
    });

    if (filteredDetections.length === 0) {
      return acc;
    }

    filteredDetectionTotal += filteredDetections.length;
    acc.push({
      ...feature,
      properties: {
        ...(feature.properties || {}),
        all_detections_in_frame: filteredDetections,
        detection_count_in_frame: filteredDetections.length,
      },
    });
    return acc;
  }, []);

  return {
    ...geojson,
    features: filteredFeatures,
    metadata: {
      ...(geojson.metadata || {}),
      filteredDetectionCount: filteredDetectionTotal,
      appliedLengthFilter: {
        min: minLength,
        max: maxLength,
      },
    },
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

const buildSegmentCoverageRows = (group: any): SegmentCoverageRowData[] => {
  if (!group) return [];
  const tracks = Array.isArray(group.overlapping_tracks) ? group.overlapping_tracks : [];
  if (tracks.length === 0) return [];

  const segmentStart = Number(group.start_feet) || 0;
  const explicitEnd = Number(group.end_feet);
  const fallbackEnd = tracks.reduce((max, track) => Math.max(max, Number(track.end_feet) || max), segmentStart);
  const segmentEnd = Number.isFinite(explicitEnd) ? explicitEnd : fallbackEnd;
  const totalSpan = Math.max(1, segmentEnd - segmentStart);

  const grouped = tracks.reduce((acc: any[], track: any) => {
    const parentId = track.parent_track_id ?? track.track_id ?? `track-${acc.length}`;
    let existing = acc.find((item: any) => item.parent_track_id === parentId);
    if (!existing) {
      existing = { parent_track_id: parentId, spans: [] as any[] };
      acc.push(existing);
    }
    existing.spans.push({
      ...track,
      start_feet: Number(track.start_feet),
      end_feet: Number(track.end_feet),
    });
    return acc;
  }, []);

  return grouped.map((groupEntry: any, idx: number) => {
    const spans = groupEntry.spans
      .map((span: any) => {
        const safeStart = Number.isFinite(span.start_feet) ? span.start_feet : segmentStart;
        const safeEnd = Number.isFinite(span.end_feet) ? span.end_feet : safeStart;
        return { ...span, safeStart, safeEnd };
      })
      .sort((a: any, b: any) => a.safeStart - b.safeStart);

    if (spans.length === 0) {
      return null;
    }

    const clampValue = (val: number) => Math.max(0, Math.min(totalSpan, val));
    const rowStart = Math.min(...spans.map((span: any) => Math.max(0, Math.min(segmentEnd, span.safeStart) - segmentStart)));
    const rowEnd = Math.max(...spans.map((span: any) => Math.max(0, Math.min(segmentEnd, span.safeEnd) - segmentStart)));
    const overlapStart = clampValue(Math.min(...spans.map((span: any) => Math.max(0, Math.min(segmentEnd, span.safeStart) - segmentStart))));
    const overlapEnd = clampValue(Math.max(...spans.map((span: any) => Math.max(0, Math.min(segmentEnd, span.safeEnd) - segmentStart))));
    const coverageLeftPct = Math.max(0, Math.min(100, (overlapStart / totalSpan) * 100));
    const coverageWidthPct = Math.max(1, Math.min(100, ((overlapEnd - overlapStart) / totalSpan) * 100));

    const defectSet = new Set<string>();
    spans.forEach((span: any) => {
      (Array.isArray(span.defect_types) ? span.defect_types : []).forEach((defect: any) => {
        if (defect) defectSet.add(String(defect));
      });
    });

    const dots = spans.map((span: any, dotIdx: number) => {
      const clampStart = Math.max(segmentStart, span.safeStart);
      const clampEnd = Math.min(segmentEnd, span.safeEnd);
      const mid = ((clampStart + clampEnd) / 2) - segmentStart;
      if (!Number.isFinite(mid)) return null;
      const leftPct = (mid / totalSpan) * 100;
      const severityLabel = Array.isArray(span.severity_labels) && span.severity_labels.length > 0
        ? span.severity_labels.join(', ')
        : 'unknown';
      const tooltip = `Track ${span.track_id ?? dotIdx + 1} · Severity ${severityLabel}`;
      return { leftPct: Math.max(0, Math.min(100, leftPct)), tooltip };
    }).filter((dot): dot is { leftPct: number; tooltip: string } => Boolean(dot));

    const thumbnails = spans
      .map((span: any, thumbIdx: number) => {
        if (!span.thumbnail_url) return null;
        const damageType = Array.isArray(span.defect_types) && span.defect_types.length > 0
          ? span.defect_types.join(', ')
          : 'unknown';
        const severityLabel = Array.isArray(span.severity_labels) && span.severity_labels.length > 0
          ? span.severity_labels.join(', ')
          : 'unknown';
        const clampStart = Math.max(segmentStart, span.safeStart);
        const clampEnd = Math.min(segmentEnd, span.safeEnd);
        const lengthFeet = Math.max(0, clampEnd - clampStart);
        const lengthLabel = Number.isFinite(lengthFeet) && lengthFeet > 0 ? `${lengthFeet.toFixed(1)}ft` : 'N/A';
        const caption = `Defects: ${damageType} · Severity: ${severityLabel} · Length: ${lengthLabel}`;
        return { url: span.thumbnail_url, caption };
      })
      .filter((thumb): thumb is { url: string; caption: string } => Boolean(thumb));

    const description = `Defects: ${defectSet.size ? Array.from(defectSet).join(', ') : 'unknown'} · ${Math.max(0, rowEnd - rowStart).toFixed(1)}ft (${rowStart.toFixed(1)}ft - ${rowEnd.toFixed(1)}ft)`;

    return {
      id: String(groupEntry.parent_track_id ?? idx),
      description,
      coverageLeftPct,
      coverageWidthPct,
      dots,
      thumbnails,
    };
  }).filter((row): row is SegmentCoverageRowData => Boolean(row));
};

function MapPageContent() {
  const [geojson, setGeojson] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [jobVideoSegments, setJobVideoSegments] = useState<Record<string, JobVideoSegmentsEntry>>({});
  const [selectedTrackGroupForVideo, setSelectedTrackGroupForVideo] = useState<any | null>(null);
  const [activeVideoSegmentId, setActiveVideoSegmentId] = useState<number | string | null>(null);
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);
  
  // State for sidebar in parent to control map width
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [screenSize, setScreenSize] = useState({ width: 0, height: 0 }); // Added to dynamically calc sidebar width
  const [lengthFilter, setLengthFilter] = useState<LengthFilterState>({ min: '', max: '' });
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const searchParams = useSearchParams();
  const targetConfig = useMemo(() => getTargetConfigFromSearchParams(searchParams), [searchParams]);
  const targetS3Uri = `${S3_URI_BASE}${targetConfig.prefix}`;
  const targetDisplayLabel = targetConfig.datasetLabel;
  const filteredGeojson = useMemo(
    () => filterGeojsonByLength(geojson, lengthFilter),
    [geojson, lengthFilter]
  );
  const visibleDetectionCount = useMemo(() => {
    if (!filteredGeojson?.features) return 0;
    return filteredGeojson.features.reduce((sum: number, feature: any) => {
      const frameCount = feature?.properties?.detection_count_in_frame;
      if (typeof frameCount === 'number' && Number.isFinite(frameCount)) {
        return sum + frameCount;
      }
      if (Array.isArray(feature?.properties?.all_detections_in_frame)) {
        return sum + feature.properties.all_detections_in_frame.length;
      }
      return sum;
    }, 0);
  }, [filteredGeojson]);
  const hasActiveLengthFilter = Boolean(lengthFilter.min.trim() || lengthFilter.max.trim());
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
  const coverageRows = useMemo(
    () => buildSegmentCoverageRows(selectedTrackGroupForVideo),
    [selectedTrackGroupForVideo]
  );
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
    if (screenSize.width >= 1920) return 1000;
    if (screenSize.width >= 1600) return 800;
    if (screenSize.width >= 1200) return 500;
    return 450;
  };
  const sidebarWidth = getSidebarWidth(); // Calculate once per render cycle when screen size changes
  const handleLengthFilterChange = (key: 'min' | 'max', value: string) => {
    setLengthFilter(prev => ({
      ...prev,
      [key]: value,
    }));
  };
  const resetLengthFilter = () => setLengthFilter({ min: '', max: '' });
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
      const loadedVideoSegments = await videoSegmentsPromise;
      setJobVideoSegments(loadedVideoSegments);
      console.log(`[map] Loaded video segments for ${Object.keys(loadedVideoSegments).length} job(s).`);

      if (isParentTrackDataset(allFeatures)) {
        const { lineFeatures, defectPointFeatures } = convertParentTracksToFeatures(allFeatures);
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
          setSuccessMessage(`Loaded ${defectPointFeatures.length} crack points across ${lineFeatures.length} parent tracks in ${targetDisplayLabel || targetS3Uri}.`);
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
        const unitLabel = targetConfig.mode === 'data' ? 'files' : 'sources';
        setSuccessMessage(`Loaded ${aggregatedFrameFeatures.length} frames (${allFeatures.length} detections) from ${geojsonUrls.length - failedUrls.length} ${unitLabel} in ${targetDisplayLabel || targetS3Uri}.`);
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

  const videoTimelineSegments = Array.isArray(activeVideoJobEntry?.segmentsIndex?.segments)
    ? activeVideoJobEntry.segmentsIndex.segments
    : [];
  const totalVideoDistanceFeet = Number(activeVideoJobEntry?.segmentsIndex?.total_distance_ft) || 0;
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

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
                minWidth: '230px',
                flex: '1'
              }}>
                <span style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Length (mm) Filter
                </span>
                <div style={{
                  display: 'flex',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                  alignItems: 'center'
                }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="Min"
                    value={lengthFilter.min}
                    onChange={(e) => handleLengthFilterChange('min', e.target.value)}
                    style={{
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      padding: '0.35rem 0.5rem',
                      fontSize: '0.85rem',
                      width: '90px',
                      fontFamily: 'Inter, sans-serif'
                    }}
                    aria-label="Minimum length filter in millimeters"
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="Max"
                    value={lengthFilter.max}
                    onChange={(e) => handleLengthFilterChange('max', e.target.value)}
                    style={{
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      padding: '0.35rem 0.5rem',
                      fontSize: '0.85rem',
                      width: '90px',
                      fontFamily: 'Inter, sans-serif'
                    }}
                    aria-label="Maximum length filter in millimeters"
                  />
                  {hasActiveLengthFilter && (
                    <button
                      type="button"
                      onClick={resetLengthFilter}
                      style={{
                        background: '#e0e7ff',
                        color: '#312e81',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.35rem 0.75rem',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <span style={{
                  fontSize: '0.75rem',
                  color: '#6b7280'
                }}>
                  Only detections whose measured length falls within this range remain visible.
                </span>
              </div>

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                minWidth: '240px',
                gap: '0.2rem'
              }}>
                <span style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Data Source
                </span>
                <code style={{
                  fontSize: '0.85rem',
                  background: '#eef2ff',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '6px',
                  color: '#1e40af',
                  wordBreak: 'break-all'
                }}>
                  {targetS3Uri}
                </code>
                <span style={{
                  fontSize: '0.75rem',
                  color: '#6b7280'
                }}>
                  Override via ?dataset=sf2 or full ?prefix=customer_outputs/run
                </span>
              </div>

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
              
              {videoSegmentJobKeys.length > 0 && (
                <span style={{
                  color: '#0f172a',
                  fontSize: '0.85rem',
                  fontWeight: 500
                }}>
                  Video segments ready for {videoSegmentJobKeys.length} job{videoSegmentJobKeys.length === 1 ? '' : 's'}.
                </span>
              )}
              
              {filteredGeojson?.features && (
                <span style={{
                  color: '#374151',
                  fontSize: '0.85rem',
                  fontWeight: 500
                }}>
                  Showing {filteredGeojson.features.length} features · {visibleDetectionCount} detections
                  {hasActiveLengthFilter && filteredGeojson.features.length === 0 && (
                    <span style={{ color: '#dc2626', marginLeft: '0.5rem' }}>
                      No detections match the current length filter.
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
          
          {selectedTrackGroupForVideo && (
            <div style={{
              background: '#ffffff',
              borderRadius: '12px',
              padding: '1rem',
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
                      style={{ width: '100%', height: '220px', background: '#000' }}
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
                  {videoTimelineSegments.length > 0 && (
                    <div>
                      <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Segments</span>
                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                        {videoTimelineSegments.map((segment: any, idx: number) => {
                          const distanceFeet = Number(segment.distance_end_ft) - Number(segment.distance_start_ft);
                          const hasDistance = Number.isFinite(distanceFeet) && distanceFeet > 0 && totalVideoDistanceFeet > 0;
                          const flexGrow = hasDistance ? Math.max(0.5, distanceFeet / totalVideoDistanceFeet) : 1;
                          const isActive = activeVideoSegment?.segment_id === segment.segment_id;
                          return (
                            <button
                              key={segment.segment_id ?? idx}
                              type="button"
                              onClick={() => setActiveVideoSegmentId(segment.segment_id ?? idx)}
                              style={{
                                flexGrow,
                                flexBasis: '80px',
                                minWidth: '70px',
                                borderRadius: '8px',
                                border: isActive ? '2px solid #4338ca' : '1px solid #c7d2fe',
                                background: isActive ? '#e0e7ff' : '#f8fafc',
                                color: '#1e3a8a',
                                fontWeight: 600,
                                padding: '0.35rem',
                                cursor: 'pointer',
                                fontSize: '0.8rem'
                              }}
                            >
                              {segment.segment_id ?? idx + 1}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ flex: '1 1 360px', minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#111827' }}>Track coverage</div>
                  {coverageRows.length > 0 ? (
                    coverageRows.map(row => (
                      <div key={row.id} style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', background: '#f9fafb' }}>
                        <div style={{ fontSize: '0.85rem', color: '#374151' }}>{row.description}</div>
                        <div style={{ position: 'relative', height: '18px', borderRadius: '999px', background: '#e5e7eb', overflow: 'hidden' }}>
                          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${row.coverageLeftPct}%`, width: `${row.coverageWidthPct}%`, background: '#6366f1', opacity: 0.6 }} />
                          {row.dots.map((dot, dotIdx) => (
                            <div
                              key={`${row.id}-dot-${dotIdx}`}
                              title={dot.tooltip}
                              style={{
                                position: 'absolute',
                                top: '-4px',
                                left: `calc(${dot.leftPct}% - 5px)`,
                                width: '10px',
                                height: '10px',
                                borderRadius: '50%',
                                background: '#f97316',
                                border: '1px solid #fff',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.2)'
                              }}
                            />
                          ))}
                        </div>
                        {row.thumbnails.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {row.thumbnails.map((thumb, thumbIdx) => (
                              <div key={`${row.id}-thumb-${thumbIdx}`} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <img
                                  src={thumb.url}
                                  alt={`thumb-${thumbIdx}`}
                                  style={{ width: '80px', height: '56px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #d1d5db' }}
                                />
                                <span style={{ fontSize: '0.8rem', color: '#374151' }}>{thumb.caption}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>No overlapping tracks with thumbnails for this segment.</div>
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
            geojson={filteredGeojson} 
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
