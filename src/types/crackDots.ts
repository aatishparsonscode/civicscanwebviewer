/**
 * Type definitions for crack dots view feature
 */

export interface CrackDotData {
  defect_id: string;
  defect_type: string; // alligator, longitudinal, transverse, pothole, sealed_crack
  gps_coordinates: {
    latitude: number;
    longitude: number;
  };
  offset_gps_coordinates: {
    latitude: number;
    longitude: number;
  };
  centroid_px: [number, number]; // Pixel position in 4K frame
  severity: string;
  images: {
    thumbnail?: string;
    polygon_overlay?: string;
    measurement_overlay?: string;
  };
  measurements?: {
    width_px?: number;
    length_px?: number;
    area_px?: number;
  };
  parent_segment_id?: number;
  job_id?: string;
  frame_id?: number;
}

export type MapViewMode = 'segments' | 'cracks';
