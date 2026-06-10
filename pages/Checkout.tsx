import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { currentUser } from '../services/mockData';
import { api } from '../services/api';
import {
  CreateOrderPayload,
  CurlecPaymentConfirmation,
  DeliveryOptions,
  DeliveryQuote,
  MenuItem,
  PaymentOptions,
  ShopStatus
} from '../types';
import { useAddresses } from '../contexts/AddressContext';
import { useCart } from '../contexts/CartContext';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils/currency';
import AppHeader, { HeaderAvatarLink, HeaderCartLink } from '../components/AppHeader';

declare global {
  interface Window {
    L: any;
    Razorpay?: any;
  }
}

type CheckoutPaymentMethod = 'DuitNow' | 'Curlec';
type CheckoutOrderPayload = CreateOrderPayload & {
  paymentMethod: CheckoutPaymentMethod;
};

const CURLEC_CHECKOUT_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
const CURLEC_PENDING_CHECKOUT_KEY = 'takcakap_curlec_pending_checkout_v1';
const CURLEC_PENDING_CHECKOUT_TTL_MS = 60 * 60 * 1000;

type PendingCurlecCheckout = {
  orderDetails: CheckoutOrderPayload;
  createdAtMs: number;
  curlecOrderId: string;
  checkoutSessionId: string;
};

const clearPendingCurlecCheckout = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CURLEC_PENDING_CHECKOUT_KEY);
};

const readPendingCurlecCheckout = (): PendingCurlecCheckout | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CURLEC_PENDING_CHECKOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCurlecCheckout;
    if (
      !parsed ||
      !parsed.orderDetails ||
      !Array.isArray(parsed.orderDetails.items) ||
      parsed.orderDetails.items.length === 0 ||
      typeof parsed.createdAtMs !== 'number' ||
      !String(parsed.checkoutSessionId || '').trim()
    ) {
      clearPendingCurlecCheckout();
      return null;
    }
    if (Date.now() - parsed.createdAtMs > CURLEC_PENDING_CHECKOUT_TTL_MS) {
      clearPendingCurlecCheckout();
      return null;
    }
    return parsed;
  } catch {
    clearPendingCurlecCheckout();
    return null;
  }
};

const writePendingCurlecCheckout = (payload: PendingCurlecCheckout) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CURLEC_PENDING_CHECKOUT_KEY, JSON.stringify(payload));
};

const resolveCurlecCallbackUrl = (): string => {
  const apiBaseRaw = String(import.meta.env.VITE_API_BASE_URL || '/api').trim();
  if (/^https?:\/\//i.test(apiBaseRaw)) {
    return `${apiBaseRaw.replace(/\/$/, '')}/payments/curlec/callback`;
  }
  const normalizedBase = apiBaseRaw
    ? apiBaseRaw.startsWith('/')
      ? apiBaseRaw
      : `/${apiBaseRaw}`
    : '/api';
  return `${window.location.origin}${normalizedBase.replace(/\/$/, '')}/payments/curlec/callback`;
};

