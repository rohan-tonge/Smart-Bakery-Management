import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api, createNotificationEventSource } from '../../api/client';
import CatalogImage from '../../components/CatalogImage';
import ThemeToggle from '../../components/ThemeToggle';
import PaymentProofModal from '../../components/PaymentProofModal';
import BatchCostModal from '../../components/BatchCostModal';
import BatchScheduleModal from '../../components/BatchScheduleModal';
import RecipeModal from '../../components/RecipeModal';
import SalesAnalyticsSection from './SalesAnalyticsSection';
import { formatCurrency, formatHourlyRate, formatUnitCost } from '../../utils/currency';
import {
  Shield,
  ShoppingBag,
  QrCode,
  Package,
  Layers,
  BarChart3,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Plus,
  Trash2,
  Save,
  Check,
  Users,
  UserPlus,
  Truck,
  ArrowUpDown,
  X,
  Clock,
  ClipboardList,
  FileText,
  ChefHat,
  Search,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Bell,
  ArrowRight,
  Clock3,
  AlertOctagon,
  Activity,
  Image as ImageIcon,
  Calendar,
  Banknote,
  Filter,
  Percent,
  TrendingUp,
  DollarSign,
  Edit2,
  PackageCheck,
} from 'lucide-react';

const UNIT_FAMILIES = {
  g: 'mass',
  kg: 'mass',
  ml: 'volume',
  L: 'volume',
  piece: 'count',
};

const UNIT_CONVERSIONS = {
  mass: {
    g: 1,
    kg: 1000,
  },
  volume: {
    ml: 1,
    L: 1000,
  },
  count: {
    piece: 1,
  },
};

const areUnitsConvertible = (fromUnit, toUnit) => {
  const fromFamily = UNIT_FAMILIES[fromUnit];
  const toFamily = UNIT_FAMILIES[toUnit];
  return Boolean(fromFamily && toFamily && fromFamily === toFamily);
};

const convertUnit = (quantity, fromUnit, toUnit) => {
  if (fromUnit === toUnit) return Number(quantity);
  const fromFamily = UNIT_FAMILIES[fromUnit];
  const toFamily = UNIT_FAMILIES[toUnit];
  if (!fromFamily || fromFamily !== toFamily) return null;
  const factorFrom = UNIT_CONVERSIONS[fromFamily][fromUnit];
  const factorTo = UNIT_CONVERSIONS[toFamily][toUnit];
  return (Number(quantity) * factorFrom) / factorTo;
};

const getCompatibleUnits = (baseUnit) => {
  const family = UNIT_FAMILIES[baseUnit];
  if (family === 'mass') return ['kg', 'g'];
  if (family === 'volume') return ['L', 'ml'];
  return ['piece'];
};

const HOLD_REASONS = [
  'Customer requested cancellation',
  'Customer requested a change',
  'Product or order issue',
  'Ingredient or equipment issue',
  'Other',
];

const HOLD_INSTRUCTIONS = [
  'Stop production immediately',
  'Continue current work temporarily',
  'Stop after the current safe production step',
];

const HOLD_RESOLUTIONS = [
  'Resume normal production',
  'Confirm Order Cancellation',
  'Stop batch and review wastage',
  'Reassign or reschedule',
];

