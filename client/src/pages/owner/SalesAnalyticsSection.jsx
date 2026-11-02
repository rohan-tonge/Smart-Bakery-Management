import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../../api/client';
import {
  TrendingUp,
  DollarSign,
  ShoppingBag,
  Calendar,
  Download,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Search,
  ArrowUpDown,
  Percent,
  Package,
  Layers,
  Info,
} from 'lucide-react';
import { formatCurrency, formatCompactCurrency } from '../../utils/currency';

const getDatePresets = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const formatYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Today (00:00:00 to 23:59:59)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // This Week (Monday of this week to today end)
  const currentDay = now.getDay(); // 0 is Sunday
  const diffToMonday = (currentDay === 0 ? -6 : 1) - currentDay;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday, 0, 0, 0, 0);

  // This Month (1st of month to today end)
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  return {
    today: {
      label: 'Today',
      from: formatYMD(todayStart),
      to: formatYMD(todayStart),
      fromIso: todayStart.toISOString(),
      toIso: todayEnd.toISOString(),
    },
    thisWeek: {
      label: 'This week',
      from: formatYMD(monday),
      to: formatYMD(todayStart),
      fromIso: monday.toISOString(),
      toIso: todayEnd.toISOString(),
    },
    thisMonth: {
      label: 'This month',
      from: formatYMD(thisMonthStart),
      to: formatYMD(todayStart),
      fromIso: thisMonthStart.toISOString(),
      toIso: todayEnd.toISOString(),
    },
  };
};

