import React, { useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, ClipboardList, Package, Plus, RefreshCw, Save, ShoppingBag, Warehouse } from 'lucide-react';
import { api } from '../../api/client';

const sections = [
  { id: 'overview', label: 'Operations overview', icon: BarChart3 },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'menu', label: 'Products & categories', icon: Package },
  { id: 'inventory', label: 'Inventory', icon: Warehouse },
  { id: 'purchases', label: 'Purchases', icon: ClipboardList },
  { id: 'reports', label: 'Operational reports', icon: BarChart3 },
];

export default function ManagerDashboard() {
  const [section, setSection] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [reports, setReports] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);
  const [productForm, setProductForm] = useState({ name: '', category: '', imageUrl: '', price: '', description: '' });
  const [categoryForm, setCategoryForm] = useState({ name: '', imageUrl: '', description: '' });
  const [receipt, setReceipt] = useState({ vendor: '', ingredient: '', quantity: '', unitPrice: '', lotNumber: '', expiryDate: '', invoiceNumber: '' });

  const announce = (message) => { setNotice(message); window.setTimeout(() => setNotice(''), 3500); };
  const load = async (target = section) => {
    setLoading(true);
    setError('');
    try {
      if (target === 'overview') {
        const [o, l, b] = await Promise.all([api.getAllOrders(), api.getLowStock(), api.getBatches()]);
        setOrders(o.data?.orders || o.data || []);
        setLowStock(l.data?.ingredients || l.data?.items || l.data || []);
        setReports({ batches: b.data?.batches || b.data || [], orderMeta: o.meta });
      } else if (target === 'orders') {
        const response = await api.getAllOrders();
        setOrders(response.data?.orders || response.data || []);
      } else if (target === 'menu') {
        const [p, c] = await Promise.all([api.getProducts(), api.getCategories()]);
        setProducts(p.data?.products || p.data || []);
        setCategories(c.data?.categories || c.data || []);
      } else if (target === 'inventory') {
        const [i, l] = await Promise.all([api.getInventory(), api.getLowStock()]);
        setInventory(i.data?.inventory || i.data || []);
        setLowStock(l.data?.ingredients || l.data?.items || l.data || []);
      } else if (target === 'purchases') {
        const [v, i, p] = await Promise.all([api.getVendors(), api.getIngredients(), api.getPurchases()]);
        setVendors(v.data?.vendors || v.data || []);
        setIngredients(i.data?.ingredients || i.data || []);
        setPurchases(p.data?.purchases || p.data || []);
      } else if (target === 'reports') {
        const [o, p, i, b] = await Promise.all([api.getOrdersReport(), api.getProductsReport(), api.getInventoryReport(), api.getProductionReport()]);
        const orderReport = o.data?.orders || o.data || {};
        const productRows = p.data?.products || p.data || [];
        const inventoryReport = i.data?.inventory || i.data || {};
        const productionReport = b.data?.production || b.data || {};
        setReports({
          orders: { totalOrders: orderReport.totalOrders, byStatus: orderReport.byStatus, byPaymentStatus: orderReport.byPaymentStatus, byFulfillmentType: orderReport.byFulfillmentType, cancelledOrders: orderReport.cancelledOrders, trend: orderReport.trend },
          products: productRows.map((row) => ({ productName: row.productName, variantName: row.variantName, quantitySold: row.quantitySold, orderCount: row.orderCount, productionQuantity: row.productionQuantity, wastageQuantity: row.wastageQuantity, wastageRate: row.wastageRate })),
          inventory: { lowStockCount: inventoryReport.lowStockCount, expiringLotCount: inventoryReport.expiringLotCount, transactionCount: inventoryReport.transactionCount, stockAddedByUnit: inventoryReport.stockAddedByUnit, stockConsumedByUnit: inventoryReport.stockConsumedByUnit, wastageByUnit: inventoryReport.wastageByUnit },
          production: { totalBatches: productionReport.totalBatches, byStatus: productionReport.byStatus, completedBatches: productionReport.completedBatches, packagedBatches: productionReport.packagedBatches, packagingBatches: productionReport.packagingBatches, deliveredBatches: productionReport.deliveredBatches, plannedQuantity: productionReport.plannedQuantity, producedQuantity: productionReport.producedQuantity, usableQuantity: productionReport.usableQuantity, wastageQuantity: productionReport.wastageQuantity, averageDurationMinutes: productionReport.averageDurationMinutes, trend: productionReport.trend },
        });
      }
    } catch (loadError) {
      setError(loadError.message || 'Could not load this workspace section.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(section); }, [section]);

  const updateStatus = async (order, status) => {
    try { await api.updateOrderStatus(order._id, status); announce(`Order ${order.orderNumber} updated.`); await load('orders'); }
    catch (e) { setError(e.message); }
  };
  const verifyPayment = async (order) => {
    try { await api.confirmPayment(order._id, 'Verified in bakery UPI account'); announce(`Payment for ${order.orderNumber} confirmed.`); await load('orders'); }
    catch (e) { setError(e.message); }
  };
  const rejectPayment = async (order) => {
    if (!window.confirm(`Reject payment for ${order.orderNumber} and cancel the order?`)) return;
    try { await api.rejectPayment(order._id, 'Payment could not be verified by the bakery'); announce(`Payment for ${order.orderNumber} rejected.`); await load('orders'); }
    catch (e) { setError(e.message); }
  };
  const saveProduct = async (event) => {
    event.preventDefault();
    try {
      const payload = { name: productForm.name.trim(), category: productForm.category, imageUrl: productForm.imageUrl.trim(), description: productForm.description.trim() || undefined, basePrice: Number(productForm.price) };
      if (editingProduct) await api.updateProduct(editingProduct, payload);
      else {
        const response = await api.createProduct(payload);
        const item = response.data?.product || response.data;
        if (item?._id) await api.addVariant(item._id, { name: 'Regular', quantity: 1, unit: 'piece', price: Number(productForm.price) });
      }
      setEditingProduct(null); setProductForm({ name: '', category: '', imageUrl: '', price: '', description: '' });
      announce('Product saved.'); await load('menu');
    } catch (e) { setError(e.message); }
  };
  const editProduct = (product) => {
    setEditingProduct(product._id);
    setProductForm({ name: product.name || '', category: product.category?._id || product.category || '', imageUrl: product.imageUrl || product.images?.[0] || '', price: product.basePrice ?? product.variants?.[0]?.price ?? '', description: product.description || '' });
  };
  const saveCategory = async (event) => {
    event.preventDefault();
    try {
      const payload = { name: categoryForm.name.trim(), imageUrl: categoryForm.imageUrl.trim(), description: categoryForm.description.trim() || undefined };
      if (editingCategory) await api.updateCategory(editingCategory, payload); else await api.createCategory(payload);
      setEditingCategory(null); setCategoryForm({ name: '', imageUrl: '', description: '' });
      announce('Category saved.'); await load('menu');
    } catch (e) { setError(e.message); }
  };
  const editCategory = (category) => { setEditingCategory(category._id); setCategoryForm({ name: category.name || '', imageUrl: category.imageUrl || category.image || '', description: category.description || '' }); };
  const saveReceipt = async (event) => {
    event.preventDefault();
    const ingredient = ingredients.find((item) => item._id === receipt.ingredient);
    try {
      await api.createPurchase({ vendor: receipt.vendor, purchaseDate: new Date(), invoiceNumber: receipt.invoiceNumber.trim() || undefined, items: [{ ingredient: receipt.ingredient, quantity: Number(receipt.quantity), unit: ingredient?.unit || 'kg', unitPrice: Number(receipt.unitPrice || 0), lotNumber: receipt.lotNumber.trim(), expiryDate: receipt.expiryDate ? new Date(receipt.expiryDate) : undefined }] });
      setReceipt({ vendor: '', ingredient: '', quantity: '', unitPrice: '', lotNumber: '', expiryDate: '', invoiceNumber: '' });
      announce('Purchase recorded and stock received.'); await load('purchases');
    } catch (e) { setError(e.message); }
  };

  return <div className="manager-dashboard container">
    <header className="manager-header"><div><span className="eyebrow">Operations</span><h1>Manager workspace</h1><p>Orders, catalog, stock and purchasing operations.</p></div><button className="btn btn-outline btn-sm" onClick={() => load()} disabled={loading}><RefreshCw size={15} /> Refresh</button></header>
    {notice && <div className="alert alert-success" role="status">{notice}</div>}
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    <div className="manager-workspace">
      <nav className="manager-nav" aria-label="Manager workspace navigation">{sections.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setSection(id)} className={`manager-nav-item ${section === id ? 'active' : ''}`} aria-current={section === id ? 'page' : undefined}><Icon size={17} />{label}</button>)}</nav>
      <main className="manager-content" aria-live="polite">
        {loading ? <div className="manager-state">Loading {sections.find((item) => item.id === section)?.label.toLowerCase()}…</div> : null}
        {!loading && section === 'overview' && <div className="manager-metrics"><article className="card manager-metric"><span>Open orders</span><strong>{reports?.orderMeta?.counts?.active ?? orders.filter((o) => !['COMPLETED', 'DELIVERED', 'CANCELLED', 'EXPIRED'].includes(o.status)).length}</strong><small>{(reports?.orderMeta?.counts?.total ?? orders.length) > 0 ? `${reports?.orderMeta?.counts?.active ?? orders.filter((o) => !['COMPLETED', 'DELIVERED', 'CANCELLED', 'EXPIRED'].includes(o.status)).length} active · ${reports?.orderMeta?.counts?.total ?? orders.length} total orders` : 'No orders placed yet'}</small></article><article className="card manager-metric"><span>Low stock alerts</span><strong>{lowStock.length}</strong><small>{lowStock.length ? 'Items need attention' : 'Stock levels look good'}</small></article><article className="card manager-metric"><span>Open production batches</span><strong>{(reports?.batches || []).filter((batch) => !['COMPLETED', 'DELIVERED', 'CANCELLED', 'REJECTED'].includes(batch.status)).length}</strong><small>{(reports?.batches || []).length > 0 ? `${(reports?.batches || []).filter((batch) => !['COMPLETED', 'DELIVERED', 'CANCELLED', 'REJECTED'].includes(batch.status)).length} active · ${(reports?.batches || []).length} total batches` : 'Current kitchen workload'}</small></article><div className="card manager-panel"><h2>Recent orders</h2>{orders.slice(0, 6).map((order) => <div className="manager-list-row" key={order._id}><strong>{order.orderNumber}</strong><span>{order.contactName || 'Customer'}</span><span className="badge badge-info">{order.status}</span></div>)}{!orders.length && <p>No customer orders placed yet.</p>}</div></div>}
        {!loading && section === 'orders' && <section className="manager-panel card"><h2>Order operations</h2>{orders.map((order) => <article className="manager-order" key={order._id}><div><strong>{order.orderNumber}</strong><p>{order.contactName || 'Customer'} · {order.items?.map((item) => `${item.productName} × ${item.quantity}`).join(', ')}</p><small>Payment: {order.paymentStatus}</small></div><div className="manager-order-actions">{order.paymentMethod === 'MANUAL_UPI' && order.paymentStatus === 'PENDING_VERIFICATION' && <><button className="btn btn-primary btn-sm" onClick={() => verifyPayment(order)}>Verify payment</button><button className="btn btn-outline btn-sm" onClick={() => rejectPayment(order)}>Reject & cancel</button></>}<select aria-label={`Update status for ${order.orderNumber}`} className="input-field" value={order.status} onChange={(event) => updateStatus(order, event.target.value)} disabled={order.status === 'PENDING_PAYMENT'}><option value={order.status}>{order.status}</option>{['CONFIRMED', 'IN_PRODUCTION', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].filter((status) => status !== order.status).map((status) => <option key={status}>{status}</option>)}</select></div></article>)}{!orders.length && <p>No orders are available.</p>}</section>}
        {!loading && section === 'menu' && <div className="manager-columns"><section className="manager-panel card"><h2>Menu catalog</h2>{products.map((product) => <div className="manager-list-row" key={product._id}><span><strong>{product.name}</strong><small>{product.category?.name || 'Category not set'}</small></span><button className="btn btn-outline btn-sm" onClick={() => editProduct(product)}>Edit</button></div>)}{!products.length && <p>No products yet.</p>}<form className="manager-form" onSubmit={saveProduct}><h3>{editingProduct ? 'Edit product' : 'Add product'}</h3><input className="input-field" required placeholder="Product name" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} /><select className="input-field" required value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}><option value="">Choose category</option>{categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}</select><input className="input-field" type="number" min="0" step="0.01" required placeholder="Price" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} /><input className="input-field" type="url" placeholder="Product image URL (https://…)" value={productForm.imageUrl} onChange={(e) => setProductForm({ ...productForm, imageUrl: e.target.value })} /><textarea className="input-field" placeholder="Description" value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} /><button className="btn btn-primary" type="submit"><Save size={16} />{editingProduct ? 'Save product' : 'Create product'}</button></form></section><section className="manager-panel card"><h2>Categories</h2>{categories.map((category) => <div className="manager-list-row" key={category._id}><strong>{category.name}</strong><button className="btn btn-outline btn-sm" onClick={() => editCategory(category)}>Edit</button></div>)}{!categories.length && <p>No categories yet.</p>}<form className="manager-form" onSubmit={saveCategory}><h3>{editingCategory ? 'Edit category' : 'Add category'}</h3><input className="input-field" required placeholder="Category name" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} /><input className="input-field" type="url" placeholder="Category image URL (https://…)" value={categoryForm.imageUrl} onChange={(e) => setCategoryForm({ ...categoryForm, imageUrl: e.target.value })} /><textarea className="input-field" placeholder="Description" value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} /><button className="btn btn-primary" type="submit"><Plus size={16} />{editingCategory ? 'Save category' : 'Create category'}</button></form></section></div>}
        {!loading && section === 'inventory' && <section className="manager-panel card"><h2>Inventory</h2>{lowStock.length > 0 && <div className="alert alert-warning"><AlertTriangle size={17} /> {lowStock.length} ingredient(s) are below their safety level.</div>}{inventory.map((item, index) => <div className="manager-list-row" key={item._id || item.ingredient?._id || index}><strong>{item.ingredient?.name || item.name || 'Ingredient'}</strong><span>{item.available ?? item.currentStock ?? item.quantity ?? 0} {item.ingredient?.unit || item.unit}</span></div>)}{!inventory.length && <p>No inventory rows are available.</p>}</section>}
        {!loading && section === 'purchases' && <div className="manager-columns"><section className="manager-panel card"><h2>Receive a purchase</h2><form className="manager-form" onSubmit={saveReceipt}><select required className="input-field" value={receipt.vendor} onChange={(e) => setReceipt({ ...receipt, vendor: e.target.value })}><option value="">Choose supplier</option>{vendors.map((vendor) => <option key={vendor._id} value={vendor._id}>{vendor.name}</option>)}</select><select required className="input-field" value={receipt.ingredient} onChange={(e) => setReceipt({ ...receipt, ingredient: e.target.value })}><option value="">Choose ingredient</option>{ingredients.map((ingredient) => <option key={ingredient._id} value={ingredient._id}>{ingredient.name} ({ingredient.unit})</option>)}</select><input required className="input-field" type="number" min="0.01" step="0.01" placeholder="Quantity" value={receipt.quantity} onChange={(e) => setReceipt({ ...receipt, quantity: e.target.value })} /><input required className="input-field" type="number" min="0" step="0.01" placeholder="Unit price" value={receipt.unitPrice} onChange={(e) => setReceipt({ ...receipt, unitPrice: e.target.value })} /><input required className="input-field" placeholder="Lot number" value={receipt.lotNumber} onChange={(e) => setReceipt({ ...receipt, lotNumber: e.target.value })} /><input className="input-field" type="date" aria-label="Expiry date" value={receipt.expiryDate} onChange={(e) => setReceipt({ ...receipt, expiryDate: e.target.value })} /><input className="input-field" placeholder="Invoice number" value={receipt.invoiceNumber} onChange={(e) => setReceipt({ ...receipt, invoiceNumber: e.target.value })} /><button className="btn btn-primary" type="submit"><Plus size={16} />Receive stock</button></form></section><section className="manager-panel card"><h2>Recent purchases</h2>{purchases.map((purchase) => <div className="manager-list-row" key={purchase._id}><span><strong>{purchase.vendor?.name || 'Supplier'}</strong><small>{new Date(purchase.purchaseDate).toLocaleDateString()} · {purchase.items?.length || 0} line(s)</small></span><span>{purchase.invoiceNumber || 'No invoice'}</span></div>)}{!purchases.length && <p>No purchase records available.</p>}</section></div>}
        {!loading && section === 'reports' && <section className="manager-panel card"><h2>Operational reports</h2>{reports && Object.entries(reports).map(([key, report]) => <article className="manager-report" key={key}><h3>{key[0].toUpperCase() + key.slice(1)}</h3><pre>{JSON.stringify(report, null, 2)}</pre></article>)}</section>}
      </main>
    </div>
  </div>;
}
