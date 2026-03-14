import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { TrendingUp, Package, Users, DollarSign } from 'lucide-react';
import { startOfDay, endOfDay } from 'date-fns';

export default function Dashboard({ forceOverall = false }: { forceOverall?: boolean }) {
  const { activeShop } = useAuth();
  const effectiveShop = forceOverall ? null : activeShop;
  const [stats, setStats] = useState({
    dailySales: 0,
    totalProducts: 0,
    totalCustomers: 0,
    lowStockItems: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        // Fetch today's invoices
        const invoicesRef = collection(db, 'invoices');
        let qInvoices;
        if (effectiveShop) {
          qInvoices = query(
            invoicesRef,
            where('shopId', '==', effectiveShop.id),
            where('createdAt', '>=', todayStart),
            where('createdAt', '<=', todayEnd)
          );
        } else {
          qInvoices = query(
            invoicesRef,
            where('createdAt', '>=', todayStart),
            where('createdAt', '<=', todayEnd)
          );
        }
        const invoicesSnap = await getDocs(qInvoices);
        let dailyTotal = 0;
        invoicesSnap.forEach((doc) => {
          const data = doc.data() as any;
          dailyTotal += data.grandTotal || 0;
        });

        // Fetch products count & low stock
        let qProducts = collection(db, 'products') as any;
        if (effectiveShop) {
          qProducts = query(qProducts, where('shopId', '==', effectiveShop.id));
        }
        const productsSnap = await getDocs(qProducts);
        let lowStockCount = 0;
        productsSnap.forEach((doc) => {
          const product = doc.data() as any;
          product.variants?.forEach((v: any) => {
            if (v.stock < 5) lowStockCount++;
          });
        });

        // Fetch customers count
        let qCustomers = collection(db, 'customers') as any;
        if (effectiveShop) {
          qCustomers = query(qCustomers, where('shopId', '==', effectiveShop.id));
        }
        const customersSnap = await getDocs(qCustomers);

        setStats({
          dailySales: dailyTotal,
          totalProducts: productsSnap.size,
          totalCustomers: customersSnap.size,
          lowStockItems: lowStockCount,
        });
      } catch (error) {
        console.error("Error fetching dashboard stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [effectiveShop]);

  if (loading) return <div>Loading dashboard...</div>;

  const statCards = [
    { title: "Today's Sales", value: `₹${stats.dailySales.toFixed(2)}`, icon: <DollarSign size={24} className="text-emerald-600" />, bg: "bg-emerald-100" },
    { title: "Total Products", value: stats.totalProducts, icon: <Package size={24} className="text-blue-600" />, bg: "bg-blue-100" },
    { title: "Total Customers", value: stats.totalCustomers, icon: <Users size={24} className="text-purple-600" />, bg: "bg-purple-100" },
    { title: "Low Stock Alerts", value: stats.lowStockItems, icon: <TrendingUp size={24} className="text-red-600" />, bg: "bg-red-100" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Overview of your business today.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card, idx) => (
          <div key={idx} className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className={`flex-shrink-0 rounded-md p-3 ${card.bg}`}>
                  {card.icon}
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">{card.title}</dt>
                    <dd className="text-lg font-semibold text-gray-900">{card.value}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Placeholder for charts or recent activity */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Recent Activity</h2>
        <p className="text-gray-500 text-sm">More analytics coming soon...</p>
      </div>
    </div>
  );
}
