import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { currentUser } from '../services/mockData';
import { Address } from '../types';
import { useAddresses } from '../contexts/AddressContext';
import { useAuth } from '../contexts/AuthContext';
import AppHeader, { HeaderAvatarLink, HeaderCartLink } from '../components/AppHeader';
import UserMobileTabBar from '../components/UserMobileTabBar';
import { useCart } from '../contexts/CartContext';

declare global {
  interface Window {
    L: any;
  }
}

const hasValidCoordinates = (lat?: number, lng?: number): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Number(lat) >= -90 &&
  Number(lat) <= 90 &&
  Number(lng) >= -180 &&
  Number(lng) <= 180;

const SavedAddresses: React.FC = () => {
  const { addresses, isLoading, addAddress, updateAddress, deleteAddress } = useAddresses();
  const { user, logout, isAuthenticated } = useAuth();
  const { cartCount } = useCart();
  const activeUser = user || currentUser;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ 
    name: '', 
    addressLine: '', 
    phone: '',
    note: '',
    latitude: 3.139,
    longitude: 101.6869
  });

  // Map Refs
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const handleOpenModal = (address?: Address) => {
    if (address) {
      setEditingId(address.id);
      setFormData({ 
        name: address.name, 
        addressLine: address.addressLine, 
        phone: address.phone || '',
        note: address.note || '',
        latitude: address.latitude || 3.139,
        longitude: address.longitude || 101.6869
      });
    } else {
      setEditingId(null);
      setFormData({ 
        name: '', 
        addressLine: '', 
        phone: '',
        note: '',
        latitude: 3.139,
        longitude: 101.6869
      });
    }
    setIsModalOpen(true);
  };

  // Initialize Map when modal opens
  useEffect(() => {
    if (isModalOpen && mapContainerRef.current && window.L) {
      const L = window.L;
      
      // Delay slightly to ensure container is rendered
      setTimeout(() => {
        if (!mapRef.current) {
          // Create map
          mapRef.current = L.map(mapContainerRef.current).setView([formData.latitude, formData.longitude], 13);
          
          // Add tile layer (OpenStreetMap)
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          }).addTo(mapRef.current);
          
          // Add Draggable Marker
          markerRef.current = L.marker([formData.latitude, formData.longitude], { draggable: true }).addTo(mapRef.current);
          
          // Listen for drag end
          markerRef.current.on('dragend', (e: any) => {
            const { lat, lng } = e.target.getLatLng();
            setFormData(prev => ({ ...prev, latitude: lat, longitude: lng }));
            fetchAddressFromCoords(lat, lng);
          });
          
          // Click map to move marker
          mapRef.current.on('click', (e: any) => {
             markerRef.current.setLatLng(e.latlng);
             const { lat, lng } = e.latlng;
             setFormData(prev => ({ ...prev, latitude: lat, longitude: lng }));
             fetchAddressFromCoords(lat, lng);
          });

        } else {
            // Update view if map exists
            mapRef.current.invalidateSize();
            mapRef.current.setView([formData.latitude, formData.longitude]);
            if(markerRef.current) markerRef.current.setLatLng([formData.latitude, formData.longitude]);
        }
      }, 100);
    }
    
    // Cleanup function
    return () => {
        if (!isModalOpen && mapRef.current) {
            mapRef.current.remove();
            mapRef.current = null;
            markerRef.current = null;
        }
    };
  }, [isModalOpen]); // Re-run when modal opens

  const fetchAddressFromCoords = async (lat: number, lng: number) => {
      // Placeholder for geocoding logic
      console.log(`Pin dropped at: ${lat}, ${lng}`);
  };

  const handleLocateMe = () => {
      if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition((position) => {
              const { latitude, longitude } = position.coords;
              setFormData(prev => ({ ...prev, latitude, longitude }));
              if(mapRef.current) {
                  mapRef.current.setView([latitude, longitude], 15);
                  if(markerRef.current) markerRef.current.setLatLng([latitude, longitude]);
              }
          }, (err) => {
              console.error("Geolocation error:", err);
              alert("Could not access your location.");
          });
      }
  };

  const handleDelete = async (id: string) => {
      await deleteAddress(id);
  };

  const handleSave = async () => {
    const payload = {
      ...formData,
      phone: formData.phone.trim()
    };

    if (!payload.name || !payload.addressLine || !payload.phone) {
        alert("Please enter label, house/unit/block, and phone number");
        return;
    }
    if (!hasValidCoordinates(payload.latitude, payload.longitude)) {
        alert("Invalid map coordinates. Please adjust the pin and try again.");
        return;
    }

    if (editingId) {
       await updateAddress(editingId, payload);
    } else {
       await addAddress(payload);
    }
    setIsModalOpen(false);
  };

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-[#0d1c0d] dark:text-white">
      <AppHeader
        containerClassName="px-4 md:px-10"
        maxWidthClassName="max-w-[1440px]"
        rightContent={
          <>
            <HeaderCartLink cartCount={cartCount} />
            <HeaderAvatarLink isAuthenticated={isAuthenticated} avatarUrl={activeUser.avatar} />
          </>
        }
      />

      <div className="flex flex-1 max-w-[1440px] mx-auto w-full px-4 md:px-10 pt-28 sm:pt-32 pb-24 lg:pb-8 gap-6 md:gap-8">
        {/* Sidebar */}
        <aside className="hidden lg:flex flex-col w-64 shrink-0 gap-6">
           <div className="bg-white dark:bg-white/5 rounded-xl p-6 shadow-sm border border-[#e7f4e7] dark:border-white/10 sticky top-24">
             <div className="flex flex-col gap-4">
               <Link to="/dashboard" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#e7f4e7] dark:hover:bg-white/5 transition-colors">
                 <span className="material-symbols-outlined">grid_view</span>
                 <span className="text-sm font-medium">Dashboard</span>
               </Link>
               <Link to="/orders" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#e7f4e7] dark:hover:bg-white/5 transition-colors">
                 <span className="material-symbols-outlined">receipt_long</span>
                 <span className="text-sm font-medium">Order History</span>
               </Link>
               <Link to="/addresses" className="flex items-center gap-3 p-2 rounded-lg bg-primary text-[#0d1c0d] font-bold">
                 <span className="material-symbols-outlined">location_on</span>
                 <span className="text-sm">Saved Addresses</span>
               </Link>
               <Link to="/account" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#e7f4e7] dark:hover:bg-white/5 transition-colors">
                 <span className="material-symbols-outlined">person</span>
                 <span className="text-sm font-medium">Manage Account</span>
               </Link>
             </div>
             <div className="mt-8 pt-8 border-t border-[#e7f4e7] dark:border-white/10">
                <button onClick={logout} className="flex items-center gap-3 p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg w-full transition-colors">
                   <span className="material-symbols-outlined">logout</span>
                   <span className="text-sm font-medium">Log Out</span>
                </button>
             </div>
           </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col gap-5 sm:gap-6 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl sm:text-2xl font-bold">Saved Addresses</h1>
                <button 
                  onClick={() => handleOpenModal()}
                  className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-background-dark px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-primary/20"
                >
                    <span className="material-symbols-outlined text-lg">add</span>
                    Add New Address
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {isLoading ? (
                    <div className="text-sm text-gray-500">Loading addresses...</div>
                ) : addresses.length === 0 ? (
                    <div className="md:col-span-2 bg-white dark:bg-white/5 rounded-xl p-6 border border-[#e7f4e7] dark:border-white/10 shadow-sm text-center text-gray-500">
                      No saved addresses yet.
                    </div>
                ) : addresses.map((addr) => (
                    <div key={addr.id} className="bg-white dark:bg-white/5 rounded-xl p-4 sm:p-6 border border-[#e7f4e7] dark:border-white/10 shadow-sm flex flex-col gap-4 relative group">
                        <div className="flex items-start gap-4">
                            <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                <span className="material-symbols-outlined text-primary">
                                {addr.name.toLowerCase() === 'home' ? 'home' : addr.name.toLowerCase() === 'work' ? 'work' : 'place'}
                                </span>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-bold text-lg">{addr.name}</h3>
                                </div>
                                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{addr.addressLine}</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{addr.phone}</p>
                                {hasValidCoordinates(addr.latitude, addr.longitude) && (
                                    <p className="text-xs text-primary mt-1 flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[14px]">pin_drop</span>
                                        {Number(addr.latitude).toFixed(4)}, {Number(addr.longitude).toFixed(4)}
                                    </p>
                                )}
                                {addr.note && (
                                    <p className="text-xs text-gray-400 mt-2 italic">Note: {addr.note}</p>
                                )}
                            </div>
                        </div>
                        
                        <div className="flex items-center justify-end gap-2 pt-4 border-t border-[#e7f4e7] dark:border-white/10 mt-auto">
                             <button 
                                onClick={() => handleOpenModal(addr)}
                                className="px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-100 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 transition-colors"
                             >
                                Edit
                             </button>
                             <button 
                                onClick={() => handleDelete(addr.id)}
                                className="px-3 py-2 rounded-lg text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors"
                             >
                                Delete
                             </button>
                        </div>
                    </div>
                ))}
            </div>
        </main>
      </div>
      <UserMobileTabBar />

       {/* Address Modal */}
       {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
             <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setIsModalOpen(false)} />
             <div className="relative bg-white dark:bg-zinc-900 w-full max-w-2xl p-4 sm:p-6 md:p-8 rounded-2xl shadow-2xl border border-white/10 flex flex-col gap-5 sm:gap-6 max-h-[92vh] overflow-y-auto no-scrollbar">
                <div className="flex items-center justify-between">
                    <h3 className="text-xl sm:text-2xl font-bold">{editingId ? 'Edit Address' : 'Add New Address'}</h3>
                    <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                
                <div className="space-y-4">
                    {/* Map Section */}
                    <div>
                        <label className="block text-sm font-semibold mb-2">Pin Location</label>
                        <div
                           ref={mapContainerRef} 
                           id="map" 
                           className="w-full h-56 sm:h-64 rounded-xl bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 shadow-inner"
                        ></div>
                        <p className="text-xs text-gray-400 mt-1 text-center">Drag marker to adjust location</p>
                        <button
                          type="button"
                          onClick={handleLocateMe}
                          className="mt-3 w-full bg-primary hover:bg-primary/90 text-background-dark py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-primary/20"
                        >
                          <span className="material-symbols-outlined text-base">my_location</span>
                          Locate Me
                        </button>
                        <p className="mt-2 text-center text-sm font-bold text-primary">
                          (Delivery will use <span className="font-semibold">Locate Me</span> button, you can adjust the location pin manually if needed)
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold mb-1">Label</label>
                        <input 
                        type="text" 
                        className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                        placeholder="Home, Office..."
                        value={formData.name}
                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold mb-1">
                          House No. , Unit or Block
                        </label>
                        <textarea 
                          className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none h-20"
                          placeholder="e.g. B-12-3, Block B, Vista Residence"
                          value={formData.addressLine}
                          onChange={(e) => setFormData({...formData, addressLine: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold mb-1">Phone Number</label>
                        <input 
                          type="tel" 
                          className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                          placeholder="+60123456789"
                          value={formData.phone}
                          onChange={(e) => setFormData({...formData, phone: e.target.value})}
                        />
                    </div>
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-sm font-semibold">Delivery Instructions (Optional)</label>
                            <span className="text-xs text-gray-400">{(formData.note || '').length}/66</span>
                        </div>
                        <input 
                          type="text" 
                          maxLength={66}
                          className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                          placeholder="e.g. Leave at front desk"
                          value={formData.note}
                          onChange={(e) => setFormData({...formData, note: e.target.value})}
                        />
                    </div>
                </div>
                
                <div className="flex flex-col-reverse sm:flex-row gap-3 mt-2">
                    <button 
                      onClick={() => setIsModalOpen(false)}
                      className="flex-1 py-3 font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                      onClick={handleSave}
                      className="flex-1 py-3 font-bold bg-primary text-background-dark rounded-xl hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
                    >
                        Save Address
                    </button>
                </div>
             </div>
          </div>
       )}
    </div>
  );
};

export default SavedAddresses;