const getCurlecReturnConfirmation = (search: string): CurlecPaymentConfirmation | null => {
  const params = new URLSearchParams(search);
  const orderId = String(params.get('razorpay_order_id') || '').trim();
  const paymentId = String(params.get('razorpay_payment_id') || '').trim();
  const signature = String(params.get('razorpay_signature') || '').trim();
  if (!orderId || !paymentId || !signature) return null;
  return { orderId, paymentId, signature };
};
const loadCurlecCheckoutScript = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  if (window.Razorpay) return true;

  const existing = document.querySelector<HTMLScriptElement>('script[data-curlec-checkout="true"]');
  if (existing) {
    await new Promise((resolve) => {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', resolve, { once: true });
    });
    return Boolean(window.Razorpay);
  }

  const script = document.createElement('script');
  script.src = CURLEC_CHECKOUT_SCRIPT_URL;
  script.async = true;
  script.dataset.curlecCheckout = 'true';

  const loaded = await new Promise<boolean>((resolve) => {
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

  return loaded && Boolean(window.Razorpay);
};

const hasValidCoordinates = (lat?: number, lng?: number): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Number(lat) >= -90 &&
  Number(lat) <= 90 &&
  Number(lng) >= -180 &&
  Number(lng) <= 180;

const pad2 = (value: number): string => String(value).padStart(2, '0');
const toLocalDatePrefix = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const toDisplayTodayDate = (date: Date): string =>
  date.toLocaleDateString('en-MY', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const toTimeSlotValue = (minutesFromMidnight: number): string =>
  `${pad2(Math.floor(minutesFromMidnight / 60))}:${pad2(minutesFromMidnight % 60)}`;
const toTimeSlotLabel = (minutesFromMidnight: number): string => {
  const hours24 = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${pad2(minutes)}${period}`;
};

const toUtcIsoFromLocalInput = (value: string): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString();
};

const Checkout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const activeUser = user || currentUser;
  const duitNowLogoUrl = import.meta.env.VITE_DUITNOW_LOGO_URL || '/duitnow-logo.png';
  
  // Cart State from Context
  const { cart, cartTotal, cartCount, isLoading: isCartLoading, updateQuantity, removeFromCart, clearCart } = useCart();
  
  const [orderType, setOrderType] = useState<'Pickup' | 'Delivery'>('Pickup');
  const [deliveryTiming, setDeliveryTiming] = useState<'NOW' | 'SCHEDULED'>('NOW');
  const [scheduledTimeSlot, setScheduledTimeSlot] = useState('');
  const [scheduleNowMs, setScheduleNowMs] = useState(Date.now());
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOptions>({
    pickupEnabled: true,
    lalamoveEnabled: true
  });
  const [isLoadingDeliveryOptions, setIsLoadingDeliveryOptions] = useState(true);
  const [shopStatus, setShopStatus] = useState<ShopStatus | null>(null);
  const storeName = shopStatus?.storeName || 'TakCakap HQ';
  const storeAddress = shopStatus?.storeAddress || 'Kuala Lumpur, Malaysia';
  
  // Address State from Context
  const { addresses, isLoading: isAddressesLoading, addAddress, deleteAddress } = useAddresses();
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [paymentOptions, setPaymentOptions] = useState<PaymentOptions>({
    duitnowQrUrl: import.meta.env.VITE_DUITNOW_QR_URL || '',
    duitnowEnabled: true,
    curlecEnabled: false,
    serviceFee: 1.8,
    curlecConfigured: false,
    curlecKeyId: '',
    curlecDisplayName: 'Online Payment',
    curlecDescription: 'Secure online payment via Curlec'
  });
  const [isLoadingPaymentOptions, setIsLoadingPaymentOptions] = useState(true);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<CheckoutPaymentMethod>('DuitNow');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Voucher State
  const [voucherCodeInput, setVoucherCodeInput] = useState('');
  const [appliedVoucher, setAppliedVoucher] = useState<any>(null);
  const [voucherError, setVoucherError] = useState('');
  const [isApplyingVoucher, setIsApplyingVoucher] = useState(false);

  // Points State
  const [userPoints, setUserPoints] = useState(0);

  // Cart Validation State
  const [menuMap, setMenuMap] = useState<Record<string, MenuItem>>({});
  const [isValidating, setIsValidating] = useState(true);

  // Load Menu for Validation
  useEffect(() => {
    const validateCart = async () => {
        try {
            const items = await api.getMenu();
            const map = items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {} as Record<string, MenuItem>);
            setMenuMap(map);
        } catch (e) {
            console.error("Validation check failed", e);
        } finally {
            setIsValidating(false);
        }
    };
    validateCart();
  }, []);

  useEffect(() => {
    const loadPoints = async () => {
      const token = localStorage.getItem('takcakap_auth_token');
      if (!token) return;
      try {
        const res = await fetch('/api/user/points', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setUserPoints(data.balance || 0);
        }
      } catch (err) {
        console.error('Failed to load points', err);
      }
    };
    if (isAuthenticated) {
      loadPoints();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const loadDeliveryOptions = async () => {
      setIsLoadingDeliveryOptions(true);
      try {
        const options = await api.getDeliveryOptions();
        setDeliveryOptions(options);
      } catch (e) {
        console.error('Failed to load delivery options', e);
        setDeliveryOptions({ pickupEnabled: true, lalamoveEnabled: true });
      } finally {
        setIsLoadingDeliveryOptions(false);
      }
    };

    loadDeliveryOptions();
  }, []);

  useEffect(() => {
    const loadPaymentOptions = async () => {
      setIsLoadingPaymentOptions(true);
      try {
        const options = await api.getPaymentOptions();
        setPaymentOptions(options);
      } catch (error) {
        console.error('Failed to load payment options', error);
        setPaymentOptions((prev) => ({
          ...prev,
          duitnowEnabled: true,
          curlecEnabled: false,
          curlecConfigured: false,
          curlecKeyId: ''
        }));
      } finally {
        setIsLoadingPaymentOptions(false);
      }
    };

    loadPaymentOptions();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadShopStatus = async () => {
      try {
        const status = await api.getShopStatus();
        if (!cancelled) setShopStatus(status);
      } catch (e) {
        console.error('Failed to load shop status', e);
      }
    };

    loadShopStatus();
    const intervalId = window.setInterval(loadShopStatus, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const getItemError = (id: string, quantity: number) => {
      if (isValidating) return null;
      const freshItem = menuMap[id];
      if (!freshItem) return "Item no longer exists";
      if (!freshItem.isActive) return "Sold out (inactive)";
      if (freshItem.stock < quantity) return `Out of stock (Max: ${freshItem.stock})`;
      return null;
  };

  const hasErrors = cart.some(item => getItemError(item.id, item.quantity) !== null);
  const isShopOrderable = shopStatus?.isOrderable ?? true;
  const pickupDisabled = isLoadingDeliveryOptions || !deliveryOptions.pickupEnabled;
  const lalamoveDisabled = isLoadingDeliveryOptions || !deliveryOptions.lalamoveEnabled;
  const noDeliveryMethodAvailable = !isLoadingDeliveryOptions && !deliveryOptions.pickupEnabled && !deliveryOptions.lalamoveEnabled;
  const curlecAvailable = paymentOptions.curlecEnabled && paymentOptions.curlecConfigured;
  const configuredServiceFee = Math.max(0, Number(paymentOptions.serviceFee || 0));
  const noPaymentMethodAvailable =
    !isLoadingPaymentOptions && !paymentOptions.duitnowEnabled && !curlecAvailable;

  useEffect(() => {
    if (isLoadingDeliveryOptions) return;
    if (orderType === 'Pickup' && !deliveryOptions.pickupEnabled && deliveryOptions.lalamoveEnabled) {
      setOrderType('Delivery');
      return;
    }
    if (orderType === 'Delivery' && !deliveryOptions.lalamoveEnabled && deliveryOptions.pickupEnabled) {
      setOrderType('Pickup');
    }
  }, [orderType, deliveryOptions, isLoadingDeliveryOptions]);

  useEffect(() => {
    if (isLoadingPaymentOptions) return;
    if (selectedPaymentMethod === 'DuitNow' && !paymentOptions.duitnowEnabled && curlecAvailable) {
      setSelectedPaymentMethod('Curlec');
      return;
    }
    if (selectedPaymentMethod === 'Curlec' && !curlecAvailable && paymentOptions.duitnowEnabled) {
      setSelectedPaymentMethod('DuitNow');
    }
  }, [selectedPaymentMethod, paymentOptions, curlecAvailable, isLoadingPaymentOptions]);

  useEffect(() => {
    if (orderType !== 'Delivery') {
      setDeliveryTiming('NOW');
      setScheduledTimeSlot('');
    }
  }, [orderType]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setScheduleNowMs(Date.now());
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  const scheduleTodayDate = useMemo(() => new Date(scheduleNowMs), [scheduleNowMs]);
  const scheduleTodayLabel = useMemo(() => toDisplayTodayDate(scheduleTodayDate), [scheduleTodayDate]);
  const scheduleSlotOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [];
    const startMinutes = 10 * 60;
    const endMinutes = 15 * 60 + 30;
    const minAllowedMs = scheduleNowMs + 5 * 60 * 1000;
    const datePrefix = toLocalDatePrefix(scheduleTodayDate);

    for (let minute = startMinutes; minute <= endMinutes; minute += 10) {
      const value = toTimeSlotValue(minute);
      const slotDate = new Date(`${datePrefix}T${value}:00`);
      if (Number.isNaN(slotDate.getTime()) || slotDate.getTime() <= minAllowedMs) {
        continue;
      }
      options.push({ value, label: toTimeSlotLabel(minute) });
    }

    return options;
  }, [scheduleNowMs, scheduleTodayDate]);

  const hasAvailableScheduleSlots = scheduleSlotOptions.length > 0;
  const scheduledAtLocal = useMemo(() => {
    if (deliveryTiming !== 'SCHEDULED' || !scheduledTimeSlot) return '';
    return `${toLocalDatePrefix(scheduleTodayDate)}T${scheduledTimeSlot}`;
  }, [deliveryTiming, scheduledTimeSlot, scheduleTodayDate]);

  useEffect(() => {
    if (deliveryTiming !== 'SCHEDULED') return;
    if (!scheduleSlotOptions.length) {
      if (scheduledTimeSlot) setScheduledTimeSlot('');
      return;
    }

    const selectedStillValid = scheduleSlotOptions.some((option) => option.value === scheduledTimeSlot);
    if (selectedStillValid) return;

    const firstAvailable = scheduleSlotOptions[0]?.value || '';
    setScheduledTimeSlot(firstAvailable);
  }, [deliveryTiming, scheduledTimeSlot, scheduleSlotOptions]);

  // Set default selection
  useEffect(() => {
    if (addresses.length > 0 && !selectedAddressId) {
        setSelectedAddressId(addresses[0].id);
    }
  }, [addresses, selectedAddressId]);

  const [showAddressModal, setShowAddressModal] = useState(false);
  const [newAddress, setNewAddress] = useState({ 
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
  const isFinalizingCurlecRef = useRef(false);
  const handledCurlecReturnRef = useRef('');

  // Initialize Map when modal opens
  useEffect(() => {
    if (showAddressModal && mapContainerRef.current && window.L) {
      const L = window.L;
      
      // Delay slightly to ensure container is rendered
      setTimeout(() => {
        if (!mapRef.current) {
          // Create map
          mapRef.current = L.map(mapContainerRef.current).setView([newAddress.latitude, newAddress.longitude], 13);
          
          // Add tile layer
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          }).addTo(mapRef.current);
          
          // Add Draggable Marker
          markerRef.current = L.marker([newAddress.latitude, newAddress.longitude], { draggable: true }).addTo(mapRef.current);
          
          // Listen for drag end
          markerRef.current.on('dragend', (e: any) => {
            const { lat, lng } = e.target.getLatLng();
            setNewAddress(prev => ({ ...prev, latitude: lat, longitude: lng }));
          });
          
          // Click map to move marker
          mapRef.current.on('click', (e: any) => {
             markerRef.current.setLatLng(e.latlng);
             const { lat, lng } = e.latlng;
             setNewAddress(prev => ({ ...prev, latitude: lat, longitude: lng }));
          });

        } else {
            // Update view if map exists
            mapRef.current.invalidateSize();
            mapRef.current.setView([newAddress.latitude, newAddress.longitude]);
            if(markerRef.current) markerRef.current.setLatLng([newAddress.latitude, newAddress.longitude]);
        }
      }, 100);
    }
    
    // Cleanup
    return () => {
        if (!showAddressModal && mapRef.current) {
            mapRef.current.remove();
            mapRef.current = null;
            markerRef.current = null;
        }
    };
  }, [showAddressModal]);

  const handleLocateMe = () => {
      if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition((position) => {
              const { latitude, longitude } = position.coords;
              setNewAddress(prev => ({ ...prev, latitude, longitude }));
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

  const handleApplyVoucher = async () => {
    if (!voucherCodeInput.trim()) return;
    setIsApplyingVoucher(true);
    setVoucherError('');
    try {
        const token = localStorage.getItem('takcakap_auth_token');
        const response = await fetch('/api/user/vouchers/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ code: voucherCodeInput, subtotal: cartTotal })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to apply voucher');
        setAppliedVoucher(data.voucher);
    } catch (err: any) {
        setVoucherError(err.message);
        setAppliedVoucher(null);
    } finally {
        setIsApplyingVoucher(false);
    }
  };

  const handleRemoveVoucher = () => {
      setAppliedVoucher(null);
      setVoucherCodeInput('');
      setVoucherError('');
  };

  const calculateDiscount = () => {
      if (!appliedVoucher) return 0;
      if (appliedVoucher.type === 'percentage') {
          const rawDiscount = (cartTotal * Number(appliedVoucher.discount_value)) / 100;
          return appliedVoucher.max_discount ? Math.min(rawDiscount, Number(appliedVoucher.max_discount)) : rawDiscount;
      }
      return Number(appliedVoucher.discount_value);
  };

  const navigateToOrderSuccess = useCallback(
    (
      createdOrder: {
        orderId?: string | null;
        shortCode?: string | null;
        trackingUrl?: string | null;
        externalOrderId?: string | null;
      },
      orderDetails: CheckoutOrderPayload
    ) => {
      navigate('/success', {
        state: {
          orderId: createdOrder?.shortCode || createdOrder?.orderId || null,
          orderType: orderDetails.orderType,
          deliveryProvider: orderDetails.orderType === 'Delivery' ? 'Lalamove' : 'Internal',
          trackingUrl: createdOrder?.trackingUrl || null,
          externalOrderId: createdOrder?.externalOrderId || null
        }
      });
    },
    [navigate]
  );

  const finalizeCurlecOrder = useCallback(
    async (
      orderDetails: CheckoutOrderPayload,
      curlecPayment: CurlecPaymentConfirmation,
      checkoutSessionId: string
    ) => {
      if (isFinalizingCurlecRef.current) return;
      isFinalizingCurlecRef.current = true;
      setIsSubmittingPayment(true);
      try {
        const createdOrder = await api.createOrder({
          ...orderDetails,
          paymentMethod: 'Curlec',
          curlecPayment,
          curlecCheckoutSessionId: checkoutSessionId
        });
        clearPendingCurlecCheckout();
        await clearCart();
        navigateToOrderSuccess(createdOrder, orderDetails);
      } finally {
        isFinalizingCurlecRef.current = false;
        setIsSubmittingPayment(false);
      }
    },
    [clearCart, navigateToOrderSuccess]
  );

  useEffect(() => {
    const returnPayment = getCurlecReturnConfirmation(location.search);
    const params = new URLSearchParams(location.search);
    const returnError = String(params.get('error_description') || params.get('error_code') || '').trim();

    if (!returnPayment) {
      if (!returnError) return;
      clearPendingCurlecCheckout();
      alert(`Payment was not completed. ${returnError}`);
      navigate('/failed', { replace: true });
      return;
    }

    const returnKey = `${returnPayment.orderId}|${returnPayment.paymentId}|${returnPayment.signature}`;
    if (handledCurlecReturnRef.current === returnKey) return;
    handledCurlecReturnRef.current = returnKey;

    const pendingCheckout = readPendingCurlecCheckout();
    if (!pendingCheckout?.orderDetails || !pendingCheckout.checkoutSessionId) {
      navigate('/orders', { replace: true });
      return;
    }
    if (pendingCheckout.curlecOrderId && pendingCheckout.curlecOrderId !== returnPayment.orderId) {
      clearPendingCurlecCheckout();
      alert('Payment session mismatch. Please contact support if payment was deducted.');
      navigate('/orders', { replace: true });
      return;
    }

    finalizeCurlecOrder(
      pendingCheckout.orderDetails,
      returnPayment,
      pendingCheckout.checkoutSessionId
    ).catch((error: any) => {
      console.error('Curlec return finalization failed', error);
      const message = error?.message || 'Payment was received but order finalization failed. Please contact support.';
      alert(message);
    });
  }, [location.search, finalizeCurlecOrder, navigate]);

  const handlePlaceOrder = async () => {
      if (isSubmittingPayment) return;

      if (cart.length === 0) {
          alert("Your cart is empty!");
          return;
      }
      if (!isShopOrderable) {
          alert(shopStatus?.message || 'Store is unavailable right now');
          return;
      }
      if (noDeliveryMethodAvailable) {
          alert('All delivery methods are unavailable for now. Please try again later.');
          return;
      }
      if (noPaymentMethodAvailable) {
          alert('All payment methods are currently unavailable. Please try again later.');
          return;
      }
      if (selectedPaymentMethod === 'DuitNow' && !paymentOptions.duitnowEnabled) {
          alert('DuitNow is currently unavailable. Please choose Curlec.');
          return;
      }
      if (selectedPaymentMethod === 'Curlec' && !curlecAvailable) {
          alert('Curlec is currently unavailable. Please choose DuitNow.');
          return;
      }
      if (orderType === 'Pickup' && !deliveryOptions.pickupEnabled) {
          alert('Store Pickup is unavailable for now.');
          return;
      }
      if (orderType === 'Delivery' && !deliveryOptions.lalamoveEnabled) {
          alert('Lalamove Delivery is unavailable for now.');
          return;
      }
      if (hasErrors) {
          alert("Please remove unavailable items before proceeding.");
          return;
      }
      
      // Order validation based on type
      let finalAddress = '';
      let scheduledAtUtc = '';
      if (orderType === 'Delivery') {
          if (!selectedAddressId) {
              alert("Please select a delivery address.");
              return;
          }
          if (!deliveryQuote) {
              alert("Lalamove quote is not ready. Please wait and try again.");
              return;
          }
          const addr = addresses.find(a => a.id === selectedAddressId);
          if (addr) finalAddress = addr.addressLine;
          if (!addr?.phone?.trim()) {
              alert("Selected address is missing phone number. Please update your saved address.");
              return;
          }
          if (deliveryTiming === 'SCHEDULED') {
              if (!scheduledAtLocal) {
                  alert('Please choose your scheduled delivery date and time.');
                  return;
              }
              scheduledAtUtc = toUtcIsoFromLocalInput(scheduledAtLocal);
              if (!scheduledAtUtc) {
                  alert('Invalid scheduled date/time format.');
                  return;
              }
              const minimumAllowed = Date.now() + 5 * 60 * 1000;
              if (new Date(scheduledAtUtc).getTime() <= minimumAllowed) {
                  alert('Scheduled delivery must be at least 5 minutes in the future.');
                  return;
              }
          }
      }

      const selectedAddress = addresses.find(a => a.id === selectedAddressId);
      const serviceFee = configuredServiceFee;
      const deliveryFee = orderType === 'Delivery' ? (deliveryQuote?.fee || 0) : 0;
      const discount = calculateDiscount();
      const totalAmount = Math.max(0, cartTotal + serviceFee + deliveryFee - discount);

      const orderDetails: CheckoutOrderPayload = {
          orderType,
          address: finalAddress,
          addressSnapshot:
              orderType === 'Delivery' && selectedAddress
                  ? {
                        label: selectedAddress.name,
                        addressLine: selectedAddress.addressLine,
                        phone: selectedAddress.phone,
                        note: selectedAddress.note || '',
                        latitude: selectedAddress.latitude,
                        longitude: selectedAddress.longitude
                    }
                  : undefined,
          items: cart,
          total: totalAmount,
          deliveryFee,
          deliveryCurrency: deliveryQuote?.currency || 'MYR',
          quotationId: deliveryQuote?.quotationId || '',
          quotationStops: deliveryQuote?.stops || [],
          deliveryTiming,
          scheduledAtUtc: scheduledAtUtc || undefined,
          paymentMethod: selectedPaymentMethod,
          voucherCode: appliedVoucher?.code,
          recipient: {
              name: activeUser.name,
              phone: selectedAddress?.phone || activeUser.phoneNumber || '',
              remarks: selectedAddress?.note || ''
          }
      };

      if (selectedPaymentMethod === 'DuitNow') {
          navigate('/scan-pay', { state: orderDetails });
          return;
      }

      try {
          setIsSubmittingPayment(true);
          const isCurlecReady = await loadCurlecCheckoutScript();
          if (!isCurlecReady || !window.Razorpay) {
              throw new Error('Unable to load Curlec checkout. Please check your connection and try again.');
          }

          const curlecOrder = await api.createCurlecOrder({
              amount: totalAmount,
              currency: 'MYR',
              orderPayload: orderDetails
          });
          if (!String(curlecOrder.checkoutSessionId || '').trim()) {
              throw new Error('Curlec checkout session was not created. Please try again.');
          }

          writePendingCurlecCheckout({
              orderDetails,
              createdAtMs: Date.now(),
              curlecOrderId: String(curlecOrder.orderId || ''),
              checkoutSessionId: String(curlecOrder.checkoutSessionId || '')
          });

          const rzp = new window.Razorpay({
              key: curlecOrder.keyId,
              order_id: curlecOrder.orderId,
              amount: curlecOrder.amount,
              currency: curlecOrder.currency,
              callback_url: resolveCurlecCallbackUrl(),
              redirect: true,
              name: curlecOrder.displayName || paymentOptions.curlecDisplayName || 'Online Payment',
              description: `${orderType} order payment`,
              prefill: {
                  name: activeUser.name || 'Customer',
                  email: activeUser.email || '',
                  contact: selectedAddress?.phone || activeUser.phoneNumber || ''
              },
              notes: {
                  source: 'foodiedash',
                  orderType
              },
              theme: {
                  color: curlecOrder.themeColor || '#499c49'
              },
              modal: {
                  ondismiss: () => setIsSubmittingPayment(false)
              },
              handler: async (response: any) => {
                  try {
                      const curlecPayment = {
                          orderId: String(response?.razorpay_order_id || ''),
                          paymentId: String(response?.razorpay_payment_id || ''),
                          signature: String(response?.razorpay_signature || '')
                      };
                      if (!curlecPayment.orderId || !curlecPayment.paymentId || !curlecPayment.signature) {
                          throw new Error('Curlec payment confirmation is incomplete');
                      }
                      await finalizeCurlecOrder(
                          orderDetails,
                          curlecPayment,
                          String(curlecOrder.checkoutSessionId || '')
                      );
                  } catch (error: any) {
                      console.error('Curlec order finalization failed', error);
                      alert(error?.message || 'Payment was received but order finalization failed. Please contact support.');
                  } finally {
                      setIsSubmittingPayment(false);
                  }
              }
          });

          rzp.on('payment.failed', (response: any) => {
              console.error('Curlec payment failed', response);
              clearPendingCurlecCheckout();
              setIsSubmittingPayment(false);
              navigate('/failed');
          });

          rzp.open();
      } catch (error: any) {
          console.error('Failed to start Curlec checkout', error);
          clearPendingCurlecCheckout();
          alert(error?.message || 'Unable to start Curlec checkout. Please try again.');
          setIsSubmittingPayment(false);
      }
  };

  const handleDeleteAddress = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await deleteAddress(id);
    if (selectedAddressId === id) {
        // If we deleted the selected one, reset selection to first available or empty
        const remaining = addresses.filter(a => a.id !== id);
        setSelectedAddressId(remaining.length > 0 ? remaining[0].id : '');
    }
  };

  const handleSaveAddress = async () => {
      if (!newAddress.name || !newAddress.addressLine || !newAddress.phone.trim()) {
          alert('Please complete label, house/unit/block, and phone number.');
          return;
      }
      if (!hasValidCoordinates(newAddress.latitude, newAddress.longitude)) {
          alert('Invalid map coordinates. Please move the pin and try again.');
          return;
      }

      const created = await addAddress({
          name: newAddress.name,
          addressLine: newAddress.addressLine,
          phone: newAddress.phone.trim(),
          note: newAddress.note,
          latitude: newAddress.latitude,
          longitude: newAddress.longitude
      });

      if (created) {
          setSelectedAddressId(created.id);
      }
      setShowAddressModal(false);
      setNewAddress({ name: '', addressLine: '', phone: '', note: '', latitude: 3.139, longitude: 101.6869 });
  };

  useEffect(() => {
    if (orderType !== 'Delivery' || lalamoveDisabled) {
      setDeliveryQuote(null);
      setQuoteError('');
      return;
    }

    const addr = addresses.find((a) => a.id === selectedAddressId);
    if (!addr) {
      setDeliveryQuote(null);
      return;
    }

    if (!hasValidCoordinates(addr.latitude, addr.longitude)) {
      setQuoteError('Selected address has invalid coordinates. Please edit and re-save the map pin.');
      setDeliveryQuote(null);
      return;
    }
    const scheduleAtUtc = toUtcIsoFromLocalInput(scheduledAtLocal);
    if (deliveryTiming === 'SCHEDULED' && !scheduleAtUtc) {
      setQuoteError('Select a valid delivery date and time to get delivery rate.');
      setDeliveryQuote(null);
      setIsQuoting(false);
      return;
    }

    let cancelled = false;
    const fetchQuote = async () => {
      setIsQuoting(true);
      setQuoteError('');
      try {
        const quote = await api.getDeliveryQuote({
          addressLine: addr.addressLine,
          latitude: addr.latitude ?? 0,
          longitude: addr.longitude ?? 0,
          recipientName: activeUser.name,
          recipientPhone: addr.phone,
          note: addr.note,
          deliveryTiming,
          scheduledAtUtc: deliveryTiming === 'SCHEDULED' ? scheduleAtUtc : undefined
        });
        if (!cancelled) {
          setDeliveryQuote(quote);
        }
      } catch (error: any) {
        if (!cancelled) {
          setDeliveryQuote(null);
          setQuoteError(error?.message || 'Unable to fetch Lalamove quotation');
        }
      } finally {
        if (!cancelled) {
          setIsQuoting(false);
        }
      }
    };

    fetchQuote();
    return () => {
      cancelled = true;
    };
  }, [orderType, selectedAddressId, addresses, lalamoveDisabled, activeUser.name, deliveryTiming, scheduledAtLocal]);

  const serviceFee = configuredServiceFee;
  const deliveryFee = orderType === 'Delivery' ? (deliveryQuote?.fee || 0) : 0;
  const discountAmount = calculateDiscount();
  const total = Math.max(0, cartTotal + serviceFee + deliveryFee - discountAmount);

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-[#0d1c0d] dark:text-white">
       <AppHeader
         rightContent={
           <>
             <HeaderCartLink cartCount={cartCount} />
             <HeaderAvatarLink
               isAuthenticated={isAuthenticated}
               avatarUrl={activeUser.avatar || currentUser.avatar}
             />
           </>
         }
       />

       <main className="max-w-[1200px] mx-auto pt-32 pb-20 px-4">
          <div className="flex flex-col lg:flex-row gap-8">
             <div className="flex-1 space-y-8">
                <h2 className="text-3xl font-extrabold tracking-tight">Checkout</h2>

                {shopStatus && !shopStatus.isOrderable && (
                  <div className="text-sm font-semibold text-[#0d1c0d] dark:text-white bg-primary/10 border border-primary/30 rounded-lg px-3 py-2">
                    {shopStatus.message}
                  </div>
                )}

                {/* Delivery Method Toggle */}
                <section className="bg-white dark:bg-zinc-900 p-2 rounded-xl border border-gray-100 dark:border-zinc-800 flex relative">
                    <button 
                        onClick={() => !pickupDisabled && setOrderType('Pickup')}
                        disabled={pickupDisabled}
                        className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-3 rounded-lg font-bold text-sm transition-all z-10 ${
                          orderType === 'Pickup'
                            ? 'bg-primary text-background-dark shadow-md'
                            : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800'
                        } ${
                          pickupDisabled
                            ? 'opacity-60 blur-[0.4px] cursor-not-allowed hover:bg-transparent'
                            : ''
                        }`}
                    >
                        <span className="material-symbols-outlined">storefront</span>
                        <span>Self Pickup</span>
                        {pickupDisabled && !isLoadingDeliveryOptions && (
                          <span className="text-[10px] font-bold text-red-500 leading-none">Unavailable For Now</span>
                        )}
                    </button>
                    <button 
                        onClick={() => !lalamoveDisabled && setOrderType('Delivery')}
                        disabled={lalamoveDisabled}
                        className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-3 rounded-lg font-bold text-sm transition-all z-10 ${
                          orderType === 'Delivery'
                            ? 'bg-primary text-background-dark shadow-md'
                            : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800'
                        } ${
                          lalamoveDisabled
                            ? 'opacity-60 blur-[0.4px] cursor-not-allowed hover:bg-transparent'
                            : ''
                        }`}
                    >
                        <span className="material-symbols-outlined">local_shipping</span>
                        <span>Lalamove Delivery (NOW)</span>
                        {lalamoveDisabled && !isLoadingDeliveryOptions && (
                          <span className="text-[10px] font-bold text-red-500 leading-none">Unavailable For Now</span>
                        )}
                    </button>
                </section>
                {noDeliveryMethodAvailable && (
                  <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    All delivery methods are unavailable for now.
                  </div>
                )}
                
                {/* Address Section (Only for Delivery) */}
                {orderType === 'Delivery' && !lalamoveDisabled && (
                <section className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                   <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 space-y-3">
                      <h4 className="text-sm font-bold flex items-center gap-2">
                         <span className="material-symbols-outlined text-primary text-base">schedule</span>
                         Delivery Timing
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                         <button
                           onClick={() => setDeliveryTiming('NOW')}
                           className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                             deliveryTiming === 'NOW'
                               ? 'bg-primary text-background-dark shadow-sm'
                               : 'bg-white dark:bg-zinc-800 text-gray-500 border border-gray-200 dark:border-zinc-700'
                           }`}
                         >
                           Deliver NOW
                         </button>
                         <button
                           onClick={() => setDeliveryTiming('SCHEDULED')}
                           className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                             deliveryTiming === 'SCHEDULED'
                               ? 'bg-primary text-background-dark shadow-sm'
                               : 'bg-white dark:bg-zinc-800 text-gray-500 border border-gray-200 dark:border-zinc-700'
                           }`}
                         >
                           Schedule
                         </button>
                      </div>
                      {deliveryTiming === 'SCHEDULED' && (
                        <div className="space-y-3">
                          <div className="rounded-xl border border-primary/20 bg-white/90 dark:bg-zinc-800 px-3 py-2.5 flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-300">Date</span>
                            <span className="text-sm font-bold text-[#0d1c0d] dark:text-white">{scheduleTodayLabel}</span>
                          </div>
                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-300">
                              Choose Time
                            </label>
                            <div className="relative">
                              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-primary text-base pointer-events-none">
                                schedule
                              </span>
                              <select
                                value={scheduledTimeSlot}
                                onChange={(e) => setScheduledTimeSlot(e.target.value)}
                                className="w-full rounded-xl border border-primary/25 bg-white dark:bg-zinc-800 pl-10 pr-4 py-2.5 text-sm font-semibold text-[#0d1c0d] dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                              >
                                {!hasAvailableScheduleSlots && (
                                  <option value="">No slot available for today</option>
                                )}
                                {scheduleSlotOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {!hasAvailableScheduleSlots && (
                              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                                No scheduled slot left for today. Please choose Deliver NOW.
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                   </div>
                   <div className="flex items-center justify-between">
                       <h3 className="text-xl font-bold flex items-center gap-2">
                          <span className="material-symbols-outlined text-primary">location_on</span>
                          Delivery Address
                       </h3>
                       <button 
                         onClick={() => setShowAddressModal(true)}
                         className="text-sm font-bold text-primary hover:text-primary/80 flex items-center gap-1"
                       >
                           <span className="material-symbols-outlined text-lg">add</span>
                           Add New
                       </button>
                   </div>
                   
                   <div className="grid md:grid-cols-2 gap-4">
                      {isAddressesLoading ? (
                          <div className="text-sm text-gray-500">Loading addresses...</div>
                      ) : addresses.map((addr) => (
                          <label key={addr.id} className="relative group cursor-pointer">
                             <input 
                               type="radio" 
                               name="address" 
                               className="peer sr-only" 
                               checked={selectedAddressId === addr.id}
                               onChange={() => setSelectedAddressId(addr.id)}
                             />
                             <div className="h-full p-5 rounded-xl border-2 border-transparent bg-white dark:bg-zinc-800 shadow-sm transition-all peer-checked:border-primary peer-checked:ring-4 peer-checked:ring-primary/10 relative">
                                <div className="flex justify-between items-start mb-2">
                                   <div className="flex items-center gap-2">
                                      <span className={`material-symbols-outlined transition-colors ${selectedAddressId === addr.id ? 'text-primary' : 'text-gray-400'}`}>
                                          {addr.name.toLowerCase() === 'home' ? 'home' : addr.name.toLowerCase() === 'work' ? 'work' : 'place'}
                                      </span>
                                      <span className="font-bold">{addr.name}</span>
                                   </div>
                                   <div className="flex items-center gap-2">
                                        <div className="opacity-0 peer-checked:opacity-100 bg-primary text-background-dark rounded-full p-0.5 transition-opacity">
                                            <span className="material-symbols-outlined text-sm font-bold block">check</span>
                                        </div>
                                   </div>
                                </div>
                                <p className="text-sm text-gray-500 leading-relaxed dark:text-gray-400">{addr.addressLine}</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{addr.phone}</p>
                                
                                <button 
                                    onClick={(e) => handleDeleteAddress(addr.id, e)}
                                    className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-red-50 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                    title="Delete Address"
                                >
                                    <span className="material-symbols-outlined text-lg">delete</span>
                                </button>
                             </div>
                          </label>
                      ))}
                      
                   </div>
                   {isQuoting && (
                      <div className="text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                        Fetching live Lalamove quote...
                      </div>
                   )}
                   {quoteError && (
                      <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        {quoteError}
                      </div>
                   )}
                </section>
                )}

                {/* Pickup Info (Only for Pickup) */}
                {orderType === 'Pickup' && !pickupDisabled && (
                    <section className="bg-primary/5 border border-primary/10 rounded-xl p-6 flex gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="bg-white dark:bg-zinc-800 p-3 rounded-lg h-fit">
                            <span className="material-symbols-outlined text-primary text-2xl">store</span>
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-primary">Store Location</h3>
                            <p className="font-semibold">{storeName}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{storeAddress}</p>
                            <div className="mt-3 flex gap-2">
                                <span className="px-2 py-1 bg-white dark:bg-zinc-800 rounded text-xs font-bold text-gray-500 border border-gray-200 dark:border-zinc-700">Open until 10 PM</span>
                                <span className="px-2 py-1 bg-white dark:bg-zinc-800 rounded text-xs font-bold text-gray-500 border border-gray-200 dark:border-zinc-700">15-20 min prep time</span>
                            </div>
                        </div>
                    </section>
                )}

                {/* Payment */}
                <section className="space-y-4">
                   <h3 className="text-xl font-bold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">payments</span>
                      Payment Method
                   </h3>
                   {isLoadingPaymentOptions ? (
                     <div className="text-sm text-gray-500">Loading payment methods...</div>
                   ) : (
                     <>
                       {noPaymentMethodAvailable && (
                         <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                           All payment methods are currently unavailable.
                         </div>
                       )}
                       <div className="grid sm:grid-cols-2 gap-3">
                         <button
                           type="button"
                           onClick={() => paymentOptions.duitnowEnabled && setSelectedPaymentMethod('DuitNow')}
                           disabled={!paymentOptions.duitnowEnabled}
                           className={`p-4 rounded-xl border-2 text-left transition-all ${
                             selectedPaymentMethod === 'DuitNow'
                               ? 'border-primary bg-white dark:bg-zinc-800 shadow-sm ring-4 ring-primary/10'
                               : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'
                           } ${!paymentOptions.duitnowEnabled ? 'opacity-55 cursor-not-allowed' : ''}`}
                         >
                           <div className="flex items-start justify-between gap-2">
                             <div className="flex items-center gap-3">
                               <div className="h-10 w-10 rounded-lg bg-white border border-gray-100 p-1 shadow-sm flex items-center justify-center">
                                 <img
                                   src={duitNowLogoUrl}
                                   alt="DuitNow"
                                   className="h-full w-full object-contain"
                                 />
                               </div>
                               <div>
                                 <p className="font-bold">DuitNow / Scan &amp; Pay</p>
                                 <p className="text-xs text-gray-500 dark:text-gray-400">Manual QR payment</p>
                               </div>
                             </div>
                             <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                               paymentOptions.duitnowEnabled
                                 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                 : 'bg-gray-100 text-gray-500 border border-gray-200'
                             }`}>
                               {paymentOptions.duitnowEnabled ? 'Enabled' : 'Disabled'}
                             </span>
                           </div>
                         </button>

                         <button
                           type="button"
                           onClick={() => curlecAvailable && setSelectedPaymentMethod('Curlec')}
                           disabled={!curlecAvailable}
                           className={`p-4 rounded-xl border-2 text-left transition-all ${
                             selectedPaymentMethod === 'Curlec'
                               ? 'border-primary bg-white dark:bg-zinc-800 shadow-sm ring-4 ring-primary/10'
                               : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'
                           } ${!curlecAvailable ? 'opacity-55 cursor-not-allowed' : ''}`}
                         >
                           <div className="flex items-start justify-between gap-2">
                             <div>
                               <p className="font-bold">{paymentOptions.curlecDisplayName || 'Online Payment'}</p>
                               <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                 FPX, cards, Touch &apos;n Go, Boost, GrabPay and more
                               </p>
                               <p className="text-[11px] text-gray-400 mt-1">
                                 Secure online payment via Curlec
                               </p>
                             </div>
                             <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                               curlecAvailable
                                 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                 : 'bg-amber-50 text-amber-700 border border-amber-200'
                             }`}>
                               {curlecAvailable ? 'Enabled' : paymentOptions.curlecEnabled ? 'Not Configured' : 'Disabled'}
                             </span>
                           </div>
                         </button>
                       </div>
                     </>
                   )}
                </section>
             </div>

             {/* Sidebar Cart */}
             <div className="lg:w-[400px]">
                <div className="sticky top-24 bg-white dark:bg-zinc-800 rounded-2xl border border-primary/10 shadow-xl overflow-hidden">
                   <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
                      <h3 className="text-xl font-bold">Your Order</h3>
                      <Link to="/" className="text-sm font-bold text-primary hover:underline">Add Items</Link>
                   </div>
                   <div className="p-6 space-y-6 max-h-[400px] overflow-y-auto custom-scrollbar">
                      {(isValidating || isCartLoading) && (
                         <div className="text-center py-4 text-gray-500 animate-pulse">Checking item availability...</div>
                      )}
                      {!isValidating && !isCartLoading && cart.length === 0 ? (
                          <div className="text-center py-8 text-gray-500">
                              <span className="material-symbols-outlined text-4xl mb-2">remove_shopping_cart</span>
                              <p>Your cart is empty.</p>
                          </div>
                      ) : (
                          cart.map((item) => {
                              const error = getItemError(item.id, item.quantity);
                              return (
                                  <div key={item.id} className={`flex gap-4 group ${error ? 'opacity-70 grayscale-[0.5]' : ''}`}>
                                    <div className="h-16 w-16 rounded-xl bg-cover bg-center shrink-0 shadow-sm" style={{ backgroundImage: `url('${item.image}')` }}></div>
                                    <div className="flex-1 flex flex-col justify-between">
                                        <div className="flex justify-between items-start">
                                          <div>
                                              <h4 className="font-bold text-sm leading-tight pr-2">{item.name}</h4>
                                              {error && (
                                                  <div className="text-red-500 text-[10px] font-bold mt-1 flex items-center gap-0.5 bg-red-50 dark:bg-red-900/30 px-1.5 py-0.5 rounded w-fit">
                                                      <span className="material-symbols-outlined text-[10px]">error</span>
                                                      {error}
                                                  </div>
                                              )}
                                          </div>
                                          <button 
                                              onClick={() => removeFromCart(item.id)}
                                              className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                              title="Remove item"
                                          >
                                              <span className="material-symbols-outlined text-lg">delete</span>
                                          </button>
                                        </div>
                                        <div className="flex justify-between items-end mt-2">
                                            <p className="text-primary text-sm font-bold">{formatCurrency(item.price)}</p>
                                            
                                            <div className="flex items-center gap-3 bg-gray-100 dark:bg-zinc-700/50 rounded-lg p-1">
                                                <button 
                                                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                                    className="w-6 h-6 flex items-center justify-center rounded-md bg-white dark:bg-zinc-600 shadow-sm text-xs font-bold hover:bg-gray-50 transition-colors disabled:opacity-50"
                                                    disabled={item.quantity <= 1}
                                                >
                                                    -
                                                </button>
                                                <span className="text-xs font-bold w-4 text-center">{item.quantity}</span>
                                                <button 
                                                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                                    className="w-6 h-6 flex items-center justify-center rounded-md bg-white dark:bg-zinc-600 shadow-sm text-xs font-bold hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    disabled={!!error}
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                  </div>
                              );
                          })
                      )}
                   </div>
                   <div className="p-6 bg-gray-50 dark:bg-zinc-700/50 space-y-3">
                      {hasErrors && (
                          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 rounded-xl mb-4 flex items-start gap-3">
                              <span className="material-symbols-outlined text-red-500 mt-0.5">warning</span>
                              <div className="text-xs text-red-700 dark:text-red-300">
                                  <p className="font-bold">Order cannot be processed</p>
                                  <p className="opacity-90 leading-tight mt-0.5">Some items in your cart are no longer available. Please remove them to proceed.</p>
                              </div>
                          </div>
                      )}
                   
                      {/* Voucher Section */}
                      <div className="py-2 border-b border-gray-200 dark:border-gray-600 mb-2">
                        {appliedVoucher ? (
                            <div className="flex justify-between items-center bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
                                <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                                    <span className="material-symbols-outlined text-lg">local_activity</span>
                                    <span className="font-bold text-sm">Voucher {appliedVoucher.code} applied</span>
                                </div>
                                <button onClick={handleRemoveVoucher} className="text-gray-500 hover:text-red-500">
                                    <span className="material-symbols-outlined text-sm">close</span>
                                </button>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Enter Voucher Code"
                                    value={voucherCodeInput}
                                    onChange={(e) => setVoucherCodeInput(e.target.value.toUpperCase())}
                                    className="flex-1 bg-white dark:bg-zinc-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                                />
                                <button 
                                    onClick={handleApplyVoucher}
                                    disabled={!voucherCodeInput.trim() || isApplyingVoucher}
                                    className="bg-gray-800 dark:bg-gray-200 text-white dark:text-black px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-700 disabled:opacity-50"
                                >
                                    {isApplyingVoucher ? '...' : 'Apply'}
                                </button>
                            </div>
                        )}
                        {voucherError && <p className="text-red-500 text-xs mt-1">{voucherError}</p>}
                      </div>

                      <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                         <span>Subtotal</span>
                         <span className="font-bold text-[#0d1c0d] dark:text-white">{formatCurrency(cartTotal)}</span>
                      </div>
                      {isAuthenticated && (
                          <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                             <span>Current Points</span>
                             <span className="font-bold text-[#0d1c0d] dark:text-white">{userPoints} pts</span>
                          </div>
                      )}
                      {isAuthenticated && (
                          <div className="flex justify-between text-sm font-bold text-[#b49820]">
                             <span>Points to Earn</span>
                             <span>+ {Math.floor(total) * 10} pts</span>
                          </div>
                      )}
                      <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                         <span>Service Fee</span>
                         <span className="font-bold text-[#0d1c0d] dark:text-white">{formatCurrency(serviceFee)}</span>
                      </div>
                      {orderType === 'Delivery' && !lalamoveDisabled && (
                          <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                             <span>Delivery Fee (Lalamove)</span>
                             <span className="font-bold text-[#0d1c0d] dark:text-white">{isQuoting ? '...' : formatCurrency(deliveryFee)}</span>
                          </div>
                      )}
                      {discountAmount > 0 && (
                          <div className="flex justify-between text-sm text-primary">
                             <span>Discount</span>
                             <span className="font-bold">- {formatCurrency(discountAmount)}</span>
                          </div>
                      )}
                      <div className="pt-4 border-t border-gray-200 dark:border-gray-600 flex justify-between items-end">
                         <div>
                            <p className="text-xs uppercase font-bold tracking-widest text-gray-400">Grand Total</p>
                            <p className="text-3xl font-extrabold text-[#0d1c0d] dark:text-white">{formatCurrency(total)}</p>
                         </div>
                      </div>
                      <button 
                          onClick={handlePlaceOrder} 
                          disabled={
                            isSubmittingPayment ||
                            cart.length === 0 ||
                            !isShopOrderable ||
                            hasErrors ||
                            isValidating ||
                            isCartLoading ||
                            isAddressesLoading ||
                            isLoadingPaymentOptions ||
                            noDeliveryMethodAvailable ||
                            noPaymentMethodAvailable ||
                            (selectedPaymentMethod === 'DuitNow' && !paymentOptions.duitnowEnabled) ||
                            (selectedPaymentMethod === 'Curlec' && !curlecAvailable) ||
                            (orderType === 'Pickup' && pickupDisabled) ||
                            (orderType === 'Delivery' &&
                              (lalamoveDisabled ||
                                isQuoting ||
                                !deliveryQuote ||
                                (deliveryTiming === 'SCHEDULED' && !scheduledAtLocal)))
                          }
                          className="w-full mt-6 bg-primary hover:bg-primary/90 disabled:bg-gray-300 dark:disabled:bg-zinc-600 disabled:cursor-not-allowed text-background-dark py-4 rounded-xl font-extrabold text-lg transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                      >
                          {isSubmittingPayment
                            ? 'Opening Secure Checkout...'
                            : (isValidating || isCartLoading || isAddressesLoading || isLoadingPaymentOptions)
                            ? 'Verifying...'
                            : !isShopOrderable
                              ? 'Store Closed'
                            : noDeliveryMethodAvailable
                              ? 'Unavailable For Now'
                              : noPaymentMethodAvailable
                                ? 'Payment Unavailable'
                                : hasErrors
                                ? 'Remove Unavailable Items'
                                : selectedPaymentMethod === 'Curlec'
                                  ? 'Pay Now!'
                                  : 'Proceed to Scan & Pay'}
                          {!isSubmittingPayment && !hasErrors && !isValidating && !isCartLoading && !isAddressesLoading && !isLoadingPaymentOptions && !noDeliveryMethodAvailable && !noPaymentMethodAvailable && isShopOrderable && <span className="material-symbols-outlined">arrow_forward</span>}
                      </button>
                   </div>
                </div>
             </div>
          </div>
       </main>
       
       {/* Add Address Modal */}
       {showAddressModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
             <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setShowAddressModal(false)} />
             <div className="relative bg-white dark:bg-zinc-900 w-full max-w-2xl p-6 md:p-8 rounded-2xl shadow-2xl border border-white/10 flex flex-col gap-6 max-h-[90vh] overflow-y-auto no-scrollbar">
                <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-bold">Add New Address</h3>
                    <button onClick={() => setShowAddressModal(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                
                <div className="space-y-4">
                    {/* Map Section */}
                    <div>
                        <label className="block text-sm font-semibold mb-2">Pin Location</label>
                        <div 
                           ref={mapContainerRef} 
                           id="checkout-map" 
                           className="w-full h-64 rounded-xl bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 shadow-inner"
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
                        <label className="block text-sm font-semibold mb-1">Label (e.g., Home, Office)</label>
                        <input 
                          type="text" 
                          className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                          placeholder="Home"
                          value={newAddress.name}
                          onChange={(e) => setNewAddress({...newAddress, name: e.target.value})}
                        />
                    </div>
                    
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-sm font-semibold">House No. , Unit or Block</label>
                            <span className="text-xs text-gray-400">{(newAddress.addressLine || '').length}/200</span>
                        </div>
                        <textarea 
                          maxLength={200}
                          className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none h-20"
                          placeholder="e.g. B-12-3, Block B, Vista Residence"
                          value={newAddress.addressLine}
                          onChange={(e) => setNewAddress({...newAddress, addressLine: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold mb-1">Phone Number</label>
                        <input 
                          type="tel" 
                          className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                          placeholder="+60123456789"
                          value={newAddress.phone}
                          onChange={(e) => setNewAddress({...newAddress, phone: e.target.value})}
                        />
                    </div>
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-sm font-semibold">Delivery Instructions (Optional)</label>
                            <span className="text-xs text-gray-400">{(newAddress.note || '').length}/66</span>
                        </div>
                        <input 
                          type="text" 
                          maxLength={66}
                          className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                          placeholder="e.g. Leave at front desk"
                          value={newAddress.note}
                          onChange={(e) => setNewAddress({...newAddress, note: e.target.value})}
                        />
                    </div>
                </div>
                
                <div className="flex gap-3 mt-2">
                    <button 
                      onClick={() => setShowAddressModal(false)}
                      className="flex-1 py-3 font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                      onClick={handleSaveAddress}
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

export default Checkout;
