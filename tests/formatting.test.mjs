import test from 'node:test'
import assert from 'node:assert/strict'
import { formatIdr, formatIdrPrice } from '../src/lib/formatting.ts'

test('formats sub-rupiah prices with up to ten decimal places', () => {
  assert.ok(formatIdrPrice(0.095677).includes('0,095677'))
  assert.ok(formatIdrPrice(0.0935842).includes('0,0935842'))
  assert.ok(formatIdrPrice(0.09992308).includes('0,09992308'))
  assert.ok(formatIdrPrice(0.00000001).includes('0,00000001'))
})

test('keeps balances and P&L rounded to whole rupiah', () => {
  const formatted = formatIdr(33165)
  assert.ok(formatted.includes('33.165'))
  assert.doesNotMatch(formatted, /,\d/)
})

test('falls back safely for non-finite inputs', () => {
  assert.ok(formatIdr(Number.NaN).includes('0'))
  assert.ok(formatIdrPrice(Number.POSITIVE_INFINITY).includes('0'))
})
