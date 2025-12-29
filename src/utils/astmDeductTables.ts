/**
 * ASTM D6433 Deduct Value Tables for Pavement Condition Index (PCI) Calculation
 *
 * These tables are simplified representations of ASTM D6433 standard deduct values
 * for asphalt pavement distresses. Values are interpolated based on:
 * - Defect type (transverse, longitudinal, alligator, pothole)
 * - Severity level (Low, Medium, High)
 * - Density (percentage of segment affected or count)
 */

export type SeverityLevel = 'Low' | 'Medium' | 'High';
export type DefectType = 'transverse' | 'longitudinal' | 'alligator' | 'pothole';

/**
 * Deduct value lookup table structure
 * Key: density percentage or count
 * Value: deduct value (0-100)
 */
type DeductTable = Record<number, number>;

/**
 * TRANSVERSE CRACKING (across traffic direction)
 * Based on number of cracks per segment
 * Severity based on crack width and spalling
 */
const TRANSVERSE_DEDUCT: Record<SeverityLevel, DeductTable> = {
  Low: {
    0: 0,
    1: 2,
    2: 4,
    3: 6,
    5: 8,
    10: 12,
    15: 15,
    20: 18,
    30: 22,
    50: 28,
    60: 31,
    70: 34,
    80: 36,
    90: 38,
    100: 40,
  },
  Medium: {
    0: 0,
    1: 4,
    2: 8,
    3: 11,
    5: 15,
    10: 22,
    15: 28,
    20: 33,
    30: 40,
    50: 50,
    60: 55,
    70: 59,
    80: 63,
    90: 66,
    100: 69,
  },
  High: {
    0: 0,
    1: 6,
    2: 12,
    3: 17,
    5: 23,
    10: 34,
    15: 42,
    20: 48,
    30: 58,
    50: 70,
    60: 75,
    70: 79,
    80: 83,
    90: 86,
    100: 89,
  },
};

/**
 * LONGITUDINAL CRACKING (parallel to traffic direction)
 * Based on percentage of segment length affected
 * Severity based on crack width and spalling
 */
const LONGITUDINAL_DEDUCT: Record<SeverityLevel, DeductTable> = {
  Low: {
    0: 0,
    1: 1,
    5: 3,
    10: 5,
    20: 8,
    30: 11,
    40: 14,
    50: 16,
    60: 18,
    80: 22,
    100: 25,
  },
  Medium: {
    0: 0,
    1: 2,
    5: 6,
    10: 10,
    20: 16,
    30: 21,
    40: 26,
    50: 30,
    60: 34,
    80: 40,
    100: 45,
  },
  High: {
    0: 0,
    1: 3,
    5: 9,
    10: 15,
    20: 24,
    30: 31,
    40: 38,
    50: 44,
    60: 49,
    80: 58,
    100: 65,
  },
};

/**
 * ALLIGATOR CRACKING (interconnected cracks forming pattern)
 * Based on percentage of segment area affected
 * Severity based on crack pattern and spalling
 * Note: Alligator cracking indicates structural failure - more severe
 */
const ALLIGATOR_DEDUCT: Record<SeverityLevel, DeductTable> = {
  Low: {
    0: 0,
    1: 3,
    5: 8,
    10: 14,
    20: 22,
    30: 28,
    40: 33,
    50: 38,
    60: 42,
    80: 48,
    100: 52,
  },
  Medium: {
    0: 0,
    1: 5,
    5: 14,
    10: 24,
    20: 38,
    30: 48,
    40: 56,
    50: 62,
    60: 67,
    80: 75,
    100: 80,
  },
  High: {
    0: 0,
    1: 8,
    5: 20,
    10: 35,
    20: 54,
    30: 66,
    40: 75,
    50: 82,
    60: 87,
    80: 94,
    100: 98,
  },
};

/**
 * POTHOLES
 * Based on number of potholes per segment
 * Typically considered high severity due to safety concerns
 */
const POTHOLE_DEDUCT: Record<SeverityLevel, DeductTable> = {
  Low: {
    0: 0,
    1: 5,
    2: 10,
    3: 14,
    5: 20,
    10: 32,
    15: 40,
    20: 46,
    30: 55,
    50: 68,
    60: 74,
    70: 79,
    80: 83,
    90: 87,
    100: 90,
  },
  Medium: {
    0: 0,
    1: 8,
    2: 15,
    3: 21,
    5: 30,
    10: 45,
    15: 55,
    20: 62,
    30: 72,
    50: 85,
    60: 89,
    70: 92,
    80: 95,
    90: 97,
    100: 99,
  },
  High: {
    0: 0,
    1: 12,
    2: 22,
    3: 30,
    5: 42,
    10: 60,
    15: 72,
    20: 80,
    30: 90,
    50: 100,
    60: 100,
    70: 100,
    80: 100,
    90: 100,
    100: 100,
  },
};

/**
 * Main deduct table lookup structure
 */
export const DEDUCT_TABLES: Record<DefectType, Record<SeverityLevel, DeductTable>> = {
  transverse: TRANSVERSE_DEDUCT,
  longitudinal: LONGITUDINAL_DEDUCT,
  alligator: ALLIGATOR_DEDUCT,
  pothole: POTHOLE_DEDUCT,
};

/**
 * ASTM D6433 Corrected Deduct Value (CDV) Correction Curves
 * Based on Total Deduct Value (TDV) and number of deducts (q)
 * Approximated from Fig. X3.27 in ASTM D6433 for Asphalt Concrete pavements
 *
 * Key: q-value (number of individual deduct values > 2.0)
 * Value: Lookup table mapping TDV to CDV
 */
const CDV_CORRECTION_CURVES: Record<number, DeductTable> = {
  1: {
    0: 0,
    10: 10,
    20: 20,
    30: 30,
    40: 40,
    50: 50,
    60: 60,
    70: 70,
    80: 80,
    90: 90,
    100: 100,
    110: 100,
    120: 100,
  },
  2: {
    0: 0,
    10: 8,
    20: 16,
    30: 24,
    40: 32,
    50: 40,
    60: 47,
    70: 54,
    80: 61,
    90: 67,
    100: 73,
    110: 78,
    120: 82,
    140: 88,
    160: 93,
    180: 96,
    200: 98,
  },
  3: {
    0: 0,
    10: 7,
    20: 14,
    30: 21,
    40: 28,
    50: 35,
    60: 42,
    70: 48,
    80: 54,
    90: 60,
    100: 65,
    110: 70,
    120: 74,
    140: 81,
    160: 87,
    180: 91,
    200: 95,
  },
  4: {
    0: 0,
    10: 6,
    20: 13,
    30: 19,
    40: 26,
    50: 32,
    60: 38,
    70: 44,
    80: 50,
    90: 55,
    100: 60,
    110: 65,
    120: 69,
    140: 76,
    160: 82,
    180: 88,
    200: 92,
  },
  5: {
    0: 0,
    10: 6,
    20: 12,
    30: 18,
    40: 24,
    50: 30,
    60: 36,
    70: 41,
    80: 46,
    90: 51,
    100: 56,
    110: 61,
    120: 65,
    140: 72,
    160: 78,
    180: 84,
    200: 89,
  },
  6: {
    0: 0,
    10: 5,
    20: 11,
    30: 16,
    40: 22,
    50: 28,
    60: 33,
    70: 38,
    80: 43,
    90: 48,
    100: 53,
    110: 57,
    120: 61,
    140: 69,
    160: 75,
    180: 81,
    200: 86,
  },
  7: {
    0: 0,
    10: 5,
    20: 10,
    30: 15,
    40: 21,
    50: 26,
    60: 31,
    70: 36,
    80: 40,
    90: 45,
    100: 50,
    110: 54,
    120: 58,
    140: 66,
    160: 72,
    180: 78,
    200: 83,
  },
  8: {
    0: 0,
    10: 5,
    20: 10,
    30: 15,
    40: 19,
    50: 24,
    60: 29,
    70: 34,
    80: 38,
    90: 43,
    100: 47,
    110: 51,
    120: 55,
    140: 63,
    160: 69,
    180: 75,
    200: 81,
  },
  9: {
    0: 0,
    10: 4,
    20: 9,
    30: 14,
    40: 18,
    50: 23,
    60: 27,
    70: 32,
    80: 36,
    90: 40,
    100: 45,
    110: 49,
    120: 53,
    140: 60,
    160: 67,
    180: 73,
    200: 78,
  },
  10: {
    0: 0,
    10: 4,
    20: 9,
    30: 13,
    40: 17,
    50: 22,
    60: 26,
    70: 30,
    80: 34,
    90: 38,
    100: 43,
    110: 47,
    120: 51,
    140: 58,
    160: 65,
    180: 71,
    200: 76,
  },
};

/**
 * Interpolates deduct value for a given density/count
 * Uses linear interpolation between known data points
 */
export function interpolateDeductValue(
  table: DeductTable,
  density: number
): number {
  const sortedKeys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);

  // Clamp density to valid range
  const clampedDensity = Math.max(0, Math.min(100, density));

  // Find exact match
  if (table[clampedDensity] !== undefined) {
    return table[clampedDensity];
  }

  // Find surrounding values for interpolation
  let lowerKey = sortedKeys[0];
  let upperKey = sortedKeys[sortedKeys.length - 1];

  for (let i = 0; i < sortedKeys.length - 1; i++) {
    if (sortedKeys[i] <= clampedDensity && sortedKeys[i + 1] >= clampedDensity) {
      lowerKey = sortedKeys[i];
      upperKey = sortedKeys[i + 1];
      break;
    }
  }

  // Linear interpolation
  const lowerValue = table[lowerKey];
  const upperValue = table[upperKey];

  if (lowerKey === upperKey) {
    return lowerValue;
  }

  const ratio = (clampedDensity - lowerKey) / (upperKey - lowerKey);
  return lowerValue + ratio * (upperValue - lowerValue);
}

/**
 * Gets deduct value for a specific defect type, severity, and density
 */
export function getDeductValue(
  defectType: DefectType,
  severity: SeverityLevel,
  density: number
): number {
  const table = DEDUCT_TABLES[defectType]?.[severity];
  if (!table) {
    console.warn(`No deduct table found for ${defectType} - ${severity}`);
    return 0;
  }
  return interpolateDeductValue(table, density);
}

/**
 * Gets CDV from correction curve for a given TDV and q-value
 * Uses linear interpolation between known data points
 */
function getCDVFromCurve(tdv: number, q: number): number {
  // Clamp q to valid range (1-10)
  const clampedQ = Math.max(1, Math.min(10, Math.round(q)));

  const curve = CDV_CORRECTION_CURVES[clampedQ];
  if (!curve) {
    console.warn(`No CDV curve found for q=${clampedQ}, using q=1`);
    return Math.min(100, tdv);
  }

  return interpolateDeductValue(curve, tdv);
}

/**
 * Applies ASTM D6433 multiple deduct value correction
 * Implements the full iterative CDV algorithm
 *
 * Algorithm per ASTM D6433:
 * 1. If 0 or 1 deduct values > 2.0, Max CDV = TDV
 * 2. Calculate m = 1 + (9/98) × (100 - HDV), where m ≤ 10
 * 3. Reduce to m largest deduct values
 * 4. Iterate:
 *    a. Calculate q (number of DVs > 2.0)
 *    b. Get CDV from correction curve using TDV and q
 *    c. Reduce smallest DV > 2.0 to exactly 2.0
 *    d. Repeat until q = 1
 * 5. Max CDV is the largest CDV from all iterations
 */
export function applyMultipleDeductCorrection(deductValues: number[]): number {
  if (deductValues.length === 0) {
    return 0;
  }

  // Filter out deduct values less than or equal to 2.0
  const significantDeducts = deductValues.filter(dv => dv > 2.0);

  // Step 1: If 0 or 1 significant deduct values, Max CDV = TDV
  if (significantDeducts.length <= 1) {
    const tdv = deductValues.reduce((sum, dv) => sum + dv, 0);
    return Math.max(0, Math.min(100, tdv));
  }

  // Sort all deduct values in descending order
  const sortedDeducts = [...deductValues].sort((a, b) => b - a);

  // Step 2: Calculate m (maximum allowable number of deducts)
  const hdv = sortedDeducts[0]; // Highest Deduct Value
  const m = Math.min(10, 1 + (9 / 98) * (100 - hdv));

  // Step 3: Reduce to m largest deduct values
  // Keep floor(m) full values plus fractional part of the next value
  const mFloor = Math.floor(m);
  const mFraction = m - mFloor;

  let workingDeducts = sortedDeducts.slice(0, mFloor);
  if (mFraction > 0 && sortedDeducts.length > mFloor) {
    workingDeducts.push(sortedDeducts[mFloor] * mFraction);
  }

  // Step 4: Iterative CDV calculation
  const cdvResults: number[] = [];
  let iteration = 0;
  const maxIterations = 20; // Safety limit

  while (iteration < maxIterations) {
    // Calculate q (number of deducts > 2.0)
    const q = workingDeducts.filter(dv => dv > 2.0).length;

    // Calculate TDV (Total Deduct Value)
    const tdv = workingDeducts.reduce((sum, dv) => sum + dv, 0);

    // Get CDV from correction curve
    const cdv = getCDVFromCurve(tdv, q);
    cdvResults.push(cdv);

    console.log(`[CDV Iteration ${iteration + 1}] q=${q}, TDV=${tdv.toFixed(2)}, CDV=${cdv.toFixed(2)}, Deducts=[${workingDeducts.map(d => d.toFixed(1)).join(', ')}]`);

    // If q = 1, we're done
    if (q <= 1) {
      break;
    }

    // Find smallest deduct value > 2.0 and reduce it to 2.0
    let reducedSmallest = false;
    for (let i = workingDeducts.length - 1; i >= 0; i--) {
      if (workingDeducts[i] > 2.0) {
        workingDeducts[i] = 2.0;
        reducedSmallest = true;
        break;
      }
    }

    if (!reducedSmallest) {
      // Should not happen, but safety check
      console.warn('[CDV] Could not find deduct > 2.0 to reduce, breaking iteration');
      break;
    }

    iteration++;
  }

  // Step 5: Max CDV is the largest CDV from all iterations
  const maxCDV = Math.max(...cdvResults);
  console.log(`[CDV Final] Max CDV = ${maxCDV.toFixed(2)} from ${cdvResults.length} iterations`);

  return Math.max(0, Math.min(100, maxCDV));
}

/**
 * Converts PCI score (0-100) to rating category
 */
export function getPCIRating(pci: number): string {
  if (pci >= 85) return 'Excellent';
  if (pci >= 70) return 'Good';
  if (pci >= 55) return 'Fair';
  if (pci >= 40) return 'Poor';
  if (pci >= 25) return 'Very Poor';
  return 'Failed';
}

/**
 * Converts PCI score to rating category for pixel-based formula
 */
export function getPixelBasedPCIRating(pci: number): string {
  if (pci >= 85) return 'Good';
  if (pci >= 70) return 'Satisfactory';
  if (pci >= 55) return 'Fair';
  if (pci >= 40) return 'Poor';
  if (pci >= 25) return 'Very Poor';
  if (pci >= 10) return 'Serious';
  return 'Failed';
}

/**
 * Gets color hex code for PCI visualization
 */
export function getPCIColor(pci: number): string {
  if (pci >= 85) return '#16a34a'; // Dark green - Good
  if (pci >= 70) return '#65a30d'; // Lime green - Satisfactory
  if (pci >= 55) return '#facc15'; // Yellow - Fair
  if (pci >= 40) return '#f97316'; // Orange - Poor
  if (pci >= 25) return '#ea580c'; // Orange-red - Very Poor
  if (pci >= 10) return '#dc2626'; // Red - Serious
  return '#991b1b'; // Dark red - Failed
}
