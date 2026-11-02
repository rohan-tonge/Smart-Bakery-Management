import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api, createNotificationEventSource } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  CheckCircle,
  CheckCircle2,
  Package,
  AlertTriangle,
  AlertCircle,
  AlertOctagon,
  Sparkles,
  Flame,
  Check,
  RefreshCw,
  Scale,
  XCircle,
  Layers,
  ChefHat,
  Clock,
  X,
  Plus,
  Trash2,
  FileText,
  ShieldAlert,
  Info,
} from 'lucide-react';
import StatusBadge from '../../components/StatusBadge';
import PageHeader from '../../components/PageHeader';
import ThemeToggle from '../../components/ThemeToggle';
import { useToast } from '../../context/ToastContext';
import { formatDurationMinutes } from '../../utils/duration';

// The simplified 5-stage / 6-action workflow
const WORKFLOW_STEPS = [
  { key: 'PLANNED', label: '1. Accept', stage: 1 },
  { key: 'ACCEPTED', label: '2. Verify', stage: 2 },
  { key: 'VERIFIED', label: '3. Start Baking', stage: 3 },
  { key: 'IN_PRODUCTION', label: '4. Record Output', stage: 4 },
  { key: 'PACKAGING', label: '5. Package', stage: 5 },
  { key: 'PACKAGED', label: '6. Complete', stage: 6 },
];

const COMPATIBLE_UNITS = ['kg', 'g', 'piece', 'L', 'ml', 'box', 'tray'];

