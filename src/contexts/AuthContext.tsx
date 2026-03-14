import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, googleProvider } from '../firebase';
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, getDocs, collection, serverTimestamp } from 'firebase/firestore';

export interface Shop {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  receiptHeader?: string;
  receiptFooter?: string;
  logoUrl?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: 'superadmin' | 'admin' | 'staff' | 'pending';
  shopId: string;
  employeeId?: string;
  createdAt: any;
}

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  shops: Shop[];
  activeShop: Shop | null;
  setActiveShop: (shop: Shop | null) => void;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [activeShop, setActiveShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfileAndShops = async (firebaseUser: FirebaseUser) => {
    try {
      const userDocRef = doc(db, 'users', firebaseUser.uid);
      const userDoc = await getDoc(userDocRef);
      let currentProfile: UserProfile;
      
      if (userDoc.exists()) {
        currentProfile = userDoc.data() as UserProfile;
      } else {
        const isDefaultAdmin = firebaseUser.email === 'ramachandrankannan03@gmail.com' && firebaseUser.emailVerified;
        currentProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          name: firebaseUser.displayName || 'Unknown User',
          role: isDefaultAdmin ? 'superadmin' : 'pending',
          shopId: '',
          createdAt: serverTimestamp(),
        };
        await setDoc(userDocRef, currentProfile);
      }
      setProfile(currentProfile);

      if (currentProfile.role === 'superadmin') {
        const shopsSnap = await getDocs(collection(db, 'shops'));
        const shopsData = shopsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Shop));
        setShops(shopsData);
        // Do not auto-select the first shop for superadmin to allow "All Branches" view
      } else if (currentProfile.shopId) {
        const shopDoc = await getDoc(doc(db, 'shops', currentProfile.shopId));
        if (shopDoc.exists()) {
          const shopData = { id: shopDoc.id, ...shopDoc.data() } as Shop;
          setShops([shopData]);
          setActiveShop(shopData);
        }
      }
    } catch (error) {
      console.error("Error fetching user profile:", error);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await fetchProfileAndShops(firebaseUser);
      } else {
        setProfile(null);
        setShops([]);
        setActiveShop(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const refreshProfile = async () => {
    if (user) await fetchProfileAndShops(user);
  };

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error signing in with Google", error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, shops, activeShop, setActiveShop, loading, signInWithGoogle, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
