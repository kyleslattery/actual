/**
 * Safe to Spend Calculation
 *
 * Determines how much discretionary spending room exists above the buffer threshold
 * by finding the lowest projected realistic balance across the projection horizon.
 *
 * Safe to Spend = min(realisticBalance over horizon) - bufferThreshold
 */

import * as monthUtils from '../months';

import type { EnhancedDayProjection, SafeToSpend } from './types';
import { SAFE_TO_SPEND_THRESHOLDS } from './types';

/**
 * Find the minimum realistic balance across a projection array.
 *
 * @param projections - Array of enhanced day projections
 * @returns Object with minBalance and minBalanceDate, or null if empty
 */
function findMinRealisticBalance(
  projections: EnhancedDayProjection[],
): { minBalance: number; minBalanceDate: string } | null {
  if (projections.length === 0) return null;

  let minBalance = Infinity;
  let minBalanceDate = projections[0].date;

  for (const day of projections) {
    if (day.realisticBalance < minBalance) {
      minBalance = day.realisticBalance;
      minBalanceDate = day.date;
    }
  }

  return { minBalance, minBalanceDate };
}

/**
 * Calculate how much is safe to spend given combined cash projections
 * and a buffer threshold (reserved + buffer amount).
 *
 * Uses the combined cash projection (savings + checking) to reflect total liquidity.
 * The minimum realistic balance across the entire projection horizon is the tightest
 * point -- subtracting the buffer threshold gives the discretionary surplus.
 *
 * @param projections - Combined cash projections (savings + checking)
 * @param bufferThreshold - Floor amount (reserved + buffer) in cents
 * @returns SafeToSpend calculation
 */
export function calculateSafeToSpend(
  projections: EnhancedDayProjection[],
  bufferThreshold: number,
): SafeToSpend {
  if (projections.length === 0) {
    return {
      amount: 0,
      daysInHorizon: 0,
      minBalance: 0,
      minBalanceDate: monthUtils.currentDay(),
      bufferThreshold,
      level: 'overextended',
    };
  }

  const min = findMinRealisticBalance(projections)!;
  const { minBalance, minBalanceDate } = min;

  const amount = minBalance - bufferThreshold;
  const daysInHorizon =
    monthUtils.differenceInCalendarDays(
      projections[projections.length - 1].date,
      projections[0].date,
    ) + 1;

  // Determine severity level
  let level: SafeToSpend['level'];
  if (amount < 0) {
    level = 'overextended';
  } else if (amount < SAFE_TO_SPEND_THRESHOLDS.tight) {
    level = 'tight';
  } else if (amount < SAFE_TO_SPEND_THRESHOLDS.comfortable) {
    level = 'comfortable';
  } else {
    level = 'plenty';
  }

  return {
    amount,
    daysInHorizon,
    minBalance,
    minBalanceDate,
    bufferThreshold,
    level,
  };
}

/**
 * Calculate how much can safely be transferred from checking to savings.
 *
 * Uses the primary checking account projections (not combined cash) to find
 * the minimum realistic balance, then subtracts the buffer threshold.
 * If the result is positive, that's how much can be moved without the
 * checking balance ever dropping below the buffer.
 *
 * @param checkingProjections - Primary checking account projections
 * @param bufferThreshold - Floor amount (reserved + buffer) in cents
 * @returns Amount safe to transfer (clamped to >= 0), in cents
 */
export function calculateSafeToTransfer(
  checkingProjections: EnhancedDayProjection[],
  bufferThreshold: number,
): number {
  const min = findMinRealisticBalance(checkingProjections);
  if (!min) return 0;

  return Math.max(0, min.minBalance - bufferThreshold);
}
