import { vi, describe, it, expect } from 'vitest';

import { calculateSafeToSpend, calculateSafeToTransfer } from '../safe-to-spend';
import type { EnhancedDayProjection } from '../types';

// Mock the months module
vi.mock('../../months', async () => {
  const actual = await vi.importActual('../../months');
  return {
    ...actual,
    currentDay: () => '2024-01-15',
  };
});

describe('calculateSafeToSpend', () => {
  const createProjection = (
    date: string,
    realisticBalance: number,
  ): EnhancedDayProjection => ({
    date,
    balance: realisticBalance,
    occurrences: [],
    scheduledOnlyBalance: realisticBalance + 10000,
    realisticBalance,
    estimatedSpending: 5000,
  });

  it('should calculate safe-to-spend as min balance minus buffer', () => {
    const projections = [
      createProjection('2024-01-15', 500000),
      createProjection('2024-01-16', 400000),
      createProjection('2024-01-17', 300000), // minimum
      createProjection('2024-01-18', 350000),
    ];

    const bufferThreshold = 100000; // $1,000

    const result = calculateSafeToSpend(projections, bufferThreshold);

    expect(result.amount).toBe(200000); // 300000 - 100000
    expect(result.minBalance).toBe(300000);
    expect(result.minBalanceDate).toBe('2024-01-17');
    expect(result.bufferThreshold).toBe(100000);
    expect(result.level).toBe('plenty'); // 200000 > 50000 (comfortable threshold)
  });

  it('should return overextended level when amount is negative', () => {
    const projections = [
      createProjection('2024-01-15', 100000),
      createProjection('2024-01-16', 50000), // minimum
      createProjection('2024-01-17', 80000),
    ];

    const bufferThreshold = 100000;

    const result = calculateSafeToSpend(projections, bufferThreshold);

    expect(result.amount).toBe(-50000); // 50000 - 100000
    expect(result.level).toBe('overextended');
  });

  it('should return tight level for small positive amounts', () => {
    const projections = [
      createProjection('2024-01-15', 105000), // minimum
    ];

    const bufferThreshold = 100000;

    const result = calculateSafeToSpend(projections, bufferThreshold);

    expect(result.amount).toBe(5000); // 105000 - 100000
    expect(result.level).toBe('tight'); // < 10000
  });

  it('should return comfortable level for medium amounts', () => {
    const projections = [
      createProjection('2024-01-15', 130000), // minimum
    ];

    const bufferThreshold = 100000;

    const result = calculateSafeToSpend(projections, bufferThreshold);

    expect(result.amount).toBe(30000); // 130000 - 100000
    expect(result.level).toBe('comfortable'); // >= 10000 and < 50000
  });

  it('should handle empty projections', () => {
    const result = calculateSafeToSpend([], 100000);

    expect(result.amount).toBe(0);
    expect(result.daysInHorizon).toBe(0);
    expect(result.level).toBe('overextended');
  });

  it('should calculate correct days in horizon', () => {
    const projections = [
      createProjection('2024-01-15', 500000),
      createProjection('2024-01-16', 400000),
      createProjection('2024-01-17', 300000),
      createProjection('2024-01-18', 350000),
      createProjection('2024-01-19', 400000),
    ];

    const result = calculateSafeToSpend(projections, 100000);

    expect(result.daysInHorizon).toBe(5); // 19 - 15 + 1
  });
});

describe('calculateSafeToTransfer', () => {
  const createProjection = (
    date: string,
    realisticBalance: number,
  ): EnhancedDayProjection => ({
    date,
    balance: realisticBalance,
    occurrences: [],
    scheduledOnlyBalance: realisticBalance,
    realisticBalance,
    estimatedSpending: 0,
  });

  it('should calculate amount safe to transfer from checking', () => {
    const projections = [
      createProjection('2024-01-15', 500000),
      createProjection('2024-01-16', 400000),
      createProjection('2024-01-17', 350000), // minimum
      createProjection('2024-01-18', 400000),
    ];

    const bufferThreshold = 200000;

    const result = calculateSafeToTransfer(projections, bufferThreshold);

    expect(result).toBe(150000); // 350000 - 200000
  });

  it('should return 0 when min balance is below buffer', () => {
    const projections = [
      createProjection('2024-01-15', 100000), // minimum, below buffer
    ];

    const bufferThreshold = 200000;

    const result = calculateSafeToTransfer(projections, bufferThreshold);

    expect(result).toBe(0); // clamped to 0
  });

  it('should return 0 for empty projections', () => {
    const result = calculateSafeToTransfer([], 100000);
    expect(result).toBe(0);
  });
});
