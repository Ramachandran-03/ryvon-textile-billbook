import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Search, Plus, Minus, Trash2, Printer } from 'lucide-react';
import { format } from 'date-fns';

interface Product {
  id: string;
  name: string;
  sku: string;
  taxRate: number;
  variants: { id: string; size: string; color: string; stock: number; price: number }[];
}

interface CartItem {
  productId: string;
  productName: string;
  variantId: string;
  size: string;
  color: string;
  quantity: number;
  price: number;
  cost: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
}

export default function POS() {
  const { profile, activeShop } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!activeShop) return;
      const [prodSnap, custSnap] = await Promise.all([
        getDocs(query(collection(db, 'products'), where('shopId', '==', activeShop.id))),
        getDocs(query(collection(db, 'customers'), where('shopId', '==', activeShop.id)))
      ]);
      setProducts(prodSnap.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
      setCustomers(custSnap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
    };
    fetchData();
    searchInputRef.current?.focus();
  }, [activeShop]);

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchTerm) {
      // Find product by SKU (barcode scanner)
      const product = products.find(p => p.sku === searchTerm);
      if (product && product.variants.length > 0) {
        addToCart(product, product.variants[0]);
        setSearchTerm('');
      } else {
        setAlertMessage('Product not found or no variants available.');
      }
    }
  };

  const addToCart = (product: Product, variant: any) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id && item.variantId === variant.id);
      if (existing) {
        if (existing.quantity >= variant.stock) {
          setAlertMessage('Not enough stock!');
          return prev;
        }
        return prev.map(item => {
          if (item.productId === product.id && item.variantId === variant.id) {
            const newQty = item.quantity + 1;
            const newTotal = newQty * item.price;
            const newTax = (newTotal * item.taxRate) / 100;
            return { ...item, quantity: newQty, total: newTotal, taxAmount: newTax };
          }
          return item;
        });
      }
      
      const total = variant.price;
      const taxAmount = (total * product.taxRate) / 100;
      return [...prev, {
        productId: product.id,
        productName: product.name,
        variantId: variant.id,
        size: variant.size,
        color: variant.color,
        quantity: 1,
        price: variant.price,
        cost: variant.cost || 0,
        taxRate: product.taxRate,
        taxAmount,
        total
      }];
    });
  };

  const updateQuantity = (index: number, delta: number) => {
    setCart(prev => {
      const newCart = [...prev];
      const item = newCart[index];
      const newQty = item.quantity + delta;
      
      if (newQty <= 0) {
        newCart.splice(index, 1);
      } else {
        item.quantity = newQty;
        item.total = newQty * item.price;
        item.taxAmount = (item.total * item.taxRate) / 100;
      }
      return newCart;
    });
  };

  const subtotal = cart.reduce((sum, item) => sum + item.total, 0);
  const taxTotal = cart.reduce((sum, item) => sum + item.taxAmount, 0);
  const grandTotal = subtotal + taxTotal;

  const handleCheckout = async () => {
    if (cart.length === 0) return setAlertMessage('Cart is empty');
    if (!selectedCustomer) return setAlertMessage('Please select a customer');
    if (!activeShop) return setAlertMessage('No shop selected');

    setIsProcessing(true);
    try {
      const invoiceNumber = `INV-${Date.now()}`;
      const invoiceData = {
        shopId: activeShop.id,
        invoiceNumber,
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        items: cart,
        subtotal,
        taxTotal,
        grandTotal,
        status: 'paid',
        paymentMethod,
        createdAt: serverTimestamp(),
        createdBy: profile?.name || 'Unknown',
      };

      await addDoc(collection(db, 'invoices'), invoiceData);

      // Update stock and customer balance
      for (const item of cart) {
        const product = products.find(p => p.id === item.productId);
        if (product) {
          const updatedVariants = product.variants.map(v => {
            if (v.id === item.variantId) {
              return { ...v, stock: v.stock - item.quantity };
            }
            return v;
          });
          await updateDoc(doc(db, 'products', product.id), { variants: updatedVariants, updatedAt: serverTimestamp() });
        }
      }

      if (paymentMethod === 'credit') {
        const newBalance = (selectedCustomer.outstandingBalance || 0) + grandTotal;
        await updateDoc(doc(db, 'customers', selectedCustomer.id), { outstandingBalance: newBalance });
      }

      setLastInvoice({ ...invoiceData, createdAt: new Date() });
      
      setTimeout(() => {
        window.print();
      }, 500);

      setCart([]);
      setSelectedCustomer(null);
      setSearchTerm('');
      
      // Refresh products to get updated stock
      const prodSnap = await getDocs(query(collection(db, 'products'), where('shopId', '==', activeShop.id)));
      setProducts(prodSnap.docs.map(d => ({ id: d.id, ...d.data() } as Product)));

    } catch (error) {
      console.error("Checkout error:", error);
      setAlertMessage('Failed to process checkout');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!activeShop) return <div className="p-4 text-gray-500">Please select a shop to use the POS.</div>;

  return (
    <>
      <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-8rem)] print:hidden">
        {/* Left Panel: Products & Search */}
        <div className="flex-1 flex flex-col bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Scan Barcode or Search Product..."
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleSearch}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {products
                .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.sku.includes(searchTerm))
                .map(product => (
                  <div 
                    key={product.id} 
                    className="border rounded-lg p-3 hover:shadow-md cursor-pointer transition-shadow bg-gray-50"
                    onClick={() => product.variants.length > 0 && addToCart(product, product.variants[0])}
                  >
                    <p className="font-semibold text-gray-900 truncate">{product.name}</p>
                    <p className="text-xs text-gray-500 mt-1">SKU: {product.sku}</p>
                    <div className="mt-2 flex justify-between items-center">
                      <span className="text-sm font-bold text-indigo-600">₹{product.variants[0]?.price.toFixed(2)}</span>
                      <span className="text-xs text-gray-500">Stock: {product.variants[0]?.stock}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Right Panel: Cart & Checkout */}
        <div className="w-full lg:w-96 flex flex-col bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-900">Current Order</h2>
            {lastInvoice && (
              <button onClick={() => window.print()} className="text-indigo-600 hover:text-indigo-800" title="Reprint Last Invoice">
                <Printer size={20} />
              </button>
            )}
          </div>
          
          {/* Customer Selection */}
          <div className="p-4 border-b">
            <select 
              className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 p-2 border"
              value={selectedCustomer?.id || ''}
              onChange={(e) => {
                const cust = customers.find(c => c.id === e.target.value);
                setSelectedCustomer(cust || null);
              }}
            >
              <option value="">Select Customer</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name} - {c.phone}</option>
              ))}
            </select>
          </div>

          {/* Cart Items */}
          <div className="flex-1 overflow-y-auto p-4">
            {cart.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400">
                Cart is empty
              </div>
            ) : (
              <div className="space-y-4">
                {cart.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center border-b pb-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm text-gray-900">{item.productName}</p>
                      <p className="text-xs text-gray-500">{item.size} | {item.color} | GST: {item.taxRate}%</p>
                      <p className="text-sm font-semibold mt-1">₹{item.price.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button onClick={() => updateQuantity(idx, -1)} className="p-1 rounded-full bg-gray-100 hover:bg-gray-200">
                        <Minus size={16} />
                      </button>
                      <span className="w-6 text-center text-sm">{item.quantity}</span>
                      <button onClick={() => updateQuantity(idx, 1)} className="p-1 rounded-full bg-gray-100 hover:bg-gray-200">
                        <Plus size={16} />
                      </button>
                      <button onClick={() => updateQuantity(idx, -item.quantity)} className="p-1 ml-2 text-red-500 hover:bg-red-50 rounded-full">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals & Checkout */}
          <div className="p-4 border-t bg-gray-50 space-y-3">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span>
              <span>₹{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>GST</span>
              <span>₹{taxTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t">
              <span>Total</span>
              <span>₹{grandTotal.toFixed(2)}</span>
            </div>

            <div className="pt-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">Payment Method</label>
              <div className="grid grid-cols-4 gap-2">
                {['cash', 'card', 'upi', 'credit'].map(method => (
                  <button
                    key={method}
                    onClick={() => setPaymentMethod(method)}
                    className={`py-2 text-xs font-medium rounded capitalize ${
                      paymentMethod === method ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleCheckout}
              disabled={isProcessing || cart.length === 0 || !selectedCustomer}
              className="w-full mt-4 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isProcessing ? 'Processing...' : 'Complete Sale & Print'}
            </button>
          </div>
        </div>
      </div>

      {/* Printable Invoice (Hidden on screen, visible on print) */}
      {lastInvoice && (
        <div className="hidden print:block w-full max-w-sm mx-auto bg-white p-4 font-mono text-sm">
          <div className="text-center mb-4 border-b border-black pb-4">
            {activeShop?.logoUrl && (
              <img src={activeShop.logoUrl} alt="Logo" className="mx-auto h-16 w-auto mb-2 object-contain grayscale" />
            )}
            <h1 className="text-xl font-bold">{activeShop?.name || 'TEXTILE & GARMENTS'}</h1>
            <p>{activeShop?.address || '123 Fashion Street, City'}</p>
            {activeShop?.gstin && <p>GSTIN: {activeShop.gstin}</p>}
            {activeShop?.phone && <p>Phone: {activeShop.phone}</p>}
            {activeShop?.receiptHeader && <p className="mt-2 text-xs italic">{activeShop.receiptHeader}</p>}
          </div>
          
          <div className="mb-4">
            <p><strong>Invoice:</strong> {lastInvoice.invoiceNumber}</p>
            <p><strong>Date:</strong> {format(lastInvoice.createdAt, 'dd/MM/yyyy HH:mm')}</p>
            <p><strong>Customer:</strong> {lastInvoice.customerName}</p>
            <p><strong>Cashier:</strong> {lastInvoice.createdBy}</p>
          </div>

          <table className="w-full mb-4 border-b border-black pb-2">
            <thead>
              <tr className="border-b border-black border-dashed">
                <th className="text-left py-1">Item</th>
                <th className="text-right py-1">Qty</th>
                <th className="text-right py-1">Price</th>
                <th className="text-right py-1">Total</th>
              </tr>
            </thead>
            <tbody>
              {lastInvoice.items.map((item: any, idx: number) => (
                <tr key={idx}>
                  <td className="py-1">
                    {item.productName}
                    <div className="text-xs text-gray-500">{item.size} | {item.color}</div>
                  </td>
                  <td className="text-right py-1">{item.quantity}</td>
                  <td className="text-right py-1">{item.price.toFixed(2)}</td>
                  <td className="text-right py-1">{item.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="space-y-1 text-right mb-4 border-b border-black pb-4">
            <p>Subtotal: ₹{lastInvoice.subtotal.toFixed(2)}</p>
            <p>GST: ₹{lastInvoice.taxTotal.toFixed(2)}</p>
            <p className="text-lg font-bold mt-2">Grand Total: ₹{lastInvoice.grandTotal.toFixed(2)}</p>
            <p className="text-xs mt-2">Payment: {lastInvoice.paymentMethod.toUpperCase()}</p>
          </div>

          <div className="text-center text-xs">
            <p>{activeShop?.receiptFooter || 'Thank you for shopping with us!'}</p>
            <p>Visit Again</p>
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
    </>
  );
}
