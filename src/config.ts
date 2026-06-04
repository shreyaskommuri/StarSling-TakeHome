import { ShipClass } from "./types.js";

export interface LearnedConfig {
  frequencyMin: number;
  frequencyRatio: number;
  repeatedMin: number;
  repeatedRatio: number;
  openingMissAbandon: number;
  underperformingMin: number;
  underperformingHitRate: number;
  finalLearnedMin: number;
  finalLearnedRatio: number;
}

export interface TargetedDefenseConfig {
  enabled: boolean;
  opponents: string[];
  minRecords: number;
  dangerWeight: number;
  spacingAdjacentPenalty: number;
  spacingDistanceTwoPenalty: number;
  safePlacement?: boolean;
}

export interface CyclePredictionConfig {
  enabled: boolean;
  minRecords: number;
  minRepeats: number;
  minConfidence: number;
  maxPeriod: number;
}

export interface AgentConfig {
  name: string;
  placementSamples: number;
  learned: LearnedConfig;
  targetedDefense: TargetedDefenseConfig;
  cyclePrediction: CyclePredictionConfig;
}

export const STABLE_713: AgentConfig = {
  name: "stable_713",
  placementSamples: 5000,
  learned: {
    frequencyMin: 3,
    frequencyRatio: 0.5,
    repeatedMin: 2,
    repeatedRatio: 0.5,
    openingMissAbandon: 6,
    underperformingMin: 8,
    underperformingHitRate: 0.35,
    finalLearnedMin: 3,
    finalLearnedRatio: 0.75,
  },
  targetedDefense: {
    enabled: false,
    opponents: [],
    minRecords: 8,
    dangerWeight: 1,
    spacingAdjacentPenalty: 0,
    spacingDistanceTwoPenalty: 0,
  },
  cyclePrediction: {
    enabled: false,
    minRecords: 8,
    minRepeats: 2,
    minConfidence: 0.8,
    maxPeriod: 4,
  },
};

export const CONFIGS: Record<string, AgentConfig> = {
  stable_713: STABLE_713,
  targeted_defense_v1: {
    ...STABLE_713,
    name: "targeted_defense_v1",
    targetedDefense: {
      enabled: true,
      opponents: ["vega-marauder", "polaris-warship", "sirius-dreadnought", "centauri-battlecruiser"],
      minRecords: 10,
      dangerWeight: 0.35,
      spacingAdjacentPenalty: 4,
      spacingDistanceTwoPenalty: 1,
    },
  },
  targeted_defense_quick_abandon: {
    ...STABLE_713,
    name: "targeted_defense_quick_abandon",
    learned: {
      ...STABLE_713.learned,
      openingMissAbandon: 2,
    },
    targetedDefense: {
      enabled: true,
      opponents: ["vega-marauder", "polaris-warship", "sirius-dreadnought", "centauri-battlecruiser"],
      minRecords: 10,
      dangerWeight: 0.35,
      spacingAdjacentPenalty: 4,
      spacingDistanceTwoPenalty: 1,
    },
  },
  targeted_defense_safe: {
    ...STABLE_713,
    name: "targeted_defense_safe",
    targetedDefense: {
      enabled: true,
      opponents: ["vega-marauder", "polaris-warship", "sirius-dreadnought", "centauri-battlecruiser"],
      minRecords: 3,
      dangerWeight: 0.35,
      spacingAdjacentPenalty: 4,
      spacingDistanceTwoPenalty: 1,
      safePlacement: true,
    },
  },
  targeted_defense_v2: {
    ...STABLE_713,
    name: "targeted_defense_v2",
    targetedDefense: {
      enabled: true,
      opponents: ["vega-marauder", "polaris-warship", "sirius-dreadnought", "centauri-battlecruiser"],
      minRecords: 10,
      dangerWeight: 0.25,
      spacingAdjacentPenalty: 3,
      spacingDistanceTwoPenalty: 0.5,
    },
  },
  targeted_defense_v3: {
    ...STABLE_713,
    name: "targeted_defense_v3",
    placementSamples: 15000,
    targetedDefense: {
      enabled: true,
      opponents: ["vega-marauder", "polaris-warship", "sirius-dreadnought", "centauri-battlecruiser"],
      minRecords: 10,
      dangerWeight: 0.35,
      spacingAdjacentPenalty: 4,
      spacingDistanceTwoPenalty: 1,
    },
  },
  targeted_defense_cycle_v1: {
    ...STABLE_713,
    name: "targeted_defense_cycle_v1",
    targetedDefense: {
      enabled: true,
      opponents: ["vega-marauder", "polaris-warship", "sirius-dreadnought", "centauri-battlecruiser"],
      minRecords: 10,
      dangerWeight: 0.35,
      spacingAdjacentPenalty: 4,
      spacingDistanceTwoPenalty: 1,
    },
    cyclePrediction: {
      enabled: true,
      minRecords: 10,
      minRepeats: 2,
      minConfidence: 0.9,
      maxPeriod: 4,
    },
  },
  cycle_predict_v1: {
    ...STABLE_713,
    name: "cycle_predict_v1",
    cyclePrediction: {
      enabled: true,
      minRecords: 10,
      minRepeats: 2,
      minConfidence: 0.85,
      maxPeriod: 4,
    },
  },
};

export function getAgentConfig(name?: string): AgentConfig {
  return CONFIGS[name ?? "targeted_defense_v1"] ?? CONFIGS.targeted_defense_v1;
}

export const SHIP_LENGTHS: Record<ShipClass, number> = {
  CARRIER: 5,
  BATTLESHIP: 4,
  CRUISER: 3,
  SUBMARINE: 3,
  DESTROYER: 2,
};
