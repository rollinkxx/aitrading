function currencyFormat(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0)
}

export function formatIdr(value: number): string {
  return currencyFormat(value, 0)
}

export function formatIdrPrice(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0
  const maximumFractionDigits = Math.abs(safeValue) > 0 && Math.abs(safeValue) < 1 ? 10 : 0
  return currencyFormat(safeValue, maximumFractionDigits)
}
