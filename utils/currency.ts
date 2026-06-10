const myrFormatter = new Intl.NumberFormat('ms-MY', {
  style: 'currency',
  currency: 'MYR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export const formatCurrency = (value: number | string): string => {
  const num = typeof value === 'string' ? Number(value) : value;
  const amount = Number.isFinite(num) ? num : 0;
  return myrFormatter.format(amount);
};
