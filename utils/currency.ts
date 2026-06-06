const myrFormatter = new Intl.NumberFormat('ms-MY', {
  style: 'currency',
  currency: 'MYR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export const formatCurrency = (value: number): string => {
  const amount = Number.isFinite(value) ? value : 0;
  return myrFormatter.format(amount);
};
