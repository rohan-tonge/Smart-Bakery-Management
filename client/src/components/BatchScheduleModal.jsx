import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { formatCurrency } from '../utils/currency';
import { formatDurationMinutes } from '../utils/duration';
import {
  X,
  Calendar,
  Clock,
  Users,
  ChefHat,
  AlertTriangle,
  AlertOctagon,
  FileText,
  CheckCircle2,
  Package,
} from 'lucide-react';

export default function BatchScheduleModal({
  isOpen,
  onClose,
  products = [],
  workers = [],
  initialOrder = null,
  onBatchScheduled,
}) {
  const [product, setProduct] = useState('');
  const [productVariant, setProductVariant] = useState('');
  const [plannedQuantity, setPlannedQuantity] = useState(10);
  const [plannedStartTime, setPlannedStartTime] = useState(() =>
    new Date().toISOString().slice(0, 16)
  );
  const [plannedReason, setPlannedReason] = useState('STOCK_REPLENISHMENT');
  const [priority, setPriority] = useState('NORMAL');
  const [assignedWorkerId, setAssignedWorkerId] = useState('');
  const [task, setTask] = useState('Primary Baker');
  const [productionNotes, setProductionNotes] = useState('');

  // Recipe lookup & validation state
  const [recipe, setRecipe] = useState(null);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeError, setRecipeError] = useState(null);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  // Initialize or reset form state when modal opens or initialOrder changes
  useEffect(() => {
    if (!isOpen) {
      setFormError(null);
      setRecipe(null);
      setRecipeError(null);
      return;
    }

    setFormError(null);

    if (initialOrder) {
      // Pre-fill from order
      const firstItem = initialOrder.items?.[0];
      const prodId = String(firstItem?.productId?._id || firstItem?.productId || '');
      const varId = String(firstItem?.variantId?._id || firstItem?.variantId || '');

      // Calculate remaining requirement accounting for reserved finished stock
      const finishedCommitment = (initialOrder.finishedCommitments || []).find(
        (c) => String(c.product) === prodId && String(c.variant) === varId
      );
      const finishedQty = Number(finishedCommitment?.quantity) || 0;
      const orderQty = Math.max(1, (Number(firstItem?.quantity) || 1) - finishedQty);

      setProduct(prodId);
      setProductVariant(varId);
      setPlannedQuantity(orderQty);

      // Start time from order delivery date or default to now
      if (initialOrder.deliveryDate) {
        try {
          const d = new Date(initialOrder.deliveryDate);
          if (Number.isFinite(d.getTime())) {
            setPlannedStartTime(d.toISOString().slice(0, 16));
          } else {
            setPlannedStartTime(new Date().toISOString().slice(0, 16));
          }
        } catch {
          setPlannedStartTime(new Date().toISOString().slice(0, 16));
        }
      } else {
        setPlannedStartTime(new Date().toISOString().slice(0, 16));
      }

      setProductionNotes(
        initialOrder.specialInstructions
          ? `Order #${initialOrder.orderNumber}: ${initialOrder.specialInstructions}`
          : `Order #${initialOrder.orderNumber} fulfillment`
      );
      setTask('Order Fulfillment Baker');
    } else {
      // Default clean form for Planned Production
      const firstProd = products[0];
      const defaultProdId = firstProd?._id || '';
      const defaultVarId = firstProd?.variants?.[0]?._id || '';

      setProduct(defaultProdId);
      setProductVariant(defaultVarId);
      setPlannedQuantity(10);
      setPlannedStartTime(new Date().toISOString().slice(0, 16));
      setPlannedReason('FESTIVAL_DEMAND');
      setPriority('NORMAL');
      setAssignedWorkerId('');
      setTask('Planned Production Specialist');
      setProductionNotes('');
    }
  }, [isOpen, initialOrder, products]);

  // Fetch recipe info when product or variant changes
  useEffect(() => {
    if (!isOpen || !product || !productVariant) {
      setRecipe(null);
      setRecipeLoading(false);
      setRecipeError(null);
      return;
    }

    let isMounted = true;
    setRecipeLoading(true);
    setRecipeError(null);

    api
      .getRecipe(product, productVariant)
      .then((data) => {
        if (!isMounted) return;
        const r = data?.data?.recipe || data?.recipe || data;
        if (r && r.expectedYield) {
          setRecipe(r);
          setRecipeError(null);
          // If the plannedQuantity is not a multiple of expectedYield, adjust it
          setPlannedQuantity((curr) => {
            const yieldVal = Number(r.expectedYield) || 1;
            const currentNum = Number(curr) || 1;
            if (currentNum % yieldVal !== 0) {
              const multiple = Math.ceil(currentNum / yieldVal) * yieldVal;
              return multiple > 0 ? multiple : yieldVal;
            }
            return currentNum;
          });
        } else {
          setRecipe(null);
          setRecipeError('No active recipe found for this variant. Please configure a recipe in the catalog.');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setRecipe(null);
        setRecipeError(err.message || 'No active recipe found for this variant.');
      })
      .finally(() => {
        if (isMounted) setRecipeLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, product, productVariant]);

  // Handle escape key and body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.body.classList.add('modal-open');

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('modal-open');
    };
  }, [isOpen, onClose]);

  const selectedProductObj = products.find((p) => p._id === product);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    // Business checks
    if (!product || !productVariant) {
      setFormError('Please select a product and specific variant.');
      return;
    }

    const qty = Number(plannedQuantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setFormError('Planned quantity must be a positive number.');
      return;
    }


    if (initialOrder?.holdState?.isOnHold) {
      setFormError(
        `Order ${initialOrder.orderNumber} is currently on Emergency Hold (${initialOrder.holdState.holdReason}). Held orders cannot be scheduled for production.`
      );
      return;
    }

    if (initialOrder?.status === 'CANCELLED') {
      setFormError(`Order ${initialOrder.orderNumber} is cancelled and cannot be scheduled for production.`);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        product,
        productVariant,
        plannedQuantity: qty,
        plannedStartTime: plannedStartTime ? new Date(plannedStartTime) : undefined,
        productionDate: plannedStartTime ? plannedStartTime.slice(0, 10) : undefined,
        timeSlot: plannedStartTime ? { startTime: plannedStartTime.slice(11, 16) } : undefined,
        batchType: initialOrder ? 'CUSTOMER_ORDER' : 'PLANNED_PRODUCTION',
        plannedReason: initialOrder ? undefined : plannedReason,
        priority,
        productionNotes: productionNotes.trim() || undefined,
        relatedOrders: initialOrder?._id ? [initialOrder._id] : [],
        assignedWorkers: assignedWorkerId
          ? [
              {
                worker: assignedWorkerId,
                task: task.trim() || (initialOrder ? 'Order Fulfillment Baker' : 'Planned Production Baker'),
              },
            ]
          : [],
      };

      const result = await api.createBatch(payload);
      const batchData = result?.data?.batch || result?.batch || result?.data || result;

      if (onBatchScheduled) {
        await onBatchScheduled(batchData);
      }
      onClose();
    } catch (err) {
      setFormError(err.message || 'Could not schedule production batch.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-batch-title"
      className="modal-backdrop-portal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) {
          onClose();
        }
      }}
      data-testid="batch-schedule-modal"
    >
      <div
        className="modal-dialog-centered"
        style={{
          maxWidth: '560px',
          width: '94%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: 'rgba(234, 88, 12, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ea580c',
              }}
            >
              <Calendar size={20} />
            </div>
            <div>
              <h3 id="schedule-batch-title" style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                {initialOrder ? `Schedule Batch: Order ${initialOrder.orderNumber}` : 'Schedule Planned Production'}
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {initialOrder ? 'Assign staff and schedule kitchen run for order' : 'Proactively schedule kitchen production without customer orders to build finished stock'}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close dialog"
            data-testid="schedule-batch-close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form id="schedule-batch-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Form Error Banner */}
            {formError && (
              <div
                style={{
                  backgroundColor: '#fff1f2',
                  border: '1px solid #fecdd3',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  color: '#9f1239',
                  fontSize: '0.86rem',
                }}
                data-testid="schedule-batch-error"
              >
                <AlertOctagon size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ flex: 1 }}>{formError}</div>
              </div>
            )}

            {/* Planned Production vs Linked Order Banner */}
            {!initialOrder ? (
              <div
                style={{
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  fontSize: '0.85rem',
                  color: '#166534',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Package size={16} style={{ flexShrink: 0 }} />
                <span>
                  <strong>Planned Production Mode:</strong> Proactive batch without customer orders. Packaged output will build finished-goods stock to fulfill future customer orders directly.
                </span>
              </div>
            ) : (
              <div
                style={{
                  backgroundColor: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  fontSize: '0.85rem',
                  color: '#1d4ed8',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    Fulfilling Order: <strong>{initialOrder.orderNumber}</strong> ({initialOrder.customerName || 'Customer'})
                  </span>
                  <span className="badge badge-info" style={{ fontSize: '0.75rem' }}>
                    {initialOrder.status}
                  </span>
                </div>
                {initialOrder.specialInstructions && (
                  <div style={{ marginTop: '4px', fontSize: '0.8rem', color: '#b45309' }}>
                    <strong>Note:</strong> {initialOrder.specialInstructions}
                  </div>
                )}
              </div>
            )}

            {/* Product Selection */}
            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                Product to Bake <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <select
                required
                className="input-field"
                value={product}
                onChange={(e) => {
                  const pId = e.target.value;
                  const prod = products.find((p) => p._id === pId);
                  const defaultVar = prod?.variants?.[0]?._id || '';
                  setProduct(pId);
                  setProductVariant(defaultVar);
                }}
                data-testid="schedule-product-select"
              >
                <option value="">Select Product...</option>
                {products.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} ({p.category?.name || 'Bakery'})
                  </option>
                ))}
              </select>
            </div>

            {/* Variant Selection */}
            {selectedProductObj && (
              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                  Product Variant <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <select
                  required
                  className="input-field"
                  value={productVariant}
                  onChange={(e) => setProductVariant(e.target.value)}
                  data-testid="schedule-variant-select"
                >
                  <option value="">Select Variant...</option>
                  {(selectedProductObj.variants || []).map((v) => (
                    <option key={v._id} value={v._id}>
                      {v.name} ({formatCurrency(v.price)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Recipe Info Pill */}
            {recipeLoading && (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div className="spinner" style={{ width: '12px', height: '12px' }} />
                <span>Checking recipe yield and requirements...</span>
              </div>
            )}

            {recipe && (
              <div
                style={{
                  backgroundColor: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.25)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '0.82rem',
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <ChefHat size={16} />
                <span>
                  Recipe Yield: <strong>{recipe.expectedYield} units</strong>
                </span>
                {(recipe.totalTimeMinutes || recipe.preparationTime || recipe.productionTime) && (
                  <span style={{ opacity: 0.85 }}>
                    • Duration: {formatDurationMinutes(recipe.totalTimeMinutes || ((recipe.preparationTime || 0) + (recipe.productionTime || 0)))}
                  </span>
                )}
              </div>
            )}

            {recipeError && (
              <div
                style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '0.82rem',
                  color: '#92400e',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertTriangle size={16} />
                <span>{recipeError}</span>
              </div>
            )}

            {/* Planned Reason & Priority (for Planned Production) */}
            {!initialOrder && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                    Planned Reason <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <select
                    className="input-field"
                    value={plannedReason}
                    onChange={(e) => setPlannedReason(e.target.value)}
                    data-testid="schedule-reason-select"
                  >
                    <option value="FESTIVAL_DEMAND">Festival Demand (Diwali, Eid, etc.)</option>
                    <option value="WEEKEND_DEMAND">Weekend Peak Demand</option>
                    <option value="STOCK_REPLENISHMENT">Stock Replenishment / Buffer Stock</option>
                    <option value="PROMOTIONAL">Promotional Campaign</option>
                    <option value="OTHER">Other Proactive Demand</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                    Production Priority
                  </label>
                  <select
                    className="input-field"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    data-testid="schedule-priority-select"
                  >
                    <option value="NORMAL">Normal Priority</option>
                    <option value="HIGH">High Priority</option>
                    <option value="URGENT">Urgent Priority</option>
                    <option value="LOW">Low Priority</option>
                  </select>
                </div>
              </div>
            )}

            {/* Quantity and Planned Start Time */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                  Planned Quantity {recipe?.yieldUnit ? `(${recipe.yieldUnit})` : ''} <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  className="input-field"
                  value={plannedQuantity}
                  onChange={(e) => setPlannedQuantity(e.target.value)}
                  placeholder="e.g. 12"
                  data-testid="schedule-quantity-input"
                />
                {recipe && (
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '3px', display: 'block' }}>
                    Must be multiple of {recipe.expectedYield} {recipe.yieldUnit || ''} (e.g. {recipe.expectedYield}, {recipe.expectedYield * 2})
                  </small>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                  Planned Start Time
                </label>
                <input
                  type="datetime-local"
                  className="input-field"
                  value={plannedStartTime}
                  onChange={(e) => setPlannedStartTime(e.target.value)}
                  data-testid="schedule-start-time-input"
                />
              </div>
            </div>

            {/* Staff Assignment */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                  Assign Primary Baker
                </label>
                <select
                  className="input-field"
                  value={assignedWorkerId}
                  onChange={(e) => setAssignedWorkerId(e.target.value)}
                  data-testid="schedule-baker-select"
                >
                  <option value="">Unassigned (Assign later)</option>
                  {workers
                    .filter((w) => w.isActive !== false)
                    .map((w) => (
                      <option key={w._id} value={w._id}>
                        {w.name} ({w.jobDesignation || 'Baker'})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                  Staff Task Role
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder="e.g. Primary Baker"
                  maxLength={100}
                />
              </div>
            </div>

            {/* Production Notes */}
            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                Production Notes & Special Instructions
              </label>
              <textarea
                rows={3}
                placeholder="Special kitchen instructions, temperature targets, or customer preferences..."
                className="input-field"
                value={productionNotes}
                onChange={(e) => setProductionNotes(e.target.value)}
                maxLength={500}
                data-testid="schedule-notes-input"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="modal-footer">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="btn btn-outline btn-sm"
              style={{ fontWeight: 600 }}
              data-testid="schedule-batch-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
                minWidth: '150px',
                justifyContent: 'center',
              }}
              data-testid="schedule-batch-submit"
            >
              {submitting ? (
                <>
                  <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />
                  <span>Scheduling...</span>
                </>
              ) : (
                <>
                  <Calendar size={16} />
                  <span>{initialOrder ? 'Schedule Batch' : 'Schedule Planned Production'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
