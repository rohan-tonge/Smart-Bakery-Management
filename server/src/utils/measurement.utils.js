import { UNITS } from "./constants.js";

const unitInfo = {
  [UNITS.GRAM]: { dimension: "mass", factor: 1 },
  [UNITS.KILOGRAM]: { dimension: "mass", factor: 1000 },
  [UNITS.MILLILITER]: { dimension: "volume", factor: 1 },
  [UNITS.LITER]: { dimension: "volume", factor: 1000 },
  [UNITS.PIECE]: { dimension: "count", factor: 1 },
};

export const areUnitsConvertible = (fromUnit, toUnit) =>
  Boolean(
    unitInfo[fromUnit] &&
    unitInfo[toUnit] &&
    unitInfo[fromUnit].dimension === unitInfo[toUnit].dimension,
  );

export const convertQuantity = (quantity, fromUnit, toUnit) => {
  if (!areUnitsConvertible(fromUnit, toUnit)) {
    throw new TypeError(`Cannot convert ${fromUnit} to ${toUnit}`);
  }
  const result =
    (quantity * unitInfo[fromUnit].factor) / unitInfo[toUnit].factor;
  return Number(result.toFixed(6));
};
export const roundQuantity = (quantity) => Number(Number(quantity).toFixed(6));
export default { areUnitsConvertible, convertQuantity };
