/**
 * Credit Card Payment Estimation
 *
 * Generates estimated CC payment occurrences for projection purposes.
 * Each payment includes:
 * - First payment: current CC balance (what's already owed)
 * - Subsequent payments: scheduled CC transactions in the billing period + estimated daily spending
 *
 * IMPORTANT: Billing Cycle Offset
 *
 * Credit card payments are offset by one billing cycle. Charges made during a billing
 * period are not due until the *following* payment date. For example:
 *
 * Payment Dates:  2/16, 3/18, 4/17, 5/17
 *                   |     |     |
 * Payment[0] ------+     |     |     Current balance (already on statement)
 * Payment[1] ------------+     |     Covers: today -> payment[0] (billing period closes at 2/16)
 * Payment[2] ------------------+     Covers: payment[0] -> payment[1] (2/16 -> 3/18)
 *
 * A scheduled transaction on 3/11 falls in the billing period 2/16-3/18, so it appears
 * in the 4/17 payment (payment[2]), NOT the 3/18 payment.
 */

import * as monthUtils from '../months';

import { getAllOccurrences } from './project-balances';
import type {
  ProjectionAccount,
  ProjectionSchedule,
  Occurrence,
  CCPaymentResult,
} from './types';

/**
 * Create a synthetic schedule for display purposes.
 *
 * @param cardName - Name of the credit card
 * @param estimatedAmount - Amount in cents
 * @param isPaymentToCC - Whether this is a payment to the CC (vs from checking)
 * @returns A synthetic ProjectionSchedule
 */
function createSyntheticSchedule(
  cardName: string,
  estimatedAmount: number,
  isPaymentToCC: boolean = false,
): ProjectionSchedule {
  return {
    id: `synthetic-cc-${cardName.toLowerCase().replace(/\s+/g, '-')}`,
    name: isPaymentToCC ? 'Est. Payment' : `Est. CC Payment: ${cardName}`,
    account: '',
    amount: estimatedAmount,
    nextDate: '',
    completed: false,
  };
}

/**
 * Find payment transactions in transaction history.
 * Payments are identified as transfers that reduce CC balance (positive amounts).
 *
 * @param transactions - Recent transactions for the CC account
 * @returns Array of payment transactions, sorted by date (most recent first)
 */
