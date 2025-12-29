/**
 * PCI (Pavement Condition Index) Calculator
 * Implements ASTM D6433 standard for road condition assessment
 */

import {
  getPixelBasedPCIRating,
} from './astmDeductTables';

/**
 * Defect data structure matching the GeoJSON feature properties
 */
export interface DefectData {
  defect_id?: string;
  defect_type: string;
  severity?: {
    joint_severity?: string;
    joint_severity_score?: number | null;
    pixel_severity?: string;
    mm_severity?: string;
  };
  measurements_mm?: {
    width_mm?: {
      mean?: number | null;
      median?: number;
      min?: number | null;
      max?: number | null;
    };
    length_mm?: number;
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
  };
  defect_length?: number; // in meters (from individual defect measurement)
  measured_real_length?: number; // in meters (from parent track - actual physical crack length)
}

/**
 * Track data structure from GeoJSON
 */
export interface TrackData {
  track_id: number;
  defects?: DefectData[];
  defect_type?: string;
  gps_length_m?: number;
  child_tracks?: TrackData[];
}

/**
 * Pixel percentage data structure from segments_index.json
 */
export interface PixelPercentageData {
  transverse?: number;
  alligator?: number;
  pothole?: number;
  sealed_crack?: number;
  longitudinal?: number;
  total?: number;
}

/**
 * PCI calculation result
 */
export interface PCIResult {
  pci_score: number;
  pci_rating: string;
  total_deduct_value: number;
  deduct_breakdown: {
    transverse: number;
    longitudinal: number;
    alligator: number;
    pothole: number;
  };
  damage_metrics: {
    total_damage_length_ft: number;
    damage_percentage: number;
    defect_count_by_type: Record<string, number>;
    severity_distribution: Record<string, Record<string, number>>;
  };
}

/**
 * PCI calculation using Power Law approximations of ASTM D6433 curves
 *
 * Uses curved formulas (a * density^b) to better model real pavement deterioration.
 * Applies diminishing weights to multiple deducts to prevent unrealistic score stacking.
 *
 * @param pixelPercentages - Pixel percentage data from segments_index.json
 * @param options - Optional configuration for logging
 */
export function calculatePCI(
  pixelPercentages: PixelPercentageData,
  options?: { verbose?: boolean; segmentId?: number | string }
): PCIResult {
  const verbose = options?.verbose ?? false;
  const segmentLabel = options?.segmentId !== undefined ? `Segment ${options.segmentId}` : 'Segment';

  // Extract densities (default to 0)
  const densities = {
    alligator: pixelPercentages.alligator ?? 0,
    transverse: pixelPercentages.transverse ?? 0,
    longitudinal: pixelPercentages.longitudinal ?? 0,
    sealed: pixelPercentages.sealed_crack ?? 0,
    pothole: pixelPercentages.pothole ?? 0,
  };

  // Define curve coefficients (a * density^b) derived from ASTM D6433 Medium Severity curves
  const curves = {
    // Alligator rises FAST. 1% density = ~25 deduct points
    alligator: { a: 28.0, b: 0.45, max: 80 },

    // Potholes are instant killers. 0.1% density = ~20 deduct points
    pothole: { a: 100.0, b: 0.60, max: 100 },

    // Longitudinal is gentler. 1% density = ~8 deduct points
    longitudinal: { a: 8.0, b: 0.65, max: 40 },

    // Transverse is similar to Longitudinal
    transverse: { a: 7.5, b: 0.60, max: 40 },

    // Sealed cracks are very flat
    sealed: { a: 3.0, b: 0.50, max: 15 },
  };

  // Calculate individual deduct values using power law
  const deductValues: { type: string; value: number }[] = [];
  const deductBreakdown = {
    transverse: 0,
    longitudinal: 0,
    alligator: 0,
    pothole: 0,
  };

  for (const [defectType, density] of Object.entries(densities)) {
    if (density > 0 && defectType in curves) {
      const curve = curves[defectType as keyof typeof curves];
      // Formula: Deduct = a * (density^b)
      const rawDeduct = curve.a * Math.pow(density, curve.b);

      // Clip to max reasonable deduct for that type
      const finalDeduct = Math.min(rawDeduct, curve.max);

      deductValues.push({ type: defectType, value: finalDeduct });

      // Store in breakdown (sealed goes into transverse for backward compatibility)
      if (defectType === 'sealed') {
        deductBreakdown.transverse += finalDeduct;
      } else if (defectType in deductBreakdown) {
        deductBreakdown[defectType as keyof typeof deductBreakdown] = finalDeduct;
      }
    }
  }

  // Sort deduct values highest first
  deductValues.sort((a, b) => b.value - a.value);

  // Apply diminishing weights to prevent stacking
  // Weight multipliers: 1st=1.0, 2nd=0.7, 3rd=0.4, others=0.1
  // This mimics ASTM D6433 correction curves
  const weights = [1.0, 0.7, 0.4, 0.1];

  let total_cdv = 0;
  for (let i = 0; i < deductValues.length; i++) {
    const weight = i < weights.length ? weights[i] : 0.1;
    total_cdv += deductValues[i].value * weight;
  }

  // Cap CDV at 100 (cannot exceed maximum deduct)
  total_cdv = Math.min(100, total_cdv);

  // Final PCI score
  const pci_score = Math.max(0, 100 - total_cdv);
  const pci_rating = getPixelBasedPCIRating(pci_score);

  if (verbose) {
    console.group(`🎯 Power Law PCI Calculation - ${segmentLabel}`);
    console.log('Input densities:', densities);
    console.log('Calculated deducts:', deductValues.map(d => `${d.type}: ${d.value.toFixed(2)}`));
    console.log('Total CDV (with diminishing weights):', total_cdv.toFixed(2));
    console.log(`Final PCI: ${pci_score.toFixed(1)} (${pci_rating})`);
    console.groupEnd();
  }

  // Calculate total damage percentage for metrics
  const totalDamagePercentage = densities.transverse + densities.alligator + densities.pothole + densities.longitudinal;

  // Return BOTH numeric score and rating label
  return {
    pci_score: Math.round(pci_score * 10) / 10, // Numeric value (0-100)
    pci_rating, // Text rating ("Good", "Satisfactory", etc.)
    total_deduct_value: Math.round(total_cdv * 10) / 10,
    deduct_breakdown: {
      transverse: Math.round(deductBreakdown.transverse * 10) / 10,
      longitudinal: Math.round(deductBreakdown.longitudinal * 10) / 10,
      alligator: Math.round(deductBreakdown.alligator * 10) / 10,
      pothole: Math.round(deductBreakdown.pothole * 10) / 10,
    },
    damage_metrics: {
      total_damage_length_ft: 0, // Not applicable for pixel-based
      damage_percentage: Math.round(totalDamagePercentage * 10) / 10,
      defect_count_by_type: {
        transverse: densities.transverse > 0 ? 1 : 0,
        longitudinal: densities.longitudinal > 0 ? 1 : 0,
        alligator: densities.alligator > 0 ? 1 : 0,
        pothole: densities.pothole > 0 ? 1 : 0,
      },
      severity_distribution: {},
    },
  };
}
