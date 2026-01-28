/**
 * Reserved Category Balance Allocation
 *
 * Applies excluded category balances against accounts in priority order (waterfall):
 * 1. Savings accounts (fully reserve up to balance)
 * 2. Non-primary checking (fully reserve up to balance)
 * 3. Primary checking (remainder)
 */

import type {
  ProjectionAccount,
  ReservedAllocation,
  ReservedCalculation,
} from './types';

/**
 * Calculate reserved amounts for each account using waterfall allocation.
 *
 * @param accounts - All accounts with their current balances
 * @param totalExcludedBalance - Total balance from excluded category groups (in cents)
 * @returns Allocation details for each account
 */
export function calculateReservedAmounts(
  accounts: ProjectionAccount[],
  totalExcludedBalance: number,
): ReservedCalculation {
  // Only positive excluded balances can be reserved
  if (totalExcludedBalance <= 0) {
    return {
      totalExcludedBalance: 0,
      allocations: accounts.map(a => ({
        accountId: a.id,
        accountName: a.name,
        accountType: a.type,
        reservedAmount: 0,
        availableBalance: a.currentBalance,
      })),
    };
  }

  // Get cash accounts (checking and savings) with positive balances
  const cashAccounts = accounts.filter(
    a =>
      (a.type === 'checking' || a.type === 'savings') && a.currentBalance > 0,
  );

  // Sort accounts by priority: savings first, then non-primary checking, then primary checking
  const sortedAccounts = [...cashAccounts].sort((a, b) => {
    // Priority 1: Savings accounts
    if (a.type === 'savings' && b.type !== 'savings') return -1;
    if (b.type === 'savings' && a.type !== 'savings') return 1;

    // Priority 2: Non-primary checking
    if (a.type === 'checking' && b.type === 'checking') {
      if (!a.isPrimary && b.isPrimary) return -1;
      if (a.isPrimary && !b.isPrimary) return 1;
    }

    // Otherwise, sort by name for consistency
    return a.name.localeCompare(b.name);
  });

  // Allocate reserved amounts using waterfall
  let remainingToReserve = totalExcludedBalance;
  const allocations: ReservedAllocation[] = [];

  for (const account of sortedAccounts) {
    const reservedAmount = Math.min(remainingToReserve, account.currentBalance);
    remainingToReserve -= reservedAmount;

    allocations.push({
      accountId: account.id,
      accountName: account.name,
      accountType: account.type,
      reservedAmount,
      availableBalance: account.currentBalance - reservedAmount,
    });
  }

  // Add entries for accounts that didn't get any allocation (non-cash accounts, etc.)
  const allocatedIds = new Set(allocations.map(a => a.accountId));
  for (const account of accounts) {
    if (!allocatedIds.has(account.id)) {
      allocations.push({
        accountId: account.id,
        accountName: account.name,
        accountType: account.type,
        reservedAmount: 0,
        availableBalance: account.currentBalance,
      });
    }
  }

  return {
    totalExcludedBalance,
    allocations,
  };
}

/**
 * Get the reserved threshold for a specific account.
 *
 * @param accountId - The account ID to look up
 * @param calculation - The reserved calculation result
 * @returns The reserved amount for this account, or 0 if not found
 */
export function getReservedThreshold(
  accountId: string,
  calculation: ReservedCalculation,
): number {
  const allocation = calculation.allocations.find(
    a => a.accountId === accountId,
  );
  return allocation?.reservedAmount ?? 0;
}
