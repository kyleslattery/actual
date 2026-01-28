/**
 * Balance Projection Logic
 *
 * Projects account balances forward based on scheduled transactions
 * and optional estimated daily spending.
 */

import * as monthUtils from '../months';

import type {
  ProjectionAccount,
  ProjectionSchedule,
  Occurrence,
  DayProjection,
  EnhancedDayProjection,
  CombinedCashDayProjection,
} from './types';

/**
 * Get all occurrences of schedules within a date range.
 * Uses Actual's native schedule logic for recurrence calculation.
 *
 * @param schedules - Schedules to get occurrences for
 * @param startDate - Start of range (YYYY-MM-DD)
 * @param endDate - End of range (YYYY-MM-DD)
 * @param getScheduleOccurrences - Function to get occurrences from Actual's schedule system
 * @returns Array of occurrences sorted by date
 */
export function getAllOccurrences(
  schedules: ProjectionSchedule[],
  startDate: string,
  endDate: string,
  getScheduleOccurrences: (
    scheduleId: string,
    startDate: string,
    endDate: string,
  ) => Array<{ date: string; amount: number }>,
): Occurrence[] {
  const allOccurrences: Occurrence[] = [];

  for (const schedule of schedules) {
    if (schedule.completed) continue;

    const occurrences = getScheduleOccurrences(
      schedule.id,
      startDate,
      endDate,
    );

    for (const occ of occurrences) {
      allOccurrences.push({
        date: occ.date,
        amount: occ.amount,
        schedule,
      });
    }
  }

  return allOccurrences.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Project balances for a single account.
 *
 * @param account - Account to project
 * @param startDate - Start of projection (YYYY-MM-DD)
 * @param endDate - End of projection (YYYY-MM-DD)
 * @param schedules - All schedules (will be filtered to this account)
 * @param getScheduleOccurrences - Function to get schedule occurrences
 * @param additionalOccurrences - Additional occurrences to include (e.g., CC payments)
 * @returns Map of date -> DayProjection
 */
export function projectBalances(
  account: ProjectionAccount,
  startDate: string,
  endDate: string,
  schedules: ProjectionSchedule[],
  getScheduleOccurrences: (
    scheduleId: string,
    startDate: string,
    endDate: string,
  ) => Array<{ date: string; amount: number }>,
  additionalOccurrences: Occurrence[] = [],
): Map<string, DayProjection> {
  const projections = new Map<string, DayProjection>();
  let runningBalance = account.currentBalance;

  // Filter to schedules for this account
  const accountSchedules = schedules.filter(s => s.account === account.id);
  const scheduledOccurrences = getAllOccurrences(
    accountSchedules,
    startDate,
    endDate,
    getScheduleOccurrences,
  );

  // Combine scheduled and additional occurrences, sorted by date
  const allOccurrences = [...scheduledOccurrences, ...additionalOccurrences].sort(
    (a, b) => a.date.localeCompare(b.date),
  );

  // Iterate through each day in the range
  const days = monthUtils.dayRangeInclusive(startDate, endDate);

  for (const date of days) {
    const dayOccurrences = allOccurrences.filter(o => o.date === date);

    for (const occ of dayOccurrences) {
      runningBalance += occ.amount;
    }

    projections.set(date, {
      date,
      balance: runningBalance,
      occurrences: dayOccurrences,
    });
  }

  return projections;
}

/**
 * Project balances for all accounts.
 *
 * @param accounts - Accounts to project
 * @param startDate - Start of projection (YYYY-MM-DD)
 * @param endDate - End of projection (YYYY-MM-DD)
 * @param schedules - All schedules
 * @param getScheduleOccurrences - Function to get schedule occurrences
 * @returns Map of accountId -> (date -> DayProjection)
 */
export function projectAllAccountBalances(
  accounts: ProjectionAccount[],
  startDate: string,
  endDate: string,
  schedules: ProjectionSchedule[],
  getScheduleOccurrences: (
    scheduleId: string,
    startDate: string,
    endDate: string,
  ) => Array<{ date: string; amount: number }>,
): Map<string, Map<string, DayProjection>> {
  const allProjections = new Map<string, Map<string, DayProjection>>();

  for (const account of accounts) {
    const accountProjections = projectBalances(
      account,
      startDate,
      endDate,
      schedules,
      getScheduleOccurrences,
    );
    allProjections.set(account.id, accountProjections);
  }

  return allProjections;
}

/**
 * Get total projected balance across all on-budget accounts for a given date.
 *
 * @param accounts - All accounts
 * @param projections - Projection maps by account
 * @param date - Date to get total for (YYYY-MM-DD)
 * @returns Total balance in cents
 */
export function getTotalProjectedBalance(
  accounts: ProjectionAccount[],
  projections: Map<string, Map<string, DayProjection>>,
  date: string,
): number {
  let total = 0;

  for (const account of accounts) {
    if (account.offbudget) continue;

    const accountProjections = projections.get(account.id);
    if (accountProjections) {
      const dayProjection = accountProjections.get(date);
      if (dayProjection) {
        total += dayProjection.balance;
      } else {
        total += account.currentBalance;
      }
    } else {
      total += account.currentBalance;
    }
  }

  return total;
}

/**
 * Get upcoming transactions for the next N days.
 *
 * @param schedules - All schedules
 * @param getScheduleOccurrences - Function to get schedule occurrences
 * @param days - Number of days to look ahead (default: 14)
 * @returns Array of upcoming occurrences
 */
export function getUpcomingTransactions(
  schedules: ProjectionSchedule[],
  getScheduleOccurrences: (
    scheduleId: string,
    startDate: string,
    endDate: string,
  ) => Array<{ date: string; amount: number }>,
  days: number = 14,
): Occurrence[] {
  const today = monthUtils.currentDay();
  const endDate = monthUtils.addDays(today, days);

  return getAllOccurrences(schedules, today, endDate, getScheduleOccurrences);
}

/**
 * Project balances with estimated daily spending included.
 * Returns both scheduled-only and realistic balances for comparison.
 *
 * @param account - The account to project balances for
 * @param startDate - Start date of projection (YYYY-MM-DD)
 * @param endDate - End date of projection (YYYY-MM-DD)
 * @param schedules - All schedules (will be filtered to this account)
 * @param getScheduleOccurrences - Function to get schedule occurrences
 * @param accountDailySpending - Per-account daily spending estimate in cents (or 0 to disable)
 * @param additionalOccurrences - Additional occurrences to include (e.g., CC payments)
 * @returns Map of date -> EnhancedDayProjection
 */
export function projectRealisticBalances(
  account: ProjectionAccount,
  startDate: string,
  endDate: string,
  schedules: ProjectionSchedule[],
  getScheduleOccurrences: (
    scheduleId: string,
    startDate: string,
    endDate: string,
  ) => Array<{ date: string; amount: number }>,
  accountDailySpending: number = 0,
  additionalOccurrences: Occurrence[] = [],
): Map<string, EnhancedDayProjection> {
  const projections = new Map<string, EnhancedDayProjection>();
  let scheduledOnlyBalance = account.currentBalance;
  let realisticBalance = account.currentBalance;

  // Filter to schedules for this account
  const accountSchedules = schedules.filter(s => s.account === account.id);
  const scheduledOccurrences = getAllOccurrences(
    accountSchedules,
    startDate,
    endDate,
    getScheduleOccurrences,
  );

  // Combine scheduled and additional occurrences, sorted by date
  const allOccurrences = [...scheduledOccurrences, ...additionalOccurrences].sort(
    (a, b) => a.date.localeCompare(b.date),
  );

  const days = monthUtils.dayRangeInclusive(startDate, endDate);
  let isFirstDay = true;

  for (const date of days) {
    const dayOccurrences = allOccurrences.filter(o => o.date === date);

    // Apply scheduled transactions to both projections
    for (const occ of dayOccurrences) {
      scheduledOnlyBalance += occ.amount;
      realisticBalance += occ.amount;
    }

    // Only apply estimated spending for future dates
    // Don't apply on the first day (today) since we have current balance
    const estimatedSpending = isFirstDay ? 0 : accountDailySpending;

    // Apply estimated spending (as expense, so negative)
    realisticBalance -= estimatedSpending;

    projections.set(date, {
      date,
      balance: realisticBalance,
      occurrences: dayOccurrences,
      scheduledOnlyBalance,
      realisticBalance,
      estimatedSpending,
    });

    isFirstDay = false;
  }

  return projections;
}

/**
 * Get low balance days (days where balance drops to or below threshold).
 *
 * @param dailyProjections - Array of day projections
 * @param threshold - Balance threshold in cents (default: 0)
 * @returns Array of projections where balance <= threshold
 */
export function getLowBalanceDays(
  dailyProjections: DayProjection[],
  threshold: number = 0,
): DayProjection[] {
  return dailyProjections.filter(p => p.balance <= threshold);
}

/**
 * Get the day with minimum balance.
 *
 * @param dailyProjections - Array of day projections
 * @returns The projection with minimum balance, or null if empty
 */
export function getMinimumBalance(
  dailyProjections: DayProjection[],
): DayProjection | null {
  if (dailyProjections.length === 0) return null;

  return dailyProjections.reduce((min, current) =>
    current.balance < min.balance ? current : min,
  );
}

/**
 * Generate combined projections for multiple accounts into a single line.
 * Sums daily balances across all included accounts.
 * Supports enhanced projections with spending estimates.
 *
 * @param accounts - Accounts to combine
 * @param startDate - Start of projection period (YYYY-MM-DD)
 * @param endDate - End of projection period (YYYY-MM-DD)
 * @param schedules - All schedules
 * @param getScheduleOccurrences - Function to get schedule occurrences
 * @param accountDailySpending - Per-account daily spending estimates (accountId -> cents/day)
 * @param additionalOccurrences - Global additional occurrences
 * @param additionalOccurrencesByAccount - Per-account additional occurrences
 * @returns Array of combined projections
 */
export function getCombinedProjections(
  accounts: ProjectionAccount[],
  startDate: string,
  endDate: string,
  schedules: ProjectionSchedule[],
  getScheduleOccurrences: (
    scheduleId: string,
    startDate: string,
    endDate: string,
  ) => Array<{ date: string; amount: number }>,
  accountDailySpending?: Map<string, number>,
  additionalOccurrences: Occurrence[] = [],
  additionalOccurrencesByAccount?: Map<string, Occurrence[]>,
): EnhancedDayProjection[] {
  if (accounts.length === 0) {
    return [];
  }

  // Project each account individually
  const accountProjectionMaps = new Map<
    string,
    Map<string, EnhancedDayProjection>
  >();

  for (const account of accounts) {
    const spending = accountDailySpending?.get(account.id) ?? 0;
    // Combine global additional occurrences with per-account occurrences
    const accountSpecificOccurrences =
      additionalOccurrencesByAccount?.get(account.id) ?? [];
    const allAdditionalOccurrences = [
      ...additionalOccurrences,
      ...accountSpecificOccurrences,
    ];

    const projMap = projectRealisticBalances(
      account,
      startDate,
      endDate,
      schedules,
      getScheduleOccurrences,
      spending,
      allAdditionalOccurrences,
    );
    accountProjectionMaps.set(account.id, projMap);
  }

  // Combine projections for each day
  const combinedProjections: EnhancedDayProjection[] = [];
  const days = monthUtils.dayRangeInclusive(startDate, endDate);

  for (const date of days) {
    let totalBalance = 0;
    let totalScheduledOnlyBalance = 0;
    let totalRealisticBalance = 0;
    let totalEstimatedSpending = 0;
    const dayOccurrences: Occurrence[] = [];

    for (const account of accounts) {
      const projMap = accountProjectionMaps.get(account.id);
      if (projMap) {
        const dayProj = projMap.get(date);
        if (dayProj) {
          totalBalance += dayProj.balance;
          totalScheduledOnlyBalance += dayProj.scheduledOnlyBalance;
          totalRealisticBalance += dayProj.realisticBalance;
          totalEstimatedSpending += dayProj.estimatedSpending;
          dayOccurrences.push(...dayProj.occurrences);
        }
      }
    }

    combinedProjections.push({
      date,
      balance: totalBalance,
      occurrences: dayOccurrences,
      scheduledOnlyBalance: totalScheduledOnlyBalance,
      realisticBalance: totalRealisticBalance,
      estimatedSpending: totalEstimatedSpending,
    });
  }

  return combinedProjections;
}

/**
 * Generate combined cash projections with per-type (savings/checking) subtotals.
 * Reuses getCombinedProjections for the base aggregation, then augments each day
 * with savings vs checking breakdowns.
 *
 * @param accounts - All cash accounts (checking + savings only)
 * @param startDate - Start of projection period (YYYY-MM-DD)
 * @param endDate - End of projection period (YYYY-MM-DD)
 * @param schedules - All schedules
 * @param getScheduleOccurrences - Function to get schedule occurrences
 * @param accountDailySpending - Per-account daily spending estimates
 * @param additionalOccurrences - Global additional occurrences (e.g., CC payments on checking)
 * @param additionalOccurrencesByAccount - Per-account additional occurrences
 * @returns Array of combined cash projections with per-type breakdowns
 */
export function getCombinedCashProjections(
  accounts: ProjectionAccount[],
  startDate: string,
  endDate: string,
  schedules: ProjectionSchedule[],
  getScheduleOccurrences: (
    scheduleId: string,
    startDate: string,
    endDate: string,
  ) => Array<{ date: string; amount: number }>,
  accountDailySpending?: Map<string, number>,
  additionalOccurrences: Occurrence[] = [],
  additionalOccurrencesByAccount?: Map<string, Occurrence[]>,
): CombinedCashDayProjection[] {
  if (accounts.length === 0) {
    return [];
  }

  // Get per-type sub-projections
  const savingsAccounts = accounts.filter(a => a.type === 'savings');
  const checkingAccounts = accounts.filter(a => a.type === 'checking');

  const savingsProjections = getCombinedProjections(
    savingsAccounts,
    startDate,
    endDate,
    schedules,
    getScheduleOccurrences,
    accountDailySpending,
    additionalOccurrences,
    additionalOccurrencesByAccount,
  );

  const checkingProjections = getCombinedProjections(
    checkingAccounts,
    startDate,
    endDate,
    schedules,
    getScheduleOccurrences,
    accountDailySpending,
    additionalOccurrences,
    additionalOccurrencesByAccount,
  );

  // Get overall combined projections
  const baseProjections = getCombinedProjections(
    accounts,
    startDate,
    endDate,
    schedules,
    getScheduleOccurrences,
    accountDailySpending,
    additionalOccurrences,
    additionalOccurrencesByAccount,
  );

  // Merge per-type subtotals into each day
  return baseProjections.map((day, i) => ({
    ...day,
    savingsScheduledBalance: savingsProjections[i]?.scheduledOnlyBalance ?? 0,
    savingsRealisticBalance: savingsProjections[i]?.realisticBalance ?? 0,
    checkingScheduledBalance: checkingProjections[i]?.scheduledOnlyBalance ?? 0,
    checkingRealisticBalance: checkingProjections[i]?.realisticBalance ?? 0,
  }));
}
