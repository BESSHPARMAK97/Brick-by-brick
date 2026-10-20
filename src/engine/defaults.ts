import type { CalendarSettings, ProjectInput, WorkGroupId } from './types';

export const ALL_GROUPS: WorkGroupId[] = [
  'monolith', 'masonry', 'facade', 'roofing', 'waterproofing', 'mep',
  'plaster_screed', 'tiling', 'painting', 'flooring', 'landscaping',
];

export function defaultCalendar(): CalendarSettings {
  return {
    regime: '6/1',
    shiftsPerDay: 1,
    shiftHours: 8,
    observeHolidays: true,
    preHolidayShorteningHours: 0,
    extraNonWorking: [],
    extraWorking: [],
  };
}

function perGroup(v: number): Record<WorkGroupId, number> {
  return Object.fromEntries(ALL_GROUPS.map((g) => [g, v])) as Record<WorkGroupId, number>;
}

/**
 * Исходные данные по умолчанию (минимальный ввод: ЖК, Астана, монолит, 15 этажей).
 * Все численные параметры ресурсов и технологии ниже — СЦЕНАРНЫЕ и выводятся
 * в отчёте допущений; пользователь подтверждает или меняет их на шаге 3.
 */
export function createDefaultInput(patch: Partial<ProjectInput> = {}): ProjectInput {
  const base: ProjectInput = {
    schemaVersion: 1,
    name: 'ЖК, Астана — монолит 15 этажей',
    objectType: 'residential',
    city: 'astana',
    startDate: '2027-04-05',
    workGroups: ['monolith'],
    buildings: [
      {
        id: 'B1',
        name: 'Корпус 1',
        sections: [
          { id: 'S1', name: 'Секция 1', floors: 15, basementFloors: 1, zonesPerFloor: 1, floorArea: 600, slabSpanM: 6 },
        ],
      },
    ],
    calendar: defaultCalendar(),
    groupCalendars: {},
    resources: {
      crews: perGroup(1),
      crewsPerOperation: perGroup(1),
      cranesPerSection: 1,
      pumps: 1,
      concreteSupplyM3PerDay: 300,
      slabFormworkSets: 2,
      wallFormworkSets: 1,
      maxTradesPerFloor: 2,
      unavailability: [],
    },
    technology: {
      concreteClassMPa: 25,
      cementS: 0.25,
      verticalStripMPa: 0.3,
      slabStripPercent: null,
      walkStrengthMPa: 1.5,
      winterCuringTempC: 15,
      winterMeasuresIncludedInRates: false,
      masonryLagFloors: 2,
      facadeType: 'ventilated',
      temporaryHeating: true,
      enclosureForExternalWorks: false,
      projectBufferDays: 0,
    },
    overrides: {},
    constraints: [],
    forecast: null,
    strongWind: null,
    deadline: null,
    craneWindLimitMs: 15,
    confirmedParams: [],
  };
  return { ...base, ...patch };
}

/** Глубокая копия входных данных (структуры только из JSON-типов). */
export function cloneInput(input: ProjectInput): ProjectInput {
  return JSON.parse(JSON.stringify(input)) as ProjectInput;
}
