import { describe, it, expect } from 'vitest';

import { calculateReservedAmounts, getReservedThreshold } from '../reserved';
import type { ProjectionAccount } from '../types';

describe('calculateReservedAmounts', () => {
  const savingsAccount: ProjectionAccount = {
    id: 'savings-1',
    name: 'Savings',
    type: 'savings',
    isPrimary: false,
    offbudget: false,
    closed: false,
    currentBalance: 500000, // $5,000
  };

  const primaryChecking: ProjectionAccount = {
    id: 'checking-1',
    name: 'Primary Checking',
    type: 'checking',
    isPrimary: true,
    offbudget: false,
    closed: false,
    currentBalance: 300000, // $3,000
  };

  const secondaryChecking: ProjectionAccount = {
    id: 'checking-2',
    name: 'Secondary Checking',
    type: 'checking',
    isPrimary: false,
    offbudget: false,
    closed: false,
    currentBalance: 200000, // $2,000
  };

  const creditCard: ProjectionAccount = {
    id: 'cc-1',
    name: 'Credit Card',
    type: 'credit',
    isPrimary: false,
    offbudget: false,
    closed: false,
    currentBalance: -100000, // -$1,000 (owes)
  };

  it('should allocate reserved amounts in priority order', () => {
    const accounts = [
      primaryChecking,
      savingsAccount,
      secondaryChecking,
      creditCard,
    ];
    const totalExcludedBalance = 600000; // $6,000

    const result = calculateReservedAmounts(accounts, totalExcludedBalance);

    expect(result.totalExcludedBalance).toBe(600000);

    // Savings should be fully reserved first ($5,000)
    const savingsAlloc = result.allocations.find(
      a => a.accountId === 'savings-1',
    );
    expect(savingsAlloc?.reservedAmount).toBe(500000);
    expect(savingsAlloc?.availableBalance).toBe(0);

    // Secondary checking next ($1,000 remaining to reserve)
    // But only has $2,000, so reserve $1,000
    const secondaryAlloc = result.allocations.find(
      a => a.accountId === 'checking-2',
    );
    expect(secondaryAlloc?.reservedAmount).toBe(100000);
    expect(secondaryAlloc?.availableBalance).toBe(100000);

    // Primary checking last (nothing left to reserve)
    const primaryAlloc = result.allocations.find(
      a => a.accountId === 'checking-1',
    );
    expect(primaryAlloc?.reservedAmount).toBe(0);
    expect(primaryAlloc?.availableBalance).toBe(300000);

    // Credit card should have 0 reserved (not a cash account)
    const ccAlloc = result.allocations.find(a => a.accountId === 'cc-1');
    expect(ccAlloc?.reservedAmount).toBe(0);
    expect(ccAlloc?.availableBalance).toBe(-100000);
  });

  it('should handle when excluded balance exceeds available cash', () => {
    const accounts = [savingsAccount, primaryChecking];
    const totalExcludedBalance = 1000000; // $10,000 (more than total cash)

    const result = calculateReservedAmounts(accounts, totalExcludedBalance);

    // Savings fully reserved
    const savingsAlloc = result.allocations.find(
      a => a.accountId === 'savings-1',
    );
    expect(savingsAlloc?.reservedAmount).toBe(500000);

    // Primary checking fully reserved
    const primaryAlloc = result.allocations.find(
      a => a.accountId === 'checking-1',
    );
    expect(primaryAlloc?.reservedAmount).toBe(300000);

    // Total reserved is 800000, not 1000000
  });

  it('should return zero allocations for zero excluded balance', () => {
    const accounts = [savingsAccount, primaryChecking];

    const result = calculateReservedAmounts(accounts, 0);

    expect(result.totalExcludedBalance).toBe(0);
    expect(result.allocations.every(a => a.reservedAmount === 0)).toBe(true);
    expect(
      result.allocations.find(a => a.accountId === 'savings-1')
        ?.availableBalance,
    ).toBe(500000);
  });

  it('should return zero allocations for negative excluded balance', () => {
    const accounts = [savingsAccount];

    const result = calculateReservedAmounts(accounts, -50000);

    expect(result.totalExcludedBalance).toBe(0);
    expect(result.allocations[0].reservedAmount).toBe(0);
  });

  it('should skip accounts with zero or negative balance', () => {
    const emptyAccount: ProjectionAccount = {
      id: 'empty-1',
      name: 'Empty Savings',
      type: 'savings',
      isPrimary: false,
      offbudget: false,
      closed: false,
      currentBalance: 0,
    };

    const accounts = [emptyAccount, primaryChecking];
    const totalExcludedBalance = 100000;

    const result = calculateReservedAmounts(accounts, totalExcludedBalance);

    // Empty account should have 0 reserved
    const emptyAlloc = result.allocations.find(a => a.accountId === 'empty-1');
    expect(emptyAlloc?.reservedAmount).toBe(0);

    // All goes to primary checking
    const primaryAlloc = result.allocations.find(
      a => a.accountId === 'checking-1',
    );
    expect(primaryAlloc?.reservedAmount).toBe(100000);
  });

  it('should sort savings accounts before checking accounts', () => {
    // Put checking first in the input array
    const accounts = [primaryChecking, savingsAccount];
    const totalExcludedBalance = 400000;

    const result = calculateReservedAmounts(accounts, totalExcludedBalance);

    // Savings should still be reserved first
    const savingsAlloc = result.allocations.find(
      a => a.accountId === 'savings-1',
    );
    expect(savingsAlloc?.reservedAmount).toBe(400000);

    const primaryAlloc = result.allocations.find(
      a => a.accountId === 'checking-1',
    );
    expect(primaryAlloc?.reservedAmount).toBe(0);
  });
});

describe('getReservedThreshold', () => {
  it('should return reserved amount for a specific account', () => {
    const calculation = {
      totalExcludedBalance: 500000,
      allocations: [
        {
          accountId: 'acct-1',
          accountName: 'Savings',
          accountType: 'savings' as const,
          reservedAmount: 300000,
          availableBalance: 200000,
        },
        {
          accountId: 'acct-2',
          accountName: 'Checking',
          accountType: 'checking' as const,
          reservedAmount: 200000,
          availableBalance: 100000,
        },
      ],
    };

    expect(getReservedThreshold('acct-1', calculation)).toBe(300000);
    expect(getReservedThreshold('acct-2', calculation)).toBe(200000);
  });

  it('should return 0 for unknown account', () => {
    const calculation = {
      totalExcludedBalance: 100000,
      allocations: [
        {
          accountId: 'acct-1',
          accountName: 'Savings',
          accountType: 'savings' as const,
          reservedAmount: 100000,
          availableBalance: 0,
        },
      ],
    };

    expect(getReservedThreshold('unknown', calculation)).toBe(0);
  });
});
