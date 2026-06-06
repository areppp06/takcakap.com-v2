import React from 'react';
import { Link } from 'react-router-dom';

const OrderFailed: React.FC = () => {
  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark flex flex-col items-center justify-center p-4">
       <div className="max-w-md w-full bg-white dark:bg-zinc-900 rounded-xl shadow-xl overflow-hidden border border-primary/5">
          <div className="pt-10 pb-6 px-6 flex flex-col items-center text-center">
             <div className="size-20 bg-error-soft rounded-full flex items-center justify-center mb-6">
                <span className="material-symbols-outlined text-error-main text-5xl">error</span>
             </div>
             <h1 className="text-zinc-900 dark:text-white text-3xl font-bold tracking-tight mb-2">Payment Failed</h1>
             <p className="text-zinc-500 dark:text-zinc-400 text-base">Something went wrong. Please try again.</p>
          </div>
          <div className="p-8 flex flex-col gap-4">
             <Link to="/checkout" className="w-full bg-primary hover:bg-primary/90 text-background-dark py-4 rounded-lg font-bold text-lg transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2">
                <span className="material-symbols-outlined">refresh</span>
                Try Again
             </Link>
          </div>
       </div>
    </div>
  );
};

export default OrderFailed;