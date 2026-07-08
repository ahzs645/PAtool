// =============================================================================
// shared/src/purpleairCorrections.ts
//
// PurpleAir PM2.5 correction library, extracted from domain.ts (section 3).
// Barkjohn 2021/2022, EPA AirNow Fire & Smoke Map (Equation 1), Nilson
// 2022/2024, Delp & Singer 2020, and LRAPA 2017 profiles, plus the
// profile registry, regime picker, and the Kelleher 2023 reference fixture.
//
// This module depends on domain.ts only for TYPES (erased at runtime), so the
// runtime import graph stays acyclic: domain.ts imports BARKJOHN_2021_CITATION
// from here and re-exports the rest via `export * from "./purpleairCorrections"`.
// =============================================================================

import type {
  Citation,
  PurpleAirCorrectionInput,
  PurpleAirCorrectionProfile,
  PurpleAirCorrectionProfileId,
  PurpleAirCorrectionResult,
  PurpleAirInputBasis,
  SmokeRegimeKey,
} from "./domain";

export const BARKJOHN_2021_CITATION: Citation = {
  title: "Development and application of a United States-wide correction for PM2.5 data collected with the PurpleAir sensor",
  url: "https://amt.copernicus.org/articles/14/4617/2021/",
  year: 2021,
};

const BARKJOHN_2022_SMOKE_CITATION: Citation = {
  title: "Correction and Accuracy of PurpleAir PM2.5 Measurements for Extreme Wildfire Smoke",
  url: "https://doi.org/10.3390/s22249669",
  year: 2022,
};

const NILSON_2022_CITATION: Citation = {
  title: "Intra-comparison of calibration curves for PurpleAir PM2.5 sensors",
  url: "https://doi.org/10.5194/amt-15-3315-2022",
  year: 2022,
};

const EPA_AIRNOW_FSMAP_CITATION: Citation = {
  title: "EPA AirNow Fire and Smoke Map PM2.5 correction (Holder et al.)",
  url: "https://www.epa.gov/sciencematters/epa-research-improves-air-quality-information-public-airnow-fire-and-smoke-map",
  year: 2023,
};

const NILSON_2024_CITATION: Citation = {
  title: "Calibration of PurpleAir low-cost PM2.5 sensors under high relative humidity",
  url: "https://amt.copernicus.org/articles/17/6735/2024/",
  year: 2024,
};

const DELP_SINGER_2020_CITATION: Citation = {
  title: "Wildfire Smoke Adjustments for Low-Cost Particulate Matter Sensors",
  url: "https://pubs.acs.org/doi/10.1021/acs.est.0c01716",
  year: 2020,
};

const LRAPA_2017_CITATION: Citation = {
  title: "LRAPA PurpleAir adjustment factor",
  url: "https://www.lrapa.org/Documents/Air-Quality/Outdoor%20Sensor%20Performance%20Evaluation.pdf",
  year: 2017,
};

const KELLEHER_2023_CITATION: Citation = {
  title: "Evaluating EPA's correction in dust, winter, and wildfire-smoke conditions (Kelleher et al. 2023)",
  url: "https://amt.copernicus.org/articles/16/1311/2023/",
  year: 2023,
};

function roundNonNegative(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, value).toFixed(digits));
}

/**
 * @equation barkjohn-2021
 * @title Barkjohn 2021 US-wide PurpleAir PM2.5 correction
 * @category Corrections
 * @latex PM_{2.5} = 0.524 \cdot PA_{cf1} - 0.0862 \cdot RH + 5.75
 * @var PA_{cf1} | PurpleAir CF=1 PM2.5 (µg/m³)
 * @var RH | relative humidity (%)
 * @cite Barkjohn, Gantt & Clements 2021, Atmos. Meas. Tech.
 */
function barkjohn2021(pm25Cf1: number, humidity: number | null): number {
  if (humidity === null) {
    throw new Error("Barkjohn 2021 correction requires PurpleAir relative humidity.");
  }
  return roundNonNegative(0.524 * pm25Cf1 - 0.0862 * humidity + 5.75);
}

/**
 * @equation barkjohn-2022-smoke
 * @title Barkjohn 2022 extreme-smoke CF=1 extension
 * @category Corrections
 * @latex PM_{2.5} = 4.21\times10^{-4}\,PA_{cf1}^{2} + 0.392\,PA_{cf1} + 3.44 \quad (PA_{cf1} \ge 611)
 * @var PA_{cf1} | PurpleAir CF=1 PM2.5 (µg/m³)
 * @plain Below 570 uses Barkjohn 2021; 570-611 linearly blends into this quadratic.
 * @cite Barkjohn et al. 2022 (extreme smoke)
 */
function barkjohn2022Smoke(pm25Cf1: number, humidity: number | null): number {
  const quadratic = 4.21e-4 * pm25Cf1 ** 2 + 0.392 * pm25Cf1 + 3.44;
  if (pm25Cf1 >= 611) return roundNonNegative(quadratic);

  const linear = barkjohn2021(pm25Cf1, humidity);
  if (pm25Cf1 < 570) return linear;

  const transition = (pm25Cf1 - 570) / (611 - 570);
  return roundNonNegative(linear * (1 - transition) + quadratic * transition);
}

/**
 * @equation nilson-rh-growth
 * @title Nilson 2022 RH-growth ATM correction
 * @category Corrections
 * @latex PM_{2.5} = \dfrac{PA_{atm}}{1 + \dfrac{0.24}{\frac{100}{RH} - 1}}
 * @var PA_{atm} | PurpleAir ATM PM2.5 (µg/m³)
 * @var RH | relative humidity (%)
 * @cite Nilson et al. 2022
 */
function nilsonRhGrowth(pm25Atm: number, humidity: number | null): number {
  if (humidity === null || humidity <= 0 || humidity >= 100) {
    throw new Error("Nilson RH-growth correction requires relative humidity between 0 and 100.");
  }
  return roundNonNegative(pm25Atm / (1 + 0.24 / (100 / humidity - 1)));
}

/**
 * @equation nilson-polynomial
 * @title Nilson 2022 polynomial ATM + RH correction
 * @category Corrections
 * @latex PM_{2.5} = 0.53\,PA_{atm} + 0.000952\,PA_{atm}^{2} - 0.0914\,RH + 6.3
 * @var PA_{atm} | PurpleAir ATM PM2.5 (µg/m³)
 * @var RH | relative humidity (%)
 * @cite Nilson et al. 2022
 */
function nilsonPolynomial(pm25Atm: number, humidity: number | null): number {
  if (humidity === null) {
    throw new Error("Nilson polynomial correction requires relative humidity.");
  }
  return roundNonNegative(0.53 * pm25Atm + 0.000952 * pm25Atm ** 2 - 0.0914 * humidity + 6.3);
}

