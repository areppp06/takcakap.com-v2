import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useCart } from '../contexts/CartContext';
import { currentUser } from '../services/mockData';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils/currency';
import { DeliveryRecipient, DeliveryQuoteStop, OrderAddressSnapshot } from '../types';

const ScanPay: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const activeUser = user || currentUser;
  const duitNowLogoUrl = import.meta.env.VITE_DUITNOW_LOGO_URL || '/duitnow-logo.png';
  const defaultQrUrl =
    import.meta.env.VITE_DUITNOW_QR_URL ||
    'https://res.cloudinary.com/dzayh29d7/image/upload/v1770301357/KC_QR_vljdez.png';
  const { cart, cartTotal, clearCart, isLoading: isCartLoading } = useCart();
  const [isProcessing, setIsProcessing] = useState(false);
  const [qrImageUrl, setQrImageUrl] = useState(defaultQrUrl);
  const [serviceFee, setServiceFee] = useState(1.8);

  // Retrieve passed state from Checkout
  const orderDetails = location.state as {
      orderType: 'Pickup' | 'Delivery';
      address: string;
      items: any[];
      total: number;
      deliveryFee?: number;
      deliveryCurrency?: string;
      quotationId?: string;
      quotationStops?: DeliveryQuoteStop[];
      recipient?: DeliveryRecipient;
      addressSnapshot?: OrderAddressSnapshot;
      deliveryTiming?: 'NOW' | 'SCHEDULED';
      scheduledAtUtc?: string;
      paymentMethod?: 'DuitNow' | 'Curlec';
  } || {
      orderType: 'Pickup',
      address: '',
      items: [],
      total: 0
  };

  const fees = Math.max(0, Number(serviceFee || 0));
  const deliveryFee = orderDetails.orderType === 'Delivery' ? (orderDetails.deliveryFee || 0) : 0;
  const total = orderDetails.total || (cartTotal + fees + deliveryFee);

  // Redirect if cart is empty, but NOT if we are processing a payment (which clears the cart)
  useEffect(() => {
    if (!isCartLoading && cart.length === 0 && !isProcessing) {
        navigate('/');
    }
  }, [cart, navigate, isProcessing, isCartLoading]);

  useEffect(() => {
    let cancelled = false;
    const loadPaymentOptions = async () => {
      try {
        const options = await api.getPaymentOptions();
        if (!cancelled && options?.duitnowEnabled === false) {
          alert('DuitNow Scan & Pay is currently disabled. Please choose another payment method.');
          navigate('/checkout', { replace: true });
          return;
        }
        if (!cancelled && options?.duitnowQrUrl) {
          setQrImageUrl(options.duitnowQrUrl);
        }
        if (!cancelled && options?.serviceFee !== undefined) {
          setServiceFee(Math.max(0, Number(options.serviceFee || 0)));
        }
      } catch (error) {
        console.error('Failed to fetch payment options:', error);
      }
    };
    loadPaymentOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePaymentSuccess = async () => {
      setIsProcessing(true);
      try {
          // Create the order in the backend
          const createdOrder = await api.createOrder({
              userId: activeUser.id,
              items: cart,
              total: total,
              orderType: orderDetails.orderType,
              address: orderDetails.address,
              addressSnapshot: orderDetails.addressSnapshot,
              quotationId: orderDetails.quotationId,
              quotationStops: orderDetails.quotationStops || [],
              deliveryFee: orderDetails.deliveryFee,
              deliveryCurrency: orderDetails.deliveryCurrency || 'MYR',
              recipient: orderDetails.recipient,
              paymentMethod: 'DuitNow',
              deliveryTiming: orderDetails.deliveryTiming,
              scheduledAtUtc: orderDetails.scheduledAtUtc
          });
          
          // Clear cart then navigate. 
          // The useEffect above checks !isProcessing, so it won't redirect to home.
          await clearCart();
          navigate('/success', {
              state: {
                  orderId: createdOrder?.shortCode || createdOrder?.orderId || null,
                  orderType: orderDetails.orderType,
                  deliveryProvider: orderDetails.orderType === 'Delivery' ? 'Lalamove' : 'Internal',
                  trackingUrl: createdOrder?.trackingUrl || null,
                  externalOrderId: createdOrder?.externalOrderId || null
              }
          });
      } catch (error) {
          console.error("Order creation failed", error);
          alert("Failed to process order. Please try again.");
          setIsProcessing(false);
      }
  };

  const handlePaymentFailed = () => {
      // Do NOT clear cart on failure, allowing user to retry
      navigate('/failed');
  };

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-[#0d1c0d] dark:text-white">
       <nav className="sticky top-0 z-50 w-full bg-white/80 dark:bg-background-dark/80 backdrop-blur-md border-b border-[#cee8ce] dark:border-white/10 px-4 md:px-10 py-4">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
             <div className="flex items-center gap-3">
                <div className="bg-primary p-1.5 rounded-lg flex items-center justify-center">
                   <span className="material-symbols-outlined text-[#0d1c0d] font-bold">qr_code_2</span>
                </div>
                <h1 className="text-xl font-bold tracking-tight">Scan & Pay</h1>
             </div>
             <Link to="/checkout" className="flex items-center gap-2 text-sm font-semibold text-[#499c49] hover:text-primary transition-colors">
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                Back
             </Link>
          </div>
       </nav>

       <main className="max-w-5xl mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
             {/* Left Column: Order Summary */}
             <div className="lg:col-span-6 flex flex-col gap-6 order-2 lg:order-1">
                <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-[#cee8ce] dark:border-white/10 shadow-sm">
                   <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                       <span className="material-symbols-outlined text-primary">receipt_long</span>
                       Order Summary
                   </h2>
                   
                   <div className="mb-4 text-sm bg-gray-50 dark:bg-zinc-800 p-3 rounded-lg flex justify-between items-center">
                       <span className="font-bold text-gray-500">Method:</span>
                       <span className="font-bold flex items-center gap-1">
                           <span className="material-symbols-outlined text-sm">{orderDetails.orderType === 'Delivery' ? 'local_shipping' : 'storefront'}</span>
                           {orderDetails.orderType}
                       </span>
                   </div>
                   
                   {/* Scrollable Item List */}
                   <div className="max-h-[300px] overflow-y-auto custom-scrollbar pr-2 space-y-4 mb-6">
                       {cart.map((item) => (
                           <div key={item.id} className="flex items-center gap-3">
                               <div className="h-12 w-12 rounded-lg bg-cover bg-center shrink-0 border border-gray-100 dark:border-zinc-700" style={{ backgroundImage: `url('${item.image}')` }}></div>
                               <div className="flex-1 min-w-0">
                                   <div className="flex justify-between items-start">
                                       <p className="font-bold text-sm truncate">{item.name}</p>
                                       <p className="font-bold text-sm text-primary">{formatCurrency(item.price * item.quantity)}</p>
                                   </div>
                                   <p className="text-xs text-gray-500 dark:text-gray-400">{item.quantity} x {formatCurrency(item.price)}</p>
                               </div>
                           </div>
                       ))}
                   </div>

                   {/* Totals Breakdown */}
                   <div className="space-y-2 pt-4 border-t border-gray-100 dark:border-zinc-800 text-sm">
                       <div className="flex justify-between text-gray-500 dark:text-gray-400">
                           <span>Subtotal</span>
                           <span>{formatCurrency(cartTotal)}</span>
                       </div>
                       <div className="flex justify-between text-gray-500 dark:text-gray-400">
                           <span>Service Fee</span>
                           <span>{formatCurrency(fees)}</span>
                       </div>
                       {orderDetails.orderType === 'Delivery' && (
                           <div className="flex justify-between text-gray-500 dark:text-gray-400">
                               <span>Delivery Fee</span>
                               <span>{formatCurrency(deliveryFee)}</span>
                           </div>
                       )}
                   </div>
                   
                   <div className="flex justify-between items-center mt-4 pt-4 border-t-2 border-dashed border-gray-200 dark:border-zinc-700">
                       <span className="font-bold text-gray-400 uppercase text-xs tracking-wider">Total to Pay</span>
                       <span className="text-2xl font-extrabold">{formatCurrency(total)}</span>
                   </div>
                </div>

                {/* Secure Badge */}
                <div className="flex items-center justify-center gap-2 text-xs text-gray-400 bg-gray-50 dark:bg-zinc-800/50 p-3 rounded-lg">
                    <span className="material-symbols-outlined text-sm">lock</span>
                    Payments are secure and encrypted.
                </div>
             </div>

             {/* Right Column: QR & Actions */}
             <div className="lg:col-span-6 order-1 lg:order-2">
                <div className="bg-white dark:bg-zinc-900 p-8 md:p-12 rounded-2xl border-2 border-primary/20 shadow-xl relative overflow-hidden flex flex-col items-center text-center">
                   
                   {/* DuitNow Badge */}
                   <div className="mb-6 flex flex-col items-center gap-3">
                      <div className="h-14 w-auto bg-white px-4 py-2 flex items-center justify-center rounded border border-gray-100 shadow-sm">
                         <img
                           src={duitNowLogoUrl}
                           alt="DuitNow"
                           className="h-full w-auto object-contain"
                         />
                      </div>
                   </div>

                   {/* QR Code */}
                   <div className="relative p-4 bg-white rounded-2xl border-4 border-primary/10 shadow-sm mb-6 group cursor-pointer transition-transform hover:scale-105">
                      <img
                        src={qrImageUrl}
                        alt="DuitNow QR"
                        className="w-56 h-56 object-contain"
                        onError={() => setQrImageUrl(defaultQrUrl)}
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-white/90">
                          <span className="text-xs font-bold text-primary">Scan with Banking App</span>
                      </div>
                   </div>

                   <p className="text-sm text-gray-500 mb-6">Scan the QR code above using your preferred banking app or e-wallet to complete the payment.</p>

                   {/* Dev Simulation Controls */}
                   <div className="w-full bg-gray-50 dark:bg-zinc-800 rounded-xl p-4 border border-dashed border-gray-300 dark:border-zinc-600">
                       <p className="text-xs font-bold uppercase text-gray-400 mb-3 tracking-wider">Test Environment Controls</p>
                       <div className="grid grid-cols-2 gap-3">
                           <button 
                             onClick={handlePaymentSuccess}
                             disabled={isProcessing}
                             className="py-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg font-bold text-sm shadow-md transition-all active:scale-95 flex items-center justify-center gap-1"
                           >
                               {isProcessing ? 'Processing...' : (
                                   <>
                                    <span className="material-symbols-outlined text-lg">check_circle</span>
                                    Simulate Success
                                   </>
                               )}
                           </button>
                           <button 
                             onClick={handlePaymentFailed}
                             disabled={isProcessing}
                             className="py-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg font-bold text-sm shadow-md transition-all active:scale-95 flex items-center justify-center gap-1"
                           >
                               <span className="material-symbols-outlined text-lg">cancel</span>
                               Simulate Failed
                           </button>
                       </div>
                   </div>

                </div>
             </div>
          </div>
       </main>
    </div>
  );
};

export default ScanPay;
