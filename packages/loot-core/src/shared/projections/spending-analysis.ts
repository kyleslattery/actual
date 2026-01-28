/**
 * Spending Pattern Analysis
 *
 * Analyzes historical transactions to calculate typical spending patterns,
 * excluding scheduled transactions to get a picture of "unplanned" spending.
 */

import * as d from 'date-fns';

import * as monthUtils from '../months';

import type { SpendingPattern, CategorySpending } from './types';

/**
 * Transaction data needed for spending analysis.
 */
export interface SpendingTransaction {
  id: string;
  date: string;
  amount: number;
  category?: string;
  transfer_id?: string;
  schedule?: string;
}

/**
 * Calculate average daily spending from historical transactions.
 * Excludes scheduled transactions, transfers, and categories marked as "exclude".
 *
 * @param transactions - Historical transactions to analyze
 * @param excludedCategoryIds - Set of category IDs to exclude from analysis
 * @param categoryNameMap - Map of category ID to name
 * @param startDate - Start of analysis period (YYYY-MM-DD)
 * @param endDate - End of analysis period (YYYY-MM-DD)
 * @returns Spending pattern analysis
 */
export function calculateSpendingPattern(
  transactions: SpendingTransaction[],
  excludedCategoryIds: Set<string>,
  categoryNameMap: Map<string, string>,
  startDate: string,
  endDate: string,
): SpendingPattern {
  const daysAnalyzed = monthUtils.differenceInCalendarDays(endDate, startDate);

  // Filter to expenses only (negative amounts), excluding transfers
  const allExpenses = transactions.filter(
    t => t.amount < 0 && !t.transfer_id,
  );

  // Separate scheduled, excluded, and unscheduled expenses
  const scheduledExpenses = allExpenses.filter(t => t.schedule);
  const excludedExpenses = allExpenses.filter(
    t => !t.schedule && t.category && excludedCategoryIds.has(t.category),
  );
  const unscheduledExpenses = allExpenses.filter(
    t =>
      !t.schedule && (!t.category || !excludedCategoryIds.has(t.category)),
  );

  // Calculate total unscheduled spending
  const totalUnscheduledSpending = unscheduledExpenses.reduce(
    (sum, t) => sum + Math.abs(t.amount),
    0,
  );

  // Calculate spending by day of week
  const byDayOfWeek = new Array(7).fill(0);
  const dayOfWeekCounts = new Array(7).fill(0);

  for (const t of unscheduledExpenses) {
    const date = monthUtils.parseDate(t.date);
    const dayOfWeek = date.getDay();
    byDayOfWeek[dayOfWeek] += Math.abs(t.amount);
    dayOfWeekCounts[dayOfWeek]++;
  }

  // Calculate weeks in the period for averaging
  const weeksInPeriod = daysAnalyzed / 7;
  const avgByDayOfWeek = byDayOfWeek.map(total =>
    Math.round(total / weeksInPeriod),
  );

  // Calculate excluded spending total
  const excludedSpending = excludedExpenses.reduce(
    (sum, t) => sum + Math.abs(t.amount),
    0,
  );

  // Calculate spending by category
  const categoryMap = new Map<
    string,
    { name: string; total: number; count: number }
  >();
  for (const t of unscheduledExpenses) {
    if (t.category) {
      const existing = categoryMap.get(t.category) || {
        name: categoryNameMap.get(t.category) || 'Unknown',
        total: 0,
        count: 0,
      };
      existing.total += Math.abs(t.amount);
      existing.count++;
      categoryMap.set(t.category, existing);
    }
  }

  const byCategory: CategorySpending[] = Array.from(
    categoryMap.entries(),
  ).map(([id, data]) => ({
    categoryId: id,
    categoryName: data.name,
    totalSpent: data.total,
    avgMonthly: Math.round((data.total / daysAnalyzed) * 30),
    avgDaily: Math.round(data.total / daysAnalyzed),
    transactionCount: data.count,
  }));

  return {
    totalUnscheduledSpending,
    avgDailySpending: Math.round(totalUnscheduledSpending / daysAnalyzed),
    daysAnalyzed,
    startDate,
    endDate,
    byCategory,
    byDayOfWeek: avgByDayOfWeek,
    transactionCount: unscheduledExpenses.length,
    scheduledTransactionCount: scheduledExpenses.length,
    excludedTransactionCount: excludedExpenses.length,
    excludedSpending,
  };
}