// EPA AirNow Fire & Smoke Map US-wide PurpleAir correction. This is the exact
// piecewise form documented as Equation 1 in Barkjohn et al. 2025 ("Air Sensor
// Network Analysis Tool") and applied to the deployed PurpleAir.pm25_corrected
// field served through RSIG/ASNAT. It is the Barkjohn 2021 relationship
// (0.524·PA − 0.0862·RH + 5.75) extended to high smoke loads through five
// continuous segments keyed on the CF=1 PA value: the low-range 0.524 slope
// blends into a 0.786 mid-range slope (30–50), holds through 50–210, then
// blends into a high-smoke quadratic (210–260) while fading out the RH term,
// and finally drops RH entirely above 260 so the curve stays monotonic at
// extreme concentrations. All breakpoints are continuous by construction.
/**
 * @equation airnow-fsmap
 * @title EPA AirNow Fire & Smoke Map US-wide correction (Equation 1)
 * @category Corrections
 * @latex PM_{2.5} = \begin{cases} 0.524\,PA - 0.0862\,RH + 5.75 & PA < 30 \\ [0.786 f + 0.524(1-f)]\,PA - 0.0862\,RH + 5.75,\ f=\tfrac{PA}{20}-\tfrac{3}{2} & 30 \le PA < 50 \\ 0.786\,PA - 0.0862\,RH + 5.75 & 50 \le PA < 210 \\ [0.69 f + 0.786(1-f)]\,PA - 0.0862\,RH(1-f) + 2.966 f + 5.75(1-f) + 8.84\times10^{-4} PA^2 f,\ f=\tfrac{PA}{50}-\tfrac{21}{5} & 210 \le PA < 260 \\ 2.966 + 0.69\,PA + 8.84\times10^{-4}\,PA^2 & PA \ge 260 \end{cases}
 * @var PA | PurpleAir CF=1 PM2.5 (µg/m³)
 * @var RH | relative humidity (%)
 * @plain Barkjohn 2021 extended to high smoke through 5 continuous segments; RH fades out 210-260 and is dropped above 260.
 * @cite Barkjohn et al. 2025 (ASNAT), Atmosphere — Equation 1
 */
function epaAirnowFsmap(pm25Cf1: number, humidity: number | null): number {
  const pa = pm25Cf1;
  const rh = humidity ?? 0; // RH term contributes 0 when humidity is unavailable
  const highQuad = 2.966 + 0.69 * pa + 8.84e-4 * pa ** 2;

  if (pa < 30) return roundNonNegative(0.524 * pa - 0.0862 * rh + 5.75);
  if (pa < 50) {
    const f = pa / 20 - 3 / 2; // 0 at PA=30, 1 at PA=50
    const slope = 0.786 * f + 0.524 * (1 - f);
    return roundNonNegative(slope * pa - 0.0862 * rh + 5.75);
  }
  if (pa < 210) return roundNonNegative(0.786 * pa - 0.0862 * rh + 5.75);
  if (pa < 260) {
    const f = pa / 50 - 21 / 5; // 0 at PA=210, 1 at PA=260
    const slope = 0.69 * f + 0.786 * (1 - f);
    return roundNonNegative(
      slope * pa
        - 0.0862 * rh * (1 - f)
        + 2.966 * f
        + 5.75 * (1 - f)
        + 8.84e-4 * pa ** 2 * f,
    );
  }
  return roundNonNegative(highQuad);
}

// Nilson et al. 2024 (AMT, doi.org/10.5194/amt-17-6735-2024) RH+T
// multilinear correction. Uses temperature in Celsius.
/**
 * @equation nilson-2024
 * @title Nilson 2024 RH + temperature multilinear correction
 * @category Corrections
 * @latex PM_{2.5} = 0.412 \cdot PA_{cf1} - 0.0594 \cdot RH - 0.0314 \cdot T_C + 7.74
 * @var PA_{cf1} | PurpleAir CF=1 PM2.5 (µg/m³)
 * @var RH | relative humidity (%)
 * @var T_C | temperature (°C)
 * @cite Nilson et al. 2024, Atmos. Meas. Tech.
 */
function nilson2024RhTemp(pm25Cf1: number, humidity: number | null, temperatureF?: number | null): number {
  if (humidity === null) {
    throw new Error("Nilson 2024 RH+T correction requires relative humidity.");
  }
  if (temperatureF === undefined || temperatureF === null) {
    throw new Error("Nilson 2024 RH+T correction requires sensor temperature (Fahrenheit).");
  }
  const temperatureC = (temperatureF - 32) * 5 / 9;
  return roundNonNegative(0.412 * pm25Cf1 - 0.0594 * humidity - 0.0314 * temperatureC + 7.74);
}

// Delp & Singer 2020 (Environ. Sci. Technol., doi.org/10.1021/acs.est.0c01716).
// Single-multiplier wildfire override: PM_corrected ≈ 0.48 × PA_atm.
/**
 * @equation delp-singer-2020
 * @title Delp & Singer 2020 wildfire single-multiplier correction
 * @category Corrections
 * @latex PM_{2.5} = 0.48 \cdot PA_{atm}
 * @var PA_{atm} | PurpleAir ATM PM2.5 (µg/m³)
 * @cite Delp & Singer 2020, Environ. Sci. Technol.
 */
function delpSinger2020(pm25Atm: number): number {
  return roundNonNegative(0.48 * pm25Atm);
}

// LRAPA (Lane Regional Air Protection Agency, 2017) simple correction —
// shipped widely in early PA deployments and still used as a baseline
// against newer corrections in places without humidity coverage.
/**
 * @equation lrapa-2017
 * @title LRAPA 2017 PurpleAir correction
 * @category Corrections
 * @latex PM_{2.5} = 0.5 \cdot PA_{atm} - 0.66
 * @var PA_{atm} | PurpleAir ATM PM2.5 (µg/m³)
 * @cite Lane Regional Air Protection Agency 2017
 */
function lrapa2017(pm25Atm: number): number {
  return roundNonNegative(0.5 * pm25Atm - 0.66);
}

export const PURPLEAIR_CORRECTION_PROFILES: Record<PurpleAirCorrectionProfileId, PurpleAirCorrectionProfile> = {
  "epa-barkjohn-2021-cf1": {
    id: "epa-barkjohn-2021-cf1",
    label: "US EPA/Barkjohn 2021 CF=1 + RH correction",
    inputBasis: "cf_1",
    scope: "default-outdoor",
    citation: BARKJOHN_2021_CITATION,
    requiresHumidity: true,
    recommendedRegimes: ["non-smoke", "light-smoke"],
    correct: barkjohn2021,
  },
  "epa-barkjohn-2022-smoke-cf1": {
    id: "epa-barkjohn-2022-smoke-cf1",
    label: "Barkjohn 2022 extreme-smoke CF=1 extension",
    inputBasis: "cf_1",
    scope: "extreme-smoke",
    citation: BARKJOHN_2022_SMOKE_CITATION,
    requiresHumidity: true,
    recommendedRegimes: ["heavy-smoke"],
    correct: barkjohn2022Smoke,
  },
  "epa-airnow-fsmap-cf1": {
    id: "epa-airnow-fsmap-cf1",
    label: "EPA AirNow Fire & Smoke Map US-wide correction (Equation 1)",
    inputBasis: "cf_1",
    scope: "extreme-smoke",
    citation: EPA_AIRNOW_FSMAP_CITATION,
    requiresHumidity: false,
    recommendedRegimes: ["non-smoke", "light-smoke", "moderate-smoke", "heavy-smoke"],
    correct: epaAirnowFsmap,
  },
  "nilson-2022-rh-growth-atm": {
    id: "nilson-2022-rh-growth-atm",
    label: "Nilson 2022 RH-growth ATM correction",
    inputBasis: "atm",
    scope: "advanced",
    citation: NILSON_2022_CITATION,
    requiresHumidity: true,
    correct: nilsonRhGrowth,
  },
  "nilson-2022-polynomial-atm": {
    id: "nilson-2022-polynomial-atm",
    label: "Nilson 2022 polynomial ATM + RH correction",
    inputBasis: "atm",
    scope: "advanced",
    citation: NILSON_2022_CITATION,
    requiresHumidity: true,
    correct: nilsonPolynomial,
  },
  "nilson-2024-rh-temp-cf1": {
    id: "nilson-2024-rh-temp-cf1",
    label: "Nilson 2024 RH+T multilinear CF=1 correction",
    inputBasis: "cf_1",
    scope: "advanced",
    citation: NILSON_2024_CITATION,
    requiresHumidity: true,
    requiresTemperatureF: true,
    recommendedRegimes: ["non-smoke", "light-smoke"],
    correct: nilson2024RhTemp,
  },
  "delp-singer-2020-smoke-atm": {
    id: "delp-singer-2020-smoke-atm",
    label: "Delp & Singer 2020 wildfire ATM × 0.48 multiplier",
    inputBasis: "atm",
    scope: "extreme-smoke",
    citation: DELP_SINGER_2020_CITATION,
    requiresHumidity: false,
    recommendedRegimes: ["heavy-smoke"],
    correct: (pm25Atm) => delpSinger2020(pm25Atm),
  },
  "lrapa-2017-atm": {
    id: "lrapa-2017-atm",
    label: "LRAPA 2017 simple ATM correction",
    inputBasis: "atm",
    scope: "advanced",
    citation: LRAPA_2017_CITATION,
    requiresHumidity: false,
    correct: (pm25Atm) => lrapa2017(pm25Atm),
  },
};

/**
 * Pick a sensible correction profile for the given smoke regime. Falls
 * back to Barkjohn 2021 when the regime is unknown or the requested input
 * basis isn't satisfied by any of the recommended profiles.
 */
export function pickCorrectionProfileForRegime(
  regime: SmokeRegimeKey,
  inputBasis: PurpleAirInputBasis,
): PurpleAirCorrectionProfileId {
  const candidates = (Object.values(PURPLEAIR_CORRECTION_PROFILES) as PurpleAirCorrectionProfile[])
    .filter((profile) => profile.inputBasis === inputBasis)
    .filter((profile) => profile.recommendedRegimes?.includes(regime));
  if (candidates.length > 0) return candidates[0].id;
  return inputBasis === "cf_1" ? "epa-barkjohn-2021-cf1" : "nilson-2022-polynomial-atm";
}

export const PURPLEAIR_CORRECTION_KELLEHER_FIXTURE: ReadonlyArray<{
  scenario: string;
  pm25Cf1: number;
  humidity: number | null;
  temperatureF: number | null;
  expectedReference: number;
  notes: string;
}> = [
  {
    scenario: "winter-urban-cold",
    pm25Cf1: 12,
    humidity: 78,
    temperatureF: 19,
    expectedReference: 8.5,
    notes: "Kelleher 2023 §3 winter case where Barkjohn 2021 over-corrects in cold + high RH.",
  },
  {
    scenario: "dust-event",
    pm25Cf1: 45,
    humidity: 24,
    temperatureF: 88,
    expectedReference: 32,
    notes: "Coarse-mode dust where PA over-reports vs FRM; FSMap variant performs closer to reference.",
  },
  {
    scenario: "wildfire-smoke-heavy",
    pm25Cf1: 320,
    humidity: 31,
    temperatureF: 78,
    expectedReference: 165,
    notes: "Heavy smoke in transition band where Barkjohn 2021 is well below reference; needs extreme-smoke profile.",
  },
];

export const PURPLEAIR_CORRECTION_KELLEHER_CITATION = KELLEHER_2023_CITATION;

export function applyPurpleAirCorrection(input: PurpleAirCorrectionInput): PurpleAirCorrectionResult | null {
  if (typeof input.pm25 !== "number" || !Number.isFinite(input.pm25)) return null;

  const profile = PURPLEAIR_CORRECTION_PROFILES[input.profileId];
  if (!profile) {
    throw new Error(`Unknown PurpleAir correction profile: ${input.profileId}`);
  }
  if (profile.inputBasis !== input.inputBasis) {
    throw new Error(`${profile.label} requires ${profile.inputBasis} input, not ${input.inputBasis}.`);
  }

  const humidity = typeof input.humidity === "number" && Number.isFinite(input.humidity) ? input.humidity : null;
  const temperatureF =
    typeof input.temperatureF === "number" && Number.isFinite(input.temperatureF) ? input.temperatureF : null;
  const pm25Corrected = profile.correct(input.pm25, humidity, temperatureF);
  return {
    profileId: profile.id,
    label: profile.label,
    inputBasis: profile.inputBasis,
    pm25Raw: input.pm25,
    humidity,
    pm25Corrected,
    provenance: "epa-corrected-purpleair",
    citation: profile.citation,
  };
}
