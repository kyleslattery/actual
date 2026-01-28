import { vi, describe, it, expect } from 'vitest';

import {
  projectBalances,
  projectRealisticBalances,
  getCombinedProjections,
  getLowBalanceDays,
  getMinimumBalance,
} from '../project-balances';
import type { ProjectionAccount, ProjectionSchedule } from '../types';

// Mock the months module to use predictable dates
vi.mock('../../months', async () => {
  const actual = await vi.importActual('../../months');
  return {
    ...actual,
    currentDay: () => '2024-01-15',
  };
});

describe('projectBalances', () => {
  const mockAccount: ProjectionAccount = {
    id: 'acct-1',
    name: 'Checking',
    type: 'checking',
    isPrimary: true,
    offbudget: false,
    closed: false,
    currentBalance: 500000, // $5,000 in cents
  };

  const mockSchedule: ProjectionSchedule = {
    id: 'sched-1',
    name: 'Rent',
    account: 'acct-1',
    amount: -150000, // -$1,500
    nextDate: '2024-01-20',
    completed: false,
  };

  // Simple mock that returns one occurrence on the nextDate
  const mockGetScheduleOccurrences = (
    scheduleId: string,
    startDate: string,
    endDate: string,
  ) => {
    if (scheduleId === 'sched-1') {
      // Check if the schedule's next date is within the range
      if ('2024-01-20' >= startDate && '2024-01-20' <= endDate) {
        return [{ date: '2024-01-20', amount: -150000 }];
      }
    }
    return [];
  };

  it('should project balance forward with scheduled transactions', () => {
    const projections = projectBalances(
      mockAccount,
      '2024-01-15',
      '2024-01-25',
      [mockSchedule],
      mockGetScheduleOccurrences,
    );

    // Day before rent: balance unchanged
    expect(projections.get('2024-01-19')?.balance).toBe(500000);

    // Day of rent: balance reduced
    expect(projections.get('2024-01-20')?.balance).toBe(350000);
    expect(projections.get('2024-01-20')?.occurrences).toHaveLength(1);
    expect(projections.get('2024-01-20')?.occurrences[0].amount).toBe(-150000);

    // After rent: balance stays at new level
    expect(projections.get('2024-01-25')?.balance).toBe(350000);
  });

  it('should include additional occurrences', () => {
    const additionalOccurrences = [
      {
        date: '2024-01-18',
        amount: -50000, // -$500
        schedule: {
          id: 'synthetic-1',
          name: 'CC Payment',
          account: 'acct-1',
          amount: -50000,
          nextDate: '',
          completed: false,
        },
        isEstimate: true,
      },
    ];

    const projections = projectBalances(
      mockAccount,
      '2024-01-15',
      '2024-01-25',
      [mockSchedule],
      mockGetScheduleOccurrences,
      additionalOccurrences,
    );

    // After additional occurrence
    expect(projections.get('2024-01-18')?.balance).toBe(450000);
    expect(projections.get('2024-01-18')?.occurrences).toHaveLength(1);

    // After both rent and CC payment
    expect(projections.get('2024-01-25')?.balance).toBe(300000);
  });

  it('should filter schedules to the account', () => {
    const otherAccountSchedule: ProjectionSchedule = {
      id: 'sched-2',
      name: 'Other Account Bill',
      account: 'acct-other',
      amount: -100000,
      nextDate: '2024-01-18',
      completed: false,
    };

    const projections = projectBalances(
      mockAccount,
      '2024-01-15',
      '2024-01-25',
      [mockSchedule, otherAccountSchedule],
      mockGetScheduleOccurrences,
    );

    // Other account's schedule should not affect this account
    expect(projections.get('2024-01-18')?.balance).toBe(500000);
  });
});

