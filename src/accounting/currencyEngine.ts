// ============================================================================
// DOMAIN CURRENCY ENGINE & ARITHMETIC SAFETY LAYER
// ============================================================================

import * as AccountingTypes from './types.ts';
type Money = AccountingTypes.Money;
type CurrencyCode = AccountingTypes.CurrencyCode;
type FXConversionRecord = AccountingTypes.FXConversionRecord;
type FinancialRecord = AccountingTypes.FinancialRecord;
import { getNativeCurrencyForMarket } from './types.ts';

/**
 * Asserts that two Money values have identical currencies.
 * Throws a strict error if currencies differ to prevent silent unsafe arithmetic.
 */
export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(
      `CURRENCY_MISMATCH_ERROR: Unsafe direct arithmetic attempted between ${a.currency} and ${b.currency}. Direct operations without FX conversion are strictly prohibited.`
    );
  }
}

/**
 * Safely rounds numbers to 4 decimal places, returning 0 if input is not finite.
 */
export function round4(val: number): number {
  if (!Number.isFinite(val) || Number.isNaN(val)) return 0;
  return Math.round(val * 10000) / 10000;
}

/**
 * Currency-safe addition. Fails closed on currency mismatch or non-finite inputs.
 */
export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  if (!Number.isFinite(a.amount) || !Number.isFinite(b.amount)) {
    throw new Error('CURRENCY_ARITHMETIC_ERROR: Cannot add non-finite money amounts.');
  }
  return {
    amount: round4(a.amount + b.amount),
    currency: a.currency
  };
}

/**
 * Currency-safe subtraction. Fails closed on currency mismatch or non-finite inputs.
 */
export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  if (!Number.isFinite(a.amount) || !Number.isFinite(b.amount)) {
    throw new Error('CURRENCY_ARITHMETIC_ERROR: Cannot subtract non-finite money amounts.');
  }
  return {
    amount: round4(a.amount - b.amount),
    currency: a.currency
  };
}

/**
 * Converts Money using an explicit FXConversionRecord.
 * Fails closed if the money currency does not match conversion.fromCurrency, or if rate is invalid.
 */
export function convertMoney(money: Money, conversion: FXConversionRecord): Money {
  if (money.currency !== conversion.fromCurrency) {
    throw new Error(
      `FX_CONVERSION_ERROR: Money currency (${money.currency}) does not match conversion source currency (${conversion.fromCurrency}).`
    );
  }

  if (!Number.isFinite(conversion.rate) || conversion.rate <= 0) {
    throw new Error(
      `FX_CONVERSION_ERROR: Invalid conversion rate (${conversion.rate}). Exchange rates must be finite positive numbers.`
    );
  }

  if (!Number.isFinite(money.amount)) {
    throw new Error('FX_CONVERSION_ERROR: Cannot convert non-finite money amount.');
  }

  const convertedValue = round4(money.amount * conversion.rate);

  return {
    amount: convertedValue,
    currency: conversion.toCurrency
  };
}

/**
 * Computes native Net P&L = nativeGrossPnL - nativeCosts in native currency.
 * Formula: nativeNetPnL = nativeGrossPnL - nativeCosts.
 * Never subtracts a USD cost from INR P&L or vice versa.
 */
export function calculateNativeNetPnL(grossPnL: number, costs: number): number {
  if (!Number.isFinite(grossPnL) || !Number.isFinite(costs)) return 0;
  return round4(grossPnL - costs);
}

/**
 * Validates a FinancialRecord ensuring native currency matches the market mapping
 * and nativeNetPnL equals nativeGrossPnL - nativeCosts.
 */
export function validateFinancialRecord(record: FinancialRecord): boolean {
  const expectedCurrency = getNativeCurrencyForMarket(record.market);
  if (record.nativeCurrency !== expectedCurrency) {
    return false;
  }
  const expectedNet = calculateNativeNetPnL(record.nativeGrossPnL, record.nativeCosts);
  return Math.abs(record.nativeNetPnL - expectedNet) < 0.001;
}
