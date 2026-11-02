import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { formatCurrency } from '../utils/currency';
import { formatDurationMinutes } from '../utils/duration';
import {
  X,
  ChefHat,
  Plus,
  Trash2,
  Clock,
  Layers,
  AlertCircle,
  CheckCircle2,
  Save,
  Search,
} from 'lucide-react';

const VALID_UNITS = ['g', 'kg', 'ml', 'L', 'piece'];

export default function RecipeModal({
  product,
  initialVariantId = null,
  onClose,
  onRecipeSaved,
}) {
  const [selectedVariantId, setSelectedVariantId] = useState(
    initialVariantId || product?.variants?.[0]?._id || ''
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);

  // Available pantry ingredients from inventory
  const [pantryIngredients, setPantryIngredients] = useState([]);

  // Recipe State
  const [recipeExisting, setRecipeExisting] = useState(false);
  const [recipeRevision, setRecipeRevision] = useState(1);
  const [totalTimeMinutes, setTotalTimeMinutes] = useState('30');
  const [expectedYield, setExpectedYield] = useState('1');
  const [yieldUnit, setYieldUnit] = useState('piece');
  const [instructions, setInstructions] = useState('');
  const [ingredientsList, setIngredientsList] = useState([]);

  // Search filter for dropdowns
  const [searchFilter, setSearchFilter] = useState('');
  const [activeDropdownRow, setActiveDropdownRow] = useState(null);

  const closeButtonRef = useRef(null);
  const dropdownRef = useRef(null);

  // 1. Lock background scroll and listen for Escape key
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;

    if (scrollBarWidth > 0) {
      document.body.style.paddingRight = `${scrollBarWidth}px`;
    }
    document.body.style.overflow = 'hidden';

    if (closeButtonRef.current) {
      closeButtonRef.current.focus({ preventScroll: true });
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setActiveDropdownRow(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // 2. Fetch Pantry Ingredients and Recipe Data
  const loadData = useCallback(async (variantId) => {
    if (!product?._id || !variantId) return;
    setLoading(true);
    setError(null);
    setFeedback(null);

    try {
      // Fetch available ingredients
      const ingRes = await api.getIngredients({ limit: 300 }).catch(() => null);
      const ings = ingRes?.data?.ingredients || (Array.isArray(ingRes?.data) ? ingRes.data : []);
      const activeIngs = ings.filter((i) => i && i.isActive !== false);
      setPantryIngredients(activeIngs);

      // Fetch recipe for this variant
      const targetVariant = product.variants?.find((v) => v._id === variantId) || product.variants?.[0];
      const res = await api.getRecipe(product._id, variantId).catch(() => null);
      const recipe = res?.data?.recipe;

      if (recipe) {
        setRecipeExisting(true);
        setRecipeRevision(recipe.revision || 1);
        const combined = Number(recipe.totalTimeMinutes) ||
          ((Number(recipe.preparationTime) || 0) + (Number(recipe.productionTime) || 0)) ||
          Number(product.totalTimeMinutes) || 30;
        setTotalTimeMinutes(String(combined));
        setExpectedYield(String(recipe.expectedYield || 1));
        setYieldUnit(recipe.yieldUnit || targetVariant?.unit || 'piece');
        setInstructions(recipe.instructions || '');

        const mappedLines = (recipe.ingredients || []).map((ing) => ({
          ingredient: ing.ingredient?._id || ing.ingredient,
          ingredientName: ing.ingredient?.name || '',
          quantity: String(ing.quantity || ''),
          unit: ing.unit || 'kg',
        }));
        setIngredientsList(mappedLines);
      } else {
        // No recipe yet: initialize clean defaults
        setRecipeExisting(false);
        setRecipeRevision(1);
        const defaultTime = Number(product.totalTimeMinutes) ||
          ((Number(product.preparationTime) || 0) + (Number(product.productionTime) || 0)) || 30;
        setTotalTimeMinutes(String(defaultTime));
        setExpectedYield('1');
        setYieldUnit(targetVariant?.unit || 'piece');
        setInstructions('');
        setIngredientsList([]);
      }
    } catch (err) {
      setError(err.message || 'Failed to load recipe information');
    } finally {
      setLoading(false);
    }
  }, [product]);

  useEffect(() => {
    if (selectedVariantId) {
      loadData(selectedVariantId);
    }
  }, [selectedVariantId, loadData]);

  // Handle switching variant
  const handleVariantChange = (newVariantId) => {
    setSelectedVariantId(newVariantId);
  };

  // Add new ingredient row
  const handleAddIngredient = () => {
    // Find first ingredient not already in list
    const usedIds = new Set(ingredientsList.map((i) => i.ingredient).filter(Boolean));
    const available = pantryIngredients.find((i) => !usedIds.has(i._id));

    setIngredientsList((prev) => [
      ...prev,
      {
        ingredient: available?._id || '',
        ingredientName: available?.name || '',
        quantity: '',
        unit: available?.unit || 'kg',
      },
    ]);
    setError(null);
  };

  // Remove ingredient row
  const handleRemoveIngredient = (index) => {
    setIngredientsList((prev) => prev.filter((_, idx) => idx !== index));
    if (activeDropdownRow === index) setActiveDropdownRow(null);
  };

  // Update ingredient field
  const handleUpdateIngredient = (index, field, value) => {
    setIngredientsList((prev) => {
      const updated = [...prev];
      if (field === 'ingredient') {
        const found = pantryIngredients.find((i) => i._id === value);
        updated[index] = {
          ...updated[index],
          ingredient: value,
          ingredientName: found?.name || '',
          unit: found?.unit || updated[index].unit || 'kg',
        };
      } else {
        updated[index] = { ...updated[index], [field]: value };
      }
      return updated;
    });
    setError(null);
  };

  // Save Recipe handler
  const handleSaveRecipe = async (e) => {
    if (e) e.preventDefault();
    setError(null);
    setFeedback(null);

    // Validation 1: Total Time
    const parsedTime = Number(totalTimeMinutes);
    if (!Number.isFinite(parsedTime) || parsedTime <= 0) {
      setError('Please specify a positive Total Time to Make Product (minutes).');
      return;
    }

    // Validation 2: Expected Yield
    const parsedYield = Number(expectedYield);
    if (!Number.isFinite(parsedYield) || parsedYield <= 0) {
      setError('Expected batch yield must be a positive number.');
      return;
    }

    // Validation 3: At least 1 ingredient
    if (ingredientsList.length === 0) {
      setError('Please add at least one ingredient to the recipe.');
      return;
    }

    // Validation 4: Valid ingredients & quantities
    for (let i = 0; i < ingredientsList.length; i++) {
      const item = ingredientsList[i];
      if (!item.ingredient) {
        setError(`Please select an ingredient for row #${i + 1}.`);
        return;
      }
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        const name = item.ingredientName || `Row #${i + 1}`;
        setError(`Please enter a valid positive quantity for ${name}.`);
        return;
      }
    }

    // Validation 5: Duplicate check
    const ingredientIds = ingredientsList.map((i) => i.ingredient);
    const uniqueIds = new Set(ingredientIds);
    if (uniqueIds.size !== ingredientIds.length) {
      setError('Duplicate ingredients detected. Each ingredient can appear only once in a recipe.');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        totalTimeMinutes: parsedTime,
        duration: parsedTime,
        productionTime: parsedTime,
        preparationTime: 0,
        expectedYield: parsedYield,
        yieldUnit,
        instructions: instructions.trim(),
        ingredients: ingredientsList.map((item) => ({
          ingredient: item.ingredient,
          quantity: Number(item.quantity),
          unit: item.unit,
        })),
      };

      if (recipeExisting) {
        await api.updateRecipe(product._id, selectedVariantId, payload);
      } else {
        await api.createRecipe(product._id, selectedVariantId, payload);
      }

      setFeedback('Recipe saved successfully!');
      setRecipeExisting(true);
      setRecipeRevision((prev) => prev + 1);

      if (typeof onRecipeSaved === 'function') {
        onRecipeSaved({
          productId: product._id,
          variantId: selectedVariantId,
          totalTimeMinutes: parsedTime,
        });
      }

      // Close modal after brief success indicator
      setTimeout(() => {
        onClose();
      }, 750);
    } catch (err) {
      setError(err.message || 'Failed to save recipe. Please check ingredient amounts and try again.');
    } finally {
      setSaving(false);
    }
  };

  const selectedVariant = product.variants?.find((v) => v._id === selectedVariantId) || product.variants?.[0];
  const usedIngredientIds = new Set(ingredientsList.map((i) => i.ingredient).filter(Boolean));

  // Live Production Cost Breakdown
  const quantityProduced = Number(expectedYield) || 1;
  const totalIngredientCost = ingredientsList.reduce((sum, item) => {
    if (!item.ingredient || !item.quantity) return sum;
    const ing = pantryIngredients.find((i) => i._id === item.ingredient);
    const unitCost = ing?.costPerUnit ?? ing?.pricePerUnit ?? 0;
    const qty = Number(item.quantity) || 0;
    return sum + qty * unitCost;
  }, 0);
  const electricityPerUnit = Number(product?.electricityCostPerUnit || 0);
  const packagingPerUnit = Number(product?.packagingCostPerUnit || 0);
  const totalElectricityCost = quantityProduced * electricityPerUnit;
  const totalPackagingCost = quantityProduced * packagingPerUnit;
  const totalProductionCost = totalIngredientCost + totalElectricityCost + totalPackagingCost;
  const costPerUnit = quantityProduced > 0 ? totalProductionCost / quantityProduced : 0;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-recipe-modal-title"
      id="recipe-modal-overlay"
      className="modal-backdrop-animated"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.68)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="recipe-modal-card"
        className="card modal-card-animated recipe-modal-grid-card"
      >
        {/* Sticky Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--bg-main)',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--primary-light)',
                  color: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ChefHat size={18} />
              </div>
              <h2
                id="manage-recipe-modal-title"
                style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}
              >
                Manage Recipe: {product.name}
              </h2>
              {recipeExisting ? (
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    backgroundColor: '#dcfce7',
                    color: '#15803d',
                    border: '1px solid #bbf7d0',
                  }}
                >
                  Active (Rev {recipeRevision})
                </span>
              ) : (
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    backgroundColor: '#fef3c7',
                    color: '#b45309',
                    border: '1px solid #fde68a',
                  }}
                >
                  Unconfigured
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Configure ingredients and total production time required to make this item
            </div>
          </div>

          <button
            id="recipe-modal-close-btn"
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="btn btn-sm"
            style={{
              padding: '6px',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div
          id="recipe-modal-body"
          style={{
            padding: '1.5rem',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          {/* Variant Selector (if product has variants) */}
          {product.variants?.length > 1 && (
            <div>
              <label
                htmlFor="recipe-variant-select"
                style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}
              >
                Product Variant / Size
              </label>
              <select
                id="recipe-variant-select"
                className="input-field"
                value={selectedVariantId}
                onChange={(e) => handleVariantChange(e.target.value)}
              >
                {product.variants.map((v) => (
                  <option key={v._id} value={v._id}>
                    {v.name} ({formatCurrency(v.price)}) - {v.quantity} {v.unit}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Feedback & Error Alerts */}
          {error && (
            <div
              className="alert alert-danger"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.85rem',
                padding: '10px 14px',
                margin: 0,
              }}
            >
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {feedback && (
            <div
              className="alert alert-success"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.85rem',
                padding: '10px 14px',
                margin: 0,
              }}
            >
              <CheckCircle2 size={16} />
              <span>{feedback}</span>
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
              <div className="spinner" style={{ margin: '0 auto 1rem auto' }} />
              <p style={{ margin: 0 }}>Loading recipe ingredients and duration...</p>
            </div>
          ) : (
            <form id="recipe-form" onSubmit={handleSaveRecipe} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Product Production Configuration Card */}
              <div
                style={{
                  padding: '1.25rem',
                  borderRadius: '12px',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  {/* Single combined Total Time to Make Product field */}
                  <div>
                    <label
                      htmlFor="recipe-total-time"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        marginBottom: '6px',
                        color: 'var(--text-main)',
                      }}
                    >
                      <Clock size={15} style={{ color: 'var(--primary)' }} />
                      Total Time to Make Product (min) <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        id="recipe-total-time"
                        type="number"
                        min="1"
                        step="1"
                        required
                        placeholder="e.g. 45"
                        className="input-field"
                        value={totalTimeMinutes}
                        onChange={(e) => setTotalTimeMinutes(e.target.value)}
                        style={{ flex: 1, margin: 0 }}
                      />
                      <span
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          color: 'var(--primary)',
                          whiteSpace: 'nowrap',
                          minWidth: '70px',
                        }}
                      >
                        {formatDurationMinutes(totalTimeMinutes)}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                      Complete duration required to make product (preparation and baking).
                    </span>
                  </div>

                  {/* Batch Yield */}
                  <div>
                    <label
                      htmlFor="recipe-expected-yield"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        marginBottom: '6px',
                        color: 'var(--text-main)',
                      }}
                    >
                      <Layers size={15} style={{ color: 'var(--primary)' }} />
                      Expected Batch Yield <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        id="recipe-expected-yield"
                        type="number"
                        min="0.001"
                        step="any"
                        required
                        placeholder="1"
                        className="input-field"
                        value={expectedYield}
                        onChange={(e) => setExpectedYield(e.target.value)}
                        style={{ flex: 1, margin: 0 }}
                      />
                      <select
                        className="input-field"
                        value={yieldUnit}
                        onChange={(e) => setYieldUnit(e.target.value)}
                        style={{ width: '100px', margin: 0 }}
                      >
                        {VALID_UNITS.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                      Finished output for this recipe formulation (e.g. 1 {selectedVariant?.unit || 'piece'}).
                    </span>
                  </div>
                </div>
              </div>

              {/* Recipe Ingredients Management Section */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.75rem',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: '0.98rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                      Recipe Ingredients ({ingredientsList.length})
                    </h3>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                      Ingredients required to produce {expectedYield || 1} {yieldUnit || 'piece'}
                    </div>
                  </div>

                  {/* Add Ingredient Button */}
                  <button
                    id="recipe-add-ingredient-btn"
                    type="button"
                    onClick={handleAddIngredient}
                    className="btn btn-primary btn-sm"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                    }}
                  >
                    <Plus size={15} /> Add Ingredient
                  </button>
                </div>

                {/* Compact Recipe Summary & Entry List */}
                {ingredientsList.length === 0 ? (
                  <div
                    style={{
                      padding: '2.5rem 1.5rem',
                      textAlign: 'center',
                      backgroundColor: 'var(--bg-main)',
                      borderRadius: '12px',
                      border: '1px dashed var(--border-color)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <ChefHat size={32} style={{ margin: '0 auto 0.75rem auto', opacity: 0.4 }} />
                    <div style={{ fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                      No Ingredients Added Yet
                    </div>
                    <div style={{ fontSize: '0.82rem', marginBottom: '1rem' }}>
                      Click the &quot;Add Ingredient&quot; button above to configure the recipe ingredients.
                    </div>
                    <button
                      type="button"
                      onClick={handleAddIngredient}
                      className="btn btn-outline btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Plus size={14} /> Add First Ingredient
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.65rem',
                    }}
                  >
                    {ingredientsList.map((item, idx) => {
                      const selectedIng = pantryIngredients.find((i) => i._id === item.ingredient);

                      return (
                        <div
                          key={idx}
                          className="recipe-ingredient-row"
                        >
                          {/* Ingredient Selector */}
                          <div className="recipe-ingredient-selector-col">
                            <select
                              aria-label={`Ingredient line ${idx + 1}`}
                              className="input-field"
                              value={item.ingredient}
                              onChange={(e) => handleUpdateIngredient(idx, 'ingredient', e.target.value)}
                              style={{ margin: 0, fontSize: '0.85rem' }}
                              required
                            >
                              <option value="">Select Ingredient...</option>
                              {pantryIngredients.map((ing) => {
                                const isAlreadySelected = usedIngredientIds.has(ing._id) && item.ingredient !== ing._id;
                                return (
                                  <option
                                    key={ing._id}
                                    value={ing._id}
                                    disabled={isAlreadySelected}
                                  >
                                    {ing.name} ({ing.unit}){isAlreadySelected ? ' — Added' : ''}
                                  </option>
                                );
                              })}
                            </select>
                          </div>

                          {/* Quantity Input */}
                          <div>
                            <input
                              type="number"
                              step="any"
                              min="0.000001"
                              required
                              placeholder="Qty"
                              aria-label={`Quantity for row ${idx + 1}`}
                              className="input-field"
                              value={item.quantity}
                              onChange={(e) => handleUpdateIngredient(idx, 'quantity', e.target.value)}
                              style={{ margin: 0, fontSize: '0.85rem' }}
                            />
                          </div>

                          {/* Unit Selector */}
                          <div>
                            <select
                              aria-label={`Unit for row ${idx + 1}`}
                              className="input-field"
                              value={item.unit}
                              onChange={(e) => handleUpdateIngredient(idx, 'unit', e.target.value)}
                              style={{ margin: 0, fontSize: '0.85rem' }}
                            >
                              {VALID_UNITS.map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </div>

                          {/* Remove Action */}
                          <div style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleRemoveIngredient(idx)}
                              className="btn btn-sm"
                              style={{
                                color: 'var(--danger, #dc2626)',
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '6px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                              title="Remove ingredient"
                              aria-label={`Remove ingredient row ${idx + 1}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Live Costing Breakdown Card */}
              <div
                style={{
                  padding: '1rem',
                  borderRadius: '10px',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                  <h4 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    Production Cost Breakdown ({quantityProduced} {yieldUnit || 'piece'})
                  </h4>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Formula: Ingredients + Electricity + Packaging
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))', gap: '0.5rem' }}>
                  <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Ingredient Cost</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>{formatCurrency(totalIngredientCost)}</div>
                  </div>
                  <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Electricity Cost</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>{formatCurrency(totalElectricityCost)}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>₹{electricityPerUnit.toFixed(2)} × {quantityProduced}</div>
                  </div>
                  <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Packaging Cost</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>{formatCurrency(totalPackagingCost)}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>₹{packagingPerUnit.toFixed(2)} × {quantityProduced}</div>
                  </div>
                  <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 600 }}>Total Production Cost</div>
                    <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--primary)' }}>{formatCurrency(totalProductionCost)}</div>
                  </div>
                  <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--success)', fontWeight: 600 }}>Cost per Unit</div>
                    <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--success)' }}>{formatCurrency(costPerUnit)}</div>
                  </div>
                </div>
              </div>

              {/* Optional Kitchen Instructions */}
              <div>
                <label
                  htmlFor="recipe-instructions"
                  style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-main)' }}
                >
                  Kitchen Baking Instructions (Optional)
                </label>
                <textarea
                  id="recipe-instructions"
                  rows={2}
                  placeholder="Key baking steps, oven temperature, cooling instructions..."
                  className="input-field"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  style={{ margin: 0 }}
                />
              </div>
            </form>
          )}
        </div>

        {/* Sticky Actions Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--bg-main)',
            flexShrink: 0,
            gap: '1rem',
          }}
        >
          <button
            id="recipe-cancel-btn"
            type="button"
            onClick={onClose}
            className="btn btn-outline btn-sm"
            style={{ fontWeight: 600 }}
          >
            Cancel
          </button>

          <button
            id="recipe-save-btn"
            type="submit"
            form="recipe-form"
            disabled={saving || loading}
            className="btn btn-primary btn-sm"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 700,
              minWidth: '130px',
              justifyContent: 'center',
            }}
          >
            {saving ? (
              <>
                <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save size={15} />
                <span>{recipeExisting ? 'Update Recipe' : 'Save Recipe'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
