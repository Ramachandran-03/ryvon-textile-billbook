import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LayoutDashboard, ShoppingCart, Package, Users, FileText, LogOut, Menu, Settings, Store, Truck } from 'lucide-react';

const Layout: React.FC = () => {
  const { profile, shops, activeShop, setActiveShop, signOut } = useAuth();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const navItems = [
    { to: '/', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { to: '/pos', icon: <ShoppingCart size={20} />, label: 'POS / Billing' },
    { to: '/products', icon: <Package size={20} />, label: 'Products' },
    { to: '/customers', icon: <Users size={20} />, label: 'Customers' },
  ];

  if (profile?.role === 'admin' || profile?.role === 'superadmin') {
    navItems.push({ to: '/purchases', icon: <Truck size={20} />, label: 'Purchases' });
    navItems.push({ to: '/reports', icon: <FileText size={20} />, label: 'Reports' });
    navItems.push({ to: '/admin', icon: <Settings size={20} />, label: 'Settings & Staff' });
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-center h-16 border-b border-gray-200">
          <span className="text-xl font-bold text-indigo-600">Textile POS</span>
        </div>
        <div className="flex flex-col flex-1 overflow-y-auto">
          <nav className="flex-1 px-2 py-4 space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setIsMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`
                }
              >
                <span className="mr-3">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold">
                {profile?.name?.charAt(0) || 'U'}
              </div>
            </div>
            <div className="ml-3 overflow-hidden">
              <p className="text-sm font-medium text-gray-700 truncate">{profile?.name}</p>
              <p className="text-xs font-medium text-gray-500 capitalize">{profile?.role}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center w-full px-4 py-2 text-sm font-medium text-red-600 rounded-md hover:bg-red-50 transition-colors"
          >
            <LogOut size={20} className="mr-3" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="flex items-center justify-between h-16 px-4 bg-white border-b border-gray-200">
          <div className="flex items-center">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 mr-4 text-gray-500 rounded-md hover:bg-gray-100 focus:outline-none md:hidden"
            >
              <Menu size={24} />
            </button>
            
            {/* Shop Selector */}
            <div className="flex items-center text-sm">
              <Store size={18} className="text-gray-400 mr-2 hidden sm:block" />
              {profile?.role === 'superadmin' ? (
                <select 
                  className="border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm font-medium text-gray-700 py-1 pl-2 pr-8"
                  value={activeShop?.id || 'all'}
                  onChange={(e) => {
                    if (e.target.value === 'all') {
                      setActiveShop(null);
                    } else {
                      const shop = shops.find(s => s.id === e.target.value);
                      setActiveShop(shop || null);
                    }
                  }}
                >
                  <option value="all">All Branches (Overall)</option>
                  {shops.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ) : (
                <span className="font-medium text-gray-700">{activeShop?.name || 'No Shop Assigned'}</span>
              )}
            </div>
          </div>
        </header>
        
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
      
      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-gray-600 bg-opacity-50 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </div>
  );
};

export default Layout;
