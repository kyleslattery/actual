/**
 * Projection Types
 *
 * Type definitions for cashflow projections, spending analysis, and financial metrics.
 * These types are used throughout the projections module.
 */

import type { AccountEntity } from '../../types/models/account';
import type { CategoryEntity } from '../../types/models/category';
import type { ScheduleEntity } from '../../types/models/schedule';
import type { TransactionEntity } from '../../types/models/transaction';

// Re-export commonly used entity types for convenience
export type { AccountEntity, CategoryEntity, ScheduleEntity, TransactionEntity };

/**
 * Account type for projection purposes.
 * Actual Budget doesn't have a built-in account type field, so this is
 * determined via account metadata or settings.
 */
export type ProjectionAccountType =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'investment'
  | 'other';

/**
 * Extended account entity with projection-specific fields.
 * Adds type classification and primary flag for projections.
 */
export interface ProjectionAccount {
  id: AccountEntity['id'];
  name: string;
  type: ProjectionAccountType;
  /** Whether this is the primary checking account for CC payment projections */
  isPrimary: boolean;
  offbudget: boolean;
  closed: boolean;
  /** Current balance in cents (integer) */
  currentBalance: number;
}

/**
 * Simplified schedule representation for projections.
 * Extracts the fields we need from ScheduleEntity.
 */
export interface ProjectionSchedule {
  id: ScheduleEntity['id'];
  name: string;
  /** Account ID this schedule applies to */
  account: AccountEntity['id'];
  /** Amount in cents (negative for expenses, positive for income) */
  amount: number;
  /** Next scheduled date (YYYY-MM-DD string) */
  nextDate: string;
  /** Whether the schedule has been completed */
  completed: boolean;
  /** Category ID if known (for excluded category filtering) */
  category?: CategoryEntity['id'];
}

/**
 * A single occurrence of a scheduled transaction.
 * Represents when a schedule will hit and for how much.
 */
export interface Occurrence {
  /** Date of the occurrence (YYYY-MM-DD string) */
  date: string;
  /** Amount in cents */
  amount: number;
  /** The schedule that generated this occurrence */
  schedule: ProjectionSchedule;
  /** Whether this is an estimated (synthetic) occurrence */
  isEstimate?: boolean;
  /** Label for estimates (e.g., "Est. CC Payment: Chase") */
  estimateLabel?: string;
}

/**
 * Projection data for a single day.
 * Contains the balance and any transactions occurring that day.
 */
export interface DayProjection {
  /** Date of this projection (YYYY-MM-DD string) */
  date: string;
  /** Projected balance at end of day in cents */
  balance: number;
  /** Scheduled occurrences on this day */
  occurrences: Occurrence[];
}

/**
 * Enhanced projection with both scheduled-only and realistic (with spending estimate) balances.
 */
export interface EnhancedDayProjection extends DayProjection {
  /** Balance considering only scheduled transactions */
  scheduledOnlyBalance: number;
  /** Balance including estimated daily spending */
  realisticBalance: number;
  /** Estimated spending applied this day (in cents) */
  estimatedSpending: number;
}

/**
 * Combined cash projection with per-account-type breakdowns.
 * Used for stacked charts showing savings vs checking.
 */
export interface CombinedCashDayProjection extends EnhancedDayProjection {
  savingsScheduledBalance: number;
  savingsRealisticBalance: number;
  checkingScheduledBalance: number;
  checkingRealisticBalance: number;
}

// =============================================================================
// Spending Analysis Types
// =============================================================================

/**
 * Spending breakdown for a single category.
 */
export interface CategorySpending {
  categoryId: CategoryEntity['id'];
  categoryName: string;
  /** Total spent in cents over the analysis period */
  totalSpent: number;
  /** Average monthly spending in cents */
  avgMonthly: number;
  /** Average daily spending in cents */
  avgDaily: number;
  /** Number of transactions in this category */
  transactionCount: number;
}

/**
 * Complete spending pattern analysis result.
 * Used to estimate future unscheduled spending.
 */
export interface SpendingPattern {
  /** Total unscheduled spending in cents */
  totalUnscheduledSpending: number;
  /** Average daily spending in cents */
  avgDailySpending: number;
  /** Number of days analyzed */
  daysAnalyzed: number;
  /** Start of analysis period (YYYY-MM-DD) */
  startDate: string;
  /** End of analysis period (YYYY-MM-DD) */
  endDate: string;
  /** Spending breakdown by category */
  byCategory: CategorySpending[];
  /** Average spending by day of week (index 0 = Sunday, amounts in cents) */
  byDayOfWeek: number[];
  /** Number of unscheduled transactions */
  transactionCount: number;
  /** Number of scheduled transactions (excluded from analysis) */
  scheduledTransactionCount: number;
  /** Number of transactions in excluded categories */
  excludedTransactionCount: number;
  /** Total spending in excluded categories in cents */
  excludedSpending: number;
}