describe('projectRealisticBalances', () => {
  const mockAccount: ProjectionAccount = {
    id: 'acct-1',
    name: 'Checking',
    type: 'checking',
    isPrimary: true,
    offbudget: false,
    closed: false,
    currentBalance: 500000, // $5,000
  };

  const mockGetScheduleOccurrences = () => [];

  it('should apply daily spending estimate to realistic balance', () => {
    const dailySpending = 5000; // $50/day

    const projections = projectRealisticBalances(
      mockAccount,
      '2024-01-15',
      '2024-01-20', // 6 days
      [],
      mockGetScheduleOccurrences,
      dailySpending,
    );

    // First day: no spending applied (we have current balance)
    const firstDay = projections.get('2024-01-15')!;
    expect(firstDay.scheduledOnlyBalance).toBe(500000);
    expect(firstDay.realisticBalance).toBe(500000);
    expect(firstDay.estimatedSpending).toBe(0);

    // Second day: spending applied
    const secondDay = projections.get('2024-01-16')!;
    expect(secondDay.scheduledOnlyBalance).toBe(500000);
    expect(secondDay.realisticBalance).toBe(495000); // 500000 - 5000
    expect(secondDay.estimatedSpending).toBe(5000);

    // Last day: 5 days of spending applied
    const lastDay = projections.get('2024-01-20')!;
    expect(lastDay.scheduledOnlyBalance).toBe(500000);
    expect(lastDay.realisticBalance).toBe(475000); // 500000 - (5 * 5000)
  });

  it('should combine scheduled transactions with spending estimate', () => {
    const mockSchedule: ProjectionSchedule = {
      id: 'sched-1',
      name: 'Paycheck',
      account: 'acct-1',
      amount: 200000, // +$2,000
      nextDate: '2024-01-18',
      completed: false,
    };

    const mockGetOccurrences = (scheduleId: string) => {
      if (scheduleId === 'sched-1') {
        return [{ date: '2024-01-18', amount: 200000 }];
      }
      return [];
    };

    const dailySpending = 5000;

    const projections = projectRealisticBalances(
      mockAccount,
      '2024-01-15',
      '2024-01-20',
      [mockSchedule],
      mockGetOccurrences,
      dailySpending,
    );

    // After paycheck
    const paycheckDay = projections.get('2024-01-18')!;
    expect(paycheckDay.scheduledOnlyBalance).toBe(700000); // 500000 + 200000
    // Realistic: 500000 + 200000 - (3 * 5000) = 685000
    expect(paycheckDay.realisticBalance).toBe(685000);
  });
});

describe('getLowBalanceDays', () => {
  it('should find days where balance drops below threshold', () => {
    const projections = [
      { date: '2024-01-15', balance: 500000, occurrences: [] },
      { date: '2024-01-16', balance: 200000, occurrences: [] },
      { date: '2024-01-17', balance: -50000, occurrences: [] }, // negative
      { date: '2024-01-18', balance: 0, occurrences: [] },
      { date: '2024-01-19', balance: 100000, occurrences: [] },
    ];

    const lowDays = getLowBalanceDays(projections, 100000);

    expect(lowDays).toHaveLength(3);
    expect(lowDays.map(d => d.date)).toEqual([
      '2024-01-17',
      '2024-01-18',
      '2024-01-19',
    ]);
  });

  it('should return empty array if no low balance days', () => {
    const projections = [
      { date: '2024-01-15', balance: 500000, occurrences: [] },
      { date: '2024-01-16', balance: 400000, occurrences: [] },
    ];

    const lowDays = getLowBalanceDays(projections, 0);
    expect(lowDays).toHaveLength(0);
  });
});

describe('getMinimumBalance', () => {
  it('should find the day with minimum balance', () => {
    const projections = [
      { date: '2024-01-15', balance: 500000, occurrences: [] },
      { date: '2024-01-16', balance: 200000, occurrences: [] },
      { date: '2024-01-17', balance: -50000, occurrences: [] },
      { date: '2024-01-18', balance: 100000, occurrences: [] },
    ];

    const min = getMinimumBalance(projections);

    expect(min?.date).toBe('2024-01-17');
    expect(min?.balance).toBe(-50000);
  });

  it('should return null for empty array', () => {
    expect(getMinimumBalance([])).toBeNull();
  });
});

describe('getCombinedProjections', () => {
  const checkingAccount: ProjectionAccount = {
    id: 'checking-1',
    name: 'Checking',
    type: 'checking',
    isPrimary: true,
    offbudget: false,
    closed: false,
    currentBalance: 500000,
  };

  const savingsAccount: ProjectionAccount = {
    id: 'savings-1',
    name: 'Savings',
    type: 'savings',
    isPrimary: false,
    offbudget: false,
    closed: false,
    currentBalance: 1000000,
  };

  const mockGetScheduleOccurrences = () => [];

  it('should combine balances from multiple accounts', () => {
    const combined = getCombinedProjections(
      [checkingAccount, savingsAccount],
      '2024-01-15',
      '2024-01-17',
      [],
      mockGetScheduleOccurrences,
    );

    expect(combined).toHaveLength(3);
    expect(combined[0].scheduledOnlyBalance).toBe(1500000);
    expect(combined[0].realisticBalance).toBe(1500000);
  });

  it('should apply per-account spending estimates', () => {
    const accountDailySpending = new Map([
      ['checking-1', 5000], // $50/day on checking
      ['savings-1', 0], // No spending from savings
    ]);

    const combined = getCombinedProjections(
      [checkingAccount, savingsAccount],
      '2024-01-15',
      '2024-01-17',
      [],
      mockGetScheduleOccurrences,
      accountDailySpending,
    );

    // First day: no spending
    expect(combined[0].realisticBalance).toBe(1500000);

    // Second day: $50 from checking
    expect(combined[1].realisticBalance).toBe(1495000);

    // Third day: another $50
    expect(combined[2].realisticBalance).toBe(1490000);
  });

  it('should return empty array for no accounts', () => {
    const combined = getCombinedProjections(
      [],
      '2024-01-15',
      '2024-01-17',
      [],
      mockGetScheduleOccurrences,
    );

    expect(combined).toHaveLength(0);
  });
});