export default function SalesAnalyticsSection({ onNavigateTab }) {
  const presets = useMemo(() => getDatePresets(), []);
  const [selectedPreset, setSelectedPreset] = useState('thisMonth');
  const [customFrom, setCustomFrom] = useState(presets.thisMonth.from);
  const [customTo, setCustomTo] = useState(presets.thisMonth.to);
  const [dateError, setDateError] = useState(null);

  // Core Data
  const [summary, setSummary] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [topProducts, setTopProducts] = useState({ byUnitsSold: [], byRevenue: [] });
  const [productsData, setProductsData] = useState({ products: [], meta: { total: 0, page: 1, limit: 10, pages: 1 } });
  const [lowStockItems, setLowStockItems] = useState([]);

  // UI States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Advanced Table Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('netSales');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);

  // Date Range
  const currentRange = useMemo(() => {
    if (selectedPreset !== 'custom') {
      const p = presets[selectedPreset] || presets.thisMonth;
      return { from: p.fromIso, to: p.toIso, fromYMD: p.from, toYMD: p.to };
    }
    return {
      from: customFrom ? `${customFrom}T00:00:00.000Z` : undefined,
      to: customTo ? `${customTo}T23:59:59.999Z` : undefined,
      fromYMD: customFrom,
      toYMD: customTo,
    };
  }, [selectedPreset, customFrom, customTo, presets]);

  // Load Data
  const loadAnalytics = useCallback(async () => {
    setDateError(null);
    if (selectedPreset === 'custom') {
      if (!customFrom || !customTo) {
        setDateError('Please specify both start and end dates.');
        return;
      }
      if (new Date(customFrom) > new Date(customTo)) {
        setDateError('Start date cannot be later than end date.');
        return;
      }
    }

    setLoading(true);
    setError(null);

    const params = {
      from: currentRange.from,
      to: currentRange.to,
    };

    try {
      const [sumRes, timeRes, topRes, prodRes, lowStockRes] = await Promise.all([
        api.getSalesAnalyticsSummary(params),
        api.getSalesOverTime(params),
        api.getTopProducts({ ...params, limit: 5 }),
        api.getProductPerformance({
          ...params,
          page,
          limit: 10,
          search: searchQuery,
          sortBy,
          sortOrder,
        }),
        api.getLowStock().catch(() => ({ data: { ingredients: [] } })),
      ]);

      setSummary(sumRes.data?.summary || null);
      setTimeline(timeRes.data?.timeline || []);
      setTopProducts(topRes.data || { byUnitsSold: [], byRevenue: [] });
      setProductsData(prodRes.data || { products: [], meta: { total: 0, page: 1, limit: 10, pages: 1 } });

      const lowStockList = lowStockRes.data?.ingredients || (Array.isArray(lowStockRes.data) ? lowStockRes.data : []);
      setLowStockItems(lowStockList);
    } catch (err) {
      setError(err.message || 'Failed to load sales analytics.');
    } finally {
      setLoading(false);
    }
  }, [currentRange, selectedPreset, customFrom, customTo, page, searchQuery, sortBy, sortOrder]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // CSV Export
  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const csvText = await api.exportSalesAnalyticsCsv({
        from: currentRange.from,
        to: currentRange.to,
      });

      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      const filename = `smart-bakery-sales-${currentRange.fromYMD || 'all'}-to-${currentRange.toYMD || 'now'}.csv`;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || 'Could not export CSV report');
    } finally {
      setExporting(false);
    }
  };

  const handlePresetChange = (presetKey) => {
    setSelectedPreset(presetKey);
    setPage(1);
    if (presetKey !== 'custom' && presets[presetKey]) {
      setCustomFrom(presets[presetKey].from);
      setCustomTo(presets[presetKey].to);
    }
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const pendingPaymentsCount = summary?.pendingOrders || 0;
  const pendingPaymentsAmount = summary?.pendingPayment || 0;
  const lowStockCount = lowStockItems.length;

  return (
    <div
      className="sales-analytics-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* ========================================================================= */}
      {/* 1. HEADER & PERIOD SELECTOR */}
      {/* ========================================================================= */}
      <div
        className="card"
        style={{
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          borderRadius: 'var(--radius, 12px)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: '1.35rem',
                fontWeight: 800,
                margin: 0,
                color: 'var(--text-main, #1e293b)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <TrendingUp size={24} color="var(--primary)" />
              Sales & Profit Overview
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
              Clear summary of your revenue, profit, orders, and action items.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={loadAnalytics}
              disabled={loading}
              title="Refresh Analytics"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleExportCsv}
              disabled={exporting || loading}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Download CSV report"
            >
              <Download size={14} />
              <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
            </button>
          </div>
        </div>

        {/* Period Selector Tabs */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid var(--border-color, #e2e8f0)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginRight: '2px' }}>
              Period:
            </span>
            {Object.entries(presets).map(([key, item]) => (
              <button
                key={key}
                type="button"
                className={`btn btn-sm ${selectedPreset === key ? 'btn-primary' : 'btn-outline'}`}
                style={{
                  fontSize: '0.82rem',
                  padding: '5px 12px',
                  borderRadius: '20px',
                  border: selectedPreset === key ? 'none' : '1px solid var(--border-color, #e2e8f0)',
                  cursor: 'pointer',
                  fontWeight: selectedPreset === key ? 700 : 500,
                }}
                onClick={() => handlePresetChange(key)}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              className={`btn btn-sm ${selectedPreset === 'custom' ? 'btn-primary' : 'btn-outline'}`}
              style={{
                fontSize: '0.82rem',
                padding: '5px 12px',
                borderRadius: '20px',
                border: selectedPreset === 'custom' ? 'none' : '1px solid var(--border-color, #e2e8f0)',
                cursor: 'pointer',
                fontWeight: selectedPreset === 'custom' ? 700 : 500,
              }}
              onClick={() => handlePresetChange('custom')}
            >
              Custom Range
            </button>
          </div>

          {/* Active Range Display */}
          <div
            style={{
              fontSize: '0.82rem',
              color: 'var(--text-muted, #64748b)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Calendar size={14} />
            <span>
              {currentRange.fromYMD || 'Start'} &rarr; {currentRange.toYMD || 'Now'}
            </span>
          </div>
        </div>

        {/* Custom Date Pickers */}
        {selectedPreset === 'custom' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              background: 'var(--surface-color, #f8fafc)',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid var(--border-color, #e2e8f0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label htmlFor="custom-analytics-from" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>From:</label>
              <input
                id="custom-analytics-from"
                type="date"
                className="input-field"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '0.82rem', height: '32px' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label htmlFor="custom-analytics-to" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>To:</label>
              <input
                id="custom-analytics-to"
                type="date"
                className="input-field"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '0.82rem', height: '32px' }}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={loadAnalytics}
              style={{ height: '32px', fontSize: '0.82rem', padding: '0 12px' }}
            >
              Apply Filter
            </button>
          </div>
        )}

        {dateError && (
          <div className="alert alert-danger" style={{ margin: 0, padding: '8px 12px', fontSize: '0.82rem' }}>
            <AlertCircle size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            {dateError}
          </div>
        )}
      </div>

      {/* Global Error Banner */}
      {error && (
        <div
          className="alert alert-danger"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            margin: 0,
            padding: '12px 16px',
            borderRadius: 'var(--radius, 12px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-sm btn-outline" onClick={loadAnalytics}>
            Retry
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. FOUR PRIMARY SUMMARY CARDS */}
      {/* ========================================================================= */}
      <div
        className="analytics-kpi-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
          width: '100%',
        }}
      >
        {/* Card 1: Total Sales */}
        <div
          className="card"
          style={{
            padding: '1.25rem',
            position: 'relative',
            overflow: 'hidden',
            borderLeft: '4px solid var(--primary, #3b82f6)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            borderRadius: 'var(--radius, 12px)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: 'var(--primary, #3b82f6)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Total Sales
            </span>
            <div
              style={{
                background: 'rgba(59, 130, 246, 0.1)',
                color: 'var(--primary, #3b82f6)',
                padding: '6px',
                borderRadius: '8px',
              }}
            >
              <TrendingUp size={18} />
            </div>
          </div>
          <div
            style={{
              fontSize: '1.85rem',
              fontWeight: 800,
              marginTop: '6px',
              color: 'var(--text-main, #1e293b)',
              lineHeight: 1.2,
            }}
          >
            {loading ? '...' : formatCurrency(summary?.netSales)}
          </div>
          <div
            style={{
              fontSize: '0.78rem',
              color: 'var(--text-muted, #64748b)',
              marginTop: '6px',
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '4px',
            }}
          >
            <span>Paid & recognized revenue</span>
            {pendingPaymentsAmount > 0 && (
              <span style={{ color: '#b45309', fontWeight: 600 }}>
                · {formatCompactCurrency(pendingPaymentsAmount)} pending
              </span>
            )}
          </div>
        </div>

        {/* Card 2: Estimated / Finalized Profit */}
        <div
          className="card"
          style={{
            padding: '1.25rem',
            position: 'relative',
            overflow: 'hidden',
            borderLeft: summary?.grossProfit != null ? '4px solid var(--success, #10b981)' : '4px solid #94a3b8',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            borderRadius: 'var(--radius, 12px)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: summary?.grossProfit != null ? 'var(--success, #10b981)' : 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {summary?.cogsStatus === 'COMPUTABLE' ? 'Finalized Profit' : 'Estimated Profit'}
            </span>
            <div
              style={{
                background: summary?.grossProfit != null ? 'rgba(16, 185, 129, 0.1)' : 'rgba(148, 163, 184, 0.15)',
                color: summary?.grossProfit != null ? '#10b981' : '#64748b',
                padding: '6px',
                borderRadius: '8px',
              }}
            >
              <DollarSign size={18} />
            </div>
          </div>
          <div
            style={{
              fontSize: '1.85rem',
              fontWeight: 800,
              marginTop: '6px',
              color: summary?.grossProfit != null ? 'var(--text-main, #1e293b)' : 'var(--text-muted)',
              lineHeight: 1.2,
            }}
          >
            {loading ? '...' : summary?.grossProfit != null ? (
              formatCurrency(summary.grossProfit)
            ) : (
              <span style={{ fontSize: '1.2rem', fontWeight: 600 }}>Pending Costing</span>
            )}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', marginTop: '6px' }}>
            {summary?.cogsStatus === 'COMPUTABLE' && (
              <span style={{ color: 'var(--success, #10b981)', fontWeight: 600 }}>
                ✓ 100% verified batch costs
              </span>
            )}
            {summary?.cogsStatus === 'PARTIAL' && (
              <span style={{ color: '#b45309', fontWeight: 600 }}>
                ⚠ Partial costs ({summary.cogsCoveragePercent}% tracked)
              </span>
            )}
            {summary?.cogsStatus === 'UNAVAILABLE' && (
              <span>Requires batch cost records</span>
            )}
          </div>
        </div>

        {/* Card 3: Number of Orders */}
        <div
          className="card"
          style={{
            padding: '1.25rem',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            borderRadius: 'var(--radius, 12px)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: 'var(--text-muted, #64748b)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Number of Orders
            </span>
            <div
              style={{
                background: 'rgba(99, 102, 241, 0.1)',
                color: '#6366f1',
                padding: '6px',
                borderRadius: '8px',
              }}
            >
              <ShoppingBag size={18} />
            </div>
          </div>
          <div
            style={{
              fontSize: '1.85rem',
              fontWeight: 800,
              marginTop: '6px',
              color: 'var(--text-main, #1e293b)',
              lineHeight: 1.2,
            }}
          >
            {loading ? '...' : `${summary?.paidOrders ?? 0}`}
            <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '6px' }}>
              paid / {summary?.totalOrders ?? 0} total
            </span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', marginTop: '6px' }}>
            {summary?.pendingOrders ?? 0} pending · {summary?.cancelledOrders ?? 0} cancelled
          </div>
        </div>

        {/* Card 4: Gross Profit Margin */}
        <div
          className="card"
          style={{
            padding: '1.25rem',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            borderRadius: 'var(--radius, 12px)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: 'var(--text-muted, #64748b)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Gross Profit Margin
            </span>
            <div
              style={{
                background: 'rgba(234, 179, 8, 0.1)',
                color: '#ca8a04',
                padding: '6px',
                borderRadius: '8px',
              }}
            >
              <Percent size={18} />
            </div>
          </div>
          <div
            style={{
              fontSize: '1.85rem',
              fontWeight: 800,
              marginTop: '6px',
              color:
                summary?.grossMarginPercentage != null
                  ? summary.grossMarginPercentage >= 0
                    ? 'var(--success, #10b981)'
                    : 'var(--danger, #ef4444)'
                  : 'var(--text-muted)',
              lineHeight: 1.2,
            }}
          >
            {loading ? (
              '...'
            ) : summary?.grossMarginPercentage != null ? (
              `${summary.grossMarginPercentage}%`
            ) : (
              <span style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-muted)' }}>—</span>
            )}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', marginTop: '6px' }}>
            {summary?.cogsStatus === 'COMPUTABLE' && 'Finalized gross margin'}
            {summary?.cogsStatus === 'PARTIAL' && 'Estimated from available costs'}
            {summary?.cogsStatus === 'UNAVAILABLE' && 'Awaiting batch costing'}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. COMPACT "NEEDS ATTENTION" SECTION */}
      {/* ========================================================================= */}
      <div
        className="card"
        style={{
          padding: '1rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          borderRadius: 'var(--radius, 12px)',
          background:
            pendingPaymentsCount > 0 || lowStockCount > 0
              ? 'linear-gradient(to right, #fffbeb, #ffffff)'
              : 'var(--surface-color, #ffffff)',
          borderLeft:
            pendingPaymentsCount > 0 || lowStockCount > 0
              ? '4px solid #f59e0b'
              : '4px solid var(--success, #10b981)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3
            style={{
              fontSize: '0.95rem',
              fontWeight: 700,
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--text-main, #1e293b)',
            }}
          >
            {pendingPaymentsCount > 0 || lowStockCount > 0 ? (
              <>
                <AlertTriangle size={18} color="#d97706" />
                <span>Needs Attention</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={18} color="var(--success, #10b981)" />
                <span>All Clear</span>
              </>
            )}
          </h3>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)' }}>
            Quick action links for everyday operations
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            alignItems: 'center',
          }}
        >
          {/* Action 1: Pending Payments */}
          {pendingPaymentsCount > 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flex: '1 1 280px',
                padding: '8px 12px',
                background: '#ffffff',
                borderRadius: '8px',
                border: '1px solid #fde68a',
              }}
            >
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#92400e' }}>
                  {pendingPaymentsCount} Pending Payment{pendingPaymentsCount === 1 ? '' : 's'} ({formatCurrency(pendingPaymentsAmount)})
                </div>
                <div style={{ fontSize: '0.75rem', color: '#78350f' }}>
                  Awaiting UPI UTR or delivery collection confirmation
                </div>
              </div>
              {onNavigateTab && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => onNavigateTab('orders')}
                  style={{
                    fontSize: '0.78rem',
                    padding: '4px 10px',
                    marginLeft: '8px',
                    whiteSpace: 'nowrap',
                    borderColor: '#d97706',
                    color: '#92400e',
                  }}
                >
                  Review Orders &rarr;
                </button>
              )}
            </div>
          ) : null}

          {/* Action 2: Low Stock */}
          {lowStockCount > 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flex: '1 1 280px',
                padding: '8px 12px',
                background: '#ffffff',
                borderRadius: '8px',
                border: '1px solid #fed7aa',
              }}
            >
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#9a3412' }}>
                  {lowStockCount} Low-Stock Ingredient{lowStockCount === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#7c2d12' }}>
                  Inventory is running below recommended reorder levels
                </div>
              </div>
              {onNavigateTab && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => onNavigateTab('inventory')}
                  style={{
                    fontSize: '0.78rem',
                    padding: '4px 10px',
                    marginLeft: '8px',
                    whiteSpace: 'nowrap',
                    borderColor: '#ea580c',
                    color: '#9a3412',
                  }}
                >
                  Manage Stock &rarr;
                </button>
              )}
            </div>
          ) : null}

          {/* Status when everything is fine */}
          {pendingPaymentsCount === 0 && lowStockCount === 0 && (
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted, #64748b)', padding: '4px 0' }}>
              No pending payment approvals or low-stock alerts right now. Your store operations are in good shape!
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. PRIMARY SALES TREND CHART */}
      {/* ========================================================================= */}
      <div
        className="card"
        style={{
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          borderRadius: 'var(--radius, 12px)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3
              style={{
                fontSize: '1.05rem',
                fontWeight: 700,
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-main, #1e293b)',
              }}
            >
              <TrendingUp size={18} color="var(--primary)" />
              Sales Trend
            </h3>
            <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>
              Daily recognized sales for the selected period ({currentRange.fromYMD || 'Start'} to {currentRange.toYMD || 'Now'}).
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: 'var(--primary, #3b82f6)' }}></span>
            <span>Net Sales (₹)</span>
          </div>
        </div>

        {/* Chart Canvas Area */}
        <div style={{ minHeight: '220px', width: '100%', position: 'relative' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '220px', color: 'var(--text-muted)' }}>
              <div className="spinner" style={{ marginRight: '8px' }}></div>
              Loading sales trend...
            </div>
          ) : timeline.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '220px',
                color: 'var(--text-muted)',
              }}
            >
              <AlertCircle size={28} style={{ marginBottom: '6px', opacity: 0.5 }} />
              <p style={{ margin: 0, fontSize: '0.85rem' }}>No sales recorded for this period.</p>
            </div>
          ) : (
            <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <div style={{ minWidth: timeline.length > 8 ? `${timeline.length * 44}px` : '100%', height: '220px' }}>
                <svg
                  viewBox={`0 0 ${Math.max(timeline.length * 55, 450)} 200`}
                  width="100%"
                  height="200"
                  preserveAspectRatio="none"
                >
                  {/* Grid Lines */}
                  {[0, 50, 100, 150].map((y) => (
                    <line
                      key={y}
                      x1="40"
                      y1={y}
                      x2={Math.max(timeline.length * 55, 450)}
                      y2={y}
                      stroke="var(--border-color, #e2e8f0)"
                      strokeDasharray="3 3"
                    />
                  ))}

                  {/* Bars & Labels */}
                  {(() => {
                    const maxVal = Math.max(...timeline.map((t) => t.netSales), 100);
                    const width = Math.max(timeline.length * 55, 450) - 50;
                    const step = width / timeline.length;

                    return timeline.map((item, idx) => {
                      const barH = (item.netSales / maxVal) * 140;
                      const x = 45 + idx * step;
                      const y = 160 - barH;
                      const barW = Math.max(step * 0.55, 12);

                      return (
                        <g key={item.period} className="chart-bar-group">
                          <rect
                            x={x}
                            y={y}
                            width={barW}
                            height={Math.max(barH, 2)}
                            fill="var(--primary, #3b82f6)"
                            rx="3"
                            style={{ transition: 'all 0.2s ease', cursor: 'pointer' }}
                          >
                            <title>{`${item.period}: ${formatCurrency(item.netSales)} (${item.paidOrders || 0} orders)`}</title>
                          </rect>
                          <text
                            x={x + barW / 2}
                            y="180"
                            fontSize="10"
                            textAnchor="middle"
                            fill="var(--text-muted, #64748b)"
                            transform={`rotate(-25, ${x + barW / 2}, 180)`}
                          >
                            {item.period.length > 10 ? item.period.slice(5) : item.period}
                          </text>
                        </g>
                      );
                    });
                  })()}
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 5. COLLAPSIBLE "ADVANCED ANALYTICS & PRODUCT DETAILS" SECTION */}
      {/* ========================================================================= */}
      <div
        className="card"
        style={{
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          borderRadius: 'var(--radius, 12px)',
        }}
      >
        {/* Toggle Button */}
        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            cursor: 'pointer',
            textAlign: 'left',
          }}
          aria-expanded={showAdvanced}
        >
          <div>
            <h3
              style={{
                fontSize: '1.05rem',
                fontWeight: 700,
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-main, #1e293b)',
              }}
            >
              <Layers size={18} color="var(--primary)" />
              Advanced Analytics & Product Profitability
            </h3>
            <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>
              Detailed top sellers, payment status breakdown, and per-item margin table.
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.82rem',
              fontWeight: 600,
              color: 'var(--primary)',
            }}
          >
            <span>{showAdvanced ? 'Hide Details' : 'Show Details'}</span>
            {showAdvanced ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>
        </button>

        {showAdvanced && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingTop: '0.5rem' }}>
            {/* 5A. TOP PRODUCTS RANKING */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '1rem',
              }}
            >
              {/* By Units Sold */}
              <div
                style={{
                  background: 'var(--surface-color, #f8fafc)',
                  padding: '1.25rem',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color, #e2e8f0)',
                }}
              >
                <h4
                  style={{
                    fontSize: '0.92rem',
                    fontWeight: 700,
                    margin: '0 0 1rem 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: 'var(--text-main, #1e293b)',
                  }}
                >
                  <Package size={16} color="var(--primary)" />
                  Top Products by Units Sold
                </h4>
                {topProducts.byUnitsSold.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                    No product units sold in this period.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {topProducts.byUnitsSold.map((p, idx) => {
                      const maxUnits = topProducts.byUnitsSold[0]?.unitsSold || 1;
                      const pct = Math.round((p.unitsSold / maxUnits) * 100);
                      return (
                        <div key={`${p.productId}-${p.variantId}`}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-main, #1e293b)' }}>
                              {idx + 1}. {p.productName} ({p.variantName})
                            </span>
                            <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{p.unitsSold} units</span>
                          </div>
                          <div style={{ height: '6px', background: 'rgba(0,0,0,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--primary)', borderRadius: '3px' }}></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* By Revenue */}
              <div
                style={{
                  background: 'var(--surface-color, #f8fafc)',
                  padding: '1.25rem',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color, #e2e8f0)',
                }}
              >
                <h4
                  style={{
                    fontSize: '0.92rem',
                    fontWeight: 700,
                    margin: '0 0 1rem 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: 'var(--text-main, #1e293b)',
                  }}
                >
                  <DollarSign size={16} color="#10b981" />
                  Top Products by Revenue
                </h4>
                {topProducts.byRevenue.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                    No revenue data in this period.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {topProducts.byRevenue.map((p, idx) => {
                      const maxRev = topProducts.byRevenue[0]?.netSales || 1;
                      const pct = Math.round((p.netSales / maxRev) * 100);
                      return (
                        <div key={`${p.productId}-${p.variantId}`}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-main, #1e293b)' }}>
                              {idx + 1}. {p.productName} ({p.variantName})
                            </span>
                            <span style={{ fontWeight: 700, color: 'var(--success, #10b981)' }}>{formatCurrency(p.netSales)}</span>
                          </div>
                          <div style={{ height: '6px', background: 'rgba(0,0,0,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: '#10b981', borderRadius: '3px' }}></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 5B. PAYMENT & COST BREAKDOWN */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '1rem',
                background: 'var(--surface-color, #f8fafc)',
                padding: '1.25rem',
                borderRadius: '10px',
                border: '1px solid var(--border-color, #e2e8f0)',
              }}
            >
              <div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.75rem 0', color: 'var(--text-main, #1e293b)' }}>
                  Revenue Recognition Breakdown
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Gross Sales:</span>
                    <span style={{ fontWeight: 600 }}>{formatCurrency(summary?.grossSales)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Discounts Given:</span>
                    <span style={{ fontWeight: 600, color: '#dc2626' }}>- {formatCurrency(summary?.discount)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Refunds Processed:</span>
                    <span style={{ fontWeight: 600, color: '#dc2626' }}>- {formatCurrency(summary?.refund)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '6px' }}>
                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>Net Recognized Revenue:</span>
                    <span style={{ fontWeight: 800, color: 'var(--primary)' }}>{formatCurrency(summary?.netSales)}</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.75rem 0', color: 'var(--text-main, #1e293b)' }}>
                  Cost & Profit Logic (COGS)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Cost of Goods Sold (COGS):</span>
                    <span style={{ fontWeight: 600 }}>{summary?.cogs != null ? formatCurrency(summary.cogs) : 'Pending batch costs'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Costing Coverage:</span>
                    <span style={{ fontWeight: 600 }}>
                      {summary?.cogsCoveragePercent != null ? `${summary.cogsCoveragePercent}% of units` : '0%'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '6px' }}>
                    <span style={{ fontWeight: 700, color: summary?.grossProfit != null ? 'var(--success)' : 'var(--text-muted)' }}>
                      Gross Profit:
                    </span>
                    <span style={{ fontWeight: 800, color: summary?.grossProfit != null ? 'var(--success)' : 'var(--text-muted)' }}>
                      {summary?.grossProfit != null ? formatCurrency(summary.grossProfit) : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 5C. PRODUCT PERFORMANCE TABLE */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--text-main, #1e293b)' }}>
                    Item Performance & Margin Details
                  </h4>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Filter and sort individual product sales, costs, and profit contributions.
                  </p>
                </div>

                {/* Search Box */}
                <div style={{ position: 'relative', minWidth: '220px' }}>
                  <Search
                    size={14}
                    style={{
                      position: 'absolute',
                      left: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                    }}
                  />
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Search product..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    style={{ paddingLeft: '30px', height: '32px', fontSize: '0.8rem', width: '100%' }}
                  />
                </div>
              </div>

              {/* Table Wrapper */}
              <div style={{ overflowX: 'auto', width: '100%', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '700px' }}>
                  <thead>
                    <tr
                      style={{
                        borderBottom: '2px solid var(--border-color, #e2e8f0)',
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                      }}
                    >
                      <th style={{ padding: '8px', cursor: 'pointer' }} onClick={() => handleSort('productName')}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          Product & Variant <ArrowUpDown size={12} />
                        </div>
                      </th>
                      <th style={{ padding: '8px', textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('unitsSold')}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                          Units <ArrowUpDown size={12} />
                        </div>
                      </th>
                      <th style={{ padding: '8px', textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('orderCount')}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                          Orders <ArrowUpDown size={12} />
                        </div>
                      </th>
                      <th style={{ padding: '8px', textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('netSales')}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                          Net Sales <ArrowUpDown size={12} />
                        </div>
                      </th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>COGS</th>
                      <th style={{ padding: '8px', textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('grossProfit')}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                          Profit <ArrowUpDown size={12} />
                        </div>
                      </th>
                      <th style={{ padding: '8px', textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('grossMargin')}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                          Margin <ArrowUpDown size={12} />
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem 0', color: 'var(--text-muted)' }}>
                          Loading product data...
                        </td>
                      </tr>
                    ) : productsData.products.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem 0', color: 'var(--text-muted)' }}>
                          No products found matching criteria.
                        </td>
                      </tr>
                    ) : (
                      productsData.products.map((item) => (
                        <tr
                          key={`${item.productId}-${item.variantId}`}
                          style={{ borderBottom: '1px solid var(--border-color, #f1f5f9)', fontSize: '0.82rem' }}
                        >
                          <td style={{ padding: '8px' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-main, #1e293b)' }}>{item.productName}</div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{item.variantName}</div>
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{item.unitsSold}</td>
                          <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text-muted)' }}>{item.orderCount}</td>
                          <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                            {formatCurrency(item.netSales)}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>
                            {item.cogs != null ? (
                              formatCurrency(item.cogs)
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>
                            {item.grossProfit != null ? (
                              <span style={{ color: item.grossProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                {formatCurrency(item.grossProfit)}
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>
                            {item.grossMarginPercentage != null ? (
                              <span style={{ color: item.grossMarginPercentage >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                {item.grossMarginPercentage}%
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {productsData.meta.pages > 1 && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '0.5rem',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                  }}
                >
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Showing {(page - 1) * 10 + 1} to {Math.min(page * 10, productsData.meta.total)} of {productsData.meta.total} products
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={page <= 1}
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                      style={{ fontSize: '0.78rem', padding: '3px 8px' }}
                    >
                      Previous
                    </button>
                    <span style={{ padding: '3px 8px', fontSize: '0.8rem', fontWeight: 600 }}>
                      {page} / {productsData.meta.pages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={page >= productsData.meta.pages}
                      onClick={() => setPage((prev) => Math.min(productsData.meta.pages, prev + 1))}
                      style={{ fontSize: '0.78rem', padding: '3px 8px' }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 5D. PLAIN DEFINITIONS */}
            <div
              style={{
                background: 'rgba(59, 130, 246, 0.04)',
                border: '1px solid rgba(59, 130, 246, 0.15)',
                padding: '1rem',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                fontSize: '0.78rem',
                color: 'var(--text-muted, #64748b)',
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--text-main, #1e293b)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Info size={15} color="var(--primary)" /> How these figures are calculated
              </div>
              <div>&bull; <strong>Total Sales (Net Revenue):</strong> Completed and paid customer orders minus any discounts or refunds. Pending payments are excluded until verified.</div>
              <div>&bull; <strong>Profit & Cost of Goods Sold (COGS):</strong> Deducts the actual ingredient batch costs from your recipe batches. If batches haven't been completed yet, profit is labelled as estimated.</div>
              <div>&bull; <strong>Pending Payments:</strong> Customer orders where cash is due on delivery or a UPI payment reference is awaiting your verification.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