export default function ProductionStaffDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const [batches, setBatches] = useState([]);
  const [metaInfo, setMetaInfo] = useState({ totalAll: 0, totalActive: 0, total: 0 });
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successNotice, setSuccessNotice] = useState(null);

  // Recipe Requirements state
  const [requirements, setRequirements] = useState(null);
  const [requirementsLoading, setRequirementsLoading] = useState(false);
  const [requirementsError, setRequirementsError] = useState(null);

  // Reject modal state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Stage 4: Record Baking Output State (Compact 3-field form)
  const [outputForm, setOutputForm] = useState({
    outputQuantity: '',
    outputUnit: 'kg',
    outputRemark: '',
  });

  // Stage 5: Split Packaging State
  const [splitPackages, setSplitPackages] = useState([
    { id: 1, packageNumber: 1, quantity: '', unit: 'kg', remark: '' },
  ]);
  const [packagingRemark, setPackagingRemark] = useState('');

  // Hold & Acknowledgement State
  const [bakerReportStage, setBakerReportStage] = useState('');
  const [bakerWorkCompleted, setBakerWorkCompleted] = useState('');
  const [bakerIngredientsConsumed, setBakerIngredientsConsumed] = useState(false);
  const [bakerSafeStoppingReached, setBakerSafeStoppingReached] = useState(false);
  const [bakerReportNote, setBakerReportNote] = useState('');
  const [submittingAcknowledge, setSubmittingAcknowledge] = useState(false);

  const selectedBatchRef = useRef(selectedBatch);
  selectedBatchRef.current = selectedBatch;

  const isBatchOnHold = Boolean(selectedBatch?.holdState?.isOnHold);
  const holdInstruction = selectedBatch?.holdState?.holdInstruction;
  const isStopImmediately = isBatchOnHold && holdInstruction === 'Stop production immediately';
  const isContinueStep = isBatchOnHold && holdInstruction === 'Continue current work temporarily';
  const isStopAfterStep = isBatchOnHold && holdInstruction === 'Stop after the current safe production step';
  const isSafePointReported = Boolean(selectedBatch?.holdState?.stepFinishedReported);

  const isStageActionBlocked = (stageActionName) => {
    if (!isBatchOnHold) return false;
    if (isStopImmediately) return true;
    if (isStopAfterStep && isSafePointReported) return true;
    const permitted = selectedBatch?.holdState?.permittedStep;
    if ((isContinueStep || isStopAfterStep) && permitted && stageActionName !== permitted) {
      return true;
    }
    return false;
  };

  const handleAcknowledgeHold = async (e) => {
    e?.preventDefault?.();
    if (!selectedBatch) return;
    setSubmittingAcknowledge(true);
    try {
      const payload = {
        currentStage: bakerReportStage || selectedBatch.status,
        workCompleted: bakerWorkCompleted,
        ingredientsConsumed: Boolean(bakerIngredientsConsumed),
        safeStoppingPointReached: Boolean(bakerSafeStoppingReached),
        note: bakerReportNote,
      };
      await api.acknowledgeBatchHold(selectedBatch._id, payload);
      notify('Production hold acknowledged. State report sent to manager.');
      await fetchProductionWork();
      await fetchBatchDetails(selectedBatch._id);
    } catch (err) {
      toast.error(err.message || 'Failed to acknowledge hold');
    } finally {
      setSubmittingAcknowledge(false);
    }
  };

  const notify = (msg) => {
    setSuccessNotice(msg);
    toast.success(msg);
    setTimeout(() => setSuccessNotice(null), 3500);
  };

  const fetchProductionWork = async (isBackground = false) => {
    try {
      if (!isBackground && batches.length === 0) {
        setLoading(true);
      }
      setError(null);

      let batchList = [];
      let meta = { totalAll: 0, totalActive: 0, total: 0 };

      try {
        const myRes = await api.getMyBatches({ active: 'true' });
        batchList = myRes.data?.batches || myRes.data || [];
        if (myRes.meta) meta = myRes.meta;
      } catch {
        const allRes = await api.getBatches();
        batchList = allRes.data?.batches || allRes.data || [];
        if (allRes.meta) meta = allRes.meta;
      }

      if (!batchList || batchList.length === 0) {
        try {
          const allRes = await api.getBatches();
          const generalBatches = allRes.data?.batches || allRes.data || [];
          if (generalBatches.length > 0) {
            batchList = generalBatches;
            if (allRes.meta) meta = allRes.meta;
          }
        } catch {
          // ignore
        }
      }

      // Filter exclusively to active workstation stages: PLANNED, ACCEPTED, VERIFIED, IN_PRODUCTION, PACKAGING, PACKAGED
      const ACTIVE_STATUSES = new Set(['PLANNED', 'ACCEPTED', 'VERIFIED', 'IN_PRODUCTION', 'PACKAGING', 'PACKAGED']);
      const activeBatches = (batchList || []).filter((b) => ACTIVE_STATUSES.has(b.status));

      // Canonical sort: newest orders first by createdAt descending
      const sortedBatches = [...activeBatches].sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        if (timeB !== timeA) {
          return timeB - timeA;
        }
        return String(b._id || '').localeCompare(String(a._id || ''));
      });

      setBatches(sortedBatches);
      setMetaInfo({
        totalAll: meta.totalAll ?? meta.total ?? batchList.length,
        totalActive: meta.totalActive ?? sortedBatches.length,
        total: sortedBatches.length,
      });

      if (sortedBatches.length > 0) {
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const targetBatchId = urlParams?.get('batchId') || urlParams?.get('batch');
        const targetBatch = targetBatchId
          ? sortedBatches.find((b) => b._id === targetBatchId || b.batchNumber === targetBatchId)
          : null;

        if (targetBatch) {
          setSelectedBatch(targetBatch);
        } else if (!selectedBatch) {
          setSelectedBatch(sortedBatches[0]);
        } else {
          const updated = sortedBatches.find((b) => b._id === selectedBatch._id);
          setSelectedBatch(updated || sortedBatches[0]);
        }
      } else {
        setSelectedBatch(null);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch production tasks');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectBatch = (b) => {
    setSelectedBatch(b);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (b?._id) {
        url.searchParams.set('batchId', b._id);
      } else {
        url.searchParams.delete('batchId');
        url.searchParams.delete('batch');
      }
      window.history.replaceState(null, '', url.toString());
    }
  };

  const fetchBatchDetails = async (batchId) => {
    if (!batchId) {
      setRequirements(null);
      return;
    }
    try {
      setRequirementsLoading(true);
      setRequirementsError(null);
      const reqsRes = await api.getBatchRequirements(batchId);
      const data = reqsRes?.data?.data || reqsRes?.data || reqsRes;
      setRequirements(data);
    } catch (err) {
      console.error('Failed to load batch requirements', err);
      setRequirements(null);
      setRequirementsError(err.message || 'Could not load recipe requirements');
    } finally {
      setRequirementsLoading(false);
    }
  };

  const otherHeldBatches = useMemo(() => {
    return batches.filter(
      (b) => b.holdState?.isOnHold && b._id !== selectedBatch?._id
    );
  }, [batches, selectedBatch?._id]);

  useEffect(() => {
    fetchProductionWork();

    let eventSource = null;
    try {
      eventSource = createNotificationEventSource();
      const onHoldEvent = () => {
        fetchProductionWork(true);
        if (selectedBatchRef.current?._id) {
          fetchBatchDetails(selectedBatchRef.current._id);
        }
      };
      eventSource.addEventListener('PRODUCTION_HOLD', onHoldEvent);
      eventSource.addEventListener('PRODUCTION_HOLD_UPDATED', onHoldEvent);
      eventSource.addEventListener('PRODUCTION_HOLD_RESOLVED', onHoldEvent);
    } catch {
      // fallback to polling
    }

    const pollInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchProductionWork(true);
        if (selectedBatchRef.current?._id) {
          fetchBatchDetails(selectedBatchRef.current._id);
        }
      }
    }, 4000);

    return () => {
      clearInterval(pollInterval);
      if (eventSource) eventSource.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedBatch?._id) {
      fetchBatchDetails(selectedBatch._id);

      if (selectedBatch.holdState?.isOnHold) {
        setBakerReportStage(selectedBatch.status);
        setBakerIngredientsConsumed(
          Boolean(
            (selectedBatch.consumedIngredients && selectedBatch.consumedIngredients.length > 0) ||
            selectedBatch.consumptionStatus === 'CONSUMED' ||
            ['IN_PRODUCTION', 'QUALITY_CHECK', 'PACKAGING', 'PACKAGED'].includes(selectedBatch.status)
          )
        );
      }

      // Initialize Stage 4 output form with batch values or defaults
      const defaultUnit = selectedBatch.actualOutputUnit || selectedBatch.unit || 'kg';
      setOutputForm({
        outputQuantity: selectedBatch.actualOutputQuantity != null ? String(selectedBatch.actualOutputQuantity) : '',
        outputUnit: defaultUnit,
        outputRemark: selectedBatch.bakerOutputRemark || '',
      });

      // Initialize Stage 5 split packages
      if (selectedBatch.packages && selectedBatch.packages.length > 0) {
        setSplitPackages(
          selectedBatch.packages.map((pkg, idx) => ({
            id: idx + 1,
            packageNumber: pkg.packageNumber || idx + 1,
            quantity: String(pkg.quantity),
            unit: pkg.unit || defaultUnit,
            remark: pkg.remark || '',
          }))
        );
        setPackagingRemark(selectedBatch.packagingRemark || '');
      } else {
        // Default to single package matching output or planned quantity
        const initialQty = selectedBatch.actualOutputQuantity || selectedBatch.usableQuantity || selectedBatch.plannedQuantity || '';
        setSplitPackages([
          { id: 1, packageNumber: 1, quantity: String(initialQty), unit: defaultUnit, remark: 'Standard Pack' },
        ]);
        setPackagingRemark(selectedBatch.packagingRemark || '');
      }

      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (url.searchParams.get('batchId') !== selectedBatch._id) {
          url.searchParams.set('batchId', selectedBatch._id);
          window.history.replaceState(null, '', url.toString());
        }
      }
    } else {
      setRequirements(null);
    }
  }, [selectedBatch?._id]);

  const getBatchPlanPayload = (batch) => {
    return {
      batchNumber: batch.batchNumber,
      product: batch.product?._id || batch.product,
      plannedQuantity: batch.plannedQuantity,
      relatedOrders: (batch.relatedOrders || []).map((o) => o._id || o),
      assignedWorkers: (batch.assignedWorkers || []).map(
        (w) => w.worker?._id || w.worker || w._id || w
      ),
    };
  };

  // Helper for workflow step indexing
  const getStepIndex = (status) => {
    const idx = WORKFLOW_STEPS.findIndex((s) => s.key === status);
    return idx >= 0 ? idx : 0;
  };

  // -------------------------------------------------------------
  // STAGE 1 ACTION: Accept Batch
  // -------------------------------------------------------------
  const handleAcceptBatch = async () => {
    if (!selectedBatch) return;
    try {
      setActionLoading(true);
      const planPayload = getBatchPlanPayload(selectedBatch);
      await api.acceptBatch(selectedBatch._id, planPayload);
      notify(`Batch ${selectedBatch.batchNumber} accepted! Review ingredients & equipment below.`);
      await fetchProductionWork();
      await fetchBatchDetails(selectedBatch._id);
    } catch (err) {
      alert(`Accept failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Reject Batch Modal action
  const handleRejectBatch = async (e) => {
    e.preventDefault();
    if (!selectedBatch || !rejectReason.trim()) return;
    try {
      setActionLoading(true);
      await api.rejectBatch(selectedBatch._id, rejectReason.trim());
      notify(`Batch ${selectedBatch.batchNumber} assignment rejected.`);
      setShowRejectModal(false);
      setRejectReason('');
      await fetchProductionWork();
    } catch (err) {
      alert(`Reject failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // -------------------------------------------------------------
  // STAGE 2 ACTION: Verify Ingredients, Weights & Equipment
  // -------------------------------------------------------------
  const handleVerifyBatch = async () => {
    if (!selectedBatch) return;
    try {
      setActionLoading(true);
      const planPayload = getBatchPlanPayload(selectedBatch);
      await api.verifyBatch(selectedBatch._id, planPayload);
      notify(`Ingredients, weights & equipment confirmed for ${selectedBatch.batchNumber}! Ready to bake.`);
      await fetchProductionWork(true);
      await fetchBatchDetails(selectedBatch._id);
    } catch (err) {
      alert(`Verification failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // -------------------------------------------------------------
  // STAGE 3 ACTION: Start Baking
  // -------------------------------------------------------------
  const handleStartBatch = async () => {
    if (!selectedBatch) return;
    try {
      setActionLoading(true);
      await api.startBatch(selectedBatch._id, { autoConsume: true });
      notify(`Oven & mixing started for batch ${selectedBatch.batchNumber}! Active baking in progress.`);
      await fetchProductionWork(true);
      await fetchBatchDetails(selectedBatch._id);
    } catch (err) {
      alert(`Start failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // -------------------------------------------------------------
  // STAGE 4 ACTION: Record Baking Output (Compact 3-field form)
  // -------------------------------------------------------------
  const handleRecordOutput = async (e) => {
    e.preventDefault();
    if (!selectedBatch) return;

    const qty = Number(outputForm.outputQuantity);
    if (!qty || qty <= 0 || isNaN(qty)) {
      alert('Please enter a valid positive numeric output weight/quantity');
      return;
    }
    if (!outputForm.outputUnit) {
      alert('Please select a corresponding unit for the output');
      return;
    }

    try {
      setActionLoading(true);
      const res = await api.completeBatch(selectedBatch._id, {
        outputQuantity: qty,
        outputUnit: outputForm.outputUnit,
        outputRemark: outputForm.outputRemark.trim() || undefined,
        producedQuantity: qty,
        usableQuantity: qty,
        wastageQuantity: 0,
      });
      const updatedBatch = res?.data?.batch;
      if (updatedBatch) {
        setSelectedBatch(updatedBatch);
      }
      notify(`Baking output recorded (${qty} ${outputForm.outputUnit})! Ready for packaging.`);
      await fetchProductionWork(true);
    } catch (err) {
      alert(`Recording output failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // -------------------------------------------------------------
  // STAGE 5 ACTIONS: Split Packaging
  // -------------------------------------------------------------
  const baseAvailableOutput = useMemo(() => {
    if (!selectedBatch) return 0;
    return selectedBatch.actualOutputQuantity ?? selectedBatch.usableQuantity ?? selectedBatch.plannedQuantity ?? 0;
  }, [selectedBatch]);

  const baseUnit = useMemo(() => {
    if (!selectedBatch) return 'kg';
    return selectedBatch.actualOutputUnit || selectedBatch.unit || 'kg';
  }, [selectedBatch]);

  const handleAddPackageRow = () => {
    setSplitPackages((prev) => [
      ...prev,
      {
        id: Date.now(),
        packageNumber: prev.length + 1,
        quantity: '',
        unit: baseUnit,
        remark: `Pack ${prev.length + 1}`,
      },
    ]);
  };

  const handleRemovePackageRow = (id) => {
    if (splitPackages.length <= 1) return;
    setSplitPackages((prev) =>
      prev.filter((p) => p.id !== id).map((p, idx) => ({ ...p, packageNumber: idx + 1 }))
    );
  };

  const handlePackageRowChange = (id, field, value) => {
    setSplitPackages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  // Running total calculation with unit conversion (e.g. g to kg)
  const totalPackagedQuantity = useMemo(() => {
    return splitPackages.reduce((acc, pkg) => {
      const q = parseFloat(pkg.quantity);
      if (isNaN(q) || q <= 0) return acc;
      if (pkg.unit === baseUnit) return acc + q;
      // Convert g <-> kg
      if (pkg.unit === 'g' && baseUnit === 'kg') return acc + q / 1000;
      if (pkg.unit === 'kg' && baseUnit === 'g') return acc + q * 1000;
      // Convert ml <-> L
      if (pkg.unit === 'ml' && baseUnit === 'L') return acc + q / 1000;
      if (pkg.unit === 'L' && baseUnit === 'ml') return acc + q * 1000;
      return acc + q;
    }, 0);
  }, [splitPackages, baseUnit]);

  const remainingOutput = Math.max(0, Number((baseAvailableOutput - totalPackagedQuantity).toFixed(4)));
  const isOverpackaged = totalPackagedQuantity > baseAvailableOutput + 0.0001;

  const handleSavePackaging = async (e) => {
    console.log("DEBUG_PKG_STATE: " + JSON.stringify({
      selectedBatchId: selectedBatch?._id,
      splitPackages,
      baseUnit,
      baseAvailableOutput,
      totalPackagedQuantity,
      isOverpackaged,
    }));
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    if (!selectedBatch) {
      console.log("DEBUG_PKG: selectedBatch is null");
      return;
    }

    if (splitPackages.some((p) => !p.quantity || Number(p.quantity) <= 0)) {
      console.log("DEBUG_PKG: invalid quantity in splitPackages", JSON.stringify(splitPackages));
      alert('All packages must have a valid quantity greater than 0');
      return;
    }

    if (isOverpackaged) {
      console.log("DEBUG_PKG: overpackaged", totalPackagedQuantity, baseAvailableOutput);
      alert(`Total packaged quantity (${totalPackagedQuantity} ${baseUnit}) cannot exceed available baking output (${baseAvailableOutput} ${baseUnit})`);
      return;
    }

    try {
      console.log("DEBUG_PKG: Calling api.packageBatch with ID:", selectedBatch._id);
      setActionLoading(true);
      const packagesPayload = splitPackages.map((p, idx) => ({
        packageNumber: idx + 1,
        quantity: Number(p.quantity),
        unit: p.unit,
        remark: p.remark?.trim() || undefined,
      }));

      const res = await api.packageBatch(selectedBatch._id, {
        packagedQuantity: Number(totalPackagedQuantity.toFixed(4)),
        packages: packagesPayload,
        packagingRemark: packagingRemark.trim() || undefined,
      });

      console.log("DEBUG_PKG: api.packageBatch success:", JSON.stringify(res?.data?.batch?.status));
      const updatedBatch = res?.data?.batch;
      if (updatedBatch) {
        setSelectedBatch(updatedBatch);
      }

      notify(`Packaging saved! Total packaged: ${totalPackagedQuantity} ${baseUnit}. Ready to complete.`);
      await fetchProductionWork(true);
    } catch (err) {
      console.log('DEBUG_PKG: Packaging failed error:', err.message || String(err));
      alert(`Packaging failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // -------------------------------------------------------------
  // STAGE 6 ACTION: Mark as Complete
  // -------------------------------------------------------------
  const handleMarkComplete = async () => {
    if (!selectedBatch) return;
    try {
      setActionLoading(true);
      const res = await api.finalizeBatch(selectedBatch._id);
      const completedBatch = res?.data?.batch || { ...selectedBatch, status: 'COMPLETED' };
      setSelectedBatch(completedBatch);
      notify(`Batch ${selectedBatch.batchNumber} marked COMPLETED! Associated order is now READY.`);
      await fetchProductionWork(true);
      // Keep completed batch selected so baker sees the completion banner & confirmation
      setSelectedBatch(completedBatch);
    } catch (err) {
      alert(`Finalize failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  useEffect(() => {
    window.__savePackaging = handleSavePackaging;
    window.__markComplete = handleMarkComplete;
    return () => {
      delete window.__savePackaging;
      delete window.__markComplete;
    };
  }, [handleSavePackaging, handleMarkComplete]);

  // Collect customer remarks and pack instructions
  const customerRemarks = useMemo(() => {
    if (!selectedBatch) return [];
    const list = [];
    if (selectedBatch.relatedOrders && Array.isArray(selectedBatch.relatedOrders)) {
      selectedBatch.relatedOrders.forEach((ro) => {
        const orderNum = ro.orderNumber || (typeof ro === 'string' ? ro : ro._id);
        const remarks = ro.specialInstructions;
        const packPref = ro.packInstructions;
        const contactName = ro.contactName;
        const contactPhone = ro.contactPhone;
        const deliveryDate = ro.deliveryDate;
        const deliverySlot = ro.deliveryTimeSlot;
        if (remarks || packPref || contactName) {
          list.push({
            orderNumber: orderNum,
            remarks: remarks || '',
            packInstructions: packPref || '',
            contactName: contactName || '',
            contactPhone: contactPhone || '',
            deliveryDate: deliveryDate || '',
            deliverySlot: deliverySlot || '',
          });
        }
      });
    }
    // If productionNotes exists and is distinct
    if (selectedBatch.productionNotes && !list.some((r) => r.remarks === selectedBatch.productionNotes)) {
      list.push({
        orderNumber: 'Batch Instruction',
        remarks: selectedBatch.productionNotes,
        packInstructions: '',
      });
    }
    return list;
  }, [selectedBatch]);

  return (
    <div className="container production-dashboard" style={{ padding: '2rem 1.25rem 4rem 1.25rem', maxWidth: '1280px' }}>
      {/* Toast Notice */}
      {successNotice && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            backgroundColor: '#16a34a',
            color: '#ffffff',
            padding: '12px 20px',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontWeight: 700,
          }}
        >
          <Check size={18} />
          <span>{successNotice}</span>
        </div>
      )}

      {/* Header */}
      <PageHeader
        title="Kitchen Production Workstation"
        subtitle="Accept → Verify → Bake → Record Output → Package → Complete"
        badge={
          <div style={{ display: 'flex', gap: '6px' }}>
            <span className="badge badge-info">Production Workstation</span>
            {user?.name && <span className="badge badge-success">Baker: {user.name}</span>}
          </div>
        }
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <ThemeToggle />
            <button
              type="button"
              onClick={fetchProductionWork}
              disabled={loading}
              className="btn btn-outline btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: '44px' }}
            >
              <RefreshCw size={15} />
              <span>Refresh Queue</span>
            </button>
          </div>
        }
      />

      {/* FLOATING TOP EMERGENCY ALERT FOR OTHER HELD BATCHES */}
      {otherHeldBatches.length > 0 && (
        <div
          style={{
            backgroundColor: '#fff1f2',
            border: '2px solid #e11d48',
            borderRadius: '10px',
            padding: '10px 16px',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            boxShadow: '0 4px 12px rgba(225, 29, 72, 0.15)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9f1239' }}>
            <span style={{ fontSize: '1.3rem' }}>🚨</span>
            <div>
              <strong>EMERGENCY ALERT:</strong> Batch <strong>{otherHeldBatches[0].batchNumber}</strong> ({otherHeldBatches[0].productSnapshot?.productName || otherHeldBatches[0].product?.name}) is on Hold!
              <span style={{ fontSize: '0.82rem', marginLeft: '6px', color: '#be123c' }}>
                Reason: {otherHeldBatches[0].holdState?.holdReason}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleSelectBatch(otherHeldBatches[0])}
            className="btn btn-primary btn-sm"
            style={{ backgroundColor: '#be123c', borderColor: '#be123c' }}
          >
            Switch to This Batch
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '5rem 0' }}>
          <div className="spinner" style={{ margin: '0 auto 1rem auto' }}></div>
          <p style={{ color: 'var(--text-muted)' }}>Loading kitchen workstation queue...</p>
        </div>
      ) : error ? (
        <div
          className="alert alert-danger"
          role="alert"
          style={{
            marginBottom: '2rem',
            padding: '1.25rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <AlertCircle size={24} style={{ flexShrink: 0 }} />
            <div>
              <strong style={{ display: 'block', fontSize: '0.98rem', marginBottom: '2px' }}>
                Failed to Load Kitchen Workstation
              </strong>
              <span style={{ fontSize: '0.88rem' }}>{error}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchProductionWork}
            className="btn btn-primary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: '38px', padding: '0 1.25rem' }}
          >
            <RefreshCw size={15} />
            <span>Retry</span>
          </button>
        </div>
      ) : (
        <div
          className="production-layout"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 340px) minmax(0, 1fr)',
            gap: '1.5rem',
            alignItems: 'start',
          }}
        >
          {/* ========================================================================= */}
          {/* LEFT COLUMN: ASSIGNED BATCHES LIST */}
          {/* ========================================================================= */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
                paddingBottom: '0.75rem',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <h2
                style={{
                  fontSize: '1.15rem',
                  fontWeight: 800,
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--text-main)',
                }}
              >
                <ChefHat size={18} color="var(--primary)" />
                <span>Assigned Batches ({batches.length})</span>
              </h2>
            </div>

            {batches.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                <Package size={38} style={{ margin: '0 auto 0.85rem auto', opacity: 0.45 }} />
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.35rem' }}>
                  No Active Workstation Batches
                </h3>
                <p style={{ margin: 0, fontSize: '0.86rem', lineHeight: 1.5 }}>
                  No production batches are currently waiting at your station.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {batches.map((b) => {
                  const isSelected = selectedBatch?._id === b._id;

                  // Extract remarks snippet
                  const cardRemarks = (b.relatedOrders || [])
                    .map((ro) => ro.specialInstructions || ro.packInstructions)
                    .filter(Boolean)
                    .concat(b.productionNotes ? [b.productionNotes] : []);
                  const uniqueCardRemarks = [...new Set(cardRemarks)];

                  return (
                    <button
                      type="button"
                      key={b._id}
                      onClick={() => handleSelectBatch(b)}
                      aria-pressed={isSelected}
                      className={`kitchen-batch-card ${isSelected ? 'kitchen-batch-card-active' : ''}`}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                        padding: '12px 14px',
                        borderRadius: '12px',
                        border: b.holdState?.isOnHold ? '2px solid #e11d48' : isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                        backgroundColor: isSelected ? 'var(--primary-light)' : 'var(--card-bg)',
                        cursor: 'pointer',
                        boxShadow: isSelected ? 'var(--shadow-sm)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '4px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <strong style={{ fontSize: '0.98rem', color: 'var(--text-main)' }}>{b.batchNumber}</strong>
                          {b.holdState?.isOnHold && (
                            <span style={{ backgroundColor: '#be123c', color: '#fff', fontSize: '0.68rem', fontWeight: 800, padding: '1px 6px', borderRadius: '4px' }}>
                              ON HOLD
                            </span>
                          )}
                          {b.batchType === 'PLANNED_PRODUCTION' && (
                            <span style={{ backgroundColor: '#0d9488', color: '#fff', fontSize: '0.68rem', fontWeight: 800, padding: '1px 6px', borderRadius: '4px' }}>
                              PLANNED
                            </span>
                          )}
                        </div>
                        <StatusBadge status={b.status} size="sm" />
                      </div>

                      <div style={{ fontSize: '0.92rem', color: 'var(--text-main)', fontWeight: 700 }}>
                        {b.product?.name || b.productSnapshot?.productName || 'Bakery Product'}
                      </div>

                      <div
                        style={{
                          fontSize: '0.78rem',
                          color: 'var(--text-muted)',
                          marginTop: '4px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '4px',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>Target: {b.plannedQuantity} {b.unit || 'units'}</span>
                        <span>
                          {b.createdAt
                            ? new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : 'Active'}
                        </span>
                      </div>

                      {/* Planned production tag on card */}
                      {b.batchType === 'PLANNED_PRODUCTION' && (
                        <div
                          style={{
                            marginTop: '6px',
                            fontSize: '0.74rem',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            backgroundColor: '#ccfbf1',
                            color: '#0f766e',
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={`Planned Production: ${b.plannedReason || 'Finished Stock Replenishment'}`}
                        >
                          📦 Planned: {b.plannedReason || 'Finished Stock'}
                        </div>
                      )}

                      {/* Customer remarks snippet on card */}
                      {uniqueCardRemarks.length > 0 && (
                        <div
                          style={{
                            marginTop: '6px',
                            fontSize: '0.75rem',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            backgroundColor: '#fef3c7',
                            color: '#92400e',
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={uniqueCardRemarks.join(' | ')}
                        >
                          💬 Customer: {uniqueCardRemarks[0]}
                        </div>
                      )}

                      {/* Owner instructions snippet on card */}
                      {b.ownerInstructions && (
                        <div
                          style={{
                            marginTop: '4px',
                            fontSize: '0.73rem',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            backgroundColor: '#ede9fe',
                            color: '#6b21a8',
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={b.ownerInstructions}
                        >
                          👑 Owner: {b.ownerInstructions}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* RIGHT COLUMN: WORKSTATION OPERATING CONSOLE */}
          {/* ========================================================================= */}
          {selectedBatch ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Batch Console Header Card */}
              <div className="card" style={{ padding: '1.75rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    gap: '1rem',
                    marginBottom: '1.25rem',
                  }}
                >
                  <div>
                    <span className="badge badge-info" style={{ marginBottom: '6px' }}>
                      Station Console
                    </span>
                    <h2 style={{ fontSize: '1.65rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                      {selectedBatch.batchNumber}
                    </h2>
                    <div style={{ fontSize: '1.1rem', color: 'var(--text-main)', marginTop: '4px', fontWeight: 700 }}>
                      {selectedBatch.product?.name || selectedBatch.productSnapshot?.productName} · Target Yield: {selectedBatch.plannedQuantity} {selectedBatch.unit || 'units'}
                      {selectedBatch.batchType === 'PLANNED_PRODUCTION' && (
                        <span className="badge" style={{ marginLeft: '10px', backgroundColor: '#0d9488', color: '#fff', fontSize: '0.78rem', verticalAlign: 'middle', fontWeight: 700 }}>
                          ✨ Planned ({selectedBatch.plannedReason || 'Finished Stock'})
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <StatusBadge status={selectedBatch.status} size="lg" />
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                      Station: <strong>{user?.name || 'Assigned Baker'}</strong>
                    </div>
                  </div>
                </div>

                {/* Visual 5-Stage / 6-Action Progression Bar */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                    Workflow Progression
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '6px',
                      overflowX: 'auto',
                      paddingBottom: '4px',
                    }}
                  >
                    {WORKFLOW_STEPS.map((step, idx) => {
                      const currentIdx = getStepIndex(selectedBatch.status);
                      const isPast = idx < currentIdx;
                      const isCurrent = idx === currentIdx;

                      return (
                        <div
                          key={step.key}
                          style={{
                            flex: 1,
                            minWidth: '85px',
                            padding: '8px 6px',
                            borderRadius: '8px',
                            textAlign: 'center',
                            fontSize: '0.76rem',
                            fontWeight: isCurrent ? 800 : 600,
                            backgroundColor: isCurrent
                              ? 'var(--primary)'
                              : isPast
                              ? '#dcfce7'
                              : 'var(--bg-main)',
                            color: isCurrent
                              ? '#ffffff'
                              : isPast
                              ? '#15803d'
                              : 'var(--text-muted)',
                            border: isCurrent
                              ? '1.5px solid var(--primary-dark)'
                              : '1px solid var(--border-color)',
                          }}
                        >
                          {step.label}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ===================================================================== */}
                {/* EMERGENCY PRODUCTION HOLD BANNER ON WORKSTATION */}
                {/* ===================================================================== */}
                {isBatchOnHold && (
                  <div
                    style={{
                      backgroundColor: '#fff1f2',
                      border: '2px solid #e11d48',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      marginBottom: '1.25rem',
                      boxShadow: '0 4px 12px rgba(225, 29, 72, 0.15)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1.5rem' }}>🚨</span>
                        <div>
                          <h3 style={{ margin: 0, color: '#9f1239', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            EMERGENCY PRODUCTION HOLD ACTIVE
                            <span className="badge badge-danger">v{selectedBatch.holdState.instructionVersion || 1}</span>
                          </h3>
                          <span style={{ fontSize: '0.82rem', color: '#be123c' }}>
                            Placed at {new Date(selectedBatch.holdState.holdRequestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by management
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="badge badge-danger" style={{ fontSize: '0.85rem' }}>
                          Reason: {selectedBatch.holdState.holdReason}
                        </span>
                      </div>
                    </div>

                    {/* Instruction callout */}
                    <div
                      style={{
                        backgroundColor: '#ffffff',
                        border: '1.5px solid #f43f5e',
                        borderRadius: '8px',
                        padding: '0.85rem 1rem',
                        marginBottom: '0.75rem',
                      }}
                    >
                      <div style={{ fontSize: '0.82rem', textTransform: 'uppercase', color: '#be123c', fontWeight: 'bold', marginBottom: '2px' }}>
                        Management Instruction for Baker
                      </div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: isStopImmediately ? '#be123c' : '#b45309' }}>
                        {selectedBatch.holdState.holdInstruction}
                      </div>
                      {selectedBatch.holdState.ownerNote && (
                        <div style={{ marginTop: '4px', fontSize: '0.88rem', color: '#4b5563' }}>
                          <strong>Note from Owner:</strong> {selectedBatch.holdState.ownerNote}
                        </div>
                      )}
                    </div>

                    {/* Batch & Orders Details */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', fontSize: '0.85rem', color: '#881337', marginBottom: '0.75rem' }}>
                      <div><strong>Batch ID:</strong> {selectedBatch.batchNumber}</div>
                      <div><strong>Product:</strong> {selectedBatch.productSnapshot?.productName || selectedBatch.product?.name}</div>
                      <div><strong>Target Quantity:</strong> {selectedBatch.plannedQuantity} {selectedBatch.unit}</div>
                      <div><strong>Order ID(s):</strong> {selectedBatch.batchType === 'PLANNED_PRODUCTION' ? 'None (Building Finished Stock)' : ((selectedBatch.relatedOrders || []).map(o => o.orderNumber || o._id || o).join(', ') || 'Direct Production')}</div>
                    </div>

                    {/* Baker Response / Acknowledgement Section */}
                    <div style={{ borderTop: '1px solid #fecdd3', paddingTop: '0.75rem' }}>
                      {selectedBatch.holdState.bakerAcknowledged ? (
                        <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#166534', fontWeight: 'bold', marginBottom: '4px' }}>
                            <CheckCircle2 size={16} /> Acknowledged by Baker ({new Date(selectedBatch.holdState.bakerAcknowledgedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                          </div>
                          <div style={{ fontSize: '0.85rem', color: '#15803d', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '6px' }}>
                            <div><strong>Reported Stage:</strong> {selectedBatch.holdState.bakerResponse?.currentStage}</div>
                            <div><strong>Ingredients Consumed:</strong> {selectedBatch.holdState.bakerResponse?.ingredientsConsumed ? 'Yes' : 'No'}</div>
                            {selectedBatch.holdState.bakerResponse?.safeStoppingPointReached && (
                              <div><strong>Safe Stop Point:</strong> Reached</div>
                            )}
                            {selectedBatch.holdState.bakerResponse?.workCompleted && (
                              <div><strong>Work Done:</strong> {selectedBatch.holdState.bakerResponse.workCompleted}</div>
                            )}
                          </div>
                          {selectedBatch.holdState.bakerResponse?.note && (
                            <div style={{ marginTop: '4px', fontSize: '0.82rem', color: '#374151' }}>
                              <strong>Baker Note:</strong> {selectedBatch.holdState.bakerResponse.note}
                            </div>
                          )}
                          <div style={{ marginTop: '6px', fontSize: '0.82rem', color: '#6b7280', fontStyle: 'italic' }}>
                            Awaiting owner/manager hold resolution or instruction update.
                          </div>
                        </div>
                      ) : (
                        <form onSubmit={handleAcknowledgeHold} style={{ backgroundColor: '#ffffff', border: '1px solid #fda4af', borderRadius: '8px', padding: '12px' }}>
                          <div style={{ fontWeight: 'bold', color: '#9f1239', marginBottom: '8px', fontSize: '0.92rem' }}>
                            Baker Action Required: Acknowledge & Report Current State
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 'bold', marginBottom: '2px' }}>
                                Current Production Stage
                              </label>
                              <input
                                type="text"
                                className="input-field"
                                value={bakerReportStage}
                                onChange={(e) => setBakerReportStage(e.target.value)}
                                placeholder={selectedBatch.status}
                                style={{ margin: 0, padding: '4px 8px', fontSize: '0.85rem' }}
                                required
                              />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 'bold', marginBottom: '2px' }}>
                                Work Completed So Far
                              </label>
                              <input
                                type="text"
                                className="input-field"
                                value={bakerWorkCompleted}
                                onChange={(e) => setBakerWorkCompleted(e.target.value)}
                                placeholder="e.g., dough mixed, currently in oven..."
                                style={{ margin: 0, padding: '4px 8px', fontSize: '0.85rem' }}
                              />
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '10px', fontSize: '0.85rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={bakerIngredientsConsumed}
                                onChange={(e) => setBakerIngredientsConsumed(e.target.checked)}
                              />
                              <span>Ingredients have already been mixed or consumed</span>
                            </label>

                            {(isStopAfterStep || isContinueStep) && (
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={bakerSafeStoppingReached}
                                  onChange={(e) => setBakerSafeStoppingReached(e.target.checked)}
                                />
                                <span>Safe stopping point reached (ready to pause)</span>
                              </label>
                            )}
                          </div>

                          <div style={{ marginBottom: '10px' }}>
                            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 'bold', marginBottom: '2px' }}>
                              Baker Notes / Obstacles (Optional)
                            </label>
                            <input
                              type="text"
                              className="input-field"
                              value={bakerReportNote}
                              onChange={(e) => setBakerReportNote(e.target.value)}
                              placeholder="e.g., Oven timer has 5 mins left, stopping now would ruin the rise..."
                              style={{ margin: 0, padding: '4px 8px', fontSize: '0.85rem' }}
                            />
                          </div>

                          <button
                            type="submit"
                            disabled={submittingAcknowledge}
                            className="btn btn-primary btn-sm"
                            style={{ backgroundColor: '#e11d48', borderColor: '#e11d48' }}
                          >
                            {submittingAcknowledge ? 'Acknowledging...' : 'Acknowledge Hold & Report Status'}
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                )}

                {/* ===================================================================== */}
                {/* DEDICATED CUSTOMER REMARKS & OWNER INSTRUCTIONS BOX */}
                {/* Visible before acceptance and through all subsequent stages */}
                {/* ===================================================================== */}
                <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {/* Customer Remarks Box or Planned Production Banner */}
                  {selectedBatch.batchType === 'PLANNED_PRODUCTION' ? (
                    <div
                      style={{
                        backgroundColor: '#f0fdfa',
                        border: '1.5px solid #99f6e4',
                        borderRadius: '12px',
                        padding: '1rem 1.25rem',
                      }}
                      data-testid="planned-production-banner"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '0.6rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#0f766e' }}>
                          <Package size={18} />
                          <strong style={{ fontSize: '1rem' }}>Planned Production — Stock Replenishment</strong>
                        </div>
                        <span className="badge" style={{ backgroundColor: '#0d9488', color: '#fff', fontWeight: 700 }}>
                          PLANNED BATCH
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px', fontSize: '0.88rem', color: '#134e4a' }}>
                        <div><strong>Production Type:</strong> Planned Production</div>
                        <div><strong>Reason:</strong> {selectedBatch.plannedReason || 'Building finished goods stock'}</div>
                        <div><strong>Priority:</strong> {selectedBatch.priority || 'NORMAL'}</div>
                        <div><strong>Associated Customer Order:</strong> None (Building Finished Stock)</div>
                      </div>
                      {selectedBatch.productionNotes && (
                        <div style={{ marginTop: '8px', fontSize: '0.86rem', color: '#0f766e', borderTop: '1px dashed #99f6e4', paddingTop: '6px' }}>
                          <strong>Production Notes:</strong> {selectedBatch.productionNotes}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      style={{
                        backgroundColor: '#fffbeb',
                        border: '1.5px solid #fde68a',
                        borderRadius: '12px',
                        padding: '1rem 1.25rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem', color: '#92400e' }}>
                        <FileText size={18} />
                        <strong style={{ fontSize: '0.95rem' }}>Customer Remarks & Special Instructions</strong>
                      </div>

                      {customerRemarks.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                          {customerRemarks.map((item, idx) => (
                            <div
                              key={idx}
                              style={{
                                backgroundColor: '#ffffff',
                                border: '1px solid #fef3c7',
                                borderRadius: '8px',
                                padding: '8px 12px',
                                fontSize: '0.88rem',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                <span style={{ fontWeight: 700, color: '#92400e' }}>
                                  Order #{item.orderNumber}
                                  {item.contactName ? ` (${item.contactName})` : ''}
                                </span>
                                {(item.deliveryDate || item.deliverySlot) && (
                                  <span style={{ fontSize: '0.76rem', color: '#b45309', fontWeight: 600 }}>
                                    Target Delivery: {item.deliveryDate} {item.deliverySlot ? `· Slot: ${item.deliverySlot}` : ''}
                                  </span>
                                )}
                              </div>
                              {item.remarks && (
                                <div style={{ color: '#78350f', marginBottom: item.packInstructions ? '4px' : '0' }}>
                                  <span style={{ fontWeight: 600 }}>Customer Note:</span> {item.remarks}
                                </div>
                              )}
                              {item.packInstructions && (
                                <div style={{ color: '#0369a1', fontWeight: 600 }}>
                                  📦 Requested Pack Size: {item.packInstructions}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#92400e' }}>
                          No special customer remarks recorded for this batch.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Owner Instructions Box (if present) */}
                  {selectedBatch.ownerInstructions && (
                    <div
                      style={{
                        backgroundColor: '#f5f3ff',
                        border: '1.5px solid #ddd6fe',
                        borderRadius: '12px',
                        padding: '1rem 1.25rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.4rem', color: '#6b21a8' }}>
                        <ChefHat size={18} />
                        <strong style={{ fontSize: '0.95rem' }}>Owner Instructions (Managerial Notes)</strong>
                      </div>
                      <div style={{ fontSize: '0.88rem', color: '#5b21b6', fontWeight: 500 }}>
                        {selectedBatch.ownerInstructions}
                      </div>
                    </div>
                  )}

                  {/* Baker's Output Remark (if recorded in Stage 4) */}
                  {selectedBatch.bakerOutputRemark && (
                    <div
                      style={{
                        backgroundColor: '#f0fdf4',
                        border: '1.5px solid #bbf7d0',
                        borderRadius: '12px',
                        padding: '0.75rem 1.25rem',
                        fontSize: '0.88rem',
                        color: '#166534',
                      }}
                    >
                      <strong>Baker's Output Remark:</strong> {selectedBatch.bakerOutputRemark}
                    </div>
                  )}

                  {/* Packaging Remark (if recorded in Stage 5) */}
                  {selectedBatch.packagingRemark && (
                    <div
                      style={{
                        backgroundColor: '#eff6ff',
                        border: '1.5px solid #bfdbfe',
                        borderRadius: '12px',
                        padding: '0.75rem 1.25rem',
                        fontSize: '0.88rem',
                        color: '#1e40af',
                      }}
                    >
                      <strong>Packaging Remark:</strong> {selectedBatch.packagingRemark}
                    </div>
                  )}
                </div>

                {/* ===================================================================== */}
                {/* STAGE-SPECIFIC VIEWS & ACTIONS */}
                {/* ===================================================================== */}

                {/* ------------------------------------------------------------------- */}
                {/* STAGE 1: ACCEPT */}
                {/* ------------------------------------------------------------------- */}
                {selectedBatch.status === 'PLANNED' && (
                  <div
                    style={{
                      borderTop: '1px solid var(--border-color)',
                      paddingTop: '1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '1rem',
                    }}
                  >
                    <div
                      style={{
                        padding: '12px 16px',
                        backgroundColor: 'var(--bg-main)',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.88rem',
                        color: 'var(--text-main)',
                      }}
                    >
                      <strong>Stage 1 - Accept Assignment:</strong> Please review the customer remarks and batch details above before accepting this production batch. On acceptance, the recipe ingredients and equipment requirements will appear.
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        type="button"
                        disabled={actionLoading || isStageActionBlocked('ACCEPT')}
                        onClick={handleAcceptBatch}
                        className="btn btn-primary btn-lg"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '48px', padding: '0 1.5rem', opacity: isStageActionBlocked('ACCEPT') ? 0.5 : 1 }}
                        title={isStageActionBlocked('ACCEPT') ? `Blocked by Emergency Hold: ${holdInstruction}` : ''}
                      >
                        <CheckCircle size={18} />
                        <span>Accept Batch</span>
                      </button>
                      {isStageActionBlocked('ACCEPT') && (
                        <div style={{ color: '#be123c', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}>
                          <AlertOctagon size={16} /> Blocked by Hold ({holdInstruction})
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => setShowRejectModal(true)}
                        className="btn btn-outline btn-lg"
                        style={{ color: 'var(--danger)', borderColor: 'var(--danger-light)', minHeight: '48px' }}
                      >
                        <XCircle size={18} />
                        <span>Reject Assignment</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* ------------------------------------------------------------------- */}
                {/* STAGE 2: VERIFY INGREDIENTS, WEIGHTS & EQUIPMENT */}
                {/* Immediately visible upon acceptance */}
                {/* ------------------------------------------------------------------- */}
                {selectedBatch.status === 'ACCEPTED' && (
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
                      <Layers size={18} color="var(--primary)" />
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                        Stage 2: Verify Recipe Ingredients, Weights & Equipment
                      </h3>
                    </div>

                    {/* Shortage Warning if inventory is insufficient */}
                    {requirements?.ingredients?.some((i) => i.status !== 'SUFFICIENT') && (
                      <div
                        className="alert alert-danger"
                        style={{
                          marginBottom: '1rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '12px 16px',
                        }}
                      >
                        <AlertTriangle size={20} style={{ flexShrink: 0 }} />
                        <div style={{ fontSize: '0.88rem' }}>
                          <strong>Inventory Shortage Warning:</strong> One or more required ingredients do not have sufficient pantry stock. Replenish inventory before verifying and starting oven.
                        </div>
                      </div>
                    )}

                    {/* Recipe BOM Ingredients Table */}
                    {requirementsLoading ? (
                      <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <div className="spinner" style={{ margin: '0 auto 0.5rem auto', width: '24px', height: '24px' }}></div>
                        <span>Calculating recipe requirements and pantry stock...</span>
                      </div>
                    ) : requirementsError ? (
                      <div className="alert alert-warning" style={{ margin: '0.5rem 0' }}>
                        <AlertTriangle size={16} />
                        <span>{requirementsError}</span>
                      </div>
                    ) : requirements?.ingredients?.length > 0 ? (
                      <div style={{ overflowX: 'auto', borderRadius: '10px', border: '1px solid var(--border-color)', marginBottom: '1.25rem' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                          <thead>
                            <tr style={{ background: 'var(--bg-main)', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                              <th style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--text-muted)' }}>Ingredient</th>
                              <th style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--text-muted)' }}>Required Qty</th>
                              <th style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--text-muted)' }}>Pantry Stock</th>
                              <th style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--text-muted)' }}>Availability Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {requirements.ingredients.map((ing) => {
                              const isShort = ing.status !== 'SUFFICIENT';
                              return (
                                <tr key={ing.ingredientId} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: isShort ? '#fef2f2' : 'transparent' }}>
                                  <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text-main)' }}>{ing.name}</td>
                                  <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--text-main)' }}>
                                    {ing.requiredQuantity} {ing.unit}
                                  </td>
                                  <td style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>
                                    {ing.availableStock} {ing.unit}
                                  </td>
                                  <td style={{ padding: '10px 14px' }}>
                                    <span
                                      className={`badge ${!isShort ? 'badge-success' : 'badge-danger'}`}
                                      style={{ fontSize: '0.72rem' }}
                                    >
                                      {ing.status === 'SUFFICIENT' ? 'In Stock' : 'Shortage'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}

                    {/* Equipment & Tools Required */}
                    <div
                      style={{
                        backgroundColor: 'var(--bg-main)',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                        marginBottom: '1.25rem',
                      }}
                    >
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px' }}>
                        Required Equipment & Tools:
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {(requirements?.equipment || ['Commercial Baking Oven', 'Digital Weighing Scale', 'Mixing Bowls & Utensils', 'Sheet Pans & Parchment']).map(
                          (item, idx) => (
                            <span
                              key={idx}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                backgroundColor: 'var(--card-bg)',
                                border: '1px solid var(--border-color)',
                                fontSize: '0.8rem',
                                color: 'var(--text-main)',
                                fontWeight: 600,
                              }}
                            >
                              ✓ {item}
                            </span>
                          )
                        )}
                      </div>
                    </div>

                    {/* Action button */}
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        type="button"
                        disabled={actionLoading || requirements?.ingredients?.some((i) => i.status !== 'SUFFICIENT') || isStageActionBlocked('VERIFY')}
                        onClick={handleVerifyBatch}
                        className="btn btn-primary btn-lg"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '48px', padding: '0 1.5rem', opacity: isStageActionBlocked('VERIFY') ? 0.5 : 1 }}
                        title={isStageActionBlocked('VERIFY') ? `Blocked by Emergency Hold: ${holdInstruction}` : ''}
                      >
                        <Scale size={18} />
                        <span>Confirm Ingredients, Weights & Equipment Verified</span>
                      </button>
                      {isStageActionBlocked('VERIFY') && (
                        <div style={{ color: '#be123c', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}>
                          <AlertOctagon size={16} /> Blocked by Hold ({holdInstruction})
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ------------------------------------------------------------------- */}
                {/* STAGE 3: START BAKING */}
                {/* Recipe table is HIDDEN once baking starts */}
                {/* ------------------------------------------------------------------- */}
                {selectedBatch.status === 'VERIFIED' && (
                  <div
                    style={{
                      borderTop: '1px solid var(--border-color)',
                      paddingTop: '1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '1rem',
                    }}
                  >
                    <div
                      style={{
                        padding: '14px 16px',
                        backgroundColor: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        borderRadius: '10px',
                        color: '#166534',
                        fontSize: '0.9rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                      }}
                    >
                      <CheckCircle size={20} />
                      <div>
                        <strong>Ingredients & Equipment Verified:</strong> All weights, recipe proportions, and kitchen stations have been validated. The ingredients are ready for oven mixing and baking.
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        type="button"
                        disabled={actionLoading || isStageActionBlocked('START_BAKING')}
                        onClick={handleStartBatch}
                        className="btn btn-primary btn-lg"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '48px', padding: '0 1.5rem', opacity: isStageActionBlocked('START_BAKING') ? 0.5 : 1 }}
                        title={isStageActionBlocked('START_BAKING') ? `Blocked by Emergency Hold: ${holdInstruction}` : ''}
                      >
                        <Flame size={18} />
                        <span>Start Baking</span>
                      </button>
                      {isStageActionBlocked('START_BAKING') && (
                        <div style={{ color: '#be123c', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}>
                          <AlertOctagon size={16} /> Blocked by Hold ({holdInstruction})
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ------------------------------------------------------------------- */}
                {/* STAGE 4: RECORD BAKING OUTPUT */}
                {/* Compact 3-field form: Output weight/qty, Unit, Remark */}
                {/* Recipe table is HIDDEN */}
                {/* ------------------------------------------------------------------- */}
                {selectedBatch.status === 'IN_PRODUCTION' && (
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '1rem',
                        padding: '10px 14px',
                        backgroundColor: '#eff6ff',
                        borderRadius: '10px',
                        border: '1px solid #bfdbfe',
                        color: '#1e40af',
                      }}
                    >
                      <Flame size={18} color="#ef4444" />
                      <div>
                        <strong>Active Baking in Progress:</strong> Target yield is {selectedBatch.plannedQuantity} {selectedBatch.unit || 'units'}. When oven baking completes, record the measured baking output below.
                      </div>
                    </div>

                    <form onSubmit={handleRecordOutput} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                        Stage 4: Record Baking Output
                      </h3>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                        {/* 1. Output weight/quantity (mandatory numeric > 0) */}
                        <div>
                          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}>
                            Output Weight / Quantity <span style={{ color: 'var(--danger)' }}>*</span>
                          </label>
                          <input
                            type="number"
                            step="any"
                            min="0.0001"
                            required
                            placeholder="e.g. 4.2"
                            value={outputForm.outputQuantity}
                            onChange={(e) => setOutputForm((curr) => ({ ...curr, outputQuantity: e.target.value }))}
                            className="input-field"
                            style={{ width: '100%', fontSize: '1rem', padding: '10px 12px' }}
                            autoFocus
                          />
                        </div>

                        {/* 2. Corresponding unit (mandatory compatible unit) */}
                        <div>
                          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}>
                            Unit <span style={{ color: 'var(--danger)' }}>*</span>
                          </label>
                          <select
                            value={outputForm.outputUnit}
                            onChange={(e) => setOutputForm((curr) => ({ ...curr, outputUnit: e.target.value }))}
                            className="input-field"
                            style={{ width: '100%', fontSize: '1rem', padding: '10px 12px' }}
                          >
                            {COMPATIBLE_UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* 3. Output Remark (optional) */}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}>
                          Baking Remark (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g., nominal yield, golden crust, trimmed edges, slight overrun"
                          value={outputForm.outputRemark}
                          onChange={(e) => setOutputForm((curr) => ({ ...curr, outputRemark: e.target.value }))}
                          className="input-field"
                          style={{ width: '100%', fontSize: '0.9rem', padding: '10px 12px' }}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem' }}>
                        <button
                          type="submit"
                          disabled={actionLoading || isStageActionBlocked('RECORD_OUTPUT')}
                          className="btn btn-primary btn-lg"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minHeight: '48px', padding: '0 1.5rem', opacity: isStageActionBlocked('RECORD_OUTPUT') ? 0.5 : 1 }}
                          title={isStageActionBlocked('RECORD_OUTPUT') ? `Blocked by Emergency Hold: ${holdInstruction}` : ''}
                        >
                          <Sparkles size={18} />
                          <span>Record Output & Proceed to Packing</span>
                        </button>
                        {isStageActionBlocked('RECORD_OUTPUT') && (
                          <div style={{ color: '#be123c', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}>
                            <AlertOctagon size={16} /> Blocked by Hold ({holdInstruction})
                          </div>
                        )}
                      </div>
                    </form>
                  </div>
                )}

                {/* ------------------------------------------------------------------- */}
                {/* STAGE 5: PACKAGE (Split Packaging Support) */}
                {/* Recipe table is HIDDEN */}
                {/* ------------------------------------------------------------------- */}
                {selectedBatch.status === 'PACKAGING' && (
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                        marginBottom: '1rem',
                        padding: '12px 16px',
                        backgroundColor: '#f8fafc',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      <div>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                          Available Output to Package
                        </span>
                        <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary)' }}>
                          {baseAvailableOutput} {baseUnit}
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                          Total Packaged / Remaining
                        </span>
                        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: isOverpackaged ? 'var(--danger)' : 'var(--text-main)' }}>
                          {totalPackagedQuantity.toFixed(2)} {baseUnit} / {remainingOutput.toFixed(2)} {baseUnit} left
                        </div>
                      </div>
                    </div>

                    {isOverpackaged && (
                      <div
                        className="alert alert-danger"
                        style={{
                          marginBottom: '1rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 14px',
                        }}
                      >
                        <AlertTriangle size={18} />
                        <span>
                          <strong>Packaging Exceeds Output:</strong> Total packaged ({totalPackagedQuantity} {baseUnit}) cannot exceed available output ({baseAvailableOutput} {baseUnit})!
                        </span>
                      </div>
                    )}

                    <form onSubmit={handleSavePackaging} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                          Stage 5: Split Packaging Rows
                        </h3>
                        <button
                          type="button"
                          onClick={handleAddPackageRow}
                          className="btn btn-outline btn-sm"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', minHeight: '38px' }}
                        >
                          <Plus size={16} />
                          <span>Add Package Row</span>
                        </button>
                      </div>

                      {/* Dynamic Package Rows */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {splitPackages.map((pkg, idx) => (
                          <div
                            key={pkg.id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '60px 1fr 100px 2fr 44px',
                              gap: '8px',
                              alignItems: 'center',
                              padding: '10px 12px',
                              backgroundColor: 'var(--bg-main)',
                              borderRadius: '8px',
                              border: '1px solid var(--border-color)',
                            }}
                          >
                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                              #{idx + 1}
                            </span>

                            <input
                              type="number"
                              step="any"
                              min="0.0001"
                              required
                              placeholder="Quantity"
                              value={pkg.quantity}
                              onChange={(e) => handlePackageRowChange(pkg.id, 'quantity', e.target.value)}
                              className="input-field"
                              style={{ width: '100%', fontSize: '0.9rem', padding: '6px 10px' }}
                            />

                            <select
                              value={pkg.unit}
                              onChange={(e) => handlePackageRowChange(pkg.id, 'unit', e.target.value)}
                              className="input-field"
                              style={{ width: '100%', fontSize: '0.85rem', padding: '6px 8px' }}
                            >
                              {COMPATIBLE_UNITS.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>

                            <input
                              type="text"
                              placeholder="Pack description (e.g., Pack 1 of 2, Gift box)"
                              value={pkg.remark}
                              onChange={(e) => handlePackageRowChange(pkg.id, 'remark', e.target.value)}
                              className="input-field"
                              style={{ width: '100%', fontSize: '0.85rem', padding: '6px 10px' }}
                            />

                            {splitPackages.length > 1 ? (
                              <button
                                type="button"
                                onClick={() => handleRemovePackageRow(pkg.id)}
                                className="btn btn-outline btn-sm"
                                style={{
                                  color: 'var(--danger)',
                                  borderColor: 'transparent',
                                  padding: '6px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  minHeight: '36px',
                                }}
                                title="Remove package row"
                              >
                                <Trash2 size={16} />
                              </button>
                            ) : (
                              <div></div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Overall Packaging Remark */}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}>
                          Overall Packaging Notes (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g., Packed in food-grade kraft boxes with bakery ribbon"
                          value={packagingRemark}
                          onChange={(e) => setPackagingRemark(e.target.value)}
                          className="input-field"
                          style={{ width: '100%', fontSize: '0.9rem', padding: '10px 12px' }}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={handleSavePackaging}
                          disabled={actionLoading || isOverpackaged || totalPackagedQuantity <= 0 || isStageActionBlocked('PACKAGE')}
                          className="btn btn-primary btn-lg"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minHeight: '48px', padding: '0 1.5rem', opacity: isStageActionBlocked('PACKAGE') ? 0.5 : 1 }}
                          title={isStageActionBlocked('PACKAGE') ? `Blocked by Emergency Hold: ${holdInstruction}` : ''}
                        >
                          <Package size={18} />
                          <span>Save Packaging & Review</span>
                        </button>
                        {isStageActionBlocked('PACKAGE') && (
                          <div style={{ color: '#be123c', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}>
                            <AlertOctagon size={16} /> Blocked by Hold ({holdInstruction})
                          </div>
                        )}
                      </div>
                    </form>
                  </div>
                )}

                {/* ------------------------------------------------------------------- */}
                {/* STAGE 6: MARK AS COMPLETE */}
                {/* Review summary and final action */}
                {/* ------------------------------------------------------------------- */}
                {selectedBatch.status === 'PACKAGED' && (
                  <div
                    style={{
                      borderTop: '1px solid var(--border-color)',
                      paddingTop: '1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '1rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <CheckCircle size={20} color="var(--primary)" />
                      <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                        Stage 6: Final Verification & Mark as Complete
                      </h3>
                    </div>

                    {/* Summary review table */}
                    <div
                      style={{
                        backgroundColor: '#f8fafc',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                        padding: '1rem 1.25rem',
                        fontSize: '0.88rem',
                      }}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase' }}>Recorded Output</span>
                          <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                            {selectedBatch.actualOutputQuantity ?? selectedBatch.usableQuantity} {selectedBatch.actualOutputUnit || selectedBatch.unit}
                          </div>
                        </div>

                        <div>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase' }}>Packaged Total</span>
                          <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                            {selectedBatch.packagedQuantity} {selectedBatch.unit || baseUnit}
                          </div>
                        </div>

                        {((selectedBatch.unpackagedQuantity ?? 0) > 0 || (selectedBatch.actualOutputQuantity ?? selectedBatch.usableQuantity) > (selectedBatch.packagedQuantity || 0)) && (
                          <div>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase' }}>Remaining / WIP</span>
                            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#b45309' }}>
                              {selectedBatch.unpackagedQuantity ?? Math.max(0, (selectedBatch.actualOutputQuantity ?? selectedBatch.usableQuantity) - (selectedBatch.packagedQuantity || 0))} {selectedBatch.actualOutputUnit || selectedBatch.unit}
                            </div>
                          </div>
                        )}

                        <div>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase' }}>Inventory Deductions</span>
                          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#16a34a' }}>
                            ✓ Fully Consumed
                          </div>
                        </div>
                      </div>

                      {/* Package Breakdown */}
                      {selectedBatch.packages && selectedBatch.packages.length > 0 && (
                        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
                          <span style={{ fontWeight: 700, color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                            Packages Created ({selectedBatch.packages.length}):
                          </span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                            {selectedBatch.packages.map((pkg, idx) => (
                              <div key={idx} style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                                • <strong>Pack #{pkg.packageNumber || idx + 1}:</strong> {pkg.quantity} {pkg.unit} {pkg.remark ? `(${pkg.remark})` : ''}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        type="button"
                        disabled={actionLoading || isStageActionBlocked('COMPLETED')}
                        onClick={handleMarkComplete}
                        className="btn btn-primary btn-lg"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minHeight: '48px', padding: '0 1.5rem', opacity: isStageActionBlocked('COMPLETED') ? 0.5 : 1 }}
                        title={isStageActionBlocked('COMPLETED') ? `Blocked by Emergency Hold: ${holdInstruction}` : ''}
                      >
                        <CheckCircle size={18} />
                        <span>Mark as Complete</span>
                      </button>
                      {isStageActionBlocked('COMPLETED') && (
                        <div style={{ color: '#be123c', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}>
                          <AlertOctagon size={16} /> Blocked by Hold ({holdInstruction})
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ------------------------------------------------------------------- */}
                {/* TERMINAL STATE: COMPLETED */}
                {/* ------------------------------------------------------------------- */}
                {selectedBatch.status === 'COMPLETED' && (
                  <div
                    className="alert alert-success"
                    style={{
                      margin: '1.25rem 0 0 0',
                      padding: '1.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    <CheckCircle size={24} style={{ flexShrink: 0 }} />
                    <div>
                      <strong style={{ fontSize: '1rem', display: 'block', marginBottom: '2px' }}>
                        {selectedBatch.batchType === 'PLANNED_PRODUCTION' || !(selectedBatch.relatedOrders?.length)
                          ? 'Batch Completed & Added to Finished Goods Stock!'
                          : 'Batch Completed & Orders Synchronized to Ready!'}
                      </strong>
                      <span style={{ fontSize: '0.88rem' }}>
                        {selectedBatch.batchType === 'PLANNED_PRODUCTION' || !(selectedBatch.relatedOrders?.length)
                          ? `Packaged quantity of ${selectedBatch.packagedQuantity || selectedBatch.usableQuantity} ${selectedBatch.unit || 'units'} has been added to finished goods inventory for future customer order fulfillment.`
                          : `Packaged quantity of ${selectedBatch.packagedQuantity || selectedBatch.usableQuantity} ${selectedBatch.unit || 'units'} has been added to finished stock and customer orders are ready for pickup or dispatch.`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Package size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                Select a Batch to Start Work
              </h3>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                Choose any assigned batch from the workstation queue on the left to begin the production workflow.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Reject Assignment Modal */}
      {showRejectModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: '480px', padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--danger)' }}>
                Reject Batch Assignment
              </h3>
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="btn btn-outline btn-sm"
                style={{ padding: '4px' }}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleRejectBatch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                Please provide a reason for rejecting batch <strong>{selectedBatch?.batchNumber}</strong>. The owner will be notified to reassign the batch.
              </p>
              <textarea
                required
                rows={3}
                placeholder="Reason for rejection (e.g. equipment issue, capacity constraint, shortage)..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="input-field"
                style={{ width: '100%', fontSize: '0.9rem' }}
                autoFocus
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setShowRejectModal(false)}
                  className="btn btn-outline"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !rejectReason.trim()}
                  className="btn btn-danger"
                >
                  Confirm Rejection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
