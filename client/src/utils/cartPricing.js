export function getCartLineTotal(item) {
  if (item.lineTotal !== null && item.lineTotal !== undefined) {
    return Number(item.lineTotal);
  }

  const unitPrice = item.unitPrice ?? item.price ?? 0;
  return Number(unitPrice) * Number(item.quantity || 0);
}
