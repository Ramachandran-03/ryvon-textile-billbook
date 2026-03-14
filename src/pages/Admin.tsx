import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc, query, where, serverTimestamp, setDoc, deleteDoc } from 'firebase/firestore';
import { db, firebaseConfig } from '../firebase';
import { useAuth, Shop, UserProfile } from '../contexts/AuthContext';
import { Store, Users, Plus, Building, UserPlus, Trash2, LayoutDashboard, FileText } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import Dashboard from './Dashboard';
import Reports from './Reports';

export default function Admin() {
  const { profile, activeShop, shops, refreshProfile, setActiveShop } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allShops, setAllShops] = useState<Shop[]>(shops);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'reports' | 'staff' | 'shops' | 'company'>('dashboard');
  const [loading, setLoading] = useState(false);

  // New Shop State
  const [newShopName, setNewShopName] = useState('');

  // New Staff State
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: '', employeeId: '', password: '', role: 'staff', shopId: activeShop?.id || '' });
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  // Company Profile State
  const [companyProfile, setCompanyProfile] = useState<Partial<Shop>>({});

  useEffect(() => {
    fetchData();
  }, [activeShop, profile]);

  useEffect(() => {
    if (activeShop) {
      setCompanyProfile(activeShop);
    }
  }, [activeShop]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (profile?.role === 'superadmin') {
        const shopsSnap = await getDocs(collection(db, 'shops'));
        setAllShops(shopsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
        
        if (activeShop) {
          const snap1 = await getDocs(query(collection(db, 'users'), where('shopId', '==', activeShop.id)));
          const snap2 = await getDocs(query(collection(db, 'users'), where('role', '==', 'pending')));
          const combined = [...snap1.docs, ...snap2.docs].map(d => ({ id: d.id, ...d.data() } as any));
          const unique = Array.from(new Map(combined.map(item => [item.uid, item])).values());
          setUsers(unique);
        } else {
          const usersSnap = await getDocs(collection(db, 'users'));
          setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
        }
      } else if (activeShop) {
        // Admin sees their shop users and pending users
        const snap1 = await getDocs(query(collection(db, 'users'), where('shopId', '==', activeShop.id)));
        const snap2 = await getDocs(query(collection(db, 'users'), where('role', '==', 'pending')));
        const combined = [...snap1.docs, ...snap2.docs].map(d => ({ id: d.id, ...d.data() } as any));
        
        // Deduplicate
        const unique = Array.from(new Map(combined.map(item => [item.uid, item])).values());
        setUsers(unique);
      }
    } catch (error) {
      console.error("Error fetching admin data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShopName.trim()) return;
    
    try {
      const docRef = await addDoc(collection(db, 'shops'), { 
        name: newShopName, 
        createdAt: serverTimestamp() 
      });
      setAllShops([...allShops, { id: docRef.id, name: newShopName }]);
      setNewShopName('');
      refreshProfile();
    } catch (error) {
      console.error("Error creating shop:", error);
      setAlertMessage("Failed to create shop.");
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaff.employeeId || !newStaff.password || !newStaff.name) return;

    try {
      // Use secondary app to create user without signing out current user
      const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
      const secondaryAuth = getAuth(secondaryApp);
      
      const email = `${newStaff.employeeId.toLowerCase()}@pos.local`;
      let userCredential;
      
      try {
        userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, newStaff.password);
      } catch (createError: any) {
        if (createError.code === 'auth/email-already-in-use') {
          // If the email is already in use, it might be an orphaned Auth account without a Firestore document.
          // Let's try to sign in to get the UID and create the Firestore document.
          try {
            userCredential = await signInWithEmailAndPassword(secondaryAuth, email, newStaff.password);
          } catch (signInError: any) {
            // If sign in fails (e.g., wrong password for existing account), throw the original error
            throw createError;
          }
        } else {
          throw createError;
        }
      }
      
      const newUserProfile = {
        uid: userCredential.user.uid,
        email: email,
        name: newStaff.name,
        role: newStaff.role,
        shopId: newStaff.shopId,
        employeeId: newStaff.employeeId,
        createdAt: serverTimestamp()
      };

      await setDoc(doc(db, 'users', userCredential.user.uid), newUserProfile);
      
      await secondaryAuth.signOut();
      
      setIsAddStaffOpen(false);
      setNewStaff({ name: '', employeeId: '', password: '', role: 'staff', shopId: activeShop?.id || '' });
      fetchData();
      setAlertMessage("Staff created successfully!");
    } catch (error: any) {
      console.error("Error creating staff:", error);
      if (error.code === 'auth/operation-not-allowed') {
        setAlertMessage("Action Required: You must enable 'Email/Password' authentication in your Firebase Console to create staff accounts.\n\nGo to Firebase Console -> Authentication -> Sign-in method -> Add new provider -> Email/Password -> Enable -> Save.");
      } else if (error.code === 'auth/email-already-in-use') {
        setAlertMessage("A staff member with this ID Number already exists. Please use a different ID Number.");
      } else {
        setAlertMessage(`Failed to create staff: ${error.message}`);
      }
    }
  };

  const updateUserRole = async (userId: string, role: string, shopId: string) => {
    try {
      await updateDoc(doc(db, 'users', userId), { role, shopId });
      fetchData();
    } catch (error) {
      console.error("Error updating user:", error);
      setAlertMessage("Failed to update user.");
    }
  };

  const deleteUser = async (userId: string) => {
    try {
      await deleteDoc(doc(db, 'users', userId));
      setUserToDelete(null);
      fetchData();
    } catch (error) {
      console.error("Error deleting user:", error);
      setAlertMessage("Failed to delete user.");
    }
  };

  const handleSaveCompanyProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShop) return;
    try {
      await updateDoc(doc(db, 'shops', activeShop.id), companyProfile);
      setAlertMessage("Company profile updated successfully!");
      refreshProfile();
    } catch (error) {
      console.error("Error updating company profile:", error);
      setAlertMessage("Failed to update company profile.");
    }
  };

  if (profile?.role !== 'superadmin' && profile?.role !== 'admin') {
    return <div>Access Denied. Admins only.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Settings & Administration</h1>
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`${
              activeTab === 'dashboard'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <LayoutDashboard size={18} className="mr-2" /> Overall Dashboard
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`${
              activeTab === 'reports'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <FileText size={18} className="mr-2" /> Overall Reports
          </button>
          <button
            onClick={() => setActiveTab('staff')}
            className={`${
              activeTab === 'staff'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <Users size={18} className="mr-2" /> Staff Management
          </button>
          <button
            onClick={() => setActiveTab('company')}
            className={`${
              activeTab === 'company'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <Building size={18} className="mr-2" /> Company Profile & GST
          </button>
          {profile.role === 'superadmin' && (
            <button
              onClick={() => setActiveTab('shops')}
              className={`${
                activeTab === 'shops'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
            >
              <Store size={18} className="mr-2" /> Shops / Branches
            </button>
          )}
        </nav>
      </div>

      {activeTab === 'dashboard' && (
        <div className="bg-white shadow rounded-lg p-6">
          <Dashboard forceOverall={true} />
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="bg-white shadow rounded-lg p-6">
          <Reports forceOverall={true} />
        </div>
      )}

      {activeTab === 'staff' && (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h3 className="text-lg leading-6 font-medium text-gray-900">Staff Members</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">Manage roles, shop assignments, and create new staff logins.</p>
            </div>
            <button
              onClick={() => setIsAddStaffOpen(true)}
              className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm"
            >
              <UserPlus size={18} className="mr-2" /> Add Staff
            </button>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name / Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID Number</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned Shop</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-4 text-center">Loading...</td></tr>
              ) : users.map((u) => (
                <tr key={u.uid}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{u.name}</div>
                    <div className="text-sm text-gray-500">{u.email}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {u.employeeId || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <select
                      value={u.role}
                      onChange={(e) => updateUserRole(u.uid, e.target.value, u.shopId)}
                      disabled={u.uid === profile.uid || (profile.role === 'admin' && u.role === 'superadmin')}
                      className="border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500 p-1 border"
                    >
                      <option value="pending">Pending</option>
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                      {profile.role === 'superadmin' && <option value="superadmin">Superadmin</option>}
                    </select>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <select
                      value={u.shopId || ''}
                      onChange={(e) => updateUserRole(u.uid, u.role, e.target.value)}
                      disabled={u.uid === profile.uid || profile.role !== 'superadmin'}
                      className="border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500 p-1 border"
                    >
                      <option value="">None</option>
                      {allShops.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 flex items-center space-x-2">
                    {u.uid === profile.uid ? (
                      <span className="text-gray-400 italic">You</span>
                    ) : (
                      <button
                        onClick={() => setUserToDelete(u)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete User"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'company' && (
        <div className="bg-white shadow rounded-lg p-6 max-w-3xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">Company Profile & GST Configuration</h3>
            {profile?.role === 'superadmin' && (
              <div className="flex items-center space-x-2">
                <label className="text-sm font-medium text-gray-700">Select Shop:</label>
                <select 
                  className="border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm border p-1"
                  value={activeShop?.id || ''}
                  onChange={(e) => {
                    const shop = allShops.find(s => s.id === e.target.value);
                    if (shop) setActiveShop(shop);
                  }}
                >
                  <option value="" disabled>Select a shop</option>
                  {allShops.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {!activeShop ? (
            <div className="p-4 text-gray-500 text-center">Please select a shop to configure its profile.</div>
          ) : (
          <form onSubmit={handleSaveCompanyProfile} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Company Logo (PNG only)</label>
                <div className="mt-1 flex items-center space-x-4">
                  {companyProfile.logoUrl && (
                    <img src={companyProfile.logoUrl} alt="Logo" className="h-16 w-16 object-contain border rounded bg-gray-50" />
                  )}
                  <input 
                    type="file" 
                    accept="image/png" 
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.type !== 'image/png') {
                          setAlertMessage('Please select a PNG image.');
                          return;
                        }
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setCompanyProfile({...companyProfile, logoUrl: reader.result as string});
                        };
                        reader.readAsDataURL(file);
                      }
                    }} 
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" 
                  />
                  {companyProfile.logoUrl && (
                    <button type="button" onClick={() => setCompanyProfile({...companyProfile, logoUrl: ''})} className="text-red-600 text-sm hover:underline">Remove</button>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Company / Shop Name</label>
                <input type="text" value={companyProfile.name || ''} onChange={e => setCompanyProfile({...companyProfile, name: e.target.value})} required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">GSTIN</label>
                <input type="text" value={companyProfile.gstin || ''} onChange={e => setCompanyProfile({...companyProfile, gstin: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Phone</label>
                <input type="text" value={companyProfile.phone || ''} onChange={e => setCompanyProfile({...companyProfile, phone: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input type="email" value={companyProfile.email || ''} onChange={e => setCompanyProfile({...companyProfile, email: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Address</label>
                <textarea value={companyProfile.address || ''} onChange={e => setCompanyProfile({...companyProfile, address: e.target.value})} rows={2} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Receipt Header Text</label>
                <input type="text" value={companyProfile.receiptHeader || ''} onChange={e => setCompanyProfile({...companyProfile, receiptHeader: e.target.value})} placeholder="e.g. Welcome to our store!" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Receipt Footer Text</label>
                <input type="text" value={companyProfile.receiptFooter || ''} onChange={e => setCompanyProfile({...companyProfile, receiptFooter: e.target.value})} placeholder="e.g. Thank you for shopping with us!" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
              </div>
            </div>
            <div className="flex justify-end pt-4">
              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700">
                Save Profile
              </button>
            </div>
          </form>
          )}
        </div>
      )}

      {activeTab === 'shops' && profile.role === 'superadmin' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1">
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Add New Shop</h3>
              <form onSubmit={handleCreateShop}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700">Shop Name</label>
                  <input
                    type="text"
                    required
                    value={newShopName}
                    onChange={(e) => setNewShopName(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none"
                >
                  <Plus size={18} className="mr-2" /> Create Shop
                </button>
              </form>
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shop Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shop ID</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {allShops.map((shop) => (
                    <tr key={shop.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{shop.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">{shop.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add Staff Modal */}
      {isAddStaffOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Add New Staff</h2>
            <form onSubmit={handleCreateStaff} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Full Name</label>
                <input type="text" required value={newStaff.name} onChange={e => setNewStaff({...newStaff, name: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">ID Number (e.g. EMP001)</label>
                <input type="text" required value={newStaff.employeeId} onChange={e => setNewStaff({...newStaff, employeeId: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Password / PIN</label>
                <input type="password" required minLength={6} value={newStaff.password} onChange={e => setNewStaff({...newStaff, password: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Role</label>
                <select value={newStaff.role} onChange={e => setNewStaff({...newStaff, role: e.target.value})} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2">
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {profile?.role === 'superadmin' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Assign Shop</label>
                  <select value={newStaff.shopId} onChange={e => setNewStaff({...newStaff, shopId: e.target.value})} required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2">
                    <option value="" disabled>Select a Shop</option>
                    {allShops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div className="flex justify-end space-x-3 mt-6">
                <button type="button" onClick={() => setIsAddStaffOpen(false)} className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700">Create Staff</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {userToDelete && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Delete Staff Member</h3>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to delete <strong>{userToDelete.name}</strong>? This action will remove their access to the system.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteUser(userToDelete.uid)}
                className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700"
              >
                Delete
              </button>
            </div>
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
