import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const OrderSuccess: React.FC = () => {
  const location = useLocation();
  const successState = location.state as {
    orderId?: string;
    orderType?: 'Pickup' | 'Delivery';
    deliveryProvider?: 'Internal' | 'Lalamove';
    trackingUrl?: string | null;
    externalOrderId?: string | null;
  } | null;

  const trackingUrl = successState?.trackingUrl || null;
  const isLalamoveTracking = Boolean(trackingUrl && successState?.deliveryProvider === 'Lalamove');
  const statusMessage = successState?.orderType === 'Delivery'
    ? 'Payment received. We are now finding a Lalamove rider for your order.'
    : 'Payment received. Your order is now in preparation.';

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark flex flex-col items-center justify-center p-4">
       <div className="max-w-md w-full bg-white dark:bg-zinc-900 rounded-xl shadow-xl overflow-hidden border border-primary/5">
          <div className="relative h-48 flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
             <div className="bg-primary text-background-dark size-20 rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(230,25,221,0.4)] mb-4">
                <span className="material-symbols-outlined !text-4xl font-bold">check</span>
             </div>
          </div>
          <div className="p-8 text-center">
             <h1 className="text-[#0d1c0d] dark:text-white text-3xl font-bold leading-tight mb-2">Payment Successful!</h1>
             <p className="text-gray-500 dark:text-gray-400 text-sm mt-4">{statusMessage}</p>
             {successState?.orderId && (
               <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Order Ref: {successState.orderId}</p>
             )}
             {isLalamoveTracking && successState?.externalOrderId && (
               <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Lalamove Ref: {successState.externalOrderId}</p>
             )}
             <div className="mt-8 space-y-3">
                {isLalamoveTracking ? (
                  <a
                    href={trackingUrl as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full py-4 bg-primary hover:bg-[#1fd91f] text-background-dark font-bold rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined">local_shipping</span>
                    Track on Lalamove
                  </a>
                ) : (
                  <Link to="/dashboard" className="block w-full py-4 bg-primary hover:bg-[#1fd91f] text-background-dark font-bold rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined">map</span>
                      Track Order
                  </Link>
                )}
                {successState?.orderType !== 'Pickup' && (
                  <Link to="/orders" className="block w-full py-3 bg-transparent hover:bg-primary/5 text-[#0d1c0d] dark:text-gray-300 font-semibold rounded-xl transition-all">
                      Check Status
                  </Link>
                )}
             </div>
          </div>
       </div>
    </div>
  );
};

export default OrderSuccess;
