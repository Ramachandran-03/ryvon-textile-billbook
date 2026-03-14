import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Plus, Search, PackagePlus } from 'lucide-react';
import { format } from 'date-fns';

interface Product {
  id: string;
  name: string;
  sku: string;
  variants: { id: string; size: string; color: string; stock: number; price: number; cost: number }[];
}

export default function Purchases() {
  const { activeShop } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // New Purchase State
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [purchaseItems, setPurchaseItems] = useState<any[]>([]);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      let prodQuery = collection(db, 'products') as any;
      let purQuery = collection(db, 'purchases') as any;

      if (activeShop) {
        prodQuery = query(prodQuery, where('shopId', '==', activeShop.id));
        purQuery = query(purQuery, where('shopId', '==', activeShop.id));
      }

      const [prodSnap, purSnap] = await Promise.all([
        getDocs(prodQuery),
        getDocs(purQuery)
      ]);
      setProducts(prodSnap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as Product)));
      setPurchases(purSnap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as any)).sort((a: any, b: any) => b.createdAt?.toMillis() - a.createdAt?.toMillis()));
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeShop]);

  const handleAddItem = () => {
    if (!selectedProduct) return;
    const prod = products.find(p => p.id === selectedProduct);
    if (!prod || prod.variants.length === 0) return;
    
    setPurchaseItems([...purchaseItems, {
      productId: prod.id,
      productName: prod.name,
      variantId: prod.variants[0].id,
      quantity: 1,
      cost: prod.variants[0].cost || 0,
      total: prod.variants[0].cost || 0
    }]);
    setSelectedProduct('');
  };

  const updateItem = (index: number, field: string, value: number) => {
    const newItems = [...purchaseItems];
    newItems[index][field] = value;
    newItems[index].total = newItems[index].quantity * newItems[index].cost;
    setPurchaseItems(newItems);
  };

  const removeItem = (index: number) => {
    setPurchaseItems(purchaseItems.filter((_, i) => i !== index));
  };

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShop || purchaseItems.length === 0) return setAlertMessage('Add items to purchase');

    try {
      const totalCost = purchaseItems.reduce((sum, item) => sum + item.total, 0);
      
      const purchaseData = {
        shopId: activeShop.id,
        supplierName,
        invoiceNumber,
        items: purchaseItems,
        totalCost,
        createdAt: serverTimestamp(),
        createdBy: 'Admin'
      };

      await addDoc(collection(db, 'purchases'), purchaseData);

      // Update Product Stock and Cost
      for (const item of purchaseItems) {
        const prod = products.find(p => p.id === item.productId);
        if (prod) {
          const updatedVariants = prod.variants.map(v => {
            if (v.id === item.variantId) {
              return { ...v, stock: v.stock + item.quantity, cost: item.cost }; // Update cost to latest purchase price
            }
            return v;
          });
          await updateDoc(doc(db, 'products', prod.id), { variants: updatedVariants, updatedAt: serverTimestamp() });
        }
      }

      setIsModalOpen(false);
      setSupplierName('');
      setInvoiceNumber('');
      setPurchaseItems([]);
      fetchData();
      setAlertMessage('Purchase recorded and stock updated!');
    } catch (error) {
      console.error("Error saving purchase:", error);
      setAlertMessage("Failed to save purchase.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Purchases & Inward Stock</h1>
        {activeShop && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            <PackagePlus size={20} className="mr-2" /> Record Purchase
          </button>
        )}
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice No</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Cost</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-4 text-center">Loading...</td></tr>
            ) : purchases.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-4 text-center text-gray-500">No purchases recorded.</td></tr>
            ) : (
              purchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {purchase.createdAt ? format(purchase.createdAt.toDate(), 'dd MMM yyyy') : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{purchase.supplierName}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{purchase.invoiceNumber}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{purchase.items.length} items</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">₹{purchase.totalCost?.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Record Purchase (Inward Stock)</h2>
            <form onSubmit={handleSavePurchase} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Supplier Name</label>
                  <input required value={supplierName} onChange={e => setSupplierName(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Supplier Invoice No.</label>
                  <input required value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <h3 className="text-md font-medium mb-2">Add Items to Purchase</h3>
                <div className="flex gap-2">
                  <select 
                    value={selectedProduct} 
                    onChange={e => setSelectedProduct(e.target.value)}
                    className="flex-1 border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                  >
                    <option value="">Select Product...</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                  </select>
                  <button type="button" onClick={handleAddItem} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">Add</button>
                </div>
              </div>

              {purchaseItems.length > 0 && (
                <div className="mt-4">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Qty</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Unit Cost</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Total</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {purchaseItems.map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-2 text-sm">{item.productName}</td>
                          <td className="px-4 py-2">
                            <input type="number" min="1" required value={item.quantity} onChange={e => updateItem(idx, 'quantity', Number(e.target.value))} className="w-20 border rounded p-1 text-sm" />
                          </td>
                          <td className="px-4 py-2">
                            <input type="number" min="0" step="0.01" required value={item.cost} onChange={e => updateItem(idx, 'cost', Number(e.target.value))} className="w-24 border rounded p-1 text-sm" />
                          </td>
                          <td className="px-4 py-2 text-sm font-medium">₹{item.total.toFixed(2)}</td>
                          <td className="px-4 py-2 text-right">
                            <button type="button" onClick={() => removeItem(idx)} className="text-red-500 text-sm">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="text-right mt-4 font-bold text-lg">
                    Total Purchase Value: ₹{purchaseItems.reduce((sum, item) => sum + item.total, 0).toFixed(2)}
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-3 mt-6">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700">Save Purchase</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertMessage && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Notification</h3>
            <p className="text-sm text-gray-500 mb-6 whitespace-pre-wrap">
              {alertMessage}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setAlertMessage(null)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