// =============================================================================
// Reserved Balance Types
// =============================================================================

/**
 * Reserved balance allocation for a single account.
 */
export interface ReservedAllocation {
  accountId: AccountEntity['id'];
  accountName: string;
  accountType: ProjectionAccountType;
  /** Amount reserved in this account (in cents) */
  reservedAmount: number;
  /** Balance available after reserving (in cents) */
  availableBalance: number;
}

/**
 * Complete reserved balance calculation result.
 */
export interface ReservedCalculation {
  /** Total balance from excluded category groups (in cents) */
  totalExcludedBalance: number;
  /** Per-account allocation details */
  allocations: ReservedAllocation[];
}

// =============================================================================
// Safe to Spend Types
// =============================================================================

/**
 * Safe to spend calculation result.
 * Determines discretionary spending room above the buffer threshold.
 */
export interface SafeToSpend {
  /** Amount safe to spend in cents (can be negative if overextended) */
  amount: number;
  /** Number of days in the projection horizon */
  daysInHorizon: number;
  /** Lowest projected realistic balance in the horizon (cents) */
  minBalance: number;
  /** Date when the minimum balance occurs (YYYY-MM-DD) */
  minBalanceDate: string;
  /** The floor amount (reserved + buffer) in cents */
  bufferThreshold: number;
  /** Severity level */
  level: 'overextended' | 'tight' | 'comfortable' | 'plenty';
}

// =============================================================================
// Cash Flow Types
// =============================================================================

/**
 * A single line item in monthly cash flow.
 */
export interface CashFlowLineItem {
  name: string;
  /** Amount in cents */
  amount: number;
  /** Date of the item (YYYY-MM-DD) */
  date: string;
}

/**
 * Monthly cash flow summary.
 */
export interface MonthlyCashFlow {
  /** First day of the month (YYYY-MM-DD) */
  month: string;
  /** Human-readable month label (e.g., "January 2026") */
  monthLabel: string;
  /** Total income in cents */
  income: number;
  /** Income line items */
  incomeItems: CashFlowLineItem[];
  /** Total scheduled expenses in cents (excluding excluded categories) */
  scheduledExpenses: number;
  /** Scheduled expense line items */
  scheduledItems: CashFlowLineItem[];
  /** Scheduled expenses in excluded categories (e.g., savings, insurance) in cents */
  excludedScheduledExpenses: number;
  /** Excluded expense line items */
  excludedItems: CashFlowLineItem[];
  /** Estimated unscheduled spending in cents */
  estimatedSpending: number;
  /** Number of days used for estimated spending calculation */
  daysInMonth: number;
  /** Daily spending rate used (cents per day) */
  dailySpendingRate: number;
  /** Net cash flow in cents (income - all expenses) */
  net: number;
}

/**
 * Cash runway calculation result.
 * Determines how many months of expenses are covered by available cash.
 */
export interface CashRunway {
  /** Total liquid cash (checking + savings) in cents */
  liquidCash: number;
  /** Reserved amount in cents */
  reservedAmount: number;
  /** Available cash after reservations in cents */
  availableCash: number;
  /** Average monthly expenses in cents */
  avgMonthlyExpenses: number;
  /** Runway in months (decimal) */
  runwayMonths: number;
  /** Severity level */
  level: 'critical' | 'warning' | 'good' | 'excellent';
}

// =============================================================================
// CC Payment Types
// =============================================================================

/**
 * Result of CC payment generation.
 * Contains occurrences for all affected accounts.
 */
export interface CCPaymentResult {
  /** Occurrences for the primary checking account (outgoing payments - negative amounts) */
  checkingOccurrences: Occurrence[];
  /** Occurrences per credit card account (incoming payments - positive amounts) */
  ccOccurrences: Map<AccountEntity['id'], Occurrence[]>;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Projection configuration options.
 */
export interface ProjectionConfig {
  /** Buffer amount in cents (default: 1500000 = $15,000) */
  bufferAmount: number;
  /** Number of days to project (default: 90) */
  projectionDays: number;
  /** Number of months to analyze for spending patterns (default: 3) */
  spendingAnalysisMonths: number;
}

/**
 * Default projection configuration values.
 */
export const DEFAULT_PROJECTION_CONFIG: ProjectionConfig = {
  bufferAmount: 1500000, // $15,000 in cents
  projectionDays: 90,
  spendingAnalysisMonths: 3,
};

/**
 * Thresholds for cash runway severity levels (in months).
 */
export const RUNWAY_THRESHOLDS = {
  critical: 1,
  warning: 3,
  good: 6,
} as const;

/**
 * Thresholds for safe-to-spend severity levels (in cents).
 */
export const SAFE_TO_SPEND_THRESHOLDS = {
  tight: 10000, // $100
  comfortable: 50000, // $500
} as const;