/**
 * Calculate average daily spending for a specific account.
 * Excludes transfers, scheduled transactions, and excluded category groups.
 * Works for any account type (checking, credit card, etc.)
 *
 * @param transactions - Transactions for this account
 * @param excludedCategoryIds - Set of category IDs to exclude
 * @param daysToAnalyze - Number of days in the analysis period
 * @returns Daily spending estimate in cents
 */
export function calculateAccountDailySpending(
  transactions: SpendingTransaction[],
  excludedCategoryIds: Set<string>,
  daysToAnalyze: number,
): { dailySpending: number; totalSpending: number; transactionCount: number } {
  // Filter to expenses only (negative amounts), excluding:
  // - transfers
  // - scheduled transactions
  // - transactions in excluded category groups
  const spending = transactions.filter(
    t =>
      t.amount < 0 &&
      !t.transfer_id &&
      !t.schedule &&
      (!t.category || !excludedCategoryIds.has(t.category)),
  );

  // Sum is negative, so we take absolute value
  const totalSpending = Math.abs(
    spending.reduce((sum, t) => sum + t.amount, 0),
  );

  // Use actual elapsed days since the earliest transaction (capped to the lookback window)
  // to avoid underestimating spending on newer accounts
  let effectiveDays = daysToAnalyze;
  if (spending.length > 0) {
    const earliest = spending.reduce(
      (min, t) => (t.date < min ? t.date : min),
      spending[0].date,
    );
    const daysSinceFirst = monthUtils.differenceInCalendarDays(
      monthUtils.currentDay(),
      earliest,
    );
    effectiveDays = Math.min(daysToAnalyze, Math.max(1, daysSinceFirst));
  }

  const dailySpending = Math.round(totalSpending / effectiveDays);

  return {
    dailySpending,
    totalSpending,
    transactionCount: spending.length,
  };
}

/**
 * Get transactions that are not linked to schedules.
 * These represent "unplanned" or irregular spending.
 *
 * @param transactions - All transactions
 * @returns Filtered transactions without schedules or transfers
 */
export function filterUnscheduledTransactions(
  transactions: SpendingTransaction[],
): SpendingTransaction[] {
  return transactions.filter(t => !t.schedule && !t.transfer_id);
}

/**
 * Calculate a weighted daily spending estimate that accounts for
 * day-of-week patterns (e.g., higher weekend spending).
 *
 * @param pattern - Spending pattern with day-of-week data
 * @param date - Date to get estimate for (YYYY-MM-DD)
 * @returns Estimated spending for that day in cents
 */
export function getDailySpendingForDate(
  pattern: SpendingPattern,
  date: string,
): number {
  const parsedDate = monthUtils.parseDate(date);
  const dayOfWeek = parsedDate.getDay();
  const dayOfWeekAvg = pattern.byDayOfWeek[dayOfWeek];

  // If we have day-of-week data, use it; otherwise fall back to overall average
  if (dayOfWeekAvg > 0) {
    return dayOfWeekAvg;
  }

  return pattern.avgDailySpending;
}

/**
 * Get the top spending categories.
 *
 * @param spending - Array of category spending data
 * @param limit - Maximum number of categories to return (default: 5)
 * @returns Top categories sorted by total spent
 */
export function getTopCategories(
  spending: CategorySpending[],
  limit: number = 5,
): CategorySpending[] {
  return [...spending]
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, limit);
}

/**
 * Calculate estimated spending for a date range.
 * Can optionally use day-of-week weighting.
 *
 * @param pattern - Spending pattern data
 * @param days - Number of days to estimate
 * @param useDayOfWeekWeighting - Whether to use day-specific rates
 * @returns Estimated total spending in cents
 */
export function estimateSpendingForPeriod(
  pattern: SpendingPattern,
  days: number,
  useDayOfWeekWeighting: boolean = false,
): number {
  if (!useDayOfWeekWeighting) {
    return pattern.avgDailySpending * days;
  }

  // When weighting is enabled, calculate based on typical weekly pattern
  const fullWeeks = Math.floor(days / 7);
  const remainingDays = days % 7;

  const weeklyTotal = pattern.byDayOfWeek.reduce((sum, day) => sum + day, 0);
  let total = fullWeeks * weeklyTotal;

  // Add remaining days starting from today's day of week
  const today = d.getDay(new Date());
  for (let i = 0; i < remainingDays; i++) {
    const dayIndex = (today + i) % 7;
    total += pattern.byDayOfWeek[dayIndex];
  }

  return total;
}
