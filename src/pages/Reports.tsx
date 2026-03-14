import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { Download, FileText, FileSpreadsheet, Filter } from 'lucide-react';

export default function Reports({ forceOverall = false }: { forceOverall?: boolean }) {
  const { activeShop } = useAuth();
  const effectiveShop = forceOverall ? null : activeShop;
  const [reportData, setReportData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [reportType, setReportType] = useState('invoice'); // 'invoice', 'product', 'customer', 'purchase', 'stock', 'ledger', 'profit'
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  // Fetch initial data on mount
  useEffect(() => {
    handleGenerateReport();
    // Fetch customers for ledger dropdown
    let qCustomers = collection(db, 'customers') as any;
    if (effectiveShop) {
      qCustomers = query(qCustomers, where('shopId', '==', effectiveShop.id));
    }
    getDocs(qCustomers).then(snap => setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [effectiveShop]);

  const handleGenerateReport = async () => {
    setLoading(true);
    try {
      let qInvoices = collection(db, 'invoices') as any;
      if (effectiveShop) {
        qInvoices = query(qInvoices, where('shopId', '==', effectiveShop.id));
      }
      
      if (dateRange.start && dateRange.end) {
        const start = new Date(dateRange.start);
        const end = new Date(dateRange.end);
        end.setHours(23, 59, 59, 999);
        qInvoices = query(
          qInvoices,
          where('createdAt', '>=', start),
          where('createdAt', '<=', end)
        );
      }
      qInvoices = query(qInvoices, orderBy('createdAt', 'desc'));

      const snap = await getDocs(qInvoices);
      const fetchedInvoices = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      if (reportType === 'invoice') {
        setReportData(fetchedInvoices);
      } else if (reportType === 'product') {
        const productMap = new Map<string, any>();
        fetchedInvoices.forEach((inv: any) => {
          inv.items?.forEach((item: any) => {
            const key = `${item.productId}-${item.variantId}`;
            if (productMap.has(key)) {
              const existing = productMap.get(key)!;
              existing.quantitySold += item.quantity;
              existing.totalRevenue += item.total;
            } else {
              productMap.set(key, {
                id: key,
                name: item.productName,
                variant: `${item.size} | ${item.color}`,
                quantitySold: item.quantity,
                totalRevenue: item.total
              });
            }
          });
        });
        setReportData(Array.from(productMap.values()).sort((a, b) => b.totalRevenue - a.totalRevenue));
      } else if (reportType === 'customer') {
        const customerMap = new Map<string, any>();
        fetchedInvoices.forEach((inv: any) => {
          const key = inv.customerId || 'walk-in';
          const name = inv.customerName || 'Walk-in';
          if (customerMap.has(key)) {
            const existing = customerMap.get(key)!;
            existing.invoiceCount += 1;
            existing.totalSpent += inv.grandTotal;
          } else {
            customerMap.set(key, {
              id: key,
              name: name,
              invoiceCount: 1,
              totalSpent: inv.grandTotal
            });
          }
        });
        setReportData(Array.from(customerMap.values()).sort((a, b) => b.totalSpent - a.totalSpent));
      } else if (reportType === 'purchase') {
        let pq = collection(db, 'purchases') as any;
        if (effectiveShop) pq = query(pq, where('shopId', '==', effectiveShop.id));
        if (dateRange.start && dateRange.end) {
          const start = new Date(dateRange.start);
          const end = new Date(dateRange.end);
          end.setHours(23, 59, 59, 999);
          pq = query(pq, where('createdAt', '>=', start), where('createdAt', '<=', end));
        }
        pq = query(pq, orderBy('createdAt', 'desc'));
        const pSnap = await getDocs(pq);
        setReportData(pSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } else if (reportType === 'stock') {
        let sq = collection(db, 'products') as any;
        if (effectiveShop) sq = query(sq, where('shopId', '==', effectiveShop.id));
        const sSnap = await getDocs(sq);
        const stockData: any[] = [];
        sSnap.docs.forEach(doc => {
          const p = doc.data();
          p.variants?.forEach((v: any) => {
            stockData.push({
              id: `${doc.id}-${v.id}`,
              name: p.name,
              sku: p.sku,
              variant: `${v.size} | ${v.color}`,
              stock: v.stock,
              cost: v.cost || 0,
              value: v.stock * (v.cost || 0)
            });
          });
        });
        setReportData(stockData.sort((a, b) => b.value - a.value));
      } else if (reportType === 'ledger') {
        if (!selectedCustomerId) {
          setAlertMessage("Please select a customer for the ledger.");
          setLoading(false);
          return;
        }
        // Fetch invoices and payments for this customer
        let invQ = query(collection(db, 'invoices'), where('customerId', '==', selectedCustomerId));
        let payQ = query(collection(db, 'payments'), where('customerId', '==', selectedCustomerId));
        if (effectiveShop) {
          invQ = query(invQ, where('shopId', '==', effectiveShop.id));
          payQ = query(payQ, where('shopId', '==', effectiveShop.id));
        }
        
        const [invSnap, paySnap] = await Promise.all([getDocs(invQ), getDocs(payQ)]);
        
        const ledgerEntries: any[] = [];
        invSnap.docs.forEach(d => {
          const data = d.data();
          if (data.paymentMethod === 'credit') { // Only track credit sales in ledger for balance
            ledgerEntries.push({ id: d.id, date: data.createdAt?.toDate(), type: 'Invoice', ref: data.invoiceNumber, debit: data.grandTotal, credit: 0 });
          }
        });
        paySnap.docs.forEach(d => {
          const data = d.data();
          ledgerEntries.push({ id: d.id, date: data.createdAt?.toDate(), type: 'Payment', ref: data.reference, debit: 0, credit: data.amount });
        });
        
        ledgerEntries.sort((a, b) => a.date?.getTime() - b.date?.getTime());
        
        let runningBalance = 0;
        ledgerEntries.forEach(entry => {
          runningBalance += entry.debit - entry.credit;
          entry.balance = runningBalance;
        });
        
        setReportData(ledgerEntries);
      } else if (reportType === 'profit') {
        let totalSales = 0;
        let totalCOGS = 0;
        
        fetchedInvoices.forEach((inv: any) => {
          totalSales += inv.subtotal; // Profit calculated on subtotal (excluding tax)
          inv.items?.forEach((item: any) => {
            totalCOGS += (item.cost || 0) * item.quantity;
          });
        });
        
        setReportData([{
          id: 'profit-summary',
          totalSales,
          totalCOGS,
          grossProfit: totalSales - totalCOGS,
          margin: totalSales > 0 ? ((totalSales - totalCOGS) / totalSales * 100).toFixed(2) + '%' : '0%'
        }]);
      }
    } catch (error) {
      console.error("Error fetching reports:", error);
    } finally {
      setLoading(false);
    }
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.text(`Sales Report - ${reportType.toUpperCase()}`, 14, 15);
    
    let tableColumn: string[] = [];
    let tableRows: any[] = [];

    if (reportType === 'invoice') {
      tableColumn = ["Invoice No", "Date", "Customer", "Subtotal", "Tax", "Total", "Method"];
      reportData.forEach(inv => {
        const date = inv.createdAt ? format(inv.createdAt.toDate(), 'dd/MM/yyyy') : 'N/A';
        tableRows.push([
          inv.invoiceNumber, date, inv.customerName || 'Walk-in',
          inv.subtotal.toFixed(2), inv.taxTotal.toFixed(2), inv.grandTotal.toFixed(2), inv.paymentMethod
        ]);
      });
    } else if (reportType === 'product') {
      tableColumn = ["Product Name", "Variant", "Quantity Sold", "Total Revenue"];
      reportData.forEach(prod => {
        tableRows.push([prod.name, prod.variant, prod.quantitySold, prod.totalRevenue.toFixed(2)]);
      });
    } else if (reportType === 'customer') {
      tableColumn = ["Customer Name", "Invoices Count", "Total Spent"];
      reportData.forEach(cust => {
        tableRows.push([cust.name, cust.invoiceCount, cust.totalSpent.toFixed(2)]);
      });
    } else if (reportType === 'purchase') {
      tableColumn = ["Date", "Supplier", "Invoice No", "Total Cost"];
      reportData.forEach(pur => {
        tableRows.push([pur.createdAt ? format(pur.createdAt.toDate(), 'dd/MM/yyyy') : 'N/A', pur.supplierName, pur.invoiceNumber, pur.totalCost.toFixed(2)]);
      });
    } else if (reportType === 'stock') {
      tableColumn = ["Product", "SKU", "Variant", "Stock", "Unit Cost", "Total Value"];
      reportData.forEach(stk => {
        tableRows.push([stk.name, stk.sku, stk.variant, stk.stock, stk.cost.toFixed(2), stk.value.toFixed(2)]);
      });
    } else if (reportType === 'ledger') {
      tableColumn = ["Date", "Type", "Ref", "Debit (Sale)", "Credit (Payment)", "Balance"];
      reportData.forEach(entry => {
        tableRows.push([entry.date ? format(entry.date, 'dd/MM/yyyy') : 'N/A', entry.type, entry.ref, entry.debit.toFixed(2), entry.credit.toFixed(2), entry.balance.toFixed(2)]);
      });
    } else if (reportType === 'profit') {
      tableColumn = ["Total Sales (Excl Tax)", "Total COGS", "Gross Profit", "Margin"];
      reportData.forEach(p => {
        tableRows.push([p.totalSales.toFixed(2), p.totalCOGS.toFixed(2), p.grossProfit.toFixed(2), p.margin]);
      });
    }

    autoTable(doc, { head: [tableColumn], body: tableRows, startY: 20 });
    doc.save(`${reportType}_report_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  const exportExcel = () => {
    let wsData: any[] = [];

    if (reportType === 'invoice') {
      wsData = reportData.map(inv => ({
        'Invoice No': inv.invoiceNumber,
        'Date': inv.createdAt ? format(inv.createdAt.toDate(), 'dd/MM/yyyy HH:mm') : 'N/A',
        'Customer': inv.customerName || 'Walk-in',
        'Subtotal': inv.subtotal,
        'Tax': inv.taxTotal,
        'Total': inv.grandTotal,
        'Payment Method': inv.paymentMethod,
        'Status': inv.status,
        'Created By': inv.createdBy
      }));
    } else if (reportType === 'product') {
      wsData = reportData.map(prod => ({
        'Product Name': prod.name,
        'Variant': prod.variant,
        'Quantity Sold': prod.quantitySold,
        'Total Revenue': prod.totalRevenue
      }));
    } else if (reportType === 'customer') {
      wsData = reportData.map(cust => ({
        'Customer Name': cust.name,
        'Invoices Count': cust.invoiceCount,
        'Total Spent': cust.totalSpent
      }));
    } else if (reportType === 'purchase') {
      wsData = reportData.map(pur => ({
        'Date': pur.createdAt ? format(pur.createdAt.toDate(), 'dd/MM/yyyy') : 'N/A',
        'Supplier': pur.supplierName,
        'Invoice No': pur.invoiceNumber,
        'Total Cost': pur.totalCost
      }));
    } else if (reportType === 'stock') {
      wsData = reportData.map(stk => ({
        'Product': stk.name,
        'SKU': stk.sku,
        'Variant': stk.variant,
        'Stock': stk.stock,
        'Unit Cost': stk.cost,
        'Total Value': stk.value
      }));
    } else if (reportType === 'ledger') {
      wsData = reportData.map(entry => ({
        'Date': entry.date ? format(entry.date, 'dd/MM/yyyy') : 'N/A',
        'Type': entry.type,
        'Ref': entry.ref,
        'Debit (Sale)': entry.debit,
        'Credit (Payment)': entry.credit,
        'Balance': entry.balance
      }));
    } else if (reportType === 'profit') {
      wsData = reportData.map(p => ({
        'Total Sales (Excl Tax)': p.totalSales,
        'Total COGS': p.totalCOGS,
        'Gross Profit': p.grossProfit,
        'Margin': p.margin
      }));
    }

    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${reportType} Report`);
    XLSX.writeFile(wb, `${reportType}_report_${format(new Date(), 'yyyyMMdd')}.xlsx`);
  };

  const renderTableHeaders = () => {
    if (reportType === 'invoice') {
      return (
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice No</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subtotal</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tax</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Method</th>
        </tr>
      );
    } else if (reportType === 'product') {
      return (
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product Name</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Variant</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity Sold</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Revenue</th>
        </tr>
      );
    } else if (reportType === 'customer') {
      return (
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer Name</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoices Count</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Spent</th>
        </tr>
      );
    } else if (reportType === 'purchase') {
      return (
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice No</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Cost</th>
        </tr>
      );
    } else if (reportType === 'stock') {
      return (
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Variant</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit Cost</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Value</th>
        </tr>
      );
    } else if (reportType === 'ledger') {
      return (
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ref</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Debit (Sale)</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Credit (Payment)</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Balance</th>
        </tr>
      );
    } else if (reportType === 'profit') {
      return (
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Sales (Excl Tax)</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total COGS</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gross Profit</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Margin</th>
        </tr>
      );
    }
  };

  const renderTableBody = () => {
    if (loading) {
      return <tr><td colSpan={7} className="px-6 py-4 text-center">Loading...</td></tr>;
    }
    if (reportData.length === 0) {
      return <tr><td colSpan={7} className="px-6 py-4 text-center text-gray-500">No data found.</td></tr>;
    }

    if (reportType === 'invoice') {
      return reportData.map((inv) => (
        <tr key={inv.id}>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">{inv.invoiceNumber}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
            {inv.createdAt ? format(inv.createdAt.toDate(), 'dd MMM yyyy HH:mm') : 'N/A'}
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{inv.customerName || 'Walk-in'}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">₹{inv.subtotal?.toFixed(2)}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">₹{inv.taxTotal?.toFixed(2)}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">₹{inv.grandTotal?.toFixed(2)}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
              inv.paymentMethod === 'cash' ? 'bg-green-100 text-green-800' : 
              inv.paymentMethod === 'card' ? 'bg-blue-100 text-blue-800' : 
              'bg-purple-100 text-purple-800'
            }`}>
              {inv.paymentMethod}
            </span>
          </td>
        </tr>
      ));
    } else if (reportType === 'product') {
      return reportData.map((prod) => (
        <tr key={prod.id}>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{prod.name}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{prod.variant}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{prod.quantitySold}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-emerald-600">₹{prod.totalRevenue?.toFixed(2)}</td>
        </tr>
      ));
    } else if (reportType === 'customer') {
      return reportData.map((cust) => (
        <tr key={cust.id}>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{cust.name}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cust.invoiceCount}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-emerald-600">₹{cust.totalSpent?.toFixed(2)}</td>
        </tr>
      ));
    } else if (reportType === 'purchase') {
      return reportData.map((pur) => (
        <tr key={pur.id}>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{pur.createdAt ? format(pur.createdAt.toDate(), 'dd/MM/yyyy') : 'N/A'}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{pur.supplierName}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{pur.invoiceNumber}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">₹{pur.totalCost?.toFixed(2)}</td>
        </tr>
      ));
    } else if (reportType === 'stock') {
      return reportData.map((stk) => (
        <tr key={stk.id}>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{stk.name}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{stk.sku}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{stk.variant}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{stk.stock}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">₹{stk.cost?.toFixed(2)}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-emerald-600">₹{stk.value?.toFixed(2)}</td>
        </tr>
      ));
    } else if (reportType === 'ledger') {
      return reportData.map((entry) => (
        <tr key={entry.id}>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{entry.date ? format(entry.date, 'dd/MM/yyyy') : 'N/A'}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{entry.type}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{entry.ref}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 font-medium">{entry.debit > 0 ? `₹${entry.debit.toFixed(2)}` : '-'}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-medium">{entry.credit > 0 ? `₹${entry.credit.toFixed(2)}` : '-'}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">₹{entry.balance.toFixed(2)}</td>
        </tr>
      ));
    } else if (reportType === 'profit') {
      return reportData.map((p) => (
        <tr key={p.id}>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">₹{p.totalSales.toFixed(2)}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">₹{p.totalCOGS.toFixed(2)}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-emerald-600">₹{p.grossProfit.toFixed(2)}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-indigo-600">{p.margin}</td>
        </tr>
      ));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Sales Reports</h1>
        <div className="flex space-x-3">
          <button
            onClick={exportPDF}
            disabled={reportData.length === 0}
            className="flex items-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium disabled:opacity-50"
          >
            <FileText size={18} className="mr-2" /> Export PDF
          </button>
          <button
            onClick={exportExcel}
            disabled={reportData.length === 0}
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium disabled:opacity-50"
          >
            <FileSpreadsheet size={18} className="mr-2" /> Export Excel
          </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-lg shadow flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Report Type</label>
          <select
            className="border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-2 w-48"
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
          >
            <option value="invoice">Sales by Invoice</option>
            <option value="product">Sales by Product</option>
            <option value="customer">Sales by Customer</option>
            <option value="purchase">Purchase Report</option>
            <option value="stock">Stock Report</option>
            <option value="ledger">Customer Ledger</option>
            <option value="profit">Profit Calculation</option>
          </select>
        </div>
        {reportType === 'ledger' && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Select Customer</label>
            <select
              className="border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-2 w-48"
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
            >
              <option value="">Select...</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
          <input
            type="date"
            className="border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-2"
            value={dateRange.start}
            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
          <input
            type="date"
            className="border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-2"
            value={dateRange.end}
            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
          />
        </div>
        <div className="flex space-x-2">
          <button
            onClick={handleGenerateReport}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 flex items-center"
            disabled={loading}
          >
            <Filter size={16} className="mr-2" />
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
          <button
            onClick={() => {
              setDateRange({ start: '', end: '' });
              setReportType('invoice');
            }}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Clear Filters
          </button>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            {renderTableHeaders()}
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {renderTableBody()}
          </tbody>
        </table>
      </div>

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
