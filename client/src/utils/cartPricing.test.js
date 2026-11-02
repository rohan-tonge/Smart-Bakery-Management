import test from 'node:test';
import assert from 'node:assert/strict';
import { getCartLineTotal } from './cartPricing.js';

test('checkout uses the API cart line total', () => {
  assert.equal(getCartLineTotal({ unitPrice: 300, lineTotal: 600, quantity: 2 }), 600);
});

test('checkout derives the line total from unitPrice when lineTotal is absent', () => {
  assert.equal(getCartLineTotal({ unitPrice: 300, quantity: 2 }), 600);
});

test('checkout supports legacy price cart items', () => {
  assert.equal(getCartLineTotal({ price: 125, quantity: 3 }), 375);
});
