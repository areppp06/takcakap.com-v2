import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';

const DeliveryPolicy: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-[#f8fffd] to-[#f4fff4] px-4 py-8 sm:py-12">
      <main className="mx-auto max-w-4xl">
        <div className="rounded-3xl border border-primary/20 bg-white/90 p-6 shadow-lg sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-5">
            <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-600 hover:text-primary">
              <span className="material-symbols-outlined text-base">arrow_back</span>
              Back to Home
            </Link>
            <BrandLogo
              alt="Brand logo"
              className="h-[34px] w-[94px] object-contain object-right"
              fallbackIcon="restaurant"
              fallbackIconClassName="material-symbols-outlined block text-3xl text-primary font-bold"
            />
          </div>

          <h1 className="mt-6 text-3xl font-extrabold text-background-dark">Delivery Policy</h1>
          <p className="mt-2 text-sm font-semibold text-zinc-600">DE WARISAN IBUNDA ENTERPRISE (201003028216)</p>
          <p className="mt-1 text-sm text-zinc-500">Effective Date: 21 FEB 2026</p>

          <section className="mt-6 space-y-5 text-sm text-zinc-700">
            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">1. Delivery Method</h2>
              <p className="mt-2 leading-relaxed">
                We offer delivery through third-party logistics providers, including but not limited to Lalamove.
              </p>
              <p className="mt-2 leading-relaxed">
                All delivery services are handled independently by the delivery partner and are subject to their own terms, conditions, and
                operational limitations.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">2. Delivery Time</h2>
              <p className="mt-2 leading-relaxed">
                Delivery times shown at checkout are estimates only and are provided by the third-party delivery partner.
              </p>
              <p className="mt-2 leading-relaxed">
                We shall not be liable for delivery delays caused by factors beyond our reasonable control, including:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>traffic conditions</li>
                <li>weather</li>
                <li>courier issues</li>
                <li>operational constraints</li>
                <li>incorrect delivery details</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">3. Delivery Fees</h2>
              <p className="mt-2 leading-relaxed">Delivery charges are calculated and displayed during checkout.</p>
              <p className="mt-2 leading-relaxed">Customers are responsible for paying delivery fees at the time of order confirmation.</p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">4. Customer Availability</h2>
              <p className="mt-2 leading-relaxed">
                Customers must ensure they are available to receive their order at the delivery location.
              </p>
              <p className="mt-2 leading-relaxed">If the customer is unavailable:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>the matter becomes the responsibility of the customer and delivery partner</li>
                <li>we are not liable for failed delivery attempts</li>
                <li>re-delivery may not be provided where delivery fails due to customer unavailability</li>
                <li>no refunds or replacements will normally be provided, except where required by applicable law or approved at our sole discretion</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">5. Delivery Address Accuracy</h2>
              <p className="mt-2 leading-relaxed">
                Customers must provide accurate delivery information before placing an order.
              </p>
              <p className="mt-2 leading-relaxed">Once an order is confirmed:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>delivery addresses cannot be changed</li>
              </ul>
              <p className="mt-2 leading-relaxed">
                We are not responsible for failed deliveries caused by incorrect or incomplete address details.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">6. Scheduled Orders</h2>
              <p className="mt-2 leading-relaxed">We may allow customers to schedule orders in advance.</p>
              <p className="mt-2 leading-relaxed">
                Scheduled delivery times remain subject to courier availability and are not guaranteed.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">7. Instant Orders</h2>
              <p className="mt-2 leading-relaxed">
                Instant orders are processed immediately after payment confirmation and prepared as soon as possible.
              </p>
              <p className="mt-2 leading-relaxed">Preparation time may vary depending on operational volume.</p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">8. Liability Limitation</h2>
              <p className="mt-2 leading-relaxed">We are not responsible for:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>delivery delays</li>
                <li>courier conduct</li>
                <li>lost items during delivery</li>
                <li>damages occurring after handover to courier</li>
              </ul>
              <p className="mt-2 leading-relaxed">
                Once an order is handed to the delivery partner, delivery execution is managed by the third-party courier.
              </p>
              <p className="mt-2 leading-relaxed">
                "Handover" means when the order is collected by the delivery partner from our premises.
              </p>
            </div>
          </section>

          <div className="mt-8 flex flex-wrap gap-3 border-t border-zinc-200 pt-5">
            <Link
              to="/terms-of-service"
              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-background-dark hover:border-primary/60 hover:text-primary"
            >
              View Terms & Conditions
            </Link>
            <Link
              to="/privacy-policy"
              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-background-dark hover:border-primary/60 hover:text-primary"
            >
              View Privacy Policy
            </Link>
            <Link
              to="/refund-replacement-policy"
              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-background-dark hover:border-primary/60 hover:text-primary"
            >
              View Refund & Replacement Policy
            </Link>
            <Link
              to="/"
              className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-background-dark hover:bg-primary/20"
            >
              Return to Menu
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DeliveryPolicy;