export default function OwnerManagerDashboard() {
  const [activeTab, setActiveTabRaw] = useState(() => {
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname.toLowerCase();
      const match = pathname.match(/^\/owner\/([a-z0-9_-]+)/);
      if (match && match[1]) {
        return match[1];
      }
      const paramTab = new URLSearchParams(window.location.search).get('tab');
      if (paramTab) return paramTab;
    }
    return 'overview';
  });

  const setActiveTab = (tabOrFn) => {
    setActiveTabRaw((prev) => {
      const nextTab = typeof tabOrFn === 'function' ? tabOrFn(prev) : tabOrFn;
      if (typeof window !== 'undefined' && nextTab) {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', nextTab);
        if (nextTab !== 'inventory') {
          url.searchParams.delete('subtab');
        }
        window.history.replaceState(null, '', url.toString());
      }
      return nextTab;
    });
  };
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [overview, setOverview] = useState({ orders: [], lowStock: [], batches: [] });
  // 'overview' | 'orders' | 'requisitions' | 'qr' | 'products' | 'inventory' | 'production' | 'staff' | 'analytics'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Orders State
  const [orders, setOrders] = useState([]);
  const [orderAssignmentWorkers, setOrderAssignmentWorkers] = useState({});
  const [orderSearchQuery, setOrderSearchQuery] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('ALL');
  const [orderMeta, setOrderMeta] = useState({ page: 1, limit: 50, total: 0, pages: 1 });

  // Requisitions State
  const [requisitions, setRequisitions] = useState([]);
  const [reqFilter, setReqFilter] = useState('ALL');
  const [rejectModalReq, setRejectModalReq] = useState(null);
  const [rejectModalReason, setRejectModalReason] = useState('');
  const [adjustModalReq, setAdjustModalReq] = useState(null);
  const [adjustNotes, setAdjustNotes] = useState('');
  const [adjustQuantities, setAdjustQuantities] = useState({});
  const [highlightRequisitionId, setHighlightRequisitionId] = useState(null);

  // In-App Notifications State
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const [notifFilter, setNotifFilter] = useState('ALL');

  // Production Team & Workload State
  const [teamStatus, setTeamStatus] = useState([]);
  const [productionViewMode, setProductionViewMode] = useState('QUEUE'); // 'QUEUE' | 'TEAM'
  const [recommendModal, setRecommendModal] = useState(null);
  const [reassignModalBatch, setReassignModalBatch] = useState(null);
  const [reassignWorkerId, setReassignWorkerId] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [reassignSubmitting, setReassignSubmitting] = useState(false);

  // Emergency Production Hold State
  const [holdModal, setHoldModal] = useState(null); // { type: 'order'|'batch', id, number, productName, status }
  const [holdReason, setHoldReason] = useState(HOLD_REASONS[0]);
  const [holdInstruction, setHoldInstruction] = useState(HOLD_INSTRUCTIONS[0]);
  const [holdOwnerNote, setHoldOwnerNote] = useState('');
  const [holdSubmitting, setHoldSubmitting] = useState(false);

  // Update Hold Instruction State
  const [updateInstructionModal, setUpdateInstructionModal] = useState(null);
  const [newInstruction, setNewInstruction] = useState(HOLD_INSTRUCTIONS[0]);
  const [newInstructionNote, setNewInstructionNote] = useState('');
  const [updateInstructionSubmitting, setUpdateInstructionSubmitting] = useState(false);

  // Resolve Hold State
  const [resolveHoldModal, setResolveHoldModal] = useState(null);
  const [resolveResolution, setResolveResolution] = useState(HOLD_RESOLUTIONS[0]);
  const [resolveNote, setResolveNote] = useState('');
  const [resolveCancelOrderId, setResolveCancelOrderId] = useState('');
  const [resolveSubmitting, setResolveSubmitting] = useState(false);

  // Fulfill from Finished Stock Modal State
  const [fulfillStockModal, setFulfillStockModal] = useState(null);
  const [fulfillSubmitting, setFulfillSubmitting] = useState(false);
  const [fulfillError, setFulfillError] = useState(null);

  // QR Settings State
  const [qrConfig, setQrConfig] = useState({
    upiId: '',
    payeeName: '',
    instructions: '',
    qrImageUrl: '',
    isActive: true,
  });
  const [capacityConfig, setCapacityConfig] = useState({
    workingHours: { open: '', close: '' }, slotMinutes: '', minutesPerStaffPerDay: '', ovens: [],
  });
  const [capacitySaving, setCapacitySaving] = useState(false);

  // Products State
  const [products, setProducts] = useState([]);
  const [deletingProductIds, setDeletingProductIds] = useState(() => new Set());
  const deletingProductIdsRef = useRef(new Set());
  const [categories, setCategories] = useState([]);
  const [newProduct, setNewProduct] = useState({
    name: '',
    category: '',
    price: '',
    description: '',
    imageUrl: '',
    totalTimeMinutes: '45',
    electricityCostPerUnit: '0',
    packagingCostPerUnit: '0',
  });
  const [editingProductId, setEditingProductId] = useState('');
  const [newCategory, setNewCategory] = useState({ name: '', description: '', imageUrl: '' });
  const [editingCategoryId, setEditingCategoryId] = useState('');

  // Products & Costing State
  const [productCostings, setProductCostings] = useState({});
  const [editingVariantPrices, setEditingVariantPrices] = useState({});
  const [savingVariantPriceId, setSavingVariantPriceId] = useState(null);

  // Recipe Management Modal State
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [recipeModalProduct, setRecipeModalProduct] = useState(null);
  const [recipeModalVariantId, setRecipeModalVariantId] = useState('');
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [recipeExisting, setRecipeExisting] = useState(false);
  const [recipeRevision, setRecipeRevision] = useState(1);
  const [recipeCosting, setRecipeCosting] = useState(null);
  const [recipeForm, setRecipeForm] = useState({
    preparationTime: '0',
    productionTime: '',
    estimatedDurationMinutes: '',
    equipmentPowerKw: '2.0',
    electricityTariff: '8.0',
    expectedYield: '1',
    yieldUnit: 'piece',
    instructions: '',
    labourCostPerMinute: '',
    powerCostPerMinute: '',
    packagingCostPerUnit: '',
    packagingQuantity: '',
    packagingMaterials: [],
    labourMinutes: '',
    powerMinutes: '',
    ingredients: [{ ingredient: '', quantity: '', unit: 'kg' }],
  });

  // Payment Proof Modal State
  const [viewingProofOrder, setViewingProofOrder] = useState(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [proofData, setProofData] = useState(null);
  const [proofError, setProofError] = useState(null);

  // Inline Create Ingredient Sub-Modal State
  const [showInlineIngredientModal, setShowInlineIngredientModal] = useState(false);
  const [inlineTargetRowIndex, setInlineTargetRowIndex] = useState(null);
  const [inlineIngredientSubmitting, setInlineIngredientSubmitting] = useState(false);
  const [inlineIngredientError, setInlineIngredientError] = useState(null);
  const [inlineIngredientForm, setInlineIngredientForm] = useState({
    name: '',
    unit: 'kg',
    minimumStock: '',
    reorderLevel: '',
    description: '',
    hasOpeningStock: false,
    openingStock: '',
    openingStockCost: '',
    openingStockExpiryDate: '',
    openingStockLotNumber: '',
  });
  const [ingredientRowSearch, setIngredientRowSearch] = useState({});
  const [activeIngredientDropdownRow, setActiveIngredientDropdownRow] = useState(null);

  // Inventory Sub-tab State
  const [invSubTab, setInvSubTabRaw] = useState(() => {
    if (typeof window !== 'undefined') {
      const paramSubTab = new URLSearchParams(window.location.search).get('subtab');
      if (paramSubTab) return paramSubTab;
    }
    return 'stock';
  });

  const setInvSubTab = (subTabOrFn) => {
    setInvSubTabRaw((prev) => {
      const nextSubTab = typeof subTabOrFn === 'function' ? subTabOrFn(prev) : subTabOrFn;
      if (typeof window !== 'undefined' && nextSubTab) {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', 'inventory');
        url.searchParams.set('subtab', nextSubTab);
        window.history.replaceState(null, '', url.toString());
      }
      return nextSubTab;
    });
  }; 
  // 'stock' | 'receive' | 'ingredients' | 'vendors' | 'movements'
  const [inventory, setInventory] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [expiringStock, setExpiringStock] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [transactions, setTransactions] = useState([]);

  // Add / Edit Ingredient Form
  const [editingIngredientId, setEditingIngredientId] = useState('');
  const [newIngredient, setNewIngredient] = useState({
    name: '',
    unit: 'kg',
    description: '',
    minimumStock: '',
    reorderLevel: '',
  });

  // Add Vendor Form
  const [newVendor, setNewVendor] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    gstNumber: '',
    notes: '',
  });

  // Receive Stock / Purchase Form
  const [purchaseForm, setPurchaseForm] = useState(() => ({
    vendor: '',
    purchaseDate: new Date().toISOString().slice(0, 10),
    invoiceNumber: '',
    tax: 0,
    notes: '',
    items: [
      {
        ingredient: '',
        quantity: '',
        unit: 'kg',
        unitPrice: '',
        lotNumber: `LOT-${Date.now().toString().slice(-6)}`,
        expiryDate: '',
      },
    ],
  }));

  // Manual Adjustment Form
  const [adjustmentForm, setAdjustmentForm] = useState({
    ingredientId: '',
    quantity: '',
    unit: 'kg',
    type: 'ADD',
    reason: 'Stock count calibration',
  });
  const [showAdjustModal, setShowAdjustModal] = useState(false);

  // Production State
  const [batches, setBatches] = useState([]);
  const observedBatchUpdates = useRef(new Map());
  const [workers, setWorkers] = useState([]);
  const [showNewBatchModal, setShowNewBatchModal] = useState(false);
  const [selectedOrderForBatch, setSelectedOrderForBatch] = useState(null);
  const [holdError, setHoldError] = useState(null);
  const [updateInstructionError, setUpdateInstructionError] = useState(null);
  const [resolveHoldError, setResolveHoldError] = useState(null);

  // Assign Worker Modal
  const [assignModalBatch, setAssignModalBatch] = useState(null);
  const [selectedWorkerForAssign, setSelectedWorkerForAssign] = useState('');
  const [taskDescriptionForAssign, setTaskDescriptionForAssign] = useState('Baking Specialist');

  // Staff Management State
  const [staffForm, setStaffForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    jobDesignation: 'Baker',
    hourlyLabourRate: '',
  });
  const [staffSubmitting, setStaffSubmitting] = useState(false);
  const [editingWorker, setEditingWorker] = useState(null);
  const [editWorkerForm, setEditWorkerForm] = useState({
    phone: '',
    jobDesignation: 'Baker',
    hourlyLabourRate: '',
  });
  const [editWorkerSubmitting, setEditWorkerSubmitting] = useState(false);

  // Production Batch Costing Modal State
  const [costModalBatch, setCostModalBatch] = useState(null);

  const notifySuccess = (msg) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3500);
  };

  const notifyError = (msg) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  };

  // Main Data Loader
  const loadData = async (tab = activeTab) => {
    try {
      setLoading(true);
      setError(null);

      if (tab === 'overview') {
        api.getPaymentQr().then((qrRes) => {
          if (qrRes.data) setQrConfig(qrRes.data);
        }).catch(() => {});
        const [oRes, lRes, bRes, rRes] = await Promise.all([
          api.getAllOrders().catch(() => ({ data: [] })),
          api.getLowStock().catch(() => ({ data: [] })),
          api.getBatches().catch(() => ({ data: [] })),
          api.getRequisitions().catch(() => ({ data: [] })),
        ]);
        const overviewOrders = oRes.data?.orders || oRes.data || [];
        const overviewLow = lRes.data?.ingredients || lRes.data?.items || lRes.data || [];
        const overviewBatches = bRes.data?.batches || bRes.data || [];
        const overviewReqs = rRes.data?.requisitions || rRes.data || [];
        setOverview({
          orders: overviewOrders,
          orderMeta: oRes.meta,
          lowStock: overviewLow,
          batches: overviewBatches,
          requisitions: overviewReqs,
        });
        setOrders(overviewOrders);
        if (oRes.meta) setOrderMeta(oRes.meta);
        setRequisitions(overviewReqs);
        setBatches(overviewBatches);
      } else if (tab === 'orders') {
        const orderParams = { limit: 50 };
        if (orderSearchQuery && orderSearchQuery.trim()) orderParams.search = orderSearchQuery.trim();
        if (orderStatusFilter && !['ALL', 'ACTIVE', 'HISTORICAL'].includes(orderStatusFilter)) {
          orderParams.status = orderStatusFilter;
        }
        const [res, wRes, bRes, pRes] = await Promise.all([
          api.getAllOrders(orderParams),
          api.getWorkers().catch(() => ({ data: [] })),
          api.getBatches().catch(() => ({ data: [] })),
          api.getProducts().catch(() => ({ data: [] })),
        ]);
        setOrders(res.data?.orders || res.data || []);
        if (res.meta) setOrderMeta(res.meta);
        setWorkers(wRes.data?.workers || wRes.data || []);
        setBatches(bRes.data?.batches || bRes.data || []);
        setProducts(pRes.data?.products || pRes.data || []);
      } else if (tab === 'requisitions') {
        const [reqRes, bRes, wRes] = await Promise.all([
          api.getRequisitions().catch(() => ({ data: [] })),
          api.getBatches().catch(() => ({ data: [] })),
          api.getWorkers().catch(() => ({ data: [] })),
        ]);
        setRequisitions(reqRes.data?.requisitions || reqRes.data || []);
        setBatches(bRes.data?.batches || bRes.data || []);
        setWorkers(wRes.data?.workers || wRes.data || []);
      } else if (tab === 'qr') {
        const [res, capacityRes] = await Promise.all([api.getPaymentQr(), api.getProductionCapacity()]);
        if (res.data) setQrConfig(res.data);
        if (capacityRes.data) setCapacityConfig({
          workingHours: capacityRes.data.workingHours,
          slotMinutes: String(capacityRes.data.slotMinutes),
          minutesPerStaffPerDay: String(capacityRes.data.minutesPerStaffPerDay),
          ovens: capacityRes.data.ovens.map((oven) => ({ ...oven, minutesPerDay: String(oven.minutesPerDay) })),
        });
      } else if (tab === 'products') {
        const [pRes, cRes, iRes, invRes] = await Promise.all([
          api.getProducts(),
          api.getCategories(),
          api.getIngredients({ limit: 250 }).catch(() => ({ data: { ingredients: [] } })),
          api.getInventory({ limit: 250 }).catch(() => ({ data: { inventory: [] } })),
        ]);
        const prods = pRes.data?.products || pRes.data || [];
        setProducts(prods);
        setCategories(cRes.data?.categories || cRes.data || []);
        const ingredientsList = iRes.data?.ingredients || (Array.isArray(iRes.data) ? iRes.data : []);
        setIngredients(ingredientsList);
        const inventoryList = invRes.data?.inventory || (Array.isArray(invRes.data) ? invRes.data : []);
        setInventory(inventoryList);

        // Fetch authoritative recipe costings and margins for products
        const costings = {};
        await Promise.all(
          prods.map(async (prod) => {
            try {
              const c = await api.getProductCosting(prod._id);
              if (c.data) costings[prod._id] = c.data;
            } catch {
              // Ignore if product recipe not yet created
            }
          })
        );
        setProductCostings(costings);
      } else if (tab === 'inventory') {
        const [invRes, lowRes, expRes, ingRes, venRes, purRes, trRes] = await Promise.all([
          api.getInventory({ limit: 250 }).catch(() => ({ data: { inventory: [] } })),
          api.getLowStock().catch(() => ({ data: { ingredients: [] } })),
          api.getExpiringInventory().catch(() => ({ data: { lots: [] } })),
          api.getIngredients({ limit: 250 }).catch(() => ({ data: { ingredients: [] } })),
          api.getVendors().catch(() => ({ data: [] })),
          api.getPurchases().catch(() => ({ data: [] })),
          api.getInventoryTransactions().catch(() => ({ data: [] })),
        ]);
        setInventory(invRes.data?.inventory || (Array.isArray(invRes.data) ? invRes.data : []));
        setLowStock(lowRes.data?.ingredients || lowRes.data?.items || (Array.isArray(lowRes.data) ? lowRes.data : []));
        setExpiringStock(expRes.data?.lots || (Array.isArray(expRes.data) ? expRes.data : []));
        setIngredients(ingRes.data?.ingredients || (Array.isArray(ingRes.data) ? ingRes.data : []));
        setVendors(venRes.data?.vendors || venRes.data || []);
        setPurchases(purRes.data?.purchases || purRes.data || []);
        setTransactions(trRes.data?.transactions || trRes.data || []);
      } else if (tab === 'production') {
        const [bRes, pRes, wRes, teamRes] = await Promise.all([
          api.getBatches().catch(() => ({ data: [] })),
          api.getProducts().catch(() => ({ data: [] })),
          api.getWorkers().catch(() => ({ data: [] })),
          api.getProductionTeamStatus().catch(() => ({ data: [] })),
        ]);
        setBatches(bRes.data?.batches || bRes.data || []);
        setProducts(pRes.data?.products || pRes.data || []);
        setWorkers(wRes.data?.workers || wRes.data || []);
        setTeamStatus(teamRes.data?.teamStatus || teamRes.data || []);
      } else if (tab === 'staff') {
        const wRes = await api.getWorkers().catch(() => ({ data: [] }));
        setWorkers(wRes.data?.workers || wRes.data || []);
      } else if (tab === 'analytics') {
        const [oRes, pRes, iRes] = await Promise.all([
          api.getAllOrders().catch(() => ({ data: [] })),
          api.getProducts().catch(() => ({ data: [] })),
          api.getInventory().catch(() => ({ data: [] })),
        ]);
        setOrders(oRes.data?.orders || oRes.data || []);
        setProducts(pRes.data?.products || pRes.data || []);
        setInventory(iRes.data?.inventory || iRes.data || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      let changed = false;
      if (!url.searchParams.get('tab') && activeTab) {
        url.searchParams.set('tab', activeTab);
        changed = true;
      }
      if (activeTab === 'inventory' && !url.searchParams.get('subtab') && invSubTab) {
        url.searchParams.set('subtab', invSubTab);
        changed = true;
      }
      if (changed) {
        window.history.replaceState(null, '', url.toString());
      }
    }

    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const paramTab = params.get('tab');
      const paramSubTab = params.get('subtab');
      if (paramTab) setActiveTabRaw(paramTab);
      if (paramSubTab) setInvSubTabRaw(paramSubTab);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Real-time Notification Polling & Team Status Ticker
  const fetchNotifications = async () => {
    try {
      const [countRes, listRes] = await Promise.all([
        api.getUnreadNotificationCount().catch(() => ({ data: { unreadCount: 0 } })),
        api.getNotifications({ limit: 25 }).catch(() => ({ data: { notifications: [] } })),
      ]);
      const count = countRes?.data?.unreadCount ?? 0;
      const list = listRes?.data?.notifications || [];
      setUnreadNotifCount(count);
      setNotifications(list);
    } catch {
      // Safe fallback on temporary network glitch
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 10000);
    return () => clearInterval(interval);
  }, []);

  // Timer ticker every 10 seconds for live remaining times & overdue calculations
  const [, setTimerTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTimerTick((t) => t + 1), 10000);
    return () => clearInterval(timer);
  }, []);

  // When activeTab is 'production', also poll team status every 10s
  useEffect(() => {
    if (activeTab !== 'production') return undefined;
    let isActive = true;
    const pollTeam = async () => {
      try {
        const teamRes = await api.getProductionTeamStatus();
        if (isActive && teamRes?.data?.teamStatus) {
          setTeamStatus(teamRes.data.teamStatus);
        }
      } catch {
        // keep current status on error
      }
    };
    pollTeam();
    const intervalId = setInterval(pollTeam, 10000);
    return () => {
      isActive = false;
      clearInterval(intervalId);
    };
  }, [activeTab]);

  const handleMarkNotifRead = async (id, e) => {
    if (e) e.stopPropagation();
    try {
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );
      setUnreadNotifCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification read', err);
    }
  };

  const handleMarkAllNotifsRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() }))
      );
      setUnreadNotifCount(0);
      notifySuccess('All notifications marked as read.');
    } catch (err) {
      console.error('Failed to mark all notifications read', err);
    }
  };

  const handleOpenNotification = (notif) => {
    if (!notif.readAt) {
      handleMarkNotifRead(notif._id);
    }
    setNotifPanelOpen(false);

    if (
      notif.type?.startsWith('REQUISITION_') ||
      notif.relatedEntityType === 'INGREDIENT_REQUISITION'
    ) {
      const reqId = notif.metadata?.requisitionId || notif.relatedEntityId;
      setHighlightRequisitionId(reqId ? String(reqId) : null);
      setReqFilter('ALL');
      setActiveTab('requisitions');
    } else if (notif.type?.startsWith('ORDER_') || notif.relatedEntityType === 'ORDER') {
      setActiveTab('orders');
    } else if (notif.type?.startsWith('PRODUCTION_') || notif.relatedEntityType === 'PRODUCTION_BATCH') {
      setActiveTab('production');
    }
  };

  const handleOpenRecommendation = async ({ order = null, batch = null }) => {
    setRecommendModal({
      open: true,
      order,
      batch,
      data: null,
      loading: true,
      selectedWorkerId: '',
    });
    try {
      let res;
      if (order) {
        res = await api.getRecommendedWorkersForOrder(order._id);
      } else if (batch) {
        res = await api.getRecommendedWorkersForBatch(batch._id);
      }
      const data = res?.data || res;
      const recommendedId = data?.recommendedWorker?._id || '';
      setRecommendModal({
        open: true,
        order,
        batch,
        data,
        loading: false,
        selectedWorkerId: recommendedId,
      });
    } catch (err) {
      alert(`Worker recommendation failed: ${err.message}`);
      setRecommendModal(null);
    }
  };

  const handleConfirmRecommendationAssignment = async () => {
    if (!recommendModal?.selectedWorkerId) {
      alert('Please select an eligible worker to confirm assignment.');
      return;
    }
    try {
      setLoading(true);
      if (recommendModal.order) {
        await api.assignOrderToProduction(recommendModal.order._id, {
          workers: [recommendModal.selectedWorkerId],
        });
        notifySuccess(`Confirmed assignment for order ${recommendModal.order.orderNumber}!`);
      } else if (recommendModal.batch) {
        await api.reassignBatch(recommendModal.batch._id, {
          newWorkerId: recommendModal.selectedWorkerId,
          reason: 'Owner confirmed recommended worker assignment.',
        });
        notifySuccess(`Assigned batch ${recommendModal.batch.batchNumber} to recommended baker!`);
      }
      setRecommendModal(null);
      await loadData(activeTab);
    } catch (err) {
      alert(`Assignment confirmation failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReassignBatchSubmit = async (e) => {
    e.preventDefault();
    if (!reassignModalBatch || !reassignWorkerId || !reassignReason.trim()) {
      alert('Select a replacement baker and provide an explicit reassignment reason.');
      return;
    }
    try {
      setReassignSubmitting(true);
      await api.reassignBatch(reassignModalBatch._id, {
        newWorkerId: reassignWorkerId,
        reason: reassignReason.trim(),
      });
      notifySuccess(`Batch ${reassignModalBatch.batchNumber} reassigned successfully.`);
      setReassignModalBatch(null);
      setReassignWorkerId('');
      setReassignReason('');
      await loadData(activeTab);
    } catch (err) {
      alert(`Reassignment failed: ${err.message}`);
    } finally {
      setReassignSubmitting(false);
    }
  };

  const handleCancelBatch = async (batch) => {
    const confirmMsg = `Are you sure you want to cancel batch ${batch.batchNumber}? This will release assigned workers and mark the batch as CANCELLED.`;
    if (!window.confirm(confirmMsg)) return;
    try {
      setLoading(true);
      await api.cancelBatch(batch._id, { reason: 'Cancelled by manager via dashboard' });
      notifySuccess(`Batch ${batch.batchNumber} cancelled successfully. Assigned workers released.`);
      await loadData(activeTab);
    } catch (err) {
      alert(`Cancel failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenScheduleBatchFromOrder = (order) => {
    if (order.holdState?.isOnHold) {
      notifyError(`Order ${order.orderNumber} is currently on Emergency Hold (${order.holdState.holdReason}). Resolve the hold before scheduling production.`);
      return;
    }
    if (order.status === 'CANCELLED') {
      notifyError(`Order ${order.orderNumber} is cancelled and cannot be scheduled for production.`);
      return;
    }
    setSelectedOrderForBatch(order);
    setShowNewBatchModal(true);
  };

  const handleOpenHoldModal = (type, item) => {
    setHoldError(null);
    setHoldReason(HOLD_REASONS[0]);
    setHoldInstruction(HOLD_INSTRUCTIONS[0]);
    setHoldOwnerNote('');
    if (type === 'order') {
      const firstItem = item.items?.[0];
      setHoldModal({
        type: 'order',
        id: item._id,
        number: item.orderNumber,
        productName: firstItem ? `${firstItem.productName} (${firstItem.variantName})` : 'Order Items',
        status: item.status,
      });
    } else {
      setHoldModal({
        type: 'batch',
        id: item._id,
        number: item.batchNumber,
        productName: item.productSnapshot?.productName || item.product?.name || 'Production Batch',
        status: item.status,
      });
    }
  };

  const handleConfirmHoldSubmit = async (e) => {
    e?.preventDefault?.();
    if (!holdModal) return;
    setHoldSubmitting(true);
    setHoldError(null);
    try {
      const payload = {
        reason: holdReason,
        instruction: holdInstruction,
        ownerNote: holdOwnerNote,
      };
      if (holdModal.type === 'order') {
        await api.placeOrderHold(holdModal.id, payload);
        notifySuccess(`Order ${holdModal.number} placed on Emergency Hold.`);
      } else {
        await api.placeBatchHold(holdModal.id, payload);
        notifySuccess(`Batch ${holdModal.number} placed on Emergency Hold.`);
      }
      setHoldModal(null);
      await loadData(activeTab);
    } catch (err) {
      const errMsg = err.message || 'Failed to place on hold';
      setHoldError(errMsg);
      notifyError(errMsg);
    } finally {
      setHoldSubmitting(false);
    }
  };

  const handleOpenUpdateInstructionModal = (batchOrOrder) => {
    setUpdateInstructionError(null);
    const isBatch = Boolean(batchOrOrder.batchNumber);
    const id = batchOrOrder._id;
    const num = isBatch ? batchOrOrder.batchNumber : batchOrOrder.orderNumber;
    const holdState = batchOrOrder.holdState || {};
    const batchId = isBatch ? batchOrOrder._id : (holdState.relatedBatch?._id || holdState.relatedBatch || id);
    setUpdateInstructionModal({
      batchId,
      number: num,
      currentInstruction: holdState.holdInstruction || HOLD_INSTRUCTIONS[0],
      currentNote: holdState.ownerNote || '',
    });
    setNewInstruction(holdState.holdInstruction || HOLD_INSTRUCTIONS[0]);
    setNewInstructionNote(holdState.ownerNote || '');
  };

  const handleUpdateInstructionSubmit = async (e) => {
    e?.preventDefault?.();
    if (!updateInstructionModal) return;
    setUpdateInstructionSubmitting(true);
    setUpdateInstructionError(null);
    try {
      const payload = {
        instruction: newInstruction,
        ownerNote: newInstructionNote,
      };
      await api.updateBatchHoldInstruction(updateInstructionModal.batchId, payload);
      notifySuccess(`Hold instruction updated for ${updateInstructionModal.number}. Baker notified.`);
      setUpdateInstructionModal(null);
      await loadData(activeTab);
    } catch (err) {
      const errMsg = err.message || 'Failed to update instruction';
      setUpdateInstructionError(errMsg);
      notifyError(errMsg);
    } finally {
      setUpdateInstructionSubmitting(false);
    }
  };

  const handleOpenResolveModal = (batchOrOrder) => {
    setResolveHoldError(null);
    const isBatch = Boolean(batchOrOrder.batchNumber);
    const id = batchOrOrder._id;
    const num = isBatch ? batchOrOrder.batchNumber : batchOrOrder.orderNumber;
    const holdState = batchOrOrder.holdState || {};
    const batchId = isBatch ? batchOrOrder._id : (holdState.relatedBatch?._id || holdState.relatedBatch || id);
    const relatedOrders = isBatch ? (batchOrOrder.relatedOrders || []) : [batchOrOrder];
    setResolveHoldModal({
      batchId,
      number: num,
      relatedOrders,
    });
    setResolveResolution(HOLD_RESOLUTIONS[0]);
    setResolveNote('');
    setResolveCancelOrderId('');
  };

  const handleResolveHoldSubmit = async (e) => {
    e?.preventDefault?.();
    if (!resolveHoldModal) return;
    setResolveSubmitting(true);
    setResolveHoldError(null);
    try {
      const payload = {
        resolution: resolveResolution,
        resolutionNote: resolveNote,
        ...(resolveCancelOrderId ? { cancelOrderId: resolveCancelOrderId } : {}),
      };
      await api.resolveBatchHold(resolveHoldModal.batchId, payload);
      notifySuccess(`Hold resolved for ${resolveHoldModal.number} (${resolveResolution}).`);
      setResolveHoldModal(null);
      await loadData(activeTab);
    } catch (err) {
      const errMsg = err.message || 'Failed to resolve hold';
      setResolveHoldError(errMsg);
      notifyError(errMsg);
    } finally {
      setResolveSubmitting(false);
    }
  };

  useEffect(() => {
    const isAnyHoldModalOpen = Boolean(holdModal || updateInstructionModal || resolveHoldModal);
    if (!isAnyHoldModalOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (holdModal && !holdSubmitting) setHoldModal(null);
        if (updateInstructionModal && !updateInstructionSubmitting) setUpdateInstructionModal(null);
        if (resolveHoldModal && !resolveSubmitting) setResolveHoldModal(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.body.classList.add('modal-open');

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('modal-open');
    };
  }, [holdModal, updateInstructionModal, resolveHoldModal, holdSubmitting, updateInstructionSubmitting, resolveSubmitting]);

  useEffect(() => {
    let eventSource = null;
    try {
      eventSource = createNotificationEventSource();
      const onEvent = () => {
        loadData(activeTab);
      };
      eventSource.addEventListener('PRODUCTION_HOLD', onEvent);
      eventSource.addEventListener('PRODUCTION_HOLD_UPDATED', onEvent);
      eventSource.addEventListener('PRODUCTION_HOLD_ACKNOWLEDGED', onEvent);
      eventSource.addEventListener('PRODUCTION_HOLD_RESOLVED', onEvent);
      eventSource.addEventListener('ORDER_STATUS_CHANGED', onEvent);
    } catch {
      // fallback
    }
    return () => {
      if (eventSource) eventSource.close();
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'orders') return undefined;
    let isActive = true;
    const refreshProductionUpdates = async () => {
      try {
        const response = await api.getBatches();
        if (!isActive) return;
        const latest = response.data?.batches || response.data || [];
        const previous = observedBatchUpdates.current;
        if (previous.size) {
          let accepted = false;
          let reassigned = false;
          latest.forEach((batch) => {
            const id = String(batch._id);
            const old = previous.get(id);
            const rejectedCount = batch.assignmentRejections?.length || 0;
            if (old && old.status !== 'ACCEPTED' && batch.status === 'ACCEPTED') accepted = true;
            if (old && rejectedCount > old.rejectedCount) reassigned = true;
          });
          if (accepted) notifySuccess('A production staff member accepted an assignment.');
          else if (reassigned) notifySuccess('A production assignment was rejected and sent to another staff member.');
        }
        observedBatchUpdates.current = new Map(latest.map((batch) => [String(batch._id), {
          status: batch.status,
          rejectedCount: batch.assignmentRejections?.length || 0,
        }]));
        setBatches(latest);
      } catch {
        // Keep the current order view usable if the background refresh is temporarily unavailable.
      }
    };
    refreshProductionUpdates();
    const intervalId = window.setInterval(refreshProductionUpdates, 5000);
    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [activeTab]);

  // Order Handlers & Historical Classification
  const isHistoricalOrder = (order) => ['CANCELLED', 'DELIVERED'].includes(order?.status);

  const fetchFilteredOrders = async (query = orderSearchQuery, status = orderStatusFilter, page = 1) => {
    try {
      const params = { page, limit: 50 };
      if (query && query.trim()) params.search = query.trim();
      if (status && !['ALL', 'ACTIVE', 'HISTORICAL'].includes(status)) {
        params.status = status;
      }
      const res = await api.getAllOrders(params);
      setOrders(res.data?.orders || res.data || []);
      if (res.meta) setOrderMeta(res.meta);
    } catch (err) {
      console.error('Failed to fetch filtered orders:', err);
    }
  };

  useEffect(() => {
    if (activeTab !== 'orders') return;
    const timer = setTimeout(() => {
      fetchFilteredOrders(orderSearchQuery, orderStatusFilter);
    }, 300);
    return () => clearTimeout(timer);
  }, [orderSearchQuery, orderStatusFilter, activeTab]);

  const displayedOrders = React.useMemo(() => {
    return orders.filter((order) => {
      // Status Filter
      if (orderStatusFilter === 'ACTIVE') {
        if (isHistoricalOrder(order)) return false;
      } else if (orderStatusFilter === 'HISTORICAL') {
        if (!isHistoricalOrder(order)) return false;
      } else if (orderStatusFilter !== 'ALL' && order.status !== orderStatusFilter) {
        return false;
      }

      // Customer name / phone / order number search (case-insensitive, partial matching)
      if (orderSearchQuery && orderSearchQuery.trim()) {
        const q = orderSearchQuery.trim().toLowerCase();
        const contactName = (order.contactName || '').toLowerCase();
        const custName = (order.customer?.name || '').toLowerCase();
        const phone = (order.contactPhone || '').toLowerCase();
        const orderNum = (order.orderNumber || '').toLowerCase();
        const matches = contactName.includes(q) || custName.includes(q) || phone.includes(q) || orderNum.includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [orders, orderSearchQuery, orderStatusFilter]);

  const handleConfirmPayment = async (orderId) => {
    try {
      await api.confirmPayment(orderId, 'Verified in bakery UPI account');
      notifySuccess('Payment confirmed successfully!');
      loadData('orders');
    } catch (err) {
      alert(`Could not confirm payment: ${err.message}`);
    }
  };

  const handleRejectPayment = async (orderId) => {
    if (!window.confirm('Reject this payment reference and cancel the order? The reserved stock will be released.')) return;
    try {
      await api.rejectPayment(orderId, 'Payment could not be verified by the bakery');
      notifySuccess('Payment rejected and order cancelled.');
      setOrders((prev) =>
        prev.map((ord) => (ord._id === orderId ? { ...ord, status: 'CANCELLED' } : ord))
      );
      await loadData('orders');
    } catch (err) {
      alert(`Could not reject payment: ${err.message}`);
    }
  };

  const handleClosePaymentProof = () => {
    if (proofData?.dataUrl) {
      try {
        URL.revokeObjectURL(proofData.dataUrl);
      } catch {}
    }
    setViewingProofOrder(null);
    setProofData(null);
    setProofError(null);
  };

  const handleViewPaymentProof = async (order) => {
    if (proofData?.dataUrl) {
      try {
        URL.revokeObjectURL(proofData.dataUrl);
      } catch {}
    }
    setViewingProofOrder(order);
    setProofLoading(true);
    setProofError(null);
    setProofData(null);
    try {
      const res = await api.getPaymentProof(order._id);
      setProofData({
        ...res.data,
        uploadedAt: res.data?.uploadedAt || order.paymentProof?.uploadedAt,
        fileSize: res.data?.fileSize || order.paymentProof?.fileSize,
        mimeType: res.data?.mimeType || order.paymentProof?.mimeType,
        fileName: res.data?.fileName || order.paymentProof?.fileName,
        isDeleted: order.paymentProof?.isDeleted || false,
        deletedAt: order.paymentProof?.deletedAt || null,
      });
    } catch (err) {
      if (err.status === 410 || err.message?.includes('expired') || err.message?.includes('deleted')) {
        setProofData({
          isDeleted: true,
          deletedAt: order.paymentProof?.deletedAt,
          uploadedAt: order.paymentProof?.uploadedAt,
          fileSize: order.paymentProof?.fileSize,
          mimeType: order.paymentProof?.mimeType,
          fileName: order.paymentProof?.fileName,
          errorMessage: err.message,
        });
      } else {
        setProofError(err.message || 'Failed to load payment screenshot');
      }
    } finally {
      setProofLoading(false);
    }
  };

  // Revoke object URL when dashboard unmounts or proofData changes
  useEffect(() => {
    return () => {
      if (proofData?.dataUrl) {
        try {
          URL.revokeObjectURL(proofData.dataUrl);
        } catch {}
      }
    };
  }, [proofData]);

  const handleSaveVariantPrice = async (productId, variantId) => {
    const key = `${productId}_${variantId}`;
    const newPrice = editingVariantPrices[key];
    if (newPrice === undefined || newPrice === '' || Number(newPrice) < 0) {
      alert('Please enter a valid price greater than or equal to 0.');
      return;
    }
    try {
      setSavingVariantPriceId(key);
      await api.updateVariantPrice(productId, variantId, Number(newPrice));
      notifySuccess('Selling price updated successfully!');
      const c = await api.getProductCosting(productId).catch(() => null);
      if (c?.data) {
        setProductCostings((prev) => ({ ...prev, [productId]: c.data }));
      }
      await loadData('products');
    } catch (err) {
      alert(`Could not update price: ${err.message}`);
    } finally {
      setSavingVariantPriceId(null);
    }
  };

  const handleUpdateStatus = async (orderId, newStatus) => {
    try {
      await api.updateOrderStatus(orderId, newStatus);
      notifySuccess(`Order status updated to ${newStatus}`);
      setOrders((prev) =>
        prev.map((ord) => (ord._id === orderId ? { ...ord, status: newStatus } : ord))
      );
      loadData('orders');
    } catch (err) {
      alert(`Could not update order status: ${err.message}`);
    }
  };

  const handleAssignOrder = async (order) => {
    const raw = orderAssignmentWorkers[order._id];
    const workerIds = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!workerIds.length) {
      alert('Choose at least one active production staff member first.');
      return;
    }
    try {
      await api.assignOrderToProduction(order._id, { workers: workerIds });
      notifySuccess('Order assigned to production. The selected staff member(s) have been notified.');
      await loadData('orders');
    } catch (err) {
      alert(`Could not assign this order: ${err.message}`);
    }
  };

  const handleOpenFulfillStockModal = (order) => {
    setFulfillError(null);
    setFulfillStockModal(order);
  };

  const handleConfirmFulfillFromStock = async () => {
    if (!fulfillStockModal || fulfillSubmitting) return;
    setFulfillSubmitting(true);
    setFulfillError(null);
    try {
      const res = await api.fulfillOrderFromStock(fulfillStockModal._id);
      notifySuccess(res?.message || `Order ${fulfillStockModal.orderNumber} successfully fulfilled from finished stock!`);
      setFulfillStockModal(null);
      await loadData('orders');
    } catch (err) {
      console.error('Failed to fulfill order from stock:', err);
      const msg = err.response?.data?.message || err.message || 'Failed to fulfill order from stock.';
      setFulfillError(msg);
      notifyError(msg);
    } finally {
      setFulfillSubmitting(false);
    }
  };

  const handleApproveRequisition = async (reqId, itemsPayload, notes) => {
    try {
      setLoading(true);
      await api.approveRequisition(reqId, {
        items: itemsPayload,
        notes: notes?.trim() || undefined,
      });
      notifySuccess('Requisition approved successfully.');
      setAdjustModalReq(null);
      await loadData(activeTab);
    } catch (err) {
      alert(`Approval failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRejectRequisition = async (e) => {
    e.preventDefault();
    if (!rejectModalReq || !rejectModalReason.trim()) return;
    try {
      setLoading(true);
      await api.rejectRequisition(rejectModalReq._id, rejectModalReason.trim());
      notifySuccess(`Requisition ${rejectModalReq.requisitionNumber} rejected.`);
      setRejectModalReq(null);
      setRejectModalReason('');
      await loadData(activeTab);
    } catch (err) {
      alert(`Rejection failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleIssueRequisition = async (reqId) => {
    if (!window.confirm('Issue ingredients and deduct stock from pantry now?')) return;
    try {
      setLoading(true);
      await api.issueRequisition(reqId);
      notifySuccess('Ingredients successfully issued and stock deducted from inventory lots!');
      await loadData(activeTab);
    } catch (err) {
      alert(`Ingredient issue failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // QR Settings Handler
  const handleSaveQrConfig = async (e) => {
    e.preventDefault();
    const upiId = qrConfig.upiId?.trim();
    const payeeName = qrConfig.payeeName?.trim();
    if (!upiId || !payeeName || upiId.toLowerCase() === 'bakeryowner@upi') {
      setError('Enter your official bakery UPI ID and payee name before saving. The placeholder UPI ID cannot receive payments.');
      return;
    }
    try {
      setError(null);
      const res = await api.updatePaymentQr({ ...qrConfig, upiId, payeeName, isPlaceholder: false });
      if (res.data) setQrConfig(res.data);
      notifySuccess('Bakery UPI QR configuration saved!');
    } catch (err) {
      alert(`Failed to save QR settings: ${err.message}`);
    }
  };

  const handleSaveCapacity = async (e) => {
    e.preventDefault();
    setCapacitySaving(true);
    setError(null);
    try {
      const payload = {
        workingHours: capacityConfig.workingHours,
        slotMinutes: Number(capacityConfig.slotMinutes),
        minutesPerStaffPerDay: Number(capacityConfig.minutesPerStaffPerDay),
        ovens: capacityConfig.ovens.map((oven) => ({ ...oven, minutesPerDay: Number(oven.minutesPerDay) })),
      };
      const response = await api.updateProductionCapacity(payload);
      setCapacityConfig({
        workingHours: response.data.workingHours,
        slotMinutes: String(response.data.slotMinutes),
        minutesPerStaffPerDay: String(response.data.minutesPerStaffPerDay),
        ovens: response.data.ovens.map((oven) => ({ ...oven, minutesPerDay: String(oven.minutesPerDay) })),
      });
      notifySuccess('Production capacity settings saved');
    } catch (err) {
      setError(`Could not save production capacity: ${err.message}`);
    } finally {
      setCapacitySaving(false);
    }
  };

  // Product & Category Handlers
  const handleCreateProduct = async (e) => {
    e.preventDefault();
    const totalTime = Number(newProduct.totalTimeMinutes);
    if (!Number.isFinite(totalTime) || totalTime <= 0) {
      alert('Total Time to Make Product is required and must be a finite number greater than 0 minutes.');
      return;
    }
    const elecCost = Number(newProduct.electricityCostPerUnit);
    if (!Number.isFinite(elecCost) || elecCost < 0) {
      alert('Electricity cost per unit must be a non-negative number.');
      return;
    }
    const packCost = Number(newProduct.packagingCostPerUnit);
    if (!Number.isFinite(packCost) || packCost < 0) {
      alert('Packaging cost per unit must be a non-negative number.');
      return;
    }

    try {
      const payload = {
        name: newProduct.name.trim(),
        category: newProduct.category,
        basePrice: Number(newProduct.price),
        description: newProduct.description?.trim() || undefined,
        imageUrl: newProduct.imageUrl?.trim() || '',
        totalTimeMinutes: totalTime,
        preparationTime: totalTime,
        preparationTimePerUnit: totalTime,
        productionTime: 0,
        electricityCostPerUnit: elecCost,
        packagingCostPerUnit: packCost,
      };

      let targetProductId = editingProductId;
      let targetVariantId = null;

      if (editingProductId) {
        const res = await api.updateProduct(editingProductId, payload);
        const updatedProd = res.data?.product || res.data;
        targetVariantId = updatedProd?.variants?.[0]?._id;
      } else {
        const res = await api.createProduct(payload);
        const createdProd = res.data?.product || res.data;
        targetProductId = createdProd?._id;
        if (createdProd?._id && newProduct.price) {
          try {
            const vRes = await api.addVariant(createdProd._id, {
              name: 'Regular',
              quantity: 1,
              unit: 'piece',
              price: Number(newProduct.price),
            });
            const vData = vRes.data?.variant || vRes.data;
            targetVariantId = vData?._id || createdProd.variants?.[0]?._id;
          } catch (vErr) {
            console.warn('Could not auto-create regular variant:', vErr.message);
          }
        }
      }

      // Sync or initialize active Recipe with this duration so made-to-order checkout passes
      if (targetProductId && targetVariantId) {
        try {
          const existingRecipeRes = await api.getRecipe(targetProductId, targetVariantId).catch(() => null);
          const existingRecipe = existingRecipeRes?.data?.recipe;
          if (existingRecipe) {
            await api.updateRecipe(targetProductId, targetVariantId, {
              totalTimeMinutes: totalTime,
              productionTime: totalTime,
              preparationTime: 0,
              duration: totalTime,
            });
          } else if (ingredients.length > 0) {
            await api.createRecipe(targetProductId, targetVariantId, {
              totalTimeMinutes: totalTime,
              productionTime: totalTime,
              preparationTime: 0,
              duration: totalTime,
              expectedYield: 1,
              yieldUnit: 'piece',
              instructions: `Standard production recipe for ${newProduct.name}`,
              ingredients: [{ ingredient: ingredients[0]._id, quantity: 0.1, unit: ingredients[0].unit || 'kg' }],
            });
          }
        } catch (rErr) {
          console.warn('Recipe sync notice:', rErr.message);
        }
      }

      notifySuccess(`Product "${newProduct.name}" ${editingProductId ? 'updated' : 'created'} with total time ${totalTime} min!`);
      setEditingProductId('');
      setNewProduct({
        name: '',
        category: '',
        price: '',
        description: '',
        imageUrl: '',
        totalTimeMinutes: '45',
        electricityCostPerUnit: '0',
        packagingCostPerUnit: '0',
      });
      loadData('products');
    } catch (err) {
      alert(`Could not save product: ${err.message}`);
    }
  };

  const handleCreateCategory = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: newCategory.name.trim(),
        description: newCategory.description?.trim() || undefined,
        imageUrl: newCategory.imageUrl?.trim() || '',
      };
      if (editingCategoryId) await api.updateCategory(editingCategoryId, payload);
      else await api.createCategory(payload);
      notifySuccess(`Category "${newCategory.name}" ${editingCategoryId ? 'updated' : 'created'}!`);
      setEditingCategoryId('');
      setNewCategory({ name: '', description: '', imageUrl: '' });
      loadData('products');
    } catch (err) {
      alert(`Could not create category: ${err.message}`);
    }
  };

  const handleDeleteProduct = async (id) => {
    if (deletingProductIdsRef.current.has(id)) return;
    if (!window.confirm('Are you sure you want to delete this product?')) return;
    deletingProductIdsRef.current.add(id);
    setDeletingProductIds((current) => new Set(current).add(id));
    try {
      await api.deleteProduct(id);
      setProducts((current) => current.filter((product) => product._id !== id));
      notifySuccess('Product removed from the menu');
      await loadData('products');
    } catch (err) {
      alert(err.message);
    } finally {
      deletingProductIdsRef.current.delete(id);
      setDeletingProductIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const startProductEdit = async (product) => {
    setEditingProductId(product._id);
    const combined = (product.totalTimeMinutes !== undefined && product.totalTimeMinutes !== null)
      ? Number(product.totalTimeMinutes)
      : ((Number(product.preparationTime) || 0) + (Number(product.productionTime) || 0));

    setNewProduct({
      name: product.name || '',
      category: product.category?._id || product.category || '',
      price: product.basePrice ?? product.variants?.[0]?.price ?? '',
      description: product.description || '',
      imageUrl: product.imageUrl || product.images?.[0] || '',
      totalTimeMinutes: String(combined || 30),
      electricityCostPerUnit: String(product.electricityCostPerUnit ?? 0),
      packagingCostPerUnit: String(product.packagingCostPerUnit ?? 0),
    });
    document.getElementById('owner-product-name')?.focus();
  };

  const startCategoryEdit = (category) => {
    setEditingCategoryId(category._id);
    setNewCategory({ name: category.name || '', description: category.description || '', imageUrl: category.imageUrl || category.image || '' });
  };

  // ==================== RECIPE HANDLERS ====================
  const openRecipeModal = (product, variantId = null) => {
    if (!product) return;
    setRecipeModalProduct(product);
    const targetVariantId = variantId || product.variants?.[0]?._id || '';
    setRecipeModalVariantId(targetVariantId);
    setShowRecipeModal(true);
  };

  const loadRecipeData = async (productId, variantId, prodContext = null, ingContext = null) => {
    if (!productId || !variantId) return;
    setRecipeLoading(true);
    const activeIngs = (ingContext && ingContext.length > 0) ? ingContext : ingredients;
    try {
      const res = await api.getRecipe(productId, variantId);
      const recipe = res.data?.recipe;
      if (recipe) {
        setRecipeExisting(true);
        setRecipeRevision(recipe.revision || 1);
        setRecipeCosting(recipe.costing || null);
        setRecipeForm({
          preparationTime: String(recipe.preparationTime ?? 0),
          productionTime: String(recipe.productionTime ?? ''),
          estimatedDurationMinutes: String(recipe.estimatedDurationMinutes ?? ''),
          equipmentPowerKw: String(recipe.equipmentPowerKw ?? '2.0'),
          electricityTariff: String(recipe.electricityTariff ?? '8.0'),
          expectedYield: String(recipe.expectedYield || 1),
          yieldUnit: recipe.yieldUnit || 'piece',
          instructions: recipe.instructions || '',
          labourCostPerMinute: String(recipe.labourCostPerMinute ?? ''),
          powerCostPerMinute: String(recipe.powerCostPerMinute ?? ''),
          packagingCostPerUnit: String(recipe.packagingCostPerUnit ?? ''),
          packagingQuantity: String(recipe.packagingQuantity ?? ''),
          packagingMaterials: Array.isArray(recipe.packagingMaterials) ? recipe.packagingMaterials.map((m) => ({
            name: m.name || '',
            costPerUnit: String(m.costPerUnit ?? ''),
            consumptionType: m.consumptionType || 'PER_PIECE',
            unitsPerItem: String(m.unitsPerItem ?? '1'),
          })) : [],
          labourMinutes: String(recipe.labourMinutes ?? ''),
          powerMinutes: String(recipe.powerMinutes ?? ''),
          ingredients: (recipe.ingredients && recipe.ingredients.length > 0)
            ? recipe.ingredients.map((ing) => ({
                ingredient: ing.ingredient?._id || ing.ingredient,
                quantity: String(ing.quantity || ''),
                unit: ing.unit || 'kg',
              }))
            : [{ ingredient: activeIngs[0]?._id || '', quantity: '', unit: activeIngs[0]?.unit || 'kg' }],
        });
      } else {
        throw new Error('Not found');
      }
    } catch {
      setRecipeExisting(false);
      setRecipeRevision(1);
      setRecipeCosting(null);
      const prod = prodContext || recipeModalProduct;
      const targetVariant = prod?.variants?.find((v) => v._id === variantId) || prod?.variants?.[0];
      setRecipeForm({
        preparationTime: String(prod?.preparationTime || 0),
        productionTime: String(prod?.productionTime || '30'),
        estimatedDurationMinutes: '',
        equipmentPowerKw: '2.0',
        electricityTariff: '8.0',
        expectedYield: '1',
        yieldUnit: targetVariant?.unit || 'piece',
        instructions: '',
        labourCostPerMinute: '',
        powerCostPerMinute: '',
        packagingCostPerUnit: '',
        packagingQuantity: '',
        packagingMaterials: [],
        labourMinutes: '',
        powerMinutes: '',
        ingredients: [{ ingredient: activeIngs[0]?._id || '', quantity: '', unit: activeIngs[0]?.unit || 'kg' }],
      });
    } finally {
      setRecipeLoading(false);
    }
  };

  const handleRecipeVariantChange = async (newVariantId) => {
    setRecipeModalVariantId(newVariantId);
    if (recipeModalProduct) {
      await loadRecipeData(recipeModalProduct._id, newVariantId);
    }
  };

  const handleAddRecipeIngredient = () => {
    const usedIds = new Set(recipeForm.ingredients.map((i) => i.ingredient).filter(Boolean));
    const available = ingredients.find((i) => !usedIds.has(i._id)) || ingredients[0];
    setRecipeForm((prev) => ({
      ...prev,
      ingredients: [
        ...prev.ingredients,
        {
          ingredient: available?._id || '',
          quantity: '',
          unit: available?.unit || 'kg',
        },
      ],
    }));
  };

  const handleRemoveRecipeIngredient = (index) => {
    setRecipeForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.filter((_, idx) => idx !== index),
    }));
    setActiveIngredientDropdownRow(null);
  };

  const handleUpdateRecipeIngredient = (index, field, value) => {
    setRecipeForm((prev) => {
      if (field === 'ingredient' && value) {
        const isDuplicate = prev.ingredients.some((item, idx) => idx !== index && item.ingredient === value);
        if (isDuplicate) {
          const matched = ingredients.find((i) => i._id === value);
          alert(`"${matched?.name || 'This ingredient'}" is already in the recipe. Please adjust quantity on the existing row instead of adding duplicate rows.`);
          return prev;
        }
      }

      return {
        ...prev,
        ingredients: prev.ingredients.map((item, idx) => {
          if (idx !== index) return item;
          const updated = { ...item, [field]: value };
          if (field === 'ingredient') {
            const matched = ingredients.find((ing) => ing._id === value);
            if (matched) {
              const compatible = getCompatibleUnits(matched.unit);
              if (!compatible.includes(updated.unit)) {
                updated.unit = matched.unit;
              }
            }
          }
          return updated;
        }),
      };
    });
  };

  const getIngredientStockInfo = (ingredientId, requiredQty, requiredUnit) => {
    if (!ingredientId) return null;
    const ingDoc = ingredients.find((i) => i._id === ingredientId);
    const invDoc = inventory.find((i) => i._id === ingredientId || i.ingredient?._id === ingredientId);
    const stock = Number((invDoc?.currentStock ?? 0).toFixed(4));
    const baseUnit = ingDoc?.unit || invDoc?.unit || requiredUnit || 'kg';

    let convertedRequired = null;
    let shortage = 0;
    let isShortage = false;

    if (requiredQty && Number(requiredQty) > 0) {
      convertedRequired = convertUnit(Number(requiredQty), requiredUnit, baseUnit);
      if (convertedRequired !== null) {
        convertedRequired = Number(convertedRequired.toFixed(4));
        if (convertedRequired > stock) {
          isShortage = true;
          shortage = Number((convertedRequired - stock).toFixed(4));
        }
      }
    }

    return {
      stock,
      baseUnit,
      ingName: ingDoc?.name || invDoc?.name || 'Ingredient',
      convertedRequired,
      isShortage,
      shortage,
    };
  };

  const openInlineIngredientModal = (rowIndex = null, initialName = '') => {
    setInlineTargetRowIndex(rowIndex);
    setInlineIngredientError(null);
    setInlineIngredientForm({
      name: initialName || '',
      unit: 'kg',
      minimumStock: '',
      reorderLevel: '',
      description: '',
      hasOpeningStock: false,
      openingStock: '',
      openingStockCost: '',
      openingStockExpiryDate: '',
      openingStockLotNumber: `LOT-OPN-${Date.now().toString().slice(-6)}`,
    });
    setActiveIngredientDropdownRow(null);
    setShowInlineIngredientModal(true);
  };

  const handleCreateInlineIngredient = async (e) => {
    e.preventDefault();
    setInlineIngredientSubmitting(true);
    setInlineIngredientError(null);
    try {
      const name = inlineIngredientForm.name.trim();
      if (!name) {
        throw new Error('Ingredient name is required.');
      }

      const payload = {
        name,
        unit: inlineIngredientForm.unit,
        minimumStock: inlineIngredientForm.minimumStock ? Number(inlineIngredientForm.minimumStock) : 0,
        reorderLevel: inlineIngredientForm.reorderLevel ? Number(inlineIngredientForm.reorderLevel) : 0,
        description: inlineIngredientForm.description?.trim() || undefined,
      };

      if (inlineIngredientForm.hasOpeningStock) {
        const openingQty = Number(inlineIngredientForm.openingStock);
        if (!Number.isFinite(openingQty) || openingQty <= 0) {
          throw new Error('Opening stock quantity must be a positive number greater than 0.');
        }
        payload.openingStock = openingQty;
        payload.openingStockUnit = inlineIngredientForm.unit;
        if (inlineIngredientForm.openingStockCost) {
          const cost = Number(inlineIngredientForm.openingStockCost);
          if (Number.isFinite(cost) && cost >= 0) {
            payload.openingStockCost = cost;
          }
        }
        if (inlineIngredientForm.openingStockExpiryDate) {
          payload.openingStockExpiryDate = inlineIngredientForm.openingStockExpiryDate;
        }
        if (inlineIngredientForm.openingStockLotNumber?.trim()) {
          payload.openingStockLotNumber = inlineIngredientForm.openingStockLotNumber.trim();
        }
      }

      const res = await api.createIngredient(payload);
      const created = res.data?.ingredient || res.data;
      if (!created || !created._id) {
        throw new Error('Failed to create ingredient.');
      }

      // Add to ingredients list
      setIngredients((prev) => {
        const exists = prev.some((i) => i._id === created._id);
        return exists ? prev : [...prev, created].sort((a, b) => a.name.localeCompare(b.name));
      });

      // Update inventory list in state
      if (payload.openingStock) {
        setInventory((prev) => {
          const idx = prev.findIndex((i) => i._id === created._id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], currentStock: (copy[idx].currentStock || 0) + payload.openingStock };
            return copy;
          }
          return [
            ...prev,
            {
              _id: created._id,
              name: created.name,
              unit: created.unit,
              currentStock: payload.openingStock,
              minimumStock: created.minimumStock || 0,
            },
          ];
        });
      }

      // Re-fetch inventory in background
      api.getInventory({ limit: 250 }).then((invRes) => {
        const invList = invRes?.data?.inventory || (Array.isArray(invRes?.data) ? invRes.data : null);
        if (invList) setInventory(invList);
      }).catch(() => {});

      // Automatically select in the target recipe row
      setRecipeForm((prev) => {
        const updated = [...prev.ingredients];
        if (inlineTargetRowIndex !== null && inlineTargetRowIndex >= 0 && inlineTargetRowIndex < updated.length) {
          updated[inlineTargetRowIndex] = {
            ...updated[inlineTargetRowIndex],
            ingredient: created._id,
            unit: created.unit,
          };
        } else {
          updated.push({
            ingredient: created._id,
            quantity: '',
            unit: created.unit,
          });
        }
        return {
          ...prev,
          ingredients: updated,
        };
      });

      notifySuccess(
        `Ingredient "${created.name}" created successfully${inlineIngredientForm.hasOpeningStock ? ` with ${inlineIngredientForm.openingStock} ${created.unit} opening stock` : ''}!`
      );
      setShowInlineIngredientModal(false);
    } catch (err) {
      setInlineIngredientError(err.message || 'Could not create ingredient');
    } finally {
      setInlineIngredientSubmitting(false);
    }
  };

  const handleSaveRecipe = async (e) => {
    e.preventDefault();
    if (!recipeModalProduct || !recipeModalVariantId) {
      alert('Product and variant must be selected.');
      return;
    }

    const prep = Number(recipeForm.preparationTime || 0);
    const prod = Number(recipeForm.productionTime);

    if (!Number.isFinite(prod) || prod <= 0) {
      alert('Recipe Production Duration is required and must be a finite number greater than 0 minutes.');
      return;
    }

    if (!Number.isFinite(prep) || prep < 0) {
      alert('Preparation time must be a non-negative number.');
      return;
    }

    const totalDuration = prep + prod;
    if (totalDuration <= 0) {
      alert('Total recipe duration (preparation + production) must be greater than 0 minutes.');
      return;
    }

    const yieldQty = Number(recipeForm.expectedYield);
    if (!Number.isFinite(yieldQty) || yieldQty <= 0) {
      alert('Expected recipe yield must be a positive number.');
      return;
    }

    if (!recipeForm.ingredients || recipeForm.ingredients.length === 0) {
      alert('A recipe must have at least one ingredient.');
      return;
    }

    const validIngredients = recipeForm.ingredients.map((ing) => ({
      ingredient: ing.ingredient,
      quantity: Number(ing.quantity),
      unit: ing.unit,
    }));

    for (const ing of validIngredients) {
      if (!ing.ingredient) {
        alert('Please select an ingredient for every recipe row.');
        return;
      }
      if (!Number.isFinite(ing.quantity) || ing.quantity <= 0) {
        alert('Every ingredient quantity must be greater than 0.');
        return;
      }
    }

    // Verify no duplicates
    const ids = validIngredients.map((i) => String(i.ingredient));
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length > 0) {
      alert('Duplicate ingredients found. Each ingredient can appear only once in a recipe. Please combine quantities.');
      return;
    }

    // Verify unit compatibility
    for (const ing of validIngredients) {
      const matched = ingredients.find((i) => i._id === ing.ingredient);
      if (matched && !areUnitsConvertible(ing.unit, matched.unit)) {
        alert(`Recipe unit "${ing.unit}" is not compatible with ingredient "${matched.name}" base unit "${matched.unit}".`);
        return;
      }
    }

    setRecipeSaving(true);
    try {
      const payload = {
        preparationTime: prep,
        productionTime: prod,
        duration: prod,
        estimatedDurationMinutes: recipeForm.estimatedDurationMinutes !== '' ? Number(recipeForm.estimatedDurationMinutes) : totalDuration,
        equipmentPowerKw: recipeForm.equipmentPowerKw !== '' ? Number(recipeForm.equipmentPowerKw) : 2.0,
        electricityTariff: recipeForm.electricityTariff !== '' ? Number(recipeForm.electricityTariff) : 8.0,
        packagingMaterials: (recipeForm.packagingMaterials || [])
          .filter((m) => m.name?.trim() && Number(m.costPerUnit) >= 0)
          .map((m) => ({
            name: m.name.trim(),
            costPerUnit: Number(m.costPerUnit) || 0,
            consumptionType: m.consumptionType === 'PER_BATCH' ? 'PER_BATCH' : 'PER_PIECE',
            unitsPerItem: Number(m.unitsPerItem) || 1,
          })),
        expectedYield: yieldQty,
        yieldUnit: recipeForm.yieldUnit,
        instructions: recipeForm.instructions?.trim() || undefined,
        labourCostPerMinute: recipeForm.labourCostPerMinute !== '' ? Number(recipeForm.labourCostPerMinute) : 0,
        powerCostPerMinute: recipeForm.powerCostPerMinute !== '' ? Number(recipeForm.powerCostPerMinute) : 0,
        packagingCostPerUnit: recipeForm.packagingCostPerUnit !== '' ? Number(recipeForm.packagingCostPerUnit) : 0,
        packagingQuantity: recipeForm.packagingQuantity !== '' ? Number(recipeForm.packagingQuantity) : yieldQty,
        labourMinutes: recipeForm.labourMinutes !== '' ? Number(recipeForm.labourMinutes) : undefined,
        powerMinutes: recipeForm.powerMinutes !== '' ? Number(recipeForm.powerMinutes) : undefined,
        ingredients: validIngredients,
      };

      if (recipeExisting) {
        await api.updateRecipe(recipeModalProduct._id, recipeModalVariantId, payload);
        notifySuccess(`Recipe for ${recipeModalProduct.name} updated! Total workload: ${totalDuration} minutes.`);
      } else {
        await api.createRecipe(recipeModalProduct._id, recipeModalVariantId, payload);
        notifySuccess(`Recipe created for ${recipeModalProduct.name}! Total workload: ${totalDuration} minutes.`);
      }

      await loadRecipeData(recipeModalProduct._id, recipeModalVariantId);
      const c = await api.getProductCosting(recipeModalProduct._id).catch(() => null);
      if (c?.data) {
        setProductCostings((prev) => ({ ...prev, [recipeModalProduct._id]: c.data }));
      }
      loadData('products');
    } catch (err) {
      alert(`Could not save recipe: ${err.message}`);
    } finally {
      setRecipeSaving(false);
    }
  };

  // ==================== INVENTORY HANDLERS ====================
  const handleSaveIngredient = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: newIngredient.name.trim(),
        unit: newIngredient.unit,
        description: newIngredient.description.trim() || undefined,
        minimumStock: newIngredient.minimumStock !== '' ? Number(newIngredient.minimumStock) : 0,
        reorderLevel: newIngredient.reorderLevel !== '' ? Number(newIngredient.reorderLevel) : 0,
      };
      if (editingIngredientId) {
        await api.updateIngredient(editingIngredientId, payload);
        notifySuccess(`Ingredient "${newIngredient.name}" updated successfully!`);
      } else {
        await api.createIngredient(payload);
        notifySuccess(`Ingredient "${newIngredient.name}" added to pantry!`);
      }
      setEditingIngredientId('');
      setNewIngredient({ name: '', unit: 'kg', description: '', minimumStock: '', reorderLevel: '' });
      loadData('inventory');
    } catch (err) {
      alert(`Could not save ingredient: ${err.message}`);
    }
  };

  const handleEditIngredient = (ing) => {
    setEditingIngredientId(ing._id);
    setNewIngredient({
      name: ing.name || '',
      unit: ing.unit || 'kg',
      description: ing.description || '',
      minimumStock: ing.minimumStock !== undefined && ing.minimumStock !== null ? String(ing.minimumStock) : '',
      reorderLevel: ing.reorderLevel !== undefined && ing.reorderLevel !== null ? String(ing.reorderLevel) : '',
    });
  };

  const handleCancelEditIngredient = () => {
    setEditingIngredientId('');
    setNewIngredient({ name: '', unit: 'kg', description: '', minimumStock: '', reorderLevel: '' });
  };

  const handleCreateVendor = async (e) => {
    e.preventDefault();
    try {
      await api.createVendor({
        name: newVendor.name.trim(),
        contactPerson: newVendor.contactPerson.trim() || undefined,
        phone: newVendor.phone.trim() || undefined,
        email: newVendor.email.trim() || undefined,
        address: newVendor.address.trim() || undefined,
        gstNumber: newVendor.gstNumber.trim().toUpperCase() || undefined,
        notes: newVendor.notes.trim() || undefined,
      });
      notifySuccess(`Supplier "${newVendor.name}" registered!`);
      setNewVendor({ name: '', contactPerson: '', phone: '', email: '', address: '', gstNumber: '', notes: '' });
      loadData('inventory');
    } catch (err) {
      alert(`Could not create vendor: ${err.message}`);
    }
  };

  const handleAddPurchaseItem = () => {
    setPurchaseForm({
      ...purchaseForm,
      items: [
        ...purchaseForm.items,
        {
          ingredient: '',
          quantity: '',
          unit: 'kg',
          unitPrice: '',
          lotNumber: `LOT-${Date.now().toString().slice(-6)}-${purchaseForm.items.length + 1}`,
          expiryDate: '',
        },
      ],
    });
  };

  const handleRemovePurchaseItem = (index) => {
    if (purchaseForm.items.length <= 1) return;
    const updated = purchaseForm.items.filter((_, i) => i !== index);
    setPurchaseForm({ ...purchaseForm, items: updated });
  };

  const handleUpdatePurchaseItem = (index, field, value) => {
    const updated = [...purchaseForm.items];
    updated[index][field] = value;
    if (field === 'ingredient') {
      const selectedIng = ingredients.find((ing) => ing._id === value);
      if (selectedIng?.unit) {
        updated[index].unit = selectedIng.unit;
      }
    }
    setPurchaseForm({ ...purchaseForm, items: updated });
  };

  const handleRecordPurchase = async (e) => {
    e.preventDefault();
    if (!purchaseForm.vendor) {
      alert('Please select a supplier/vendor');
      return;
    }
    if (purchaseForm.items.some((it) => !it.ingredient || !it.quantity || Number(it.quantity) <= 0)) {
      alert('Please complete all item ingredients, quantities, and lot numbers.');
      return;
    }

    // Check unique lot numbers in form
    const lotNumbers = purchaseForm.items.map((it) => it.lotNumber.trim());
    if (new Set(lotNumbers).size !== lotNumbers.length) {
      alert('All lot numbers within a purchase receiving slip must be unique.');
      return;
    }

    try {
      const payload = {
        vendor: purchaseForm.vendor,
        purchaseDate: new Date(purchaseForm.purchaseDate),
        invoiceNumber: purchaseForm.invoiceNumber.trim() || undefined,
        tax: Number(purchaseForm.tax || 0),
        notes: purchaseForm.notes.trim() || undefined,
        items: purchaseForm.items.map((it) => ({
          ingredient: it.ingredient,
          quantity: Number(it.quantity),
          unit: it.unit,
          unitPrice: Number(it.unitPrice || 0),
          lotNumber: it.lotNumber.trim(),
          expiryDate: it.expiryDate ? new Date(it.expiryDate) : undefined,
        })),
      };

      await api.createPurchase(payload);
      notifySuccess('Stock received and inventory lots successfully updated!');
      setPurchaseForm({
        vendor: '',
        purchaseDate: new Date().toISOString().slice(0, 10),
        invoiceNumber: '',
        tax: 0,
        notes: '',
        items: [
          {
            ingredient: '',
            quantity: '',
            unit: 'kg',
            unitPrice: '',
            lotNumber: `LOT-${Date.now().toString().slice(-6)}`,
            expiryDate: '',
          },
        ],
      });
      loadData('inventory');
      setInvSubTab('stock');
    } catch (err) {
      alert(`Could not record purchase / stock receipt: ${err.message}`);
    }
  };

  const handleStockAdjustment = async (e) => {
    e.preventDefault();
    if (!adjustmentForm.ingredientId || !adjustmentForm.quantity || Number(adjustmentForm.quantity) <= 0) {
      alert('Please specify an ingredient and a positive quantity');
      return;
    }
    try {
      await api.adjustInventory({
        ingredientId: adjustmentForm.ingredientId,
        quantity: Number(adjustmentForm.quantity),
        unit: adjustmentForm.unit,
        type: adjustmentForm.type,
        reason: adjustmentForm.reason.trim(),
      });
      notifySuccess(`Stock adjustment (${adjustmentForm.type}) recorded successfully!`);
      setShowAdjustModal(false);
      setAdjustmentForm({
        ingredientId: '',
        quantity: '',
        unit: 'kg',
        type: 'ADD',
        reason: 'Stock count calibration',
      });
      loadData('inventory');
    } catch (err) {
      alert(`Stock adjustment failed: ${err.message}`);
    }
  };

  // ==================== STAFF MANAGEMENT HANDLERS ====================
  const handleCreateStaff = async (e) => {
    e.preventDefault();
    if (!staffForm.name || !staffForm.email || !staffForm.password) {
      alert('Please fill in name, email, and password (min 8 chars).');
      return;
    }
    const rate = Number(staffForm.hourlyLabourRate);
    if (staffForm.hourlyLabourRate === '' || isNaN(rate) || rate < 0 || !isFinite(rate)) {
      alert('Please enter a valid, non-negative Hourly Labour Rate (₹/hour).');
      return;
    }
    try {
      setStaffSubmitting(true);
      await api.createWorker({
        name: staffForm.name.trim(),
        email: staffForm.email.trim().toLowerCase(),
        password: staffForm.password,
        phone: staffForm.phone.trim() || undefined,
        jobDesignation: staffForm.jobDesignation.trim() || 'Baker',
        hourlyLabourRate: rate,
      });
      notifySuccess(`Production staff account for "${staffForm.name}" created!`);
      setStaffForm({
        name: '',
        email: '',
        password: '',
        phone: '',
        jobDesignation: 'Baker',
        hourlyLabourRate: '',
      });
      loadData('staff');
    } catch (err) {
      alert(`Could not create staff member: ${err.message}`);
    } finally {
      setStaffSubmitting(false);
    }
  };

  const handleOpenEditStaff = (worker) => {
    setEditingWorker(worker);
    setEditWorkerForm({
      phone: worker.phone || '',
      jobDesignation: worker.jobDesignation || 'Baker',
      hourlyLabourRate: worker.hourlyLabourRate != null ? String(worker.hourlyLabourRate) : '',
    });
  };

  const handleUpdateStaff = async (e) => {
    e.preventDefault();
    if (!editingWorker) return;
    const rate = Number(editWorkerForm.hourlyLabourRate);
    if (editWorkerForm.hourlyLabourRate === '' || isNaN(rate) || rate < 0 || !isFinite(rate)) {
      alert('Please enter a valid, non-negative Hourly Labour Rate (₹/hour).');
      return;
    }
    try {
      setEditWorkerSubmitting(true);
      await api.updateWorker(editingWorker._id, {
        phone: editWorkerForm.phone.trim() || undefined,
        jobDesignation: editWorkerForm.jobDesignation.trim() || 'Baker',
        hourlyLabourRate: rate,
      });
      notifySuccess(`Updated labour rate and details for "${editingWorker.name}"!`);
      setEditingWorker(null);
      loadData('staff');
    } catch (err) {
      alert(`Could not update staff member: ${err.message}`);
    } finally {
      setEditWorkerSubmitting(false);
    }
  };

  const handleToggleStaffStatus = async (worker) => {
    const nextStatus = !worker.isActive;
    const confirmMsg = nextStatus
      ? `Reactivate ${worker.name}?`
      : `Deactivate ${worker.name}? They will not be able to log in to the workstation.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await api.updateWorker(worker._id, { isActive: nextStatus });
      notifySuccess(`${worker.name} status updated to ${nextStatus ? 'Active' : 'Inactive'}`);
      loadData('staff');
    } catch (err) {
      alert(`Could not update staff status: ${err.message}`);
    }
  };

  // ==================== PRODUCTION BATCH HANDLERS ====================
  const handleAssignWorkerToBatch = async (e) => {
    e.preventDefault();
    if (!assignModalBatch || !selectedWorkerForAssign) return;

    try {
      // Append or replace worker assignment
      const existing = (assignModalBatch.assignedWorkers || []).map((w) => ({
        worker: w.worker?._id || w.worker || w._id,
        task: w.task || 'Staff Member',
      }));

      // Add if not already present
      const alreadyHas = existing.some((w) => String(w.worker) === String(selectedWorkerForAssign));
      let updatedWorkers = existing;
      if (!alreadyHas) {
        updatedWorkers = [
          ...existing,
          { worker: selectedWorkerForAssign, task: taskDescriptionForAssign.trim() || 'Baking Specialist' },
        ];
      } else {
        updatedWorkers = existing.map((w) =>
          String(w.worker) === String(selectedWorkerForAssign)
            ? { ...w, task: taskDescriptionForAssign.trim() || w.task }
            : w
        );
      }

      await api.updateBatch(assignModalBatch._id, {
        assignedWorkers: updatedWorkers,
      });

      notifySuccess('Staff member assigned to batch successfully!');
      setAssignModalBatch(null);
      setSelectedWorkerForAssign('');
      loadData('production');
    } catch (err) {
      alert(`Failed to assign staff: ${err.message}`);
    }
  };

  return (
    <div className="container owner-dashboard" style={{ padding: '2rem 1.5rem', maxWidth: '1440px' }}>
      {/* Toast Notification */}
      {successMessage && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            background: 'var(--success)',
            color: 'white',
            padding: '12px 20px',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Check size={18} />
          {successMessage}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <h1 style={{ fontSize: '1.85rem', fontWeight: 800, margin: 0 }}>Owner Dashboard</h1>
            <span className="badge badge-info">Owner</span>
          </div>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            Unified command center for orders, inventory receiving, production floor & staff management
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <ThemeToggle />
          <button
            onClick={() => loadData(activeTab)}
            className="btn btn-outline btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} /> Refresh Data
          </button>
        </div>
      </div>

      <div className="owner-workspace">
      <aside className={`owner-sidebar ${mobileNavOpen ? 'is-open' : ''}`} aria-label="Management navigation">
        <button className="owner-nav-toggle btn btn-outline" onClick={() => setMobileNavOpen(!mobileNavOpen)} aria-expanded={mobileNavOpen}>
          {mobileNavOpen ? <X size={18} /> : <Package size={18} />} Sections
        </button>
        <nav className="owner-nav-list">
        {[
          { id: 'overview', label: 'Overview', icon: BarChart3 },
          { id: 'orders', label: 'Orders & Payments', icon: ShoppingBag },
          { id: 'products', label: 'Menu Management', icon: Package },
          { id: 'inventory', label: 'Inventory', icon: Layers },
          { id: 'production', label: 'Production', icon: Shield },
          { id: 'requisitions', label: 'Requisitions', icon: ClipboardList },
          { id: 'staff', label: 'Staff', icon: Users },
          { id: 'analytics', label: 'Sales & Analytics', icon: BarChart3 },
          { id: 'qr', label: 'Settings', icon: QrCode },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setMobileNavOpen(false); }}
              className={`owner-nav-item ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
        </nav>
      </aside>

      {/* Tab Content */}
      <section className="owner-content">
      {loading ? (
        <div style={{ textAlign: 'center', padding: '5rem 0' }}>
          <div className="spinner" style={{ margin: '0 auto 1rem auto' }}></div>
          <p style={{ color: 'var(--text-muted)' }}>Loading management data...</p>
        </div>
      ) : error ? (
        <div className="alert alert-danger" style={{ marginBottom: '2rem' }}>
          {error}
        </div>
      ) : (
        <div>
          {activeTab === 'overview' && (
            <div className="owner-overview">
              <div className="owner-section-heading"><div><h2>Today at the bakery</h2><p>Live information from your bakery operations.</p></div></div>
              <div className="owner-overview-grid">
                <button className="card owner-overview-card metric-card-animate stagger-0" onClick={() => setActiveTab('orders')}>
                  <span>Open orders</span>
                  <strong>
                    {overview.orderMeta?.counts?.active ??
                      overview.orders.filter((o) => !['COMPLETED', 'DELIVERED', 'CANCELLED', 'EXPIRED'].includes(o.status)).length}
                  </strong>
                  <small>
                    {(overview.orderMeta?.counts?.total ?? overview.orders.length) > 0
                      ? `${overview.orderMeta?.counts?.active ?? overview.orders.filter((o) => !['COMPLETED', 'DELIVERED', 'CANCELLED', 'EXPIRED'].includes(o.status)).length} active · ${overview.orderMeta?.counts?.total ?? overview.orders.length} total orders`
                      : '0 active · No orders placed yet'}
                  </small>
                </button>
                <button className="card owner-overview-card metric-card-animate stagger-1" onClick={() => setActiveTab('orders')}>
                  <span>Payments to review</span>
                  <strong>
                    {overview.orderMeta?.counts?.pendingVerification ??
                      overview.orders.filter((o) => o.paymentStatus === 'PENDING_VERIFICATION').length}
                  </strong>
                  <small>UPI references awaiting verification</small>
                </button>
                <button className="card owner-overview-card metric-card-animate stagger-2" onClick={() => { setInvSubTab('stock'); setActiveTab('inventory'); }}>
                  <span>Low stock items</span>
                  <strong>{overview.lowStock.length}</strong>
                  <small>Check ingredients and finished stock</small>
                </button>
                <button className="card owner-overview-card metric-card-animate stagger-3" onClick={() => setActiveTab('production')}>
                  <span>Active batches</span>
                  <strong>
                    {overview.batches.filter((b) => !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(b.status)).length}
                  </strong>
                  <small>
                    {overview.batches.length > 0
                      ? `${overview.batches.filter((b) => !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(b.status)).length} active · ${overview.batches.length} total batches`
                      : 'No production batches yet'}
                  </small>
                </button>
              </div>
              <div className="card owner-qr-overview" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.25rem', padding: '1.25rem' }}>
                <div>
                  <h3>Bakery payment QR</h3>
                  <p>{qrConfig.isPlaceholder ? 'Add your official UPI details to enable customer payments.' : `${qrConfig.payeeName} · ${qrConfig.upiId}`}</p>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setActiveTab('qr')}>
                    {qrConfig.isPlaceholder ? 'Configure QR' : 'Manage QR'}
                  </button>
                </div>
                {!qrConfig.isPlaceholder && qrConfig.upiId && (
                  <img
                    src={qrConfig.qrImageUrl || `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrConfig.qrData || `upi://pay?pa=${encodeURIComponent(qrConfig.upiId)}&pn=${encodeURIComponent(qrConfig.payeeName || 'Smart Bakery')}&cu=INR`)}`}
                    alt="Bakery UPI payment QR code"
                    style={{ width: '140px', height: '140px', objectFit: 'contain', background: 'white', borderRadius: '12px', border: '1px solid var(--border-color)' }}
                    onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
                  />
                )}
              </div>
              <div className="card owner-recent">
                <h3>Recent orders</h3>
                {overview.orders.length ? (
                  overview.orders.slice(0, 5).map((order) => (
                    <div className="owner-recent-row" key={order._id}>
                      <strong>{order.orderNumber || 'Order'}</strong>
                      <span>{order.contactName || order.customer?.name || 'Customer'}</span>
                      <span className="badge badge-info">{order.status}</span>
                    </div>
                  ))
                ) : (
                  <p style={{ color: 'var(--text-muted)' }}>No customer orders to show yet. Customer orders will appear here once placed.</p>
                )}
              </div>
            </div>
          )}
          {/* ========================================================================= */}
          {/* TAB 1: ORDERS & MANUAL PAYMENTS */}
          {/* ========================================================================= */}
          {activeTab === 'orders' && (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.25rem',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0 }}>
                    Orders & Payments ({displayedOrders.length}
                    {displayedOrders.length !== orders.length ? ` of ${orders.length}` : ''})
                  </h2>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Verify customer UPI payments, manage kitchen progress, and view historical orders
                  </div>
                </div>

                {/* Customer Search & Order Status Filters */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', minWidth: '280px' }}>
                    <Search
                      size={16}
                      style={{
                        position: 'absolute',
                        left: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                        pointerEvents: 'none',
                      }}
                    />
                    <input
                      type="text"
                      className="input-field"
                      placeholder="Search by customer name or phone..."
                      value={orderSearchQuery}
                      onChange={(e) => setOrderSearchQuery(e.target.value)}
                      data-testid="order-search-input"
                      style={{
                        margin: 0,
                        paddingLeft: '36px',
                        paddingRight: orderSearchQuery ? '34px' : '12px',
                        height: '38px',
                        fontSize: '0.88rem',
                        width: '100%',
                      }}
                    />
                    {orderSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setOrderSearchQuery('')}
                        aria-label="Clear search"
                        data-testid="order-search-clear"
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Filter size={16} style={{ color: 'var(--text-muted)' }} />
                    <select
                      className="input-field"
                      value={orderStatusFilter}
                      onChange={(e) => setOrderStatusFilter(e.target.value)}
                      data-testid="order-status-filter"
                      style={{
                        margin: 0,
                        height: '38px',
                        fontSize: '0.88rem',
                        padding: '4px 10px',
                        width: 'auto',
                      }}
                    >
                      <option value="ALL">All Orders</option>
                      <option value="ACTIVE">Active Orders Only</option>
                      <option value="HISTORICAL">Historical Only (Delivered / Cancelled)</option>
                      <option value="PENDING_PAYMENT">Pending Payment</option>
                      <option value="CONFIRMED">Confirmed</option>
                      <option value="IN_PRODUCTION">In Production</option>
                      <option value="READY">Ready</option>
                      <option value="OUT_FOR_DELIVERY">Out for Delivery</option>
                      <option value="DELIVERED">Delivered</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  </div>
                </div>
              </div>

              {displayedOrders.length === 0 ? (
                <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  {orderSearchQuery || orderStatusFilter !== 'ALL' ? (
                    <div>
                      <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>No orders match your search or filter.</p>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setOrderSearchQuery('');
                          setOrderStatusFilter('ALL');
                        }}
                      >
                        Reset Search & Filters
                      </button>
                    </div>
                  ) : (
                    'No customer orders found.'
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {displayedOrders.map((order) => {
                    const isHistorical = isHistoricalOrder(order);

                    // =========================================================================
                    // HISTORICAL ORDER VIEW: COMPACT ROW WITH ONLY 4 FIELDS
                    // 1. Customer Name
                    // 2. Customer Phone Number
                    // 3. Order Status
                    // 4. Order Amount
                    // All other details (items, payments, production, remarks) are hidden.
                    // =========================================================================
                    if (isHistorical) {
                      return (
                        <div
                          key={order._id}
                          className="card"
                          data-testid={`historical-order-${order.orderNumber || order._id}`}
                          style={{
                            padding: '1.1rem 1.5rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '1.25rem',
                            backgroundColor: 'var(--bg-main, #f8fafc)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '10px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
                                Customer Name
                              </div>
                              <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-main)' }}>
                                {order.contactName || order.customer?.name || 'Guest'}
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
                                Customer Phone Number
                              </div>
                              <div style={{ fontSize: '0.92rem', color: 'var(--text-muted)' }}>
                                {order.contactPhone || order.customer?.phone || 'N/A'}
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
                                Order Status
                              </div>
                              <div>
                                <span
                                  className={`badge ${order.status === 'DELIVERED' ? 'badge-success' : 'badge-danger'}`}
                                  style={{ fontSize: '0.82rem', fontWeight: 600 }}
                                >
                                  {order.status}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
                              Order Amount
                            </div>
                            <div style={{ fontWeight: 700, fontSize: '1.15rem', color: 'var(--text-main)' }}>
                              {formatCurrency(order.total ?? order.pricing?.total ?? order.totalAmount ?? 0)}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // =========================================================================
                    // ACTIVE ORDER VIEW: FULL DETAILS
                    // =========================================================================
                    const isPendingUpi = order.paymentMethod === 'MANUAL_UPI' && order.paymentStatus === 'PENDING_VERIFICATION';

                    return (
                      <div
                        key={order._id}
                        className="card"
                        data-testid={`active-order-${order.orderNumber || order._id}`}
                        style={{
                          padding: '1.5rem',
                          borderLeft: isPendingUpi ? '4px solid var(--warning)' : '1px solid var(--border-color)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            flexWrap: 'wrap',
                            gap: '1rem',
                            marginBottom: '1rem',
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: '1.15rem' }}>{order.orderNumber}</strong>
                              <span className="badge badge-info">{order.orderType}</span>
                              <span className="badge badge-warning">{order.paymentMethod === 'COD' ? 'Pay on Delivery' : order.paymentMethod}</span>
                              {order.deliveryDate && (
                                <span className="badge badge-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <Calendar size={12} /> {order.deliveryDate} ({order.deliveryTimeSlot || 'General'})
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                              Customer: <strong>{order.contactName || order.customer?.name || 'Guest'}</strong> (Phone:{' '}
                              {order.contactPhone || 'N/A'})
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span
                              className={`badge ${
                                order.paymentStatus === 'PAYMENT_CONFIRMED' || order.paymentStatus === 'SUCCESS'
                                  ? 'badge-success'
                                  : order.paymentStatus === 'PENDING_VERIFICATION'
                                  ? 'badge-info'
                                  : 'badge-warning'
                              }`}
                            >
                              Payment: {order.paymentStatus}
                            </span>

                            {order.paymentProof?.hasProof && (
                              <button
                                type="button"
                                onClick={() => handleViewPaymentProof(order)}
                                className="btn btn-outline btn-sm"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                <ImageIcon size={14} /> View Screenshot
                              </button>
                            )}

                            {isPendingUpi && <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                              <button onClick={() => handleConfirmPayment(order._id)} className="btn btn-primary btn-sm"><CheckCircle size={15} /> Verify payment</button>
                              <button onClick={() => handleRejectPayment(order._id)} className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }}>Reject & cancel</button>
                            </div>}

                            {order.paymentMethod === 'COD' && order.paymentStatus === 'PAYMENT_PENDING' && (
                              <button
                                type="button"
                                onClick={() => handleConfirmPayment(order._id)}
                                className="btn btn-outline btn-sm"
                                style={{ borderColor: 'var(--success)', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                title="Record cash or UPI collection for Pay on Delivery"
                              >
                                <CheckCircle size={14} /> Record Collection
                              </button>
                            )}

                            {['IN_PRODUCTION', 'CONFIRMED'].includes(order.status) && !order.holdState?.isOnHold && (
                              <button
                                type="button"
                                onClick={() => handleOpenHoldModal('order', order)}
                                className="btn btn-outline btn-sm"
                                style={{ borderColor: '#f43f5e', color: '#be123c', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                title="Put order and production on emergency hold"
                              >
                                <AlertOctagon size={14} /> Put on Hold
                              </button>
                            )}

                            <select
                              disabled={order.status === 'PENDING_PAYMENT'}
                              value={order.status}
                              onChange={(e) => handleUpdateStatus(order._id, e.target.value)}
                              className="input-field"
                              style={{ width: 'auto', margin: 0, padding: '4px 8px', fontSize: '0.85rem' }}
                            >
                              {order.status === 'PENDING_PAYMENT' && <option value="PENDING_PAYMENT">PENDING_PAYMENT</option>}
                              <option value="CONFIRMED">CONFIRMED</option>
                              <option value="IN_PRODUCTION">IN_PRODUCTION</option>
                              <option value="READY">READY</option>
                              <option value="OUT_FOR_DELIVERY">OUT_FOR_DELIVERY</option>
                              <option value="DELIVERED">DELIVERED</option>
                              <option value="CANCELLED">CANCELLED</option>
                            </select>
                          </div>
                        </div>

                        {/* EMERGENCY PRODUCTION HOLD BANNER */}
                        {order.holdState?.isOnHold && (
                          <div
                            style={{
                              backgroundColor: '#fff1f2',
                              border: '2px solid #f43f5e',
                              borderRadius: '10px',
                              padding: '12px 16px',
                              marginBottom: '1rem',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '1.25rem' }}>🚨</span>
                                <strong style={{ color: '#be123c', fontSize: '0.98rem' }}>EMERGENCY PRODUCTION HOLD ACTIVE</strong>
                                <span className="badge badge-danger">{order.holdState.holdReason}</span>
                              </div>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                  type="button"
                                  onClick={() => handleOpenUpdateInstructionModal(order)}
                                  className="btn btn-outline btn-sm"
                                  style={{ borderColor: '#f43f5e', color: '#be123c' }}
                                >
                                  Update Instruction
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenResolveModal(order)}
                                  className="btn btn-primary btn-sm"
                                  style={{ backgroundColor: '#be123c', borderColor: '#be123c' }}
                                >
                                  Resolve Hold
                                </button>
                              </div>
                            </div>
                            <div style={{ marginTop: '8px', fontSize: '0.86rem', color: '#881337', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                              <div><strong>Baker Instruction:</strong> {order.holdState.holdInstruction}</div>
                              {order.holdState.ownerNote && <div><strong>Owner Note:</strong> {order.holdState.ownerNote}</div>}
                              <div><strong>Requested:</strong> {new Date(order.holdState.holdRequestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (v{order.holdState.instructionVersion || 1})</div>
                              <div>
                                <strong>Baker Status:</strong>{' '}
                                {order.holdState.bakerAcknowledged ? (
                                  <span style={{ color: '#15803d', fontWeight: 'bold' }}>
                                    ✓ Acknowledged ({order.holdState.bakerResponse?.currentStage || 'Reported'}, Consumed: {order.holdState.bakerResponse?.ingredientsConsumed ? 'Yes' : 'No'})
                                  </span>
                                ) : (
                                  <span style={{ color: '#b45309', fontWeight: 'bold' }}>⏳ Awaiting Baker Acknowledgement</span>
                                )}
                              </div>
                            </div>
                            {order.holdState.bakerResponse?.note && (
                              <div style={{ marginTop: '6px', fontSize: '0.82rem', color: '#4b5563', backgroundColor: 'rgba(255,255,255,0.7)', padding: '4px 8px', borderRadius: '4px' }}>
                                <strong>Baker Note:</strong> {order.holdState.bakerResponse.note}
                              </div>
                            )}
                          </div>
                        )}

                        {order.paymentProof?.hasProof ? (
                          <div
                            style={{
                              background: '#eff6ff',
                              padding: '10px 14px',
                              borderRadius: 'var(--radius)',
                              fontSize: '0.85rem',
                              color: '#1e40af',
                              marginBottom: '1rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '8px',
                              flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <ImageIcon size={16} />
                              <span>
                                Payment screenshot uploaded · {new Date(order.paymentProof.uploadedAt).toLocaleString()}
                                {order.paymentProof.isDeleted ? ' · (Screenshot purged after 30 days)' : ' · (30-day retention)'}
                                {' · Total: '}<strong>{formatCurrency(order.total ?? order.pricing?.total ?? 0)}</strong>
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleViewPaymentProof(order)}
                              className="btn btn-sm btn-primary"
                              style={{ padding: '3px 10px', fontSize: '0.78rem' }}
                            >
                              Inspect Screenshot
                            </button>
                          </div>
                        ) : order.paymentMethod === 'COD' ? (
                          <div
                            style={{
                              background: '#f0fdf4',
                              padding: '8px 14px',
                              borderRadius: 'var(--radius)',
                              fontSize: '0.85rem',
                              color: '#166534',
                              marginBottom: '1rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            <Banknote size={16} />
                            <span>
                              Pay on Delivery order: <strong>{formatCurrency(order.total ?? order.pricing?.total ?? 0)}</strong> to be collected upon fulfillment.
                            </span>
                          </div>
                        ) : null}

                        {/* Order Items & Recipe Specification Overview */}
                        <div
                          style={{
                            margin: '0.75rem 0',
                            padding: '10px 14px',
                            borderRadius: '10px',
                            backgroundColor: 'var(--bg-main)',
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Recipe & Production Specifications
                            </span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Fulfillment: <strong>{order.orderType === 'DELIVERY' ? 'Doorstep Delivery' : 'Bakery Pickup'}</strong>
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '8px' }}>
                            {(order.items || []).map((it, i) => {
                              const matchedProduct = products.find((p) => String(p._id) === String(it.productId || it.product?._id || it.product));
                              const prep = matchedProduct?.preparationTime || 0;
                              const prod = matchedProduct?.productionTime || 0;
                              const totalDuration = prep + prod;

                              return (
                                <div
                                  key={i}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    backgroundColor: 'var(--card-bg, #fff)',
                                    border: '1px solid var(--border-color)',
                                  }}
                                >
                                  <div>
                                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                                      {it.productName || it.product?.name}
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                      Qty: <strong>{it.quantity}</strong> {it.variantName ? `· ${it.variantName}` : ''}
                                      {it.price !== undefined && it.price !== null ? ` · ${formatCurrency(it.price)} each` : ''}
                                    </div>
                                  </div>

                                  <div style={{ textAlign: 'right' }}>
                                    <span
                                      className="badge badge-success"
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem' }}
                                    >
                                      <Clock size={11} /> {totalDuration > 0 ? `${totalDuration} mins` : 'BOM Configured'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {order.specialInstructions && (
                            <div style={{ fontSize: '0.82rem', color: '#b45309', marginTop: '6px' }}>
                              <strong>Special Instructions:</strong> {order.specialInstructions}
                            </div>
                          )}
                        </div>

                        {/* Stock Fulfillment & Production Requirement Position */}
                        {(() => {
                          const sp = order.stockPosition || {
                            status: order.fulfillmentStatus === 'FULFILLED_FROM_STOCK'
                              ? 'FULFILLED_FROM_STOCK'
                              : (order.fulfillmentSummary?.type === 'FULFILLED_FROM_STOCK'
                                ? 'READY_FROM_STOCK'
                                : (order.fulfillmentSummary?.type === 'PARTIAL_STOCK'
                                  ? 'PARTIAL_STOCK'
                                  : 'PRODUCTION_REQUIRED')),
                            badge: order.fulfillmentStatus === 'FULFILLED_FROM_STOCK'
                              ? 'Fulfilled from Stock'
                              : (order.fulfillmentSummary?.type === 'FULFILLED_FROM_STOCK'
                                ? 'Ready from Stock'
                                : (order.fulfillmentSummary?.type === 'PARTIAL_STOCK'
                                  ? 'Partial Stock Available'
                                  : 'Production Required')),
                            message: order.fulfillmentStatus === 'FULFILLED_FROM_STOCK'
                              ? 'All required products are fulfilled from finished stock.'
                              : (order.fulfillmentSummary?.type === 'FULFILLED_FROM_STOCK'
                                ? 'All required products are available in finished stock.'
                                : (order.fulfillmentSummary?.type === 'PARTIAL_STOCK'
                                  ? `${order.fulfillmentSummary.totalFinishedReserved || 0} of ${order.fulfillmentSummary.totalRequested || 0} items available in finished stock. ${order.fulfillmentSummary.remainingToProduce || 0} require production.`
                                  : 'Finished goods stock unavailable. Kitchen production required.')),
                            canFulfillFromStock: order.fulfillmentStatus !== 'FULFILLED_FROM_STOCK' &&
                              order.fulfillmentSummary?.type === 'FULFILLED_FROM_STOCK' &&
                              !['CANCELLED', 'DELIVERED', 'COMPLETED', 'READY'].includes(order.status),
                            remainingToProduce: order.fulfillmentSummary?.remainingToProduce || 0,
                          };

                          const isFulfilledFromStock = order.fulfillmentStatus === 'FULFILLED_FROM_STOCK' || sp.status === 'FULFILLED_FROM_STOCK';
                          const isEligibleForFulfill = sp.canFulfillFromStock && !['CANCELLED', 'DELIVERED', 'COMPLETED', 'READY'].includes(order.status) && !order.holdState?.isOnHold;

                          if (isFulfilledFromStock) {
                            return (
                              <div
                                style={{
                                  backgroundColor: '#f0fdf4',
                                  border: '1px solid #bbf7d0',
                                  borderRadius: '8px',
                                  padding: '10px 14px',
                                  margin: '0.75rem 0',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  flexWrap: 'wrap',
                                  gap: '8px',
                                }}
                                data-testid={`stock-indicator-${order.orderNumber}`}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#166534', fontSize: '0.86rem', fontWeight: 600 }}>
                                  <CheckCircle2 size={18} style={{ color: '#16a34a', flexShrink: 0 }} />
                                  <span>All required products are fulfilled from finished stock.</span>
                                </div>
                                <span className="badge badge-success" style={{ fontWeight: 700 }}>
                                  Fulfilled from Stock
                                </span>
                              </div>
                            );
                          }

                          if (sp.status === 'READY_FROM_STOCK') {
                            return (
                              <div
                                style={{
                                  backgroundColor: '#f0fdf4',
                                  border: '1.5px solid #86efac',
                                  borderRadius: '8px',
                                  padding: '12px 14px',
                                  margin: '0.75rem 0',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  flexWrap: 'wrap',
                                  gap: '12px',
                                }}
                                data-testid={`stock-indicator-${order.orderNumber}`}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <CheckCircle2 size={20} style={{ color: '#16a34a', flexShrink: 0 }} />
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                                      <span
                                        className="badge badge-success"
                                        style={{ fontWeight: 700, fontSize: '0.82rem', padding: '3px 8px' }}
                                        data-testid={`badge-ready-from-stock-${order.orderNumber}`}
                                      >
                                        Ready from Stock
                                      </span>
                                    </div>
                                    <div style={{ fontSize: '0.84rem', color: '#166534', fontWeight: 500 }}>
                                      {sp.message || 'All required products are available in finished stock.'}
                                    </div>
                                  </div>
                                </div>

                                {isEligibleForFulfill && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <button
                                      type="button"
                                      className="btn btn-success btn-sm"
                                      onClick={() => handleOpenFulfillStockModal(order)}
                                      data-testid={`fulfill-from-stock-btn-${order.orderNumber}`}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, padding: '6px 14px' }}
                                    >
                                      <PackageCheck size={16} /> Fulfill from Stock
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          }

                          if (sp.status === 'PARTIAL_STOCK') {
                            return (
                              <div
                                style={{
                                  backgroundColor: '#eff6ff',
                                  border: '1.5px solid #93c5fd',
                                  borderRadius: '8px',
                                  padding: '12px 14px',
                                  margin: '0.75rem 0',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  flexWrap: 'wrap',
                                  gap: '12px',
                                }}
                                data-testid={`stock-indicator-${order.orderNumber}`}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <Package size={20} style={{ color: '#2563eb', flexShrink: 0 }} />
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                                      <span
                                        className="badge badge-info"
                                        style={{ fontWeight: 700, fontSize: '0.82rem', padding: '3px 8px' }}
                                        data-testid={`badge-partial-stock-${order.orderNumber}`}
                                      >
                                        Partial Stock Available
                                      </span>
                                    </div>
                                    <div style={{ fontSize: '0.84rem', color: '#1e40af', fontWeight: 500 }}>
                                      {sp.message}
                                    </div>
                                  </div>
                                </div>

                                {!['CANCELLED', 'DELIVERED', 'COMPLETED'].includes(order.status) && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <button
                                      type="button"
                                      className="btn btn-outline btn-sm"
                                      onClick={() => handleOpenScheduleBatchFromOrder(order)}
                                      disabled={order.holdState?.isOnHold}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
                                      title="Schedule production batch for remaining quantities"
                                      data-testid={`schedule-batch-order-${order.orderNumber}`}
                                    >
                                      <Calendar size={14} /> Schedule Production ({sp.remainingToProduce || 1} units)
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          }

                          // PRODUCTION_REQUIRED
                          return (
                            <div
                              style={{
                                backgroundColor: '#fffbeb',
                                border: '1.5px solid #fde68a',
                                borderRadius: '8px',
                                padding: '12px 14px',
                                margin: '0.75rem 0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                                gap: '12px',
                              }}
                              data-testid={`stock-indicator-${order.orderNumber}`}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <ChefHat size={20} style={{ color: '#b45309', flexShrink: 0 }} />
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                                    <span
                                      className="badge badge-warning"
                                      style={{ fontWeight: 700, fontSize: '0.82rem', padding: '3px 8px' }}
                                      data-testid={`badge-production-required-${order.orderNumber}`}
                                    >
                                      Production Required
                                    </span>
                                  </div>
                                  <div style={{ fontSize: '0.84rem', color: '#92400e', fontWeight: 500 }}>
                                    {sp.message || 'Finished goods stock unavailable. Kitchen production required.'}
                                  </div>
                                </div>
                              </div>

                              {!['CANCELLED', 'DELIVERED', 'COMPLETED'].includes(order.status) && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    onClick={() => handleOpenScheduleBatchFromOrder(order)}
                                    disabled={order.holdState?.isOnHold}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
                                    title="Schedule a kitchen production batch for this order"
                                    data-testid={`schedule-batch-order-${order.orderNumber}`}
                                  >
                                    <Calendar size={14} /> Schedule Production Batch
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Production Assignment Action */}
                        {order.status === 'CONFIRMED' && (
                          <div style={{ margin: '0.75rem 0 1rem', padding: '12px 14px', borderRadius: '10px', backgroundColor: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>
                            {(() => {
                              const linked = batches.filter((batch) =>
                                (batch.relatedOrders || []).some((linkedOrder) => String(linkedOrder?._id || linkedOrder) === String(order._id)) &&
                                !['REJECTED', 'CANCELLED'].includes(batch.status)
                              );

                              if (linked.length) {
                                return (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>Production Assigned:</span>
                                    {linked.map((batch) => (
                                      <span key={batch._id} className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                        <Package size={13} /> {batch.batchNumber} ({batch.status})
                                      </span>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() => handleOpenScheduleBatchFromOrder(order)}
                                      disabled={order.holdState?.isOnHold}
                                      className="btn btn-outline btn-sm"
                                      style={{ marginLeft: 'auto', fontSize: '0.78rem', padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                      title={order.holdState?.isOnHold ? 'Order is on emergency hold' : 'Schedule another batch for this order'}
                                      data-testid={`schedule-batch-order-${order.orderNumber}`}
                                    >
                                      <Calendar size={13} /> Schedule Additional Batch
                                    </button>
                                  </div>
                                );
                              }

                              const activeWorkers = workers.filter((w) => w.isActive);
                              const currentSelected = Array.isArray(orderAssignmentWorkers[order._id])
                                ? orderAssignmentWorkers[order._id]
                                : orderAssignmentWorkers[order._id]
                                ? [orderAssignmentWorkers[order._id]]
                                : [];

                              const isFullyInStock = order.fulfillmentSummary?.type === 'FULFILLED_FROM_STOCK';

                              return (
                                <div>
                                  {isFullyInStock ? (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', padding: '4px 0' }}>
                                      <div>
                                        <div style={{ fontWeight: 700, color: '#166534', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <CheckCircle2 size={16} style={{ color: '#16a34a' }} /> 100% In Stock — Ready to Fulfill
                                        </div>
                                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                          All requested items are already reserved from finished goods stock. No kitchen production batch is needed.
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <button
                                          type="button"
                                          className="btn btn-success btn-sm"
                                          onClick={() => handleOpenFulfillStockModal(order)}
                                          data-testid={`fulfill-from-stock-btn-action-${order.orderNumber}`}
                                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
                                        >
                                          <PackageCheck size={15} /> Fulfill from Stock
                                        </button>
                                        <button
                                          type="button"
                                          className="btn btn-outline btn-sm"
                                          onClick={() => handleOpenScheduleBatchFromOrder(order)}
                                          disabled={order.holdState?.isOnHold}
                                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
                                          title="Schedule an additional production batch anyway"
                                          data-testid={`schedule-batch-order-${order.orderNumber}`}
                                        >
                                          <Calendar size={14} /> Schedule Batch Anyway
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                                        <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>
                                          Assign to Production Staff:
                                        </label>
                                        <small style={{ color: 'var(--text-muted)' }}>Select one or more active bakers</small>
                                      </div>

                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                        {activeWorkers.map((w) => {
                                          const isChecked = currentSelected.includes(w._id);
                                          return (
                                            <label
                                              key={w._id}
                                              style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                padding: '5px 12px',
                                                borderRadius: '20px',
                                                fontSize: '0.82rem',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                backgroundColor: isChecked ? 'var(--primary-light)' : 'var(--card-bg, #fff)',
                                                border: isChecked ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                                                color: isChecked ? 'var(--primary-dark)' : 'var(--text-main)',
                                                transition: 'all 0.15s ease',
                                              }}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={(e) => {
                                                  const updated = e.target.checked
                                                    ? [...currentSelected, w._id]
                                                    : currentSelected.filter((id) => id !== w._id);
                                                  setOrderAssignmentWorkers((current) => ({ ...current, [order._id]: updated }));
                                                }}
                                                style={{ cursor: 'pointer' }}
                                              />
                                              <span>{w.name}</span>
                                              {w.jobDesignation && <small style={{ opacity: 0.7 }}>({w.jobDesignation})</small>}
                                            </label>
                                          );
                                        })}

                                        {activeWorkers.length === 0 && (
                                          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                                            No active production staff members configured yet.
                                          </span>
                                        )}
                                      </div>

                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                                        <button
                                          type="button"
                                          className="btn btn-primary btn-sm"
                                          onClick={() => handleOpenScheduleBatchFromOrder(order)}
                                          disabled={order.holdState?.isOnHold}
                                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
                                          title={order.holdState?.isOnHold ? 'Order is on hold - cannot schedule' : 'Open batch scheduling interface for this order'}
                                          data-testid={`schedule-batch-order-${order.orderNumber}`}
                                        >
                                          <Calendar size={15} /> Schedule Batch
                                        </button>
                                        <button
                                          type="button"
                                          className="btn btn-outline btn-sm"
                                          onClick={() => handleAssignOrder(order)}
                                          disabled={currentSelected.length === 0 || activeWorkers.length === 0 || order.holdState?.isOnHold}
                                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                        >
                                          <Users size={15} /> Quick Dispatch ({currentSelected.length})
                                        </button>
                                      </div>
                                    </>
                                  )}

                                  {order.holdState?.isOnHold && (
                                    <div
                                      style={{
                                        backgroundColor: '#fff1f2',
                                        border: '1px solid #fecdd3',
                                        borderRadius: '8px',
                                        padding: '8px 12px',
                                        marginTop: '10px',
                                        fontSize: '0.84rem',
                                        color: '#9f1239',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                      }}
                                    >
                                      <AlertOctagon size={15} />
                                      <span>
                                        This order is on <strong>Emergency Production Hold</strong> ({order.holdState.holdReason}). Resolve the hold before scheduling production.
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        <div
                          style={{
                            fontSize: '0.88rem',
                            color: 'var(--text-muted)',
                            borderTop: '1px solid var(--border-color)',
                            paddingTop: '0.75rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div>
                            {(order.items || []).map((it, i) => (
                              <span key={i} style={{ marginRight: '12px' }}>
                                • {it.productName || it.product?.name} × {it.quantity} {it.price !== undefined && it.price !== null ? `(${formatCurrency(it.price)})` : ''}
                              </span>
                            ))}
                          </div>
                          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-main)' }}>
                            {formatCurrency(order.total ?? order.pricing?.total ?? order.totalAmount ?? 0)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: INVENTORY & STOCK MANAGEMENT */}
          {/* ========================================================================= */}
          {activeTab === 'inventory' && (
            <div>
              {/* Low Stock Banner */}
              {lowStock.length > 0 && (
                <div
                  className="alert alert-danger"
                  style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <AlertTriangle size={20} />
                  <div>
                    <strong>Low Stock Alert:</strong> {lowStock.length} ingredient(s) are below threshold safety levels:
                    <span style={{ marginLeft: '6px', fontWeight: 600 }}>
                      {lowStock.map((it) => it.ingredient?.name || it.name).join(', ')}
                    </span>
                  </div>
                </div>
              )}

              {/* Inventory Sub-navigation Bar */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.5rem',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {[
                    { id: 'stock', label: `Stock Levels (${inventory.length})` },
                    { id: 'receive', label: 'Receive Stock (Purchase)' },
                    { id: 'ingredients', label: `Ingredients (${ingredients.length})` },
                    { id: 'vendors', label: `Suppliers (${vendors.length})` },
                    { id: 'movements', label: 'Stock Movements & Audit' },
                  ].map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => setInvSubTab(sub.id)}
                      className={`btn btn-sm ${invSubTab === sub.id ? 'btn-primary' : 'btn-outline'}`}
                      style={{ borderRadius: '6px' }}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setShowAdjustModal(true)}
                  className="btn btn-outline btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <ArrowUpDown size={14} /> Quick Stock Adjustment
                </button>
              </div>

              {/* Subtab 1: Current Stock Levels */}
              {invSubTab === 'stock' && (
                <div className="card" style={{ padding: '1.75rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '1.25rem',
                    }}
                  >
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                      Real-Time Ingredient Stock Levels
                    </h3>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Total Ingredients: {inventory.length} • Expiring Lots: {expiringStock.length}
                    </span>
                  </div>

                  {inventory.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                      <Layers size={36} style={{ margin: '0 auto 0.75rem auto', opacity: 0.5 }} />
                      <p>No inventory lots recorded yet.</p>
                      <button
                        onClick={() => setInvSubTab('receive')}
                        className="btn btn-primary btn-sm"
                        style={{ marginTop: '0.5rem' }}
                      >
                        Receive Initial Stock
                      </button>
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: '1rem',
                      }}
                    >
                      {inventory.map((inv, idx) => {
                        const ingName = inv.ingredient?.name || inv.name || 'Ingredient';
                        const currentQty = inv.currentStock ?? inv.quantity ?? 0;
                        const reorderLevel = Number(inv.reorderLevel ?? inv.ingredient?.reorderLevel ?? 0);
                        const minStock = Number(inv.minimumStock ?? inv.ingredient?.minimumStock ?? 0);
                        const rawThreshold = inv.lowStockThreshold ?? inv.ingredient?.lowStockThreshold;
                        const effectiveThreshold =
                          rawThreshold !== undefined && rawThreshold !== null
                            ? Number(rawThreshold)
                            : (reorderLevel > 0 ? reorderLevel : minStock);
                        const isLowStockAlerted = (lowStock || []).some(
                          (it) => String(it._id || it.id) === String(inv._id || inv.id || inv.ingredient?._id)
                        );
                        const isUnder = isLowStockAlerted || (effectiveThreshold > 0 && currentQty < effectiveThreshold);

                        return (
                          <div
                            key={idx}
                            style={{
                              padding: '14px 16px',
                              background: 'var(--bg-main)',
                              borderRadius: 'var(--radius)',
                              border: isUnder ? '1px solid var(--danger)' : '1px solid var(--border-color)',
                              boxShadow: 'var(--shadow-sm)',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <strong style={{ fontSize: '1.05rem' }}>{ingName}</strong>
                              <span className={`badge ${isUnder ? 'badge-danger' : 'badge-success'}`}>
                                {isUnder ? 'Low Stock' : 'In Stock'}
                              </span>
                            </div>

                            <div
                              style={{
                                fontSize: '1.45rem',
                                fontWeight: 800,
                                color: isUnder ? 'var(--danger)' : 'var(--primary)',
                                margin: '8px 0 4px 0',
                              }}
                            >
                              {currentQty} <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{inv.unit}</span>
                            </div>

                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                              <span>Safety Level: {effectiveThreshold} {inv.unit}</span>
                              <span>Lots Active: {inv.lots?.length ?? 1}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Subtab 2: Receive Stock / Record Purchase */}
              {invSubTab === 'receive' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                  <div className="card" style={{ padding: '1.75rem' }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                      Receive Stock & Record Purchase Slip
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
                      Logs incoming delivery from vendor, creates trackable inventory lots, and increments pantry stock.
                    </p>

                    <form onSubmit={handleRecordPurchase} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                            Supplier / Vendor <span style={{ color: 'var(--danger)' }}>*</span>
                          </label>
                          <select
                            required
                            className="input-field"
                            value={purchaseForm.vendor}
                            onChange={(e) => setPurchaseForm({ ...purchaseForm, vendor: e.target.value })}
                          >
                            <option value="">Select Vendor...</option>
                            {vendors.map((v) => (
                              <option key={v._id} value={v._id}>
                                {v.name} {v.contactPerson ? `(${v.contactPerson})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                            Purchase Date <span style={{ color: 'var(--danger)' }}>*</span>
                          </label>
                          <input
                            type="date"
                            required
                            className="input-field"
                            value={purchaseForm.purchaseDate}
                            onChange={(e) => setPurchaseForm({ ...purchaseForm, purchaseDate: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                            Invoice / Challan Number
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. INV-2026-908"
                            className="input-field"
                            value={purchaseForm.invoiceNumber}
                            onChange={(e) => setPurchaseForm({ ...purchaseForm, invoiceNumber: e.target.value })}
                          />
                        </div>
                      </div>

                      {/* Items Receiving Section */}
                      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <h4 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Received Items & Lots</h4>
                          <button
                            type="button"
                            onClick={handleAddPurchaseItem}
                            className="btn btn-outline btn-sm"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <Plus size={14} /> Add Another Item
                          </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {purchaseForm.items.map((item, idx) => (
                            <div
                              key={idx}
                              style={{
                                padding: '12px 14px',
                                background: 'var(--bg-main)',
                                borderRadius: 'var(--radius)',
                                border: '1px solid var(--border-color)',
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr)) auto',
                                gap: '0.75rem',
                                alignItems: 'center',
                              }}
                            >
                              <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, marginBottom: '2px' }}>
                                  Ingredient *
                                </label>
                                <select
                                  required
                                  className="input-field"
                                  style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                                  value={item.ingredient}
                                  onChange={(e) => handleUpdatePurchaseItem(idx, 'ingredient', e.target.value)}
                                >
                                  <option value="">Select...</option>
                                  {ingredients.map((ing) => (
                                    <option key={ing._id} value={ing._id}>
                                      {ing.name} ({ing.unit})
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, marginBottom: '2px' }}>
                                  Lot / Batch No. *
                                </label>
                                <input
                                  type="text"
                                  required
                                  placeholder="LOT-123"
                                  className="input-field"
                                  style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                                  value={item.lotNumber}
                                  onChange={(e) => handleUpdatePurchaseItem(idx, 'lotNumber', e.target.value)}
                                />
                              </div>

                              <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, marginBottom: '2px' }}>
                                  Quantity *
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  required
                                  placeholder="0.0"
                                  className="input-field"
                                  style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                                  value={item.quantity}
                                  onChange={(e) => handleUpdatePurchaseItem(idx, 'quantity', e.target.value)}
                                />
                              </div>

                              <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, marginBottom: '2px' }}>
                                  Unit
                                </label>
                                <select
                                  className="input-field"
                                  style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                                  value={item.unit}
                                  onChange={(e) => handleUpdatePurchaseItem(idx, 'unit', e.target.value)}
                                >
                                  <option value="kg">kg</option>
                                  <option value="g">g</option>
                                  <option value="L">L</option>
                                  <option value="ml">ml</option>
                                  <option value="piece">piece</option>
                                </select>
                              </div>

                              <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, marginBottom: '2px' }}>
                                  Unit Price (₹)
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  required
                                  placeholder="₹"
                                  className="input-field"
                                  style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                                  value={item.unitPrice}
                                  onChange={(e) => handleUpdatePurchaseItem(idx, 'unitPrice', e.target.value)}
                                />
                              </div>

                              <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, marginBottom: '2px' }}>
                                  Expiry Date
                                </label>
                                <input
                                  type="date"
                                  className="input-field"
                                  style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                                  value={item.expiryDate}
                                  onChange={(e) => handleUpdatePurchaseItem(idx, 'expiryDate', e.target.value)}
                                />
                              </div>

                              <div style={{ paddingTop: '16px' }}>
                                <button
                                  type="button"
                                  disabled={purchaseForm.items.length <= 1}
                                  onClick={() => handleRemovePurchaseItem(idx)}
                                  className="btn btn-sm"
                                  style={{ color: 'var(--danger)', background: 'transparent' }}
                                  title="Remove item"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                            Taxes / GST (₹)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input-field"
                            value={purchaseForm.tax}
                            onChange={(e) => setPurchaseForm({ ...purchaseForm, tax: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                            Receiving Notes
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Received in good dry condition, batch certificate verified"
                            className="input-field"
                            value={purchaseForm.notes}
                            onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })}
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '0.5rem' }}
                      >
                        <Check size={18} /> Confirm Stock Receipt & Update Inventory
                      </button>
                    </form>
                  </div>

                  {/* Purchase History */}
                  <div className="card" style={{ padding: '1.75rem' }}>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>
                      Recent Purchase Records ({purchases.length})
                    </h3>
                    {purchases.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)' }}>No previous purchases recorded.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {purchases.map((p) => (
                          <div
                            key={p._id}
                            style={{
                              padding: '12px 14px',
                              border: '1px solid var(--border-color)',
                              borderRadius: 'var(--radius)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '0.75rem',
                            }}
                          >
                            <div>
                              <strong>{p.vendor?.name || 'Vendor'}</strong>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                Date: {new Date(p.purchaseDate).toLocaleDateString()} • Invoice:{' '}
                                {p.invoiceNumber || 'N/A'} • {p.items?.length || 0} item(s)
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                                {formatCurrency(p.totalAmount ?? p.subtotal ?? 0)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Subtab 3: Ingredients Catalog */}
              {invSubTab === 'ingredients' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
                  {/* Ingredients List */}
                  <div className="card" style={{ padding: '1.75rem' }}>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>
                      Bakery Ingredients Master ({ingredients.length})
                    </h3>

                    {ingredients.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)' }}>No ingredients registered in catalog yet.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '550px', overflowY: 'auto' }}>
                        {ingredients.map((ing) => (
                          <div
                            key={ing._id}
                            style={{
                              padding: '10px 14px',
                              border: editingIngredientId === ing._id ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                              background: editingIngredientId === ing._id ? 'rgba(var(--primary-rgb, 59, 130, 246), 0.05)' : 'transparent',
                              borderRadius: 'var(--radius)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '0.75rem',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600 }}>{ing.name}</div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                Unit: <strong>{ing.unit}</strong> • Safety Min: {ing.minimumStock || 0} {ing.unit} • Reorder Level: {ing.reorderLevel || 0} {ing.unit}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="badge badge-info">{ing.unit}</span>
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => handleEditIngredient(ing)}
                                style={{ padding: '3px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                              >
                                Edit
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Add / Edit Ingredient Form */}
                  <div className="card" style={{ padding: '1.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                        {editingIngredientId ? 'Edit Ingredient' : 'Register New Ingredient'}
                      </h3>
                      {editingIngredientId && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={handleCancelEditIngredient}
                          style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    <form onSubmit={handleSaveIngredient} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                          Ingredient Name <span style={{ color: 'var(--danger)' }}>*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Unbleached Bread Flour"
                          className="input-field"
                          value={newIngredient.name}
                          onChange={(e) => setNewIngredient({ ...newIngredient, name: e.target.value })}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                          Measurement Unit <span style={{ color: 'var(--danger)' }}>*</span>
                        </label>
                        <select
                          className="input-field"
                          value={newIngredient.unit}
                          onChange={(e) => setNewIngredient({ ...newIngredient, unit: e.target.value })}
                        >
                          <option value="kg">kg (Kilograms)</option>
                          <option value="g">g (Grams)</option>
                          <option value="L">L (Liters)</option>
                          <option value="ml">ml (Milliliters)</option>
                          <option value="piece">piece (Units / Eggs)</option>
                        </select>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                            Minimum Safety Stock
                          </label>
                          <input
                            type="number"
                            min="0"
                            placeholder="e.g. 10"
                            className="input-field"
                            value={newIngredient.minimumStock}
                            onChange={(e) => setNewIngredient({ ...newIngredient, minimumStock: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                            Reorder Trigger Level
                          </label>
                          <input
                            type="number"
                            min="0"
                            placeholder="e.g. 20"
                            className="input-field"
                            value={newIngredient.reorderLevel}
                            onChange={(e) => setNewIngredient({ ...newIngredient, reorderLevel: e.target.value })}
                          />
                        </div>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                          Description / Storage Notes
                        </label>
                        <textarea
                          rows={2}
                          placeholder="e.g. Store in dry airtight container"
                          className="input-field"
                          value={newIngredient.description}
                          onChange={(e) => setNewIngredient({ ...newIngredient, description: e.target.value })}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm"
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flex: 1 }}
                        >
                          {editingIngredientId ? <Save size={16} /> : <Plus size={16} />}
                          {editingIngredientId ? 'Update Ingredient' : 'Save Ingredient'}
                        </button>
                        {editingIngredientId && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={handleCancelEditIngredient}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Subtab 4: Suppliers / Vendors */}
              {invSubTab === 'vendors' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
                  {/* Vendors List */}
                  <div className="card" style={{ padding: '1.75rem' }}>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>
                      Approved Bakery Suppliers ({vendors.length})
                    </h3>

                    {vendors.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)' }}>No vendors registered yet.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '550px', overflowY: 'auto' }}>
                        {vendors.map((v) => (
                          <div
                            key={v._id}
                            style={{
                              padding: '12px 14px',
                              border: '1px solid var(--border-color)',
                              borderRadius: 'var(--radius)',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong style={{ fontSize: '1.05rem' }}>{v.name}</strong>
                              <span className="badge badge-success">Active Supplier</span>
                            </div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                              {v.contactPerson && <span>Contact: {v.contactPerson} • </span>}
                              {v.phone && <span>Phone: {v.phone} • </span>}
                              {v.email && <span>Email: {v.email}</span>}
                            </div>
                            {v.gstNumber && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '2px' }}>
                                GST: {v.gstNumber}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Add Vendor Form */}
                  <div className="card" style={{ padding: '1.75rem' }}>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>
                      Register New Supplier
                    </h3>
                    <form onSubmit={handleCreateVendor} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                          Company / Vendor Name <span style={{ color: 'var(--danger)' }}>*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Golden Grain Mills"
                          className="input-field"
                          value={newVendor.name}
                          onChange={(e) => setNewVendor({ ...newVendor, name: e.target.value })}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                            Contact Person
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Rajesh Kumar"
                            className="input-field"
                            value={newVendor.contactPerson}
                            onChange={(e) => setNewVendor({ ...newVendor, contactPerson: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                            Phone Number
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. +91 9876543210"
                            className="input-field"
                            value={newVendor.phone}
                            onChange={(e) => setNewVendor({ ...newVendor, phone: e.target.value })}
                          />
                        </div>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                          Email Address
                        </label>
                        <input
                          type="email"
                          placeholder="orders@goldengrain.com"
                          className="input-field"
                          value={newVendor.email}
                          onChange={(e) => setNewVendor({ ...newVendor, email: e.target.value })}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                          GST Identification Number
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. 27ABCDE1234F1Z5"
                          className="input-field"
                          value={newVendor.gstNumber}
                          onChange={(e) => setNewVendor({ ...newVendor, gstNumber: e.target.value })}
                        />
                      </div>

                      <button
                        type="submit"
                        className="btn btn-primary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                      >
                        <Truck size={16} /> Register Supplier
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {/* Subtab 5: Movements & Audit Log */}
              {invSubTab === 'movements' && (
                <div className="card" style={{ padding: '1.75rem' }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>
                    Stock Movement & Audit Trail ({transactions.length})
                  </h3>

                  {transactions.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>No stock movements recorded yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {transactions.map((tx) => (
                        <div
                          key={tx._id}
                          style={{
                            padding: '12px 14px',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '0.75rem',
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span
                                className={`badge ${
                                  tx.type === 'PURCHASE'
                                    ? 'badge-success'
                                    : tx.type === 'CONSUMPTION'
                                    ? 'badge-info'
                                    : tx.type === 'WASTAGE'
                                    ? 'badge-danger'
                                    : 'badge-warning'
                                }`}
                              >
                                {tx.type}
                              </span>
                              <strong>{tx.ingredient?.name || 'Ingredient'}</strong>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                              Time: {new Date(tx.createdAt).toLocaleString()} • {tx.reason || tx.notes || 'System transaction'}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: tx.quantity > 0 ? 'var(--success)' : 'var(--danger)' }}>
                              {tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity} {tx.unit}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Balance: {tx.balanceAfter ?? 'N/A'} {tx.unit}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: PRODUCTION BATCHES */}
          {/* ========================================================================= */}
          {activeTab === 'production' && (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.25rem',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0 }}>
                    Production Batches ({batches.length})
                  </h2>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Schedule baking runs, assign staff, and track kitchen throughput
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      if (products.length > 0) openRecipeModal(products[0]);
                      else alert('Please add at least one product first to configure its recipe.');
                    }}
                    className="btn btn-outline btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    title="Manage recipes and production duration"
                  >
                    <Clock size={16} /> Manage Recipes
                  </button>
                  <button
                    onClick={() => {
                      setSelectedOrderForBatch(null);
                      setShowNewBatchModal(true);
                    }}
                    className="btn btn-primary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    data-testid="schedule-planned-production-btn"
                    title="Proactively schedule production without customer order to build finished stock"
                  >
                    <Plus size={16} /> Schedule Planned Production
                  </button>
                </div>
              </div>

              {batches.length === 0 ? (
                <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No production batches scheduled yet. Click "Schedule New Batch" to start kitchen baking.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {batches.map((b) => (
                    <div key={b._id} className="card" style={{ padding: '1.5rem' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          flexWrap: 'wrap',
                          gap: '1rem',
                          marginBottom: '0.75rem',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: '1.15rem' }}>{b.batchNumber}</strong>
                            <span
                              className={`badge ${
                                b.status === 'COMPLETED'
                                  ? 'badge-success'
                                  : b.status === 'IN_PRODUCTION'
                                  ? 'badge-warning'
                                  : 'badge-info'
                              }`}
                            >
                              {b.status}
                            </span>
                            {b.batchType === 'PLANNED_PRODUCTION' ? (
                              <span className="badge badge-success" style={{ fontSize: '0.74rem', fontWeight: 700 }}>
                                ✨ Planned ({b.plannedReason ? b.plannedReason.replace(/_/g, ' ') : 'Buffer Stock'})
                              </span>
                            ) : (
                              (b.relatedOrders && b.relatedOrders.length > 0) ? (
                                <span className="badge badge-info" style={{ fontSize: '0.72rem' }}>
                                  Order Linked
                                </span>
                              ) : (
                                <span className="badge badge-success" style={{ fontSize: '0.74rem' }}>
                                  Planned Stock
                                </span>
                              )
                            )}
                            <span
                              className={`badge ${
                                b.costing?.status === 'FINALIZED'
                                  ? 'badge-success'
                                  : (b.status === 'COMPLETED' || b.status === 'PACKAGED')
                                  ? 'badge-warning'
                                  : 'badge-info'
                              }`}
                              style={{ fontSize: '0.72rem' }}
                            >
                              {b.costing?.status === 'FINALIZED'
                                ? 'Cost: FINALIZED'
                                : (b.status === 'COMPLETED' || b.status === 'PACKAGED')
                                ? 'Cost: PENDING REVIEW'
                                : `Cost: PENDING PRODUCTION (${b.status || 'PLANNED'})`}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                            Product: <strong>{b.productSnapshot?.productName || b.product?.name || 'Recipe Product'}</strong> • Planned Yield:{' '}
                            <strong>{b.plannedQuantity}</strong> units
                            {b.usableQuantity !== undefined && b.usableQuantity !== null && (
                              <span> • Usable Yield: <strong style={{ color: 'var(--success)' }}>{b.usableQuantity}</strong> units</span>
                            )}
                          </div>

                          {/* Production Timing & Overdue Indicator */}
                          {b.actualStartTime && (() => {
                            const estMins = Number(b.estimatedDurationMinutes || b.recipeSnapshot?.estimatedDurationMinutes || b.recipe?.estimatedDurationMinutes || 30);
                            const startMs = new Date(b.actualStartTime).getTime();
                            const endMs = b.actualCompletionTime ? new Date(b.actualCompletionTime).getTime() : Date.now();
                            const elapsedMins = b.equipmentRuntimeMinutes || Math.max(1, Math.round((endMs - startMs) / 60000));
                            const isOverdue = elapsedMins > estMins;
                            const overdueMins = isOverdue ? elapsedMins - estMins : 0;
                            return (
                              <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                                <span style={{ color: 'var(--text-muted)' }}>
                                  Est: <strong>{estMins}m</strong> · Actual: <strong>{elapsedMins}m</strong>
                                </span>
                                {isOverdue ? (
                                  <span className="badge badge-danger" style={{ fontSize: '0.72rem', fontWeight: 800 }}>
                                    ⚠️ OVERDUE (+{overdueMins}m)
                                  </span>
                                ) : (
                                  <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>
                                    ● On Schedule
                                  </span>
                                )}
                                {b.delayReason && (
                                  <span style={{ fontSize: '0.76rem', color: '#b91c1c', fontStyle: 'italic' }}>
                                    Reason: "{b.delayReason}"
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => setCostModalBatch(b)}
                            className={`btn btn-sm ${b.costing?.status === 'FINALIZED' ? 'btn-outline' : (b.status === 'COMPLETED' || b.status === 'PACKAGED') ? 'btn-primary' : 'btn-outline'}`}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                            title={
                              b.costing?.status === 'FINALIZED'
                                ? 'View finalized batch cost breakdown'
                                : (b.status === 'COMPLETED' || b.status === 'PACKAGED')
                                ? 'Review and finalize batch cost'
                                : 'View current batch cost status and assigned staff'
                            }
                          >
                            <DollarSign size={14} />
                            <span>
                              {b.costing?.status === 'FINALIZED'
                                ? 'Cost Breakdown'
                                : (b.status === 'COMPLETED' || b.status === 'PACKAGED')
                                ? 'Review & Finalize Cost'
                                : 'View Cost Status'}
                            </span>
                          </button>

                          <button
                            onClick={() => {
                              setAssignModalBatch(b);
                              setSelectedWorkerForAssign('');
                            }}
                            className="btn btn-outline btn-sm"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <UserPlus size={14} /> Assign Staff
                          </button>

                          {['PLANNED', 'ACCEPTED', 'VERIFIED', 'IN_PRODUCTION', 'QUALITY_CHECK', 'PACKAGING'].includes(b.status) && !b.holdState?.isOnHold && (
                            <button
                              type="button"
                              onClick={() => handleOpenHoldModal('batch', b)}
                              className="btn btn-outline btn-sm"
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#be123c', borderColor: '#f43f5e' }}
                              title="Put this batch on emergency hold"
                            >
                              <AlertOctagon size={14} /> Put on Hold
                            </button>
                          )}

                          {['PLANNED', 'ACCEPTED', 'VERIFIED', 'IN_PRODUCTION', 'PACKAGING'].includes(b.status) && (
                            <button
                              type="button"
                              onClick={() => handleCancelBatch(b)}
                              className="btn btn-outline btn-sm"
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', borderColor: '#fca5a5' }}
                              title="Cancel this batch and release assigned workers"
                            >
                              <X size={14} /> Cancel Batch
                            </button>
                          )}
                        </div>
                      </div>

                      {/* EMERGENCY PRODUCTION HOLD BANNER ON BATCH CARD */}
                      {b.holdState?.isOnHold && (
                        <div
                          style={{
                            backgroundColor: '#fff1f2',
                            border: '2px solid #f43f5e',
                            borderRadius: '10px',
                            padding: '12px 16px',
                            margin: '0.75rem 0',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '1.25rem' }}>🚨</span>
                              <strong style={{ color: '#be123c', fontSize: '0.96rem' }}>EMERGENCY BATCH HOLD ACTIVE</strong>
                              <span className="badge badge-danger">{b.holdState.holdReason}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                type="button"
                                onClick={() => handleOpenUpdateInstructionModal(b)}
                                className="btn btn-outline btn-sm"
                                style={{ borderColor: '#f43f5e', color: '#be123c' }}
                              >
                                Update Instruction
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenResolveModal(b)}
                                className="btn btn-primary btn-sm"
                                style={{ backgroundColor: '#be123c', borderColor: '#be123c' }}
                              >
                                Resolve Hold
                              </button>
                            </div>
                          </div>
                          <div style={{ marginTop: '8px', fontSize: '0.86rem', color: '#881337', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                            <div><strong>Baker Instruction:</strong> {b.holdState.holdInstruction}</div>
                            {b.holdState.ownerNote && <div><strong>Owner Note:</strong> {b.holdState.ownerNote}</div>}
                            <div><strong>Requested:</strong> {new Date(b.holdState.holdRequestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (v{b.holdState.instructionVersion || 1})</div>
                            <div>
                              <strong>Baker Status:</strong>{' '}
                              {b.holdState.bakerAcknowledged ? (
                                <span style={{ color: '#15803d', fontWeight: 'bold' }}>
                                  ✓ Acknowledged ({b.holdState.bakerResponse?.currentStage || 'Reported'}, Consumed: {b.holdState.bakerResponse?.ingredientsConsumed ? 'Yes' : 'No'})
                                </span>
                              ) : (
                                <span style={{ color: '#b45309', fontWeight: 'bold' }}>⏳ Awaiting Baker Acknowledgement</span>
                              )}
                            </div>
                          </div>
                          {b.holdState.bakerResponse?.note && (
                            <div style={{ marginTop: '6px', fontSize: '0.82rem', color: '#4b5563', backgroundColor: 'rgba(255,255,255,0.7)', padding: '4px 8px', borderRadius: '4px' }}>
                              <strong>Baker Note:</strong> {b.holdState.bakerResponse.note}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Assigned Workers display */}
                      <div
                        style={{
                          borderTop: '1px solid var(--border-color)',
                          paddingTop: '0.75rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '0.5rem',
                          fontSize: '0.85rem',
                        }}
                      >
                        <div>
                          <span style={{ color: 'var(--text-muted)', marginRight: '6px' }}>Assigned Workers:</span>
                          {b.assignedWorkers && b.assignedWorkers.length > 0 ? (
                            b.assignedWorkers.map((w, idx) => (
                              <span
                                key={idx}
                                style={{
                                  background: 'var(--primary-light)',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  marginRight: '6px',
                                  fontSize: '0.8rem',
                                  fontWeight: 600,
                                }}
                              >
                                {w.worker?.name || 'Staff'} ({w.task || 'Baker'})
                              </span>
                            ))
                          ) : (
                            <span style={{ color: 'var(--text-light)', fontStyle: 'italic' }}>None assigned</span>
                          )}
                        </div>

                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          Scheduled: {b.plannedStartTime ? new Date(b.plannedStartTime).toLocaleString() : 'Today'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: INGREDIENT REQUISITIONS */}
          {/* ========================================================================= */}
          {activeTab === 'requisitions' && (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.25rem',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                    Ingredient Requisitions ({requisitions.length})
                  </h2>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Review kitchen requests, approve recipe portion scaling, and issue stock with automated FEFO/FIFO deduction
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {['ALL', 'PENDING', 'APPROVED', 'ISSUED', 'REJECTED'].map((filterKey) => {
                    const count = filterKey === 'ALL'
                      ? requisitions.length
                      : requisitions.filter((r) => r.status === filterKey).length;
                    const isSelected = reqFilter === filterKey;
                    return (
                      <button
                        key={filterKey}
                        type="button"
                        onClick={() => setReqFilter(filterKey)}
                        className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline'}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        <span>{filterKey === 'ALL' ? 'All' : filterKey.charAt(0) + filterKey.slice(1).toLowerCase()}</span>
                        <span className="badge" style={{ padding: '1px 6px', fontSize: '0.72rem', backgroundColor: isSelected ? 'rgba(255,255,255,0.25)' : 'var(--bg-main)' }}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Requisitions List */}
              {(() => {
                const filtered = reqFilter === 'ALL'
                  ? requisitions
                  : requisitions.filter((r) => r.status === reqFilter);

                if (!filtered.length) {
                  return (
                    <div className="card" style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <ClipboardList size={40} style={{ margin: '0 auto 0.75rem auto', opacity: 0.4 }} />
                      <p style={{ margin: 0, fontSize: '0.95rem' }}>No ingredient requisitions match "{reqFilter}".</p>
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {filtered.map((req) => {
                      const isPending = req.status === 'PENDING';
                      const isApproved = req.status === 'APPROVED';
                      const isIssued = req.status === 'ISSUED';
                      const isRejected = req.status === 'REJECTED';

                      return (
                        <div
                          key={req._id}
                          className="card"
                          style={{
                            padding: '1.5rem',
                            borderLeft: isPending
                              ? '4px solid var(--warning)'
                              : isApproved
                              ? '4px solid #3b82f6'
                              : isIssued
                              ? '4px solid #22c55e'
                              : '4px solid var(--danger)',
                          }}
                        >
                          {/* Card Header */}
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              flexWrap: 'wrap',
                              gap: '1rem',
                              marginBottom: '1rem',
                            }}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                                <strong style={{ fontSize: '1.15rem', color: 'var(--text-main)' }}>{req.requisitionNumber}</strong>
                                <span
                                  className={`badge ${
                                    isPending
                                      ? 'badge-warning'
                                      : isApproved
                                      ? 'badge-info'
                                      : isIssued
                                      ? 'badge-success'
                                      : 'badge-danger'
                                  }`}
                                >
                                  {req.status}
                                </span>
                                <span className="badge badge-outline" style={{ fontSize: '0.78rem' }}>
                                  Batch: {req.batchNumber || req.batch?.batchNumber || 'N/A'}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                Product: <strong>{req.productSnapshot?.productName || req.product?.name || 'Recipe Product'}</strong>
                                {req.productSnapshot?.variantName ? ` (${req.productSnapshot.variantName})` : ''} · Requested by: <strong>{req.requester?.name || 'Staff'}</strong>
                              </div>
                            </div>

                            {/* Action Buttons for Manager */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              {isPending && (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    onClick={() => {
                                      setAdjustModalReq(req);
                                      const initialQty = {};
                                      (req.items || []).forEach((it) => {
                                        initialQty[it.ingredient] = it.requestedQuantity;
                                      });
                                      setAdjustQuantities(initialQty);
                                      setAdjustNotes(req.notes || '');
                                    }}
                                  >
                                    <FileText size={14} /> Review & Adjust
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={() => handleIssueRequisition(req._id)}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                                  >
                                    <CheckCircle size={14} /> Issue Stock Now
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    onClick={() => {
                                      setRejectModalReq(req);
                                      setRejectModalReason('');
                                    }}
                                    style={{ color: 'var(--danger)', borderColor: 'var(--danger-light)' }}
                                  >
                                    <X size={14} /> Reject
                                  </button>
                                </>
                              )}

                              {isApproved && (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={() => handleIssueRequisition(req._id)}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', backgroundColor: '#16a34a' }}
                                  >
                                    <Package size={14} /> Issue Stock (Physical Handover)
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    onClick={() => {
                                      setRejectModalReq(req);
                                      setRejectModalReason('');
                                    }}
                                    style={{ color: 'var(--danger)' }}
                                  >
                                    <X size={14} /> Reject
                                  </button>
                                </>
                              )}

                              {isIssued && (
                                <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 10px' }}>
                                  <Check size={14} /> Stock Issued · Deducted from Pantry
                                </span>
                              )}

                              {isRejected && (
                                <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                  <X size={14} /> Rejection Finalized
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Rejection / Note Banner */}
                          {req.rejectionReason && (
                            <div className="alert alert-danger" style={{ padding: '8px 12px', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                              <strong>Rejection Reason:</strong> {req.rejectionReason}
                            </div>
                          )}

                          {req.notes && (
                            <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: '0.75rem', fontStyle: 'italic' }}>
                              Staff note: "{req.notes}"
                            </div>
                          )}

                          {/* Items Table */}
                          <div style={{ overflowX: 'auto', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
                              <thead>
                                <tr style={{ color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                                  <th style={{ padding: '6px 8px' }}>Ingredient</th>
                                  <th style={{ padding: '6px 8px' }}>Recipe Required</th>
                                  <th style={{ padding: '6px 8px' }}>Requested</th>
                                  <th style={{ padding: '6px 8px' }}>Approved</th>
                                  <th style={{ padding: '6px 8px' }}>Issued Lots & Ledger</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(req.items || []).map((it, idx) => (
                                  <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '8px', fontWeight: 600, color: 'var(--text-main)' }}>
                                      {it.name || 'Ingredient'}
                                    </td>
                                    <td style={{ padding: '8px' }}>
                                      {it.requiredQuantity} {it.unit}
                                    </td>
                                    <td style={{ padding: '8px', fontWeight: 600 }}>
                                      {it.requestedQuantity} {it.unit}
                                    </td>
                                    <td style={{ padding: '8px' }}>
                                      {it.approvedQuantity !== null && it.approvedQuantity !== undefined
                                        ? `${it.approvedQuantity} ${it.unit}`
                                        : isApproved || isIssued
                                        ? `${it.requestedQuantity} ${it.unit}`
                                        : <span style={{ color: 'var(--text-muted)' }}>Pending</span>}
                                    </td>
                                    <td style={{ padding: '8px' }}>
                                      {it.issuedLots?.length ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                          {it.issuedLots.map((lot, li) => (
                                            <span key={li} style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                              Lot <strong>{lot.lotNumber}</strong>: {lot.quantity} {lot.unit}
                                            </span>
                                          ))}
                                        </div>
                                      ) : isIssued ? (
                                        <span style={{ color: '#16a34a', fontWeight: 600 }}>{it.issuedQuantity || it.requestedQuantity} {it.unit}</span>
                                      ) : (
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Unissued</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Footer Audit Timestamps */}
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              fontSize: '0.78rem',
                              color: 'var(--text-muted)',
                              marginTop: '0.75rem',
                              paddingTop: '0.5rem',
                              borderTop: '1px dashed var(--border-color)',
                            }}
                          >
                            <span>Created: {new Date(req.createdAt).toLocaleString()}</span>
                            {req.approvedAt && <span>Approved: {new Date(req.approvedAt).toLocaleString()}</span>}
                            {req.issuedAt && <span>Issued: {new Date(req.issuedAt).toLocaleString()}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 4: PRODUCTION STAFF MANAGEMENT */}
          {/* ========================================================================= */}
          {activeTab === 'staff' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
              {/* Staff List */}
              <div className="card" style={{ padding: '1.75rem' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  Bakery Production Staff ({workers.length})
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                  Active kitchen staff authorized to operate the production workstation.
                </p>

                {workers.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No production staff members registered yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {workers.map((w) => (
                      <div
                        key={w._id}
                        style={{
                          padding: '12px 14px',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '0.75rem',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <strong style={{ fontSize: '1.05rem' }}>{w.name}</strong>
                            <span className={`badge ${w.isActive !== false ? 'badge-success' : 'badge-danger'}`}>
                              {w.isActive !== false ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            Role: <strong>{w.jobDesignation || 'Baker'}</strong> • Email: {w.email}
                          </div>
                          {w.phone && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '2px' }}>
                              Phone: {w.phone}
                            </div>
                          )}
                          <div style={{ fontSize: '0.82rem', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Labour Rate:</span>
                            {w.hourlyLabourRate != null ? (
                              <strong style={{ color: 'var(--text-main)' }}>
                                {formatHourlyRate(w.hourlyLabourRate)}
                              </strong>
                            ) : (
                              <span
                                className="badge"
                                style={{
                                  backgroundColor: '#fef3c7',
                                  color: '#b45309',
                                  border: '1px solid #fde68a',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                }}
                              >
                                ⚠ Rate missing (batch costing requires rate)
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenEditStaff(w)}
                            className="btn btn-sm btn-outline"
                            style={{ fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            title="Update labour rate and staff details"
                          >
                            <Edit2 size={13} /> Edit Rate & Info
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleStaffStatus(w)}
                            className={`btn btn-sm ${w.isActive !== false ? 'btn-outline' : 'btn-primary'}`}
                            style={{
                              fontSize: '0.78rem',
                              color: w.isActive !== false ? 'var(--danger)' : undefined,
                              borderColor: w.isActive !== false ? 'var(--danger-light)' : undefined,
                            }}
                          >
                            {w.isActive !== false ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Staff Form */}
              <div className="card" style={{ padding: '1.75rem' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  Add Production Staff
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                  Creates an authorized kitchen workstation account. Role is strictly assigned as PRODUCTION_STAFF.
                </p>

                <form onSubmit={handleCreateStaff} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                      Full Name <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Ramesh Patil"
                      className="input-field"
                      value={staffForm.name}
                      onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                      Email Address <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="ramesh.patil@bakery.com"
                      className="input-field"
                      value={staffForm.email}
                      onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                      Temporary Password <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      placeholder="Min 8 characters"
                      className="input-field"
                      value={staffForm.password}
                      onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                        Job Designation
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Head Baker, Pastry Cook"
                        className="input-field"
                        value={staffForm.jobDesignation}
                        onChange={(e) => setStaffForm({ ...staffForm, jobDesignation: e.target.value })}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                        Phone Number
                      </label>
                      <input
                        type="text"
                        placeholder="+91 9876543210"
                        className="input-field"
                        value={staffForm.phone}
                        onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                      Hourly Labour Rate (₹/hour) <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      placeholder="e.g. 150"
                      className="input-field"
                      value={staffForm.hourlyLabourRate}
                      onChange={(e) => setStaffForm({ ...staffForm, hourlyLabourRate: e.target.value })}
                    />
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Required for batch labour costing. Snapshotted onto each assigned production batch.
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={staffSubmitting}
                    className="btn btn-primary"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '0.5rem' }}
                  >
                    <UserPlus size={16} />
                    {staffSubmitting ? 'Creating Staff Account...' : 'Create Staff Member'}
                  </button>
                </form>
              </div>

              {/* Edit Staff Modal */}
              {editingWorker && (
                <div
                  className="modal-backdrop"
                  style={{
                    position: 'fixed',
                    inset: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    padding: '1rem',
                  }}
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setEditingWorker(null);
                  }}
                >
                  <div
                    className="card"
                    style={{
                      width: '100%',
                      maxWidth: '460px',
                      padding: '1.75rem',
                      borderRadius: '16px',
                      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>
                        Edit Staff: {editingWorker.name}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setEditingWorker(null)}
                        className="btn btn-outline btn-sm"
                        style={{ padding: '4px 8px' }}
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                      Update contact details and hourly labour rate. New rate will snapshot onto future batch assignments.
                    </p>

                    <form onSubmit={handleUpdateStaff} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                          Email Address
                        </label>
                        <input
                          type="text"
                          disabled
                          className="input-field"
                          value={editingWorker.email}
                          style={{ opacity: 0.7, cursor: 'not-allowed' }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                          Hourly Labour Rate (₹/hour) <span style={{ color: 'var(--danger)' }}>*</span>
                        </label>
                        <input
                          type="number"
                          required
                          min="0"
                          step="0.01"
                          placeholder="e.g. 150"
                          className="input-field"
                          value={editWorkerForm.hourlyLabourRate}
                          onChange={(e) => setEditWorkerForm({ ...editWorkerForm, hourlyLabourRate: e.target.value })}
                        />
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Required for batch costing calculation. Snapshotted on assignment.
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                            Job Designation
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Baker, Pastry Chef"
                            className="input-field"
                            value={editWorkerForm.jobDesignation}
                            onChange={(e) => setEditWorkerForm({ ...editWorkerForm, jobDesignation: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                            Phone Number
                          </label>
                          <input
                            type="text"
                            placeholder="+91 9876543210"
                            className="input-field"
                            value={editWorkerForm.phone}
                            onChange={(e) => setEditWorkerForm({ ...editWorkerForm, phone: e.target.value })}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={() => setEditingWorker(null)}
                          className="btn btn-outline btn-sm"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={editWorkerSubmitting}
                          className="btn btn-primary btn-sm"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          <Save size={14} />
                          {editWorkerSubmitting ? 'Saving...' : 'Save Staff Details'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 5: PRODUCTS & MENU */}
          {/* ========================================================================= */}
          {activeTab === 'products' && (
            <div className="owner-menu-layout">
              <div className="card owner-products-card">
                <div className="owner-products-header">
                  <h2>Bakery Products ({products.length})</h2>
                  <p>Manage menu offerings, recipes, formulation durations, and catalog pricing.</p>
                </div>

                <div className="owner-products-list">
                  {products.map((p) => {
                    const totalTime = (p.totalTimeMinutes !== undefined && p.totalTimeMinutes !== null)
                      ? Number(p.totalTimeMinutes)
                      : ((Number(p.preparationTime) || 0) + (Number(p.productionTime) || 0));
                    const hasDuration = totalTime > 0;
                    const elecCostPerUnit = Number(p.electricityCostPerUnit) || 0;
                    const packCostPerUnit = Number(p.packagingCostPerUnit) || 0;
                    const isDeleting = deletingProductIds.has(p._id);

                    return (
                      <div key={p._id} className="owner-product-card">
                        <div className="owner-product-media">
                          <CatalogImage src={p.imageUrl || p.images?.[0] || p.image} alt={p.name} />
                        </div>

                        <div className="owner-product-content">
                          <div className="owner-product-details">
                            <div className="owner-product-title-row">
                              <h3 className="owner-product-name">{p.name}</h3>
                              <span className="owner-product-price">{formatCurrency(p.price || p.basePrice || 0)}</span>
                            </div>

                            <div className="owner-product-meta">
                              <span className="owner-meta-pill">
                                {p.category?.name || 'General'}
                              </span>
                              <span className={`owner-meta-pill ${p.isAvailable !== false ? 'is-available' : 'is-unavailable'}`}>
                                <span className="owner-meta-dot" />
                                {p.isAvailable !== false ? 'Available' : 'Unavailable'}
                              </span>
                              <span className="owner-meta-pill">
                                {p.variants?.length || 1} variant{p.variants?.length === 1 ? '' : 's'}
                              </span>
                              <span className="owner-meta-pill" title="Configured Electricity Cost per Unit">
                                Elec: ₹{elecCostPerUnit.toFixed(2)}/u
                              </span>
                              <span className="owner-meta-pill" title="Configured Packaging Cost per Unit">
                                Pack: ₹{packCostPerUnit.toFixed(2)}/u
                              </span>
                            </div>

                            <div className="owner-product-duration">
                              <span className={`owner-duration-badge ${hasDuration ? 'has-duration' : 'no-duration'}`}>
                                <Clock size={12} />
                                {hasDuration
                                  ? `Total Time to Make Product: ${totalTime} min`
                                  : 'No duration set'}
                              </span>
                            </div>

                            {/* Product Variants & Costing / Margin Breakdown */}
                            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              {(p.variants || [{ _id: 'default', name: 'Regular', price: p.price || 0 }]).map((v) => {
                                const variantCosting = productCostings[p._id]?.variants?.find((vc) => String(vc.variantId) === String(v._id)) || productCostings[p._id]?.variants?.[0];
                                const currentPrice = v.price ?? p.price ?? 0;
                                const editKey = `${p._id}_${v._id}`;
                                const isEditingPrice = editingVariantPrices[editKey] !== undefined;
                                const priceVal = isEditingPrice ? editingVariantPrices[editKey] : currentPrice;
                                const isSaving = savingVariantPriceId === editKey;

                                const unitCost = variantCosting?.totalUnitCost;
                                const grossProfit = variantCosting?.grossProfit;
                                const grossMargin = variantCosting?.grossMarginPercentage;

                                return (
                                  <div
                                    key={v._id}
                                    style={{
                                      backgroundColor: 'var(--bg-main)',
                                      borderRadius: '8px',
                                      padding: '8px 10px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      flexWrap: 'wrap',
                                      gap: '8px',
                                      fontSize: '0.84rem',
                                    }}
                                  >
                                    <div>
                                      <strong style={{ color: 'var(--text-main)' }}>{v.name || 'Default Variant'}</strong>
                                      {variantCosting ? (
                                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                          <span>Unit Cost: <strong>{formatCurrency(unitCost)}</strong></span>
                                          {variantCosting.ingredientCost !== undefined && (
                                            <>
                                              <span>·</span>
                                              <span>Ing: {formatCurrency(variantCosting.ingredientCost)}</span>
                                              <span>·</span>
                                              <span>Elec: {formatCurrency(variantCosting.electricityCost)}</span>
                                              <span>·</span>
                                              <span>Pack: {formatCurrency(variantCosting.packagingCost)}</span>
                                            </>
                                          )}
                                          <span>·</span>
                                          <span>Gross Profit: <strong style={{ color: grossProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(grossProfit)}</strong></span>
                                        </div>
                                      ) : (
                                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                          Configure recipe to view unit cost & margin
                                        </div>
                                      )}
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      {grossMargin !== undefined && (
                                        <span
                                          style={{
                                            padding: '2px 8px',
                                            borderRadius: '999px',
                                            fontSize: '0.74rem',
                                            fontWeight: 700,
                                            backgroundColor: grossMargin >= 30 ? '#dcfce7' : grossMargin > 0 ? '#fef3c7' : '#fee2e2',
                                            color: grossMargin >= 30 ? '#15803d' : grossMargin > 0 ? '#b45309' : '#b91c1c',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '3px',
                                          }}
                                          title={`Gross margin: ${grossMargin}% = (Price - Cost) / Price`}
                                        >
                                          <Percent size={11} /> {grossMargin}% margin
                                        </span>
                                      )}

                                      {/* Owner Selling Price Quick Editor */}
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>₹</span>
                                        <input
                                          type="number"
                                          min="0"
                                          step="any"
                                          aria-label={`Selling price for ${p.name} ${v.name}`}
                                          value={priceVal}
                                          onChange={(e) => setEditingVariantPrices((prev) => ({ ...prev, [editKey]: e.target.value }))}
                                          style={{
                                            width: '74px',
                                            padding: '3px 6px',
                                            fontSize: '0.84rem',
                                            fontWeight: 700,
                                            borderRadius: '6px',
                                            border: '1px solid var(--border-color)',
                                            margin: 0,
                                          }}
                                        />
                                        {isEditingPrice && Number(editingVariantPrices[editKey]) !== currentPrice && (
                                          <button
                                            type="button"
                                            disabled={isSaving}
                                            onClick={() => handleSaveVariantPrice(p._id, v._id)}
                                            className="btn btn-primary btn-sm"
                                            style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                                          >
                                            {isSaving ? '...' : 'Save'}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="owner-product-actions">
                            <button
                              type="button"
                              onClick={() => openRecipeModal(p)}
                              className="btn btn-outline btn-sm owner-btn-recipe"
                              style={{
                                borderColor: hasDuration ? 'var(--primary)' : 'var(--border-color)',
                                color: hasDuration ? 'var(--primary)' : 'inherit',
                              }}
                              title={`Manage Recipe, Formulation & Duration for ${p.name}`}
                            >
                              <ChefHat size={14} />
                              <span>Manage Recipe</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => startProductEdit(p)}
                              className="btn btn-outline btn-sm"
                              title={`Edit ${p.name}`}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(p._id)}
                              disabled={isDeleting}
                              className="btn btn-sm owner-btn-delete"
                              style={{
                                cursor: isDeleting ? 'wait' : 'pointer',
                                opacity: isDeleting ? 0.55 : 1,
                              }}
                              title={`Delete ${p.name}`}
                              aria-label={`Delete ${p.name}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>
                <div className="card owner-menu-card">
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>{editingProductId ? 'Edit Product' : 'Add New Product'}</h3>
                  <form onSubmit={handleCreateProduct} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <input
                      id="owner-product-name"
                      type="text"
                      required
                      placeholder="Product Name (e.g. Cinnamon Roll)"
                      className="input-field"
                      value={newProduct.name}
                      onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                    />
                    <input type="url" placeholder="Product image URL (https://…)" className="input-field" value={newProduct.imageUrl} onChange={(e) => setNewProduct({ ...newProduct, imageUrl: e.target.value })} />
                    <select
                      className="input-field"
                      value={newProduct.category}
                      onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                    >
                      <option value="">Select Category</option>
                      {categories.map((c) => (
                        <option key={c._id} value={c._id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      required
                      placeholder="Base Price (₹)"
                      className="input-field"
                      value={newProduct.price}
                      onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                    />
                    <div>
                      <label htmlFor="owner-product-total-time" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-color)' }}>
                        Total Time to Make Product (min) <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <input
                        id="owner-product-total-time"
                        type="number"
                        min="1"
                        required
                        placeholder="e.g. 45"
                        className="input-field"
                        value={newProduct.totalTimeMinutes}
                        onChange={(e) => setNewProduct({ ...newProduct, totalTimeMinutes: e.target.value })}
                      />
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>
                        Combined preparation and baking duration required to make this product.
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
                      <div>
                        <label htmlFor="owner-product-electricity-cost" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-color)' }}>
                          Electricity Cost per Unit (₹)
                        </label>
                        <input
                          id="owner-product-electricity-cost"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          className="input-field"
                          value={newProduct.electricityCostPerUnit}
                          onChange={(e) => setNewProduct({ ...newProduct, electricityCostPerUnit: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor="owner-product-packaging-cost" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-color)' }}>
                          Packaging Cost per Unit (₹)
                        </label>
                        <input
                          id="owner-product-packaging-cost"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          className="input-field"
                          value={newProduct.packagingCostPerUnit}
                          onChange={(e) => setNewProduct({ ...newProduct, packagingCostPerUnit: e.target.value })}
                        />
                      </div>
                    </div>
                    <textarea
                      rows={2}
                      placeholder="Description"
                      className="input-field"
                      value={newProduct.description}
                      onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
                    />
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                    >
                      {editingProductId ? <Save size={16} /> : <Plus size={16} />} {editingProductId ? 'Save Product' : 'Create Product'}
                    </button>
                    {editingProductId && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setEditingProductId('');
                          setNewProduct({
                            name: '',
                            category: '',
                            price: '',
                            description: '',
                            imageUrl: '',
                            totalTimeMinutes: '45',
                            electricityCostPerUnit: '0',
                            packagingCostPerUnit: '0',
                          });
                        }}
                      >
                        Cancel edit
                      </button>
                    )}
                  </form>
                </div>

                <div className="card owner-menu-card">
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>{editingCategoryId ? 'Edit Category' : 'Add Category'}</h3>
                  <form onSubmit={handleCreateCategory} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <input
                      type="text"
                      required
                      placeholder="Category Name (e.g. Sourdough Breads)"
                      className="input-field"
                      value={newCategory.name}
                      onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                    />
                    <input type="url" placeholder="Category image URL (https://…)" className="input-field" value={newCategory.imageUrl} onChange={(e) => setNewCategory({ ...newCategory, imageUrl: e.target.value })} />
                    <textarea rows={2} placeholder="Category description" className="input-field" value={newCategory.description} onChange={(e) => setNewCategory({ ...newCategory, description: e.target.value })} />
                    <button
                      type="submit"
                      className="btn btn-outline btn-sm"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                    >
                      {editingCategoryId ? <Save size={16} /> : <Plus size={16} />} {editingCategoryId ? 'Save Category' : 'Create Category'}
                    </button>
                    {editingCategoryId && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setEditingCategoryId(''); setNewCategory({ name: '', description: '', imageUrl: '' }); }}>Cancel edit</button>}
                  </form>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginTop: '1rem' }}>
                    {categories.map((category) => (
                      <div key={category._id} className="manager-list-row">
                        <span className="manager-list-row-info">
                          <span className="owner-category-thumb">
                            <CatalogImage compact src={category.imageUrl || category.image} alt={category.name} />
                          </span>
                          <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{category.name}</strong>
                        </span>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => startCategoryEdit(category)}>Edit</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 6: UPI QR SETTINGS */}
          {/* ========================================================================= */}
          {activeTab === 'qr' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
              <section className="card" style={{ padding: '2rem', gridColumn: '1 / -1' }} aria-labelledby="production-capacity-title">
                <h2 id="production-capacity-title" style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '0.5rem' }}>Production Capacity</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                  Enter the bakery’s real working limits. Made-to-order checkout uses active production staff, oven minutes, recipe duration, and remaining daily capacity. Staff capacity counts only active production staff accounts.
                </p>
                <form onSubmit={handleSaveCapacity} style={{ display: 'grid', gap: '1rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
                    <label>Opens<input required type="time" className="input-field" value={capacityConfig.workingHours.open} onChange={(e) => setCapacityConfig((v) => ({ ...v, workingHours: { ...v.workingHours, open: e.target.value } }))} /></label>
                    <label>Closes<input required type="time" className="input-field" value={capacityConfig.workingHours.close} onChange={(e) => setCapacityConfig((v) => ({ ...v, workingHours: { ...v.workingHours, close: e.target.value } }))} /></label>
                    <label>Production slot (minutes)<input required min="15" max="1440" type="number" className="input-field" value={capacityConfig.slotMinutes} onChange={(e) => setCapacityConfig((v) => ({ ...v, slotMinutes: e.target.value }))} /></label>
                    <label>Minutes per staff member/day<input required min="1" max="1440" type="number" className="input-field" value={capacityConfig.minutesPerStaffPerDay} onChange={(e) => setCapacityConfig((v) => ({ ...v, minutesPerStaffPerDay: e.target.value }))} /></label>
                  </div>
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    <strong>Ovens and usable minutes per day</strong>
                    {capacityConfig.ovens.map((oven, index) => (
                      <div key={`oven-${index}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) minmax(120px, 1fr) auto', gap: '0.5rem' }}>
                        <input required maxLength="80" aria-label={`Oven ${index + 1} name`} className="input-field" placeholder="Oven name" value={oven.name} onChange={(e) => setCapacityConfig((v) => ({ ...v, ovens: v.ovens.map((item, i) => i === index ? { ...item, name: e.target.value } : item) }))} />
                        <input required min="1" max="1440" type="number" aria-label={`Oven ${index + 1} available minutes`} className="input-field" placeholder="Minutes/day" value={oven.minutesPerDay} onChange={(e) => setCapacityConfig((v) => ({ ...v, ovens: v.ovens.map((item, i) => i === index ? { ...item, minutesPerDay: e.target.value } : item) }))} />
                        <button type="button" className="btn btn-outline" aria-label={`Remove oven ${index + 1}`} onClick={() => setCapacityConfig((v) => ({ ...v, ovens: v.ovens.filter((_, i) => i !== index) }))}><X size={16} /></button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-outline" onClick={() => setCapacityConfig((v) => ({ ...v, ovens: [...v.ovens, { name: '', minutesPerDay: '' }] }))}><Plus size={15} /> Add oven</button>
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={capacitySaving || !capacityConfig.ovens.length}>{capacitySaving ? 'Saving…' : 'Save production capacity'}</button>
                </form>
              </section>
              <div className="card" style={{ padding: '2rem' }}>
                <h2 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '1rem' }}>
                  Owner UPI QR Configuration
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                  Configure your bakery UPI ID so customers can make direct payments without middleman payment gateways.
                </p>
                {qrConfig.isPlaceholder && <div className="alert alert-warning" role="status" style={{ marginBottom: '1.25rem' }}>The current UPI details are placeholders. Replace them with your official bakery UPI ID and payee name before saving.</div>}

                <form onSubmit={handleSaveQrConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                      Bakery UPI ID (VPA) <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      className="input-field"
                      placeholder="e.g. bakery@okaxis or your-vpa@upi"
                      value={qrConfig.upiId}
                      onChange={(e) => setQrConfig({ ...qrConfig, upiId: e.target.value })}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                      Payee / Merchant Business Name <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      className="input-field"
                      placeholder="e.g. Smart Bakery"
                      value={qrConfig.payeeName}
                      onChange={(e) => setQrConfig({ ...qrConfig, payeeName: e.target.value })}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                      Custom QR Code Image URL (Optional)
                    </label>
                    <input
                      type="url"
                      className="input-field"
                      placeholder="https://... (Leave blank to use auto-generated QR)"
                      value={qrConfig.qrImageUrl || ''}
                      onChange={(e) => setQrConfig({ ...qrConfig, qrImageUrl: e.target.value })}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                      Customer Instructions
                    </label>
                    <textarea
                      className="input-field"
                      rows={3}
                      placeholder="Instructions shown on payment page..."
                      value={qrConfig.instructions || ''}
                      onChange={(e) => setQrConfig({ ...qrConfig, instructions: e.target.value })}
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  >
                    <Save size={16} /> Save QR Configuration
                  </button>
                </form>
              </div>

              <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>Customer QR Preview</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  This is how customers will see your payment QR code on the payment screen.
                </p>

                <div
                  style={{
                    display: 'inline-block',
                    padding: '16px',
                    background: 'white',
                    borderRadius: '16px',
                    border: '1px solid var(--border-color)',
                    boxShadow: 'var(--shadow-md)',
                    marginBottom: '1rem',
                  }}
                >
                  {qrConfig.isPlaceholder || !qrConfig.upiId ? (
                    <p style={{ maxWidth: '220px', margin: 0, color: 'var(--text-muted)' }}>Your QR will appear here after you save the bakery’s official UPI ID and payee name.</p>
                  ) : (
                    <img
                      src={qrConfig.qrImageUrl || `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrConfig.qrData || `upi://pay?pa=${encodeURIComponent(qrConfig.upiId)}&pn=${encodeURIComponent(qrConfig.payeeName || 'Smart Bakery')}&cu=INR`)}`}
                      alt="Live bakery UPI QR preview"
                      style={{ width: '200px', height: '200px', display: 'block' }}
                    />
                  )}
                </div>

                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{qrConfig.payeeName || 'Payee name required'}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{qrConfig.isPlaceholder ? 'Official UPI ID not configured' : (qrConfig.upiId || 'UPI ID required')}</div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 7: SALES & PROFIT ANALYTICS */}
          {/* ========================================================================= */}
          {activeTab === 'analytics' && (
            <SalesAnalyticsSection onNavigateTab={(tab) => setActiveTab(tab)} />
          )}
        </div>
      )}
      </section>
      </div>

      {/* ========================================================================= */}
      {/* MODAL: RECIPE & PRODUCTION DURATION MANAGEMENT */}
      {/* ========================================================================= */}
      {showRecipeModal && recipeModalProduct && (
        <RecipeModal
          product={recipeModalProduct}
          initialVariantId={recipeModalVariantId}
          onClose={() => {
            setShowRecipeModal(false);
            setRecipeModalProduct(null);
          }}
          onRecipeSaved={async () => {
            await loadData('products');
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* SUB-MODAL: CREATE NEW INGREDIENT INLINE (WITH OPTIONAL OPENING STOCK) */}
      {/* ========================================================================= */}
      {showInlineIngredientModal && (
        <div
          className="modal-backdrop-animated"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10050,
            padding: '1rem',
          }}
        >
          <div
            className="card modal-card-animated"
            style={{
              maxWidth: '560px',
              width: '100%',
              padding: '1.75rem',
              maxHeight: '92vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={18} color="var(--primary)" />
                  Create New Ingredient
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Add a pantry ingredient and optionally record opening stock without leaving the recipe workflow
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowInlineIngredientModal(false)}
                className="btn btn-sm"
                style={{ border: 'none', background: 'transparent' }}
              >
                <X size={20} />
              </button>
            </div>

            {inlineIngredientError && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius)',
                  marginBottom: '1rem',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: 'var(--danger, #dc2626)',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertCircle size={16} />
                <span>{inlineIngredientError}</span>
              </div>
            )}

            <form onSubmit={handleCreateInlineIngredient} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                  Ingredient Name <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Cocoa Powder, Dark Chocolate, Vanilla Extract"
                  className="input-field"
                  value={inlineIngredientForm.name}
                  onChange={(e) => setInlineIngredientForm({ ...inlineIngredientForm, name: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                    Base Pantry Unit <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <select
                    required
                    className="input-field"
                    value={inlineIngredientForm.unit}
                    onChange={(e) => setInlineIngredientForm({ ...inlineIngredientForm, unit: e.target.value })}
                  >
                    <option value="kg">kg (Kilograms)</option>
                    <option value="g">g (Grams)</option>
                    <option value="L">L (Liters)</option>
                    <option value="ml">ml (Milliliters)</option>
                    <option value="piece">piece (Units/Count)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                    Minimum Safety Stock
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="e.g. 5"
                    className="input-field"
                    value={inlineIngredientForm.minimumStock}
                    onChange={(e) => setInlineIngredientForm({ ...inlineIngredientForm, minimumStock: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                  Reorder Level (Optional)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="e.g. 10 (triggers low-stock alert)"
                  className="input-field"
                  value={inlineIngredientForm.reorderLevel}
                  onChange={(e) => setInlineIngredientForm({ ...inlineIngredientForm, reorderLevel: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                  Description & Storage Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Store in airtight container below 20°C"
                  className="input-field"
                  value={inlineIngredientForm.description}
                  onChange={(e) => setInlineIngredientForm({ ...inlineIngredientForm, description: e.target.value })}
                />
              </div>

              {/* Optional Opening Stock Box */}
              <div
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius)',
                  padding: '1rem',
                  background: inlineIngredientForm.hasOpeningStock ? 'rgba(var(--primary-rgb, 59, 130, 246), 0.04)' : 'transparent',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={inlineIngredientForm.hasOpeningStock}
                    onChange={(e) => setInlineIngredientForm({ ...inlineIngredientForm, hasOpeningStock: e.target.checked })}
                    style={{ width: '16px', height: '16px' }}
                  />
                  Record Opening Stock in Pantry Now
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 0 24px' }}>
                  Creates an initial inventory lot and records an adjustment ledger transaction automatically.
                </p>

                {inlineIngredientForm.hasOpeningStock && (
                  <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingLeft: '24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '2px' }}>
                          Opening Quantity ({inlineIngredientForm.unit}) <span style={{ color: 'var(--danger)' }}>*</span>
                        </label>
                        <input
                          type="number"
                          min="0.000001"
                          step="any"
                          required={inlineIngredientForm.hasOpeningStock}
                          placeholder={`e.g. 25 ${inlineIngredientForm.unit}`}
                          className="input-field"
                          value={inlineIngredientForm.openingStock}
                          onChange={(e) => setInlineIngredientForm({ ...inlineIngredientForm, openingStock: e.target.value })}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '2px' }}>
                          Unit Cost (₹)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="e.g. 75.00"
                          className="input-field"
                          value={inlineIngredientForm.openingStockCost}
                          onChange={(e) => setInlineIngredientForm({ ...inlineIngredientForm, openingStockCost: e.target.value })}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '2px' }}>
                          Expiry Date
                        </label>
                        <input
                          type="date"
                          className="input-field"
                          value={inlineIngredientForm.openingStockExpiryDate}
                          onChange={(e) => setInlineIngredientForm({ ...inlineIngredientForm, openingStockExpiryDate: e.target.value })}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '2px' }}>
                          Lot / Batch Number
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. LOT-OPN-1234"
                          className="input-field"
                          value={inlineIngredientForm.openingStockLotNumber}
                          onChange={(e) => setInlineIngredientForm({ ...inlineIngredientForm, openingStockLotNumber: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowInlineIngredientModal(false)}
                  className="btn btn-outline btn-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inlineIngredientSubmitting}
                  className="btn btn-primary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Check size={16} />
                  {inlineIngredientSubmitting ? 'Creating Ingredient...' : 'Save & Select in Recipe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: SCHEDULE NEW PRODUCTION BATCH */}
      {/* ========================================================================= */}
      <BatchScheduleModal
        isOpen={showNewBatchModal}
        onClose={() => {
          setShowNewBatchModal(false);
          setSelectedOrderForBatch(null);
        }}
        products={products}
        workers={workers}
        initialOrder={selectedOrderForBatch}
        onBatchScheduled={async (createdBatch) => {
          notifySuccess(`Production batch ${createdBatch?.batchNumber || ''} scheduled successfully!`);
          await loadData('production');
          if (activeTab === 'orders') {
            await loadData('orders');
          }
        }}
      />

      {/* ========================================================================= */}
      {/* MODAL: ASSIGN STAFF TO BATCH */}
      {/* ========================================================================= */}
      {assignModalBatch && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className="modal-backdrop-portal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAssignModalBatch(null);
          }}
        >
          <div className="modal-dialog-centered" style={{ maxWidth: '440px', width: '92%' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>Assign Production Staff</h3>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Batch: {assignModalBatch.batchNumber}
                </span>
              </div>
              <button
                type="button"
                className="btn-close"
                onClick={() => setAssignModalBatch(null)}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAssignWorkerToBatch} style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                    Select Staff Member <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <select
                    required
                    className="input-field"
                    value={selectedWorkerForAssign}
                    onChange={(e) => setSelectedWorkerForAssign(e.target.value)}
                  >
                    <option value="">Choose worker...</option>
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
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                    Task Assignment
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={taskDescriptionForAssign}
                    onChange={(e) => setTaskDescriptionForAssign(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setAssignModalBatch(null)}
                  className="btn btn-outline btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Assign Worker
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* MODAL: QUICK STOCK ADJUSTMENT */}
      {/* ========================================================================= */}
      {showAdjustModal && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="stock-adjustment-title"
          className="modal-backdrop-portal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAdjustModal(false);
          }}
        >
          <div
            className="modal-dialog-centered"
            style={{ maxWidth: '440px', width: '92%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="stock-adjustment-title" style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                Stock Adjustment / Audit
              </h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setShowAdjustModal(false)}
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleStockAdjustment} style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                    Ingredient <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <select
                    required
                    className="input-field"
                    value={adjustmentForm.ingredientId}
                    onChange={(e) => {
                      const ingId = e.target.value;
                      const ing = ingredients.find((i) => i._id === ingId);
                      setAdjustmentForm({
                        ...adjustmentForm,
                        ingredientId: ingId,
                        unit: ing?.unit || adjustmentForm.unit,
                      });
                    }}
                  >
                    <option value="">Select Ingredient...</option>
                    {ingredients.map((ing) => (
                      <option key={ing._id} value={ing._id}>
                        {ing.name} ({ing.unit})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                      Type <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <select
                      className="input-field"
                      value={adjustmentForm.type}
                      onChange={(e) => setAdjustmentForm({ ...adjustmentForm, type: e.target.value })}
                    >
                      <option value="ADD">ADD (+) Stock</option>
                      <option value="REMOVE">REMOVE (-) Stock</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                      Quantity <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      placeholder="0.0"
                      className="input-field"
                      value={adjustmentForm.quantity}
                      onChange={(e) => setAdjustmentForm({ ...adjustmentForm, quantity: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                    Reason for Adjustment <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Physical inventory count correction, spillage calibration"
                    className="input-field"
                    value={adjustmentForm.reason}
                    onChange={(e) => setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="btn btn-outline btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Apply Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* MODAL: REJECT INGREDIENT REQUISITION */}
      {/* ========================================================================= */}
      {rejectModalReq && (
        <div
          className="modal-backdrop-animated"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '1rem',
          }}
        >
          <div className="card modal-card-animated" style={{ maxWidth: '440px', width: '100%', padding: '1.75rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '0.4rem', color: 'var(--text-main)' }}>
              Reject Ingredient Requisition
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginBottom: '1.25rem' }}>
              Requisition <strong>{rejectModalReq.requisitionNumber}</strong> for batch {rejectModalReq.batchNumber || 'N/A'}.
              Provide a clear reason for production staff:
            </p>
            <form onSubmit={handleRejectRequisition} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <textarea
                required
                rows={3}
                placeholder="e.g. Stock shortage in butter; alternative vendor shipment arriving at 2 PM"
                className="input-field"
                value={rejectModalReason}
                onChange={(e) => setRejectModalReason(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setRejectModalReq(null)}
                  className="btn btn-outline btn-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-sm"
                  style={{ background: 'var(--danger)', color: 'white' }}
                >
                  Confirm Rejection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: APPROVE / ADJUST INGREDIENT REQUISITION */}
      {/* ========================================================================= */}
      {adjustModalReq && (
        <div
          className="modal-backdrop-animated"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '1rem',
          }}
        >
          <div className="card modal-card-animated" style={{ maxWidth: '520px', width: '100%', padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                Review Requisition {adjustModalReq.requisitionNumber}
              </h3>
              <button
                type="button"
                onClick={() => setAdjustModalReq(null)}
                className="btn btn-sm"
                style={{ border: 'none', background: 'transparent' }}
              >
                <X size={20} />
              </button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Confirm or adjust approved quantities before releasing ingredients to kitchen station.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const itemsPayload = (adjustModalReq.items || []).map((it) => ({
                  ingredientId: it.ingredient,
                  approvedQuantity: Number(adjustQuantities[it.ingredient] ?? it.requestedQuantity),
                }));
                handleApproveRequisition(adjustModalReq._id, itemsPayload, adjustNotes);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '240px', overflowY: 'auto' }}>
                {(adjustModalReq.items || []).map((it) => (
                  <div
                    key={it.ingredient}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-main)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '0.88rem' }}>{it.name}</strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Recipe: {it.requiredQuantity} {it.unit} · Requested: {it.requestedQuantity} {it.unit}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        required
                        className="input-field"
                        style={{ width: '90px', margin: 0, padding: '4px 8px', fontSize: '0.88rem' }}
                        value={adjustQuantities[it.ingredient] ?? it.requestedQuantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setAdjustQuantities((curr) => ({ ...curr, [it.ingredient]: val }));
                        }}
                      />
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{it.unit}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                  Manager Remarks (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Approved with slight reduction due to inventory batch size"
                  className="input-field"
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  style={{ margin: 0 }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setAdjustModalReq(null)}
                  className="btn btn-outline btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" disabled={loading} className="btn btn-primary btn-sm">
                  Approve Requisition
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ========================================================================= */}
      {/* MODAL: UPI PAYMENT SCREENSHOT INSPECTION & VERIFICATION */}
      {/* ========================================================================= */}
      {viewingProofOrder && (
        <PaymentProofModal
          order={viewingProofOrder}
          proofData={proofData}
          loading={proofLoading}
          error={proofError}
          onClose={handleClosePaymentProof}
          onConfirmPayment={handleConfirmPayment}
          onRejectPayment={handleRejectPayment}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL: BATCH COST REVIEW & FINALIZATION */}
      {/* ========================================================================= */}
      {costModalBatch && (
        <BatchCostModal
          batch={costModalBatch}
          onClose={() => setCostModalBatch(null)}
          onCostFinalized={async () => {
            notifySuccess(`Batch ${costModalBatch.batchNumber} cost finalized successfully!`);
            setCostModalBatch(null);
            loadData('production');
            if (activeTab === 'analytics') {
              loadData('analytics');
            }
          }}
        />
      )}
      {/* ========================================================================= */}
      {/* MODAL: EMERGENCY PRODUCTION HOLD */}
      {/* ========================================================================= */}
      {holdModal && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="hold-modal-title"
          className="modal-backdrop-portal"
          onClick={(e) => {
            if (e.target === e.currentTarget && !holdSubmitting) {
              setHoldModal(null);
            }
          }}
          data-testid="hold-confirmation-modal"
        >
          <div className="modal-dialog-centered" style={{ maxWidth: '520px', width: '92%' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="hold-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#be123c', margin: 0 }}>
                <AlertOctagon size={22} color="#be123c" /> Put on Emergency Hold
              </h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setHoldModal(null)}
                disabled={holdSubmitting}
                aria-label="Close dialog"
                data-testid="hold-modal-close"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleConfirmHoldSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {holdError && (
                  <div
                    style={{
                      backgroundColor: '#fff1f2',
                      border: '1px solid #fecdd3',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      fontSize: '0.86rem',
                      color: '#9f1239',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                    data-testid="hold-error-banner"
                  >
                    <AlertOctagon size={16} />
                    <span>{holdError}</span>
                  </div>
                )}

                <div style={{ backgroundColor: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', padding: '10px 14px', fontSize: '0.88rem', color: '#9f1239' }}>
                  Target: <strong>{holdModal.number}</strong> ({holdModal.productName}) - Current Status: <strong>{holdModal.status}</strong>
                </div>

                <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 14px', fontSize: '0.84rem', color: '#92400e' }}>
                  ⚠️ <strong>Warning:</strong> Production is underway or assigned. Ingredients that have already been mixed or baked cannot be restored to inventory.
                </div>

                <div>
                  <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.88rem' }}>
                    Reason for Hold <span style={{ color: '#be123c' }}>*</span>
                  </label>
                  <select
                    value={holdReason}
                    onChange={(e) => setHoldReason(e.target.value)}
                    className="input-field"
                    required
                    data-testid="hold-reason-select"
                  >
                    {HOLD_REASONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.88rem' }}>
                    Baker Instruction <span style={{ color: '#be123c' }}>*</span>
                  </label>
                  <select
                    value={holdInstruction}
                    onChange={(e) => setHoldInstruction(e.target.value)}
                    className="input-field"
                    required
                    data-testid="hold-instruction-select"
                  >
                    {HOLD_INSTRUCTIONS.map((ins) => (
                      <option key={ins} value={ins}>{ins}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.88rem' }}>
                    Owner Explanatory Note (Optional)
                  </label>
                  <textarea
                    value={holdOwnerNote}
                    onChange={(e) => setHoldOwnerNote(e.target.value)}
                    rows={3}
                    className="input-field"
                    placeholder="Add context for the baker or staff (e.g., customer called wanting to change flavor to chocolate)..."
                    data-testid="hold-note-input"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setHoldModal(null)} disabled={holdSubmitting}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger"
                  disabled={holdSubmitting}
                  style={{ backgroundColor: '#be123c', borderColor: '#be123c' }}
                  data-testid="confirm-hold-submit-btn"
                >
                  {holdSubmitting ? 'Placing Hold...' : 'Confirm Production Hold'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* MODAL: UPDATE HOLD INSTRUCTION */}
      {/* ========================================================================= */}
      {updateInstructionModal && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-hold-title"
          className="modal-backdrop-portal"
          onClick={(e) => {
            if (e.target === e.currentTarget && !updateInstructionSubmitting) {
              setUpdateInstructionModal(null);
            }
          }}
          data-testid="update-instruction-modal"
        >
          <div className="modal-dialog-centered" style={{ maxWidth: '500px', width: '92%' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="update-hold-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <RefreshCw size={20} color="#2563eb" /> Update Hold Instruction
              </h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setUpdateInstructionModal(null)}
                disabled={updateInstructionSubmitting}
                aria-label="Close dialog"
                data-testid="update-instruction-close"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleUpdateInstructionSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {updateInstructionError && (
                  <div
                    style={{
                      backgroundColor: '#fff1f2',
                      border: '1px solid #fecdd3',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      fontSize: '0.86rem',
                      color: '#9f1239',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <AlertOctagon size={16} />
                    <span>{updateInstructionError}</span>
                  </div>
                )}
                <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: 0 }}>
                  Updating the instruction for <strong>{updateInstructionModal.number}</strong> will immediately notify the baker via push stream and require fresh acknowledgement.
                </p>
                <div>
                  <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.88rem' }}>
                    New Instruction <span style={{ color: '#be123c' }}>*</span>
                  </label>
                  <select
                    value={newInstruction}
                    onChange={(e) => setNewInstruction(e.target.value)}
                    className="input-field"
                    required
                  >
                    {HOLD_INSTRUCTIONS.map((ins) => (
                      <option key={ins} value={ins}>{ins}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.88rem' }}>
                    Note for Baker (Optional)
                  </label>
                  <textarea
                    value={newInstructionNote}
                    onChange={(e) => setNewInstructionNote(e.target.value)}
                    rows={3}
                    className="input-field"
                    placeholder="e.g., Hold off on putting this into the deck oven while customer confirms..."
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setUpdateInstructionModal(null)} disabled={updateInstructionSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={updateInstructionSubmitting}>
                  {updateInstructionSubmitting ? 'Updating...' : 'Update Instruction & Notify Baker'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* MODAL: RESOLVE EMERGENCY HOLD */}
      {/* ========================================================================= */}
      {resolveHoldModal && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="resolve-hold-title"
          className="modal-backdrop-portal"
          onClick={(e) => {
            if (e.target === e.currentTarget && !resolveSubmitting) {
              setResolveHoldModal(null);
            }
          }}
          data-testid="resolve-hold-modal"
        >
          <div className="modal-dialog-centered" style={{ maxWidth: '520px', width: '92%' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="resolve-hold-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <CheckCircle size={20} color="#16a34a" /> Resolve Emergency Production Hold
              </h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setResolveHoldModal(null)}
                disabled={resolveSubmitting}
                aria-label="Close dialog"
                data-testid="resolve-hold-close"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleResolveHoldSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {resolveHoldError && (
                  <div
                    style={{
                      backgroundColor: '#fff1f2',
                      border: '1px solid #fecdd3',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      fontSize: '0.86rem',
                      color: '#9f1239',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <AlertOctagon size={16} />
                    <span>{resolveHoldError}</span>
                  </div>
                )}
                <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: 0 }}>
                  Choose the resolution for <strong>{resolveHoldModal.number}</strong>:
                </p>
                <div>
                  <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.88rem' }}>
                    Resolution <span style={{ color: '#be123c' }}>*</span>
                  </label>
                  <select
                    value={resolveResolution}
                    onChange={(e) => setResolveResolution(e.target.value)}
                    className="input-field"
                    required
                  >
                    {HOLD_RESOLUTIONS.map((res) => (
                      <option key={res} value={res}>{res}</option>
                    ))}
                  </select>
                </div>

                {resolveResolution === 'Confirm Order Cancellation' && resolveHoldModal.relatedOrders?.length > 1 && (
                  <div>
                    <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.88rem' }}>
                      Select Order to Cancel (Shared Batch)
                    </label>
                    <select
                      value={resolveCancelOrderId}
                      onChange={(e) => setResolveCancelOrderId(e.target.value)}
                      className="input-field"
                    >
                      <option value="">Cancel All Orders on Batch</option>
                      {resolveHoldModal.relatedOrders.map((ord) => (
                        <option key={ord._id || ord} value={ord._id || ord}>
                          Order {ord.orderNumber || ord._id || ord}
                        </option>
                      ))}
                    </select>
                    <small style={{ color: 'var(--text-muted)' }}>
                      Cancelling a single order on a shared batch leaves remaining orders active for production.
                    </small>
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.88rem' }}>
                    Resolution Notes (Optional)
                  </label>
                  <textarea
                    value={resolveNote}
                    onChange={(e) => setResolveNote(e.target.value)}
                    rows={3}
                    className="input-field"
                    placeholder="e.g., Customer agreed to proceed; or Order cancelled upon request, wastage reviewed..."
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setResolveHoldModal(null)} disabled={resolveSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-success" disabled={resolveSubmitting} style={{ backgroundColor: '#16a34a', borderColor: '#16a34a' }}>
                  {resolveSubmitting ? 'Resolving...' : 'Apply Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL: CONFIRM FULFILL FROM FINISHED STOCK */}
      {fulfillStockModal && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="fulfill-stock-modal-title"
          className="modal-backdrop-portal"
          onClick={() => !fulfillSubmitting && setFulfillStockModal(null)}
          data-testid="fulfill-stock-modal"
        >
          <div
            className="modal-dialog-centered"
            style={{ maxWidth: '560px', width: '92%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3
                id="fulfill-stock-modal-title"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#166534', margin: 0, fontSize: '1.15rem' }}
              >
                <PackageCheck size={20} style={{ color: '#16a34a' }} />
                Confirm Fulfillment from Stock
              </h3>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setFulfillStockModal(null)}
                aria-label="Close"
                disabled={fulfillSubmitting}
                data-testid="fulfill-stock-modal-close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.88rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>Order Number: <strong>{fulfillStockModal.orderNumber}</strong></span>
                  <span className="badge badge-info">{fulfillStockModal.orderType}</span>
                </div>
                <div>Customer: <strong>{fulfillStockModal.contactName || fulfillStockModal.customer?.name || 'Guest'}</strong> ({fulfillStockModal.contactPhone || 'N/A'})</div>
                {fulfillStockModal.deliveryDate && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Delivery / Pickup: {fulfillStockModal.deliveryDate} ({fulfillStockModal.deliveryTimeSlot || 'General'})
                  </div>
                )}
              </div>

              <div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-main)' }}>
                  Products to Fulfill:
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {(fulfillStockModal.stockPosition?.itemsDetail || fulfillStockModal.items || []).map((it, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        backgroundColor: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        fontSize: '0.86rem',
                      }}
                    >
                      <div>
                        <strong style={{ color: '#166534' }}>{it.productName || it.product?.name}</strong>
                        {it.variantName ? <span style={{ color: 'var(--text-muted)' }}> · {it.variantName}</span> : ''}
                      </div>
                      <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {it.totalAvailable !== undefined && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            Available: <strong style={{ color: '#16a34a' }}>{it.totalAvailable}</strong>
                          </span>
                        )}
                        <span className="badge badge-success" style={{ fontWeight: 700 }}>
                          Fulfill: {it.requestedQuantity || it.quantity}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 14px', fontSize: '0.84rem', color: '#166534' }}>
                <strong>Stock Reservation:</strong> All requested items will be deducted from available finished goods inventory. The order status will transition to <strong>READY</strong> without creating an unnecessary production batch.
              </div>

              {fulfillError && (
                <div style={{ backgroundColor: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', padding: '10px 14px', fontSize: '0.84rem', color: '#be123c' }}>
                  {fulfillError}
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setFulfillStockModal(null)}
                disabled={fulfillSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={handleConfirmFulfillFromStock}
                disabled={fulfillSubmitting}
                data-testid="fulfill-stock-confirm-btn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
              >
                {fulfillSubmitting ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                    Allocating Stock...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} /> Confirm Stock Fulfillment
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