function findCCPayments(
  transactions: Array<{ date: string; amount: number; transfer_id?: string }>,
): Array<{ date: string; amount: number }> {
  // In Actual, CC balance is negative when you owe.
  // Payments are positive (reducing debt) and are transfers.
  const payments = transactions.filter(t => t.transfer_id && t.amount > 0);

  return payments.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Generate estimated CC payment occurrences for both checking and credit card accounts.
 *
 * @param primaryCheckingId - ID of the primary checking account
 * @param creditAccounts - Credit card accounts with balances
 * @param projectionEndDate - End date for projections (YYYY-MM-DD)
 * @param schedules - All schedules
 * @param getScheduleOccurrences - Function to get schedule occurrences
 * @param getRecentTransactions - Function to get recent transactions for an account
 * @param getAccountDailySpending - Function to get daily spending estimate for an account
 * @returns CC payment occurrences for checking and each credit card
 */
export async function generateCCPaymentOccurrences(
  primaryCheckingId: string,
  creditAccounts: ProjectionAccount[],
  projectionEndDate: string,
  schedules: ProjectionSchedule[],
  getScheduleOccurrences: (
    scheduleId: string,
    startDate: string,
    endDate: string,
  ) => Array<{ date: string; amount: number }>,
  getRecentTransactions: (
    accountId: string,
    startDate: string,
    endDate: string,
  ) => Promise<Array<{ date: string; amount: number; transfer_id?: string }>>,
  getAccountDailySpending: (accountId: string) => Promise<number>,
): Promise<CCPaymentResult> {
  const checkingOccurrences: Occurrence[] = [];
  const ccOccurrences = new Map<string, Occurrence[]>();
  const today = monthUtils.currentDay();
  const ninetyDaysAgo = monthUtils.subDays(today, 90);

  for (const cc of creditAccounts) {
    const ccPayments: Occurrence[] = [];

    // Fetch recent CC transactions to find payment pattern
    const transactions = await getRecentTransactions(
      cc.id,
      ninetyDaysAgo,
      today,
    );

    // Calculate average daily spending on this card
    const dailySpending = await getAccountDailySpending(cc.id);

    // Get scheduled transactions for this CC
    const ccSchedules = schedules.filter(s => s.account === cc.id);

    // Find payments to determine next payment date
    const payments = findCCPayments(transactions);

    let nextPaymentDate: string;

    if (payments.length > 0) {
      // Get most recent payment date
      const lastPaymentDate = payments[0].date;

      // Estimate next payment: last payment + 1 month
      nextPaymentDate = monthUtils.addMonths(lastPaymentDate, 1);
    } else {
      // No payment history - default to 1 month from today
      nextPaymentDate = monthUtils.addMonths(today, 1);
    }

    // If next payment is in the past, add months until it's in the future
    while (monthUtils.isBefore(nextPaymentDate, today)) {
      nextPaymentDate = monthUtils.addMonths(nextPaymentDate, 1);
    }

    // Current balance (what you owe now from past charges - already on statement)
    // Only negative balances represent debt; positive means a credit on the account
    const currentOwed =
      cc.currentBalance < 0 ? Math.abs(cc.currentBalance) : 0;

    // Build list of payment dates first so we can offset billing periods correctly
    const paymentDates: string[] = [];
    let tempPaymentDate = nextPaymentDate;
    while (monthUtils.isBefore(tempPaymentDate, projectionEndDate)) {
      paymentDates.push(tempPaymentDate);
      tempPaymentDate = monthUtils.addMonths(tempPaymentDate, 1);
    }

    // Generate payments
    // Payment[0]: current balance (already on statement)
    // Payment[1]: charges from today to payment[0] (billing period that closes at payment[0])
    // Payment[2]: charges from payment[0] to payment[1]
    // Payment[i]: charges from payment[i-2] to payment[i-1]
    for (let i = 0; i < paymentDates.length; i++) {
      const paymentDate = paymentDates[i];
      let paymentAmount: number;

      if (i === 0) {
        // First payment: just current balance (what's already on the statement)
        paymentAmount = currentOwed;
      } else {
        // Subsequent payments cover the billing period that closed before this payment
        // Payment[1] covers: today to payment[0]
        // Payment[2] covers: payment[0] to payment[1]
        const billingPeriodStart = i === 1 ? today : paymentDates[i - 2];
        const billingPeriodEnd = paymentDates[i - 1];
        const daysInPeriod = monthUtils.differenceInCalendarDays(
          billingPeriodEnd,
          billingPeriodStart,
        );

        // Get scheduled occurrences for this CC in the billing period
        const scheduledInPeriod = getAllOccurrences(
          ccSchedules,
          billingPeriodStart,
          billingPeriodEnd,
          getScheduleOccurrences,
        );

        // Sum scheduled amounts (expenses are negative, so take absolute value)
        const scheduledTotal = scheduledInPeriod.reduce(
          (sum, occ) => sum + Math.abs(occ.amount < 0 ? occ.amount : 0),
          0,
        );

        // Estimated unscheduled spending for the period
        const estimatedSpending = dailySpending * daysInPeriod;

        paymentAmount = scheduledTotal + estimatedSpending;
      }

      // Only add if there's actually something to pay off
      if (paymentAmount > 0) {
        // Add to checking account (outgoing payment - negative)
        checkingOccurrences.push({
          date: paymentDate,
          amount: -paymentAmount,
          schedule: createSyntheticSchedule(cc.name, -paymentAmount),
          isEstimate: true,
          estimateLabel: `Est. CC Payment: ${cc.name}`,
        });

        // Add to credit card account (incoming payment - positive, reduces debt)
        ccPayments.push({
          date: paymentDate,
          amount: paymentAmount,
          schedule: createSyntheticSchedule(cc.name, paymentAmount, true),
          isEstimate: true,
          estimateLabel: 'Est. Payment',
        });
      }
    }

    ccOccurrences.set(cc.id, ccPayments);
  }

  return { checkingOccurrences, ccOccurrences };
}

/**
 * Synchronous version for when data is already loaded.
 * Same logic as generateCCPaymentOccurrences but takes pre-loaded data.
 *
 * @param primaryCheckingId - ID of the primary checking account
 * @param creditAccounts - Credit card accounts with balances and spending data
 * @param projectionEndDate - End date for projections (YYYY-MM-DD)
 * @param schedules - All schedules
 * @param getScheduleOccurrences - Function to get schedule occurrences
 * @param recentTransactionsByAccount - Pre-loaded recent transactions by account ID
 * @param dailySpendingByAccount - Pre-loaded daily spending estimates by account ID
 * @returns CC payment occurrences for checking and each credit card
 */
export function generateCCPaymentOccurrencesSync(
  primaryCheckingId: string,
  creditAccounts: ProjectionAccount[],
  projectionEndDate: string,
  schedules: ProjectionSchedule[],
  getScheduleOccurrences: (
    scheduleId: string,
    startDate: string,
    endDate: string,
  ) => Array<{ date: string; amount: number }>,
  recentTransactionsByAccount: Map<
    string,
    Array<{ date: string; amount: number; transfer_id?: string }>
  >,
  dailySpendingByAccount: Map<string, number>,
): CCPaymentResult {
  const checkingOccurrences: Occurrence[] = [];
  const ccOccurrences = new Map<string, Occurrence[]>();
  const today = monthUtils.currentDay();

  for (const cc of creditAccounts) {
    const ccPayments: Occurrence[] = [];

    const transactions = recentTransactionsByAccount.get(cc.id) ?? [];
    const dailySpending = dailySpendingByAccount.get(cc.id) ?? 0;

    const ccSchedules = schedules.filter(s => s.account === cc.id);
    const payments = findCCPayments(transactions);

    let nextPaymentDate: string;

    if (payments.length > 0) {
      nextPaymentDate = monthUtils.addMonths(payments[0].date, 1);
    } else {
      nextPaymentDate = monthUtils.addMonths(today, 1);
    }

    while (monthUtils.isBefore(nextPaymentDate, today)) {
      nextPaymentDate = monthUtils.addMonths(nextPaymentDate, 1);
    }

    const currentOwed =
      cc.currentBalance < 0 ? Math.abs(cc.currentBalance) : 0;

    const paymentDates: string[] = [];
    let tempPaymentDate = nextPaymentDate;
    while (monthUtils.isBefore(tempPaymentDate, projectionEndDate)) {
      paymentDates.push(tempPaymentDate);
      tempPaymentDate = monthUtils.addMonths(tempPaymentDate, 1);
    }

    for (let i = 0; i < paymentDates.length; i++) {
      const paymentDate = paymentDates[i];
      let paymentAmount: number;

      if (i === 0) {
        paymentAmount = currentOwed;
      } else {
        const billingPeriodStart = i === 1 ? today : paymentDates[i - 2];
        const billingPeriodEnd = paymentDates[i - 1];
        const daysInPeriod = monthUtils.differenceInCalendarDays(
          billingPeriodEnd,
          billingPeriodStart,
        );

        const scheduledInPeriod = getAllOccurrences(
          ccSchedules,
          billingPeriodStart,
          billingPeriodEnd,
          getScheduleOccurrences,
        );

        const scheduledTotal = scheduledInPeriod.reduce(
          (sum, occ) => sum + Math.abs(occ.amount < 0 ? occ.amount : 0),
          0,
        );

        const estimatedSpending = dailySpending * daysInPeriod;
        paymentAmount = scheduledTotal + estimatedSpending;
      }

      if (paymentAmount > 0) {
        checkingOccurrences.push({
          date: paymentDate,
          amount: -paymentAmount,
          schedule: createSyntheticSchedule(cc.name, -paymentAmount),
          isEstimate: true,
          estimateLabel: `Est. CC Payment: ${cc.name}`,
        });

        ccPayments.push({
          date: paymentDate,
          amount: paymentAmount,
          schedule: createSyntheticSchedule(cc.name, paymentAmount, true),
          isEstimate: true,
          estimateLabel: 'Est. Payment',
        });
      }
    }

    ccOccurrences.set(cc.id, ccPayments);
  }

  return { checkingOccurrences, ccOccurrences };
}
