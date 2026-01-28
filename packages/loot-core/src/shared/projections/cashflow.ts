/**
 * Cash Flow and Runway Calculations
 *
 * Provides monthly cash flow analysis and runway calculations for financial planning.
 */

import * as monthUtils from '../months';

import { getAllOccurrences } from './project-balances';
import type {
  ProjectionAccount,
  ProjectionSchedule,
  MonthlyCashFlow,
  CashFlowLineItem,
  CashRunway,
  ReservedCalculation,
} from './types';
import { RUNWAY_THRESHOLDS } from './types';

/**
 * Calculate monthly cash flow for upcoming months.
 *
 * @param schedules - All active schedules (with category info from template notes)
 * @param getScheduleOccurrences - Function to get schedule occurrences
 * @param avgDailySpending - Average daily spending estimate (in cents)
 * @param excludedCategoryIds - Set of category IDs that are excluded (savings, insurance, etc.)
 * @param months - Number of months to project (default: 6)
 * @returns Array of monthly cash flow summaries
 */
export function calculateMonthlyCashFlow(
  schedules: ProjectionSchedule[],
  getScheduleOccurrences: (
    scheduleId: string,
    startDate: string,
    endDate: string,
  ) => Array<{ date: string; amount: number }>,
  avgDailySpending: number,
  excludedCategoryIds: Set<string>,
  months: number = 6,
): MonthlyCashFlow[] {
  const result: MonthlyCashFlow[] = [];
  const today = monthUtils.currentDay();

  for (let i = 0; i < months; i++) {
    const monthDate = monthUtils.addMonths(today, i);
    const monthStart = i === 0 ? today : monthUtils.firstDayOfMonth(monthDate);
    const monthEnd = monthUtils.lastDayOfMonth(monthDate);
    const daysInMonth =
      monthUtils.differenceInCalendarDays(monthEnd, monthStart) + 1;

    // Get all occurrences in this month
    const occurrences = getAllOccurrences(
      schedules,
      monthStart,
      monthEnd,
      getScheduleOccurrences,
    );

    // Separate income (positive) from expenses (negative)
    // Also track excluded expenses separately
    let income = 0;
    let scheduledExpenses = 0;
    let excludedScheduledExpenses = 0;
    const incomeItems: CashFlowLineItem[] = [];
    const scheduledItems: CashFlowLineItem[] = [];
    const excludedItems: CashFlowLineItem[] = [];

    for (const occ of occurrences) {
      const item: CashFlowLineItem = {
        name: occ.schedule.name,
        amount: occ.amount,
        date: occ.date,
      };

      if (occ.amount > 0) {
        income += occ.amount;
        incomeItems.push(item);
      } else {
        const expenseAmount = Math.abs(occ.amount);
        // Check if this schedule is in an excluded category
        const isExcluded =
          occ.schedule.category &&
          excludedCategoryIds.has(occ.schedule.category);
        if (isExcluded) {
          excludedScheduledExpenses += expenseAmount;
          excludedItems.push(item);
        } else {
          scheduledExpenses += expenseAmount;
          scheduledItems.push(item);
        }
      }
    }

    // Calculate estimated unscheduled spending
    const estimatedSpending = avgDailySpending * daysInMonth;

    // Net = Income - All Scheduled Expenses - Estimated Spending
    // (excluded expenses still affect cash flow, just not runway)
    const net =
      income - scheduledExpenses - excludedScheduledExpenses - estimatedSpending;

    result.push({
      month: monthStart,
      monthLabel: monthUtils.format(monthStart, 'MMMM yyyy'),
      income,
      incomeItems,
      scheduledExpenses,
      scheduledItems,
      excludedScheduledExpenses,
      excludedItems,
      estimatedSpending: Math.round(estimatedSpending),
      daysInMonth,
      dailySpendingRate: avgDailySpending,
      net: Math.round(net),
    });
  }

  return result;
}

/**
 * Calculate cash runway - how many months of expenses are covered by liquid cash.
 *
 * @param accounts - All accounts with balances
 * @param reservedCalculation - Reserved amount allocations
 * @param monthlyCashFlow - Monthly cash flow data (for average expenses)
 * @returns Cash runway calculation
 */
export function calculateCashRunway(
  accounts: ProjectionAccount[],
  reservedCalculation: ReservedCalculation,
  monthlyCashFlow: MonthlyCashFlow[],
): CashRunway {
  // Calculate liquid cash (checking + savings)
  const liquidCash = accounts
    .filter(a => a.type === 'checking' || a.type === 'savings')
    .reduce((sum, a) => sum + a.currentBalance, 0);

  // Get reserved amount
  const reservedAmount = reservedCalculation.totalExcludedBalance;

  // Available cash = liquid - reserved
  const availableCash = Math.max(0, liquidCash - reservedAmount);

  // Calculate average monthly expenses from cash flow data
  // Skip the first month (partial) and average the rest
  // IMPORTANT: Exclude "excluded" scheduled expenses (e.g., insurance, savings)
  // because those reduce the reserved amount, not available cash
  const fullMonths = monthlyCashFlow.slice(1);
  const avgMonthlyExpenses =
    fullMonths.length > 0
      ? fullMonths.reduce(
          (sum, m) => sum + m.scheduledExpenses + m.estimatedSpending,
          0,
        ) / fullMonths.length
      : (monthlyCashFlow[0]?.scheduledExpenses ?? 0) +
        (monthlyCashFlow[0]?.estimatedSpending ?? 0);

  // Calculate runway in months
  const runwayMonths =
    avgMonthlyExpenses > 0 ? availableCash / avgMonthlyExpenses : Infinity;

  // Determine level based on runway
  let level: CashRunway['level'];
  if (runwayMonths < RUNWAY_THRESHOLDS.critical) {
    level = 'critical';
  } else if (runwayMonths < RUNWAY_THRESHOLDS.warning) {
    level = 'warning';
  } else if (runwayMonths < RUNWAY_THRESHOLDS.good) {
    level = 'good';
  } else {
    level = 'excellent';
  }

  return {
    liquidCash,
    reservedAmount,
    availableCash,
    avgMonthlyExpenses: Math.round(avgMonthlyExpenses),
    runwayMonths: Math.round(runwayMonths * 10) / 10, // Round to 1 decimal
    level,
  };
}
