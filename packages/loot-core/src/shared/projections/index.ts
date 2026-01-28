/**
 * Cashflow Projections Module
 *
 * This module provides comprehensive cashflow projection functionality:
 * - Balance projections based on scheduled transactions
 * - Estimated daily spending analysis
 * - Credit card payment estimation with billing cycle offset
 * - Safe-to-spend calculations
 * - Monthly cash flow and runway metrics
 * - Reserved balance allocation
 *
 * @example
 * ```typescript
 * import {
 *   projectBalances,
 *   calculateSpendingPattern,
 *   calculateSafeToSpend,
 * } from 'loot-core/src/shared/projections';
 *
 * // Project balances for an account
 * const projections = projectBalances(
 *   account,
 *   startDate,
 *   endDate,
 *   schedules,
 *   getScheduleOccurrences
 * );
 *
 * // Calculate daily spending estimate
 * const pattern = calculateSpendingPattern(
 *   transactions,
 *   excludedCategoryIds,
 *   categoryNameMap,
 *   startDate,
 *   endDate
 * );
 *
 * // Determine safe-to-spend amount
 * const safeToSpend = calculateSafeToSpend(projections, bufferThreshold);
 * ```
 */

// Types
export * from './types';

// Balance Projections
export {
  getAllOccurrences,
  projectBalances,
  projectAllAccountBalances,
  getTotalProjectedBalance,
  getUpcomingTransactions,
  projectRealisticBalances,
  getLowBalanceDays,
  getMinimumBalance,
  getCombinedProjections,
  getCombinedCashProjections,
} from './project-balances';

// Credit Card Payment Estimation
export {
  generateCCPaymentOccurrences,
  generateCCPaymentOccurrencesSync,
} from './cc-payments';

// Spending Analysis
export {
  calculateSpendingPattern,
  calculateAccountDailySpending,
  filterUnscheduledTransactions,
  getDailySpendingForDate,
  getTopCategories,
  estimateSpendingForPeriod,
  type SpendingTransaction,
} from './spending-analysis';

// Safe to Spend
export {
  calculateSafeToSpend,
  calculateSafeToTransfer,
} from './safe-to-spend';

// Reserved Balance Allocation
export {
  calculateReservedAmounts,
  getReservedThreshold,
} from './reserved';

// Cash Flow & Runway
export {
  calculateMonthlyCashFlow,
  calculateCashRunway,
} from './cashflow';
