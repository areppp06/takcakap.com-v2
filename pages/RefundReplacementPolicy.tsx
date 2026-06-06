import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';

const RefundReplacementPolicy: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-[#f8fcff] to-[#f4fff4] px-4 py-8 sm:py-12">
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

          <h1 className="mt-6 text-3xl font-extrabold text-background-dark">Refund & Replacement Policy (Revised)</h1>
          <p className="mt-2 text-sm font-semibold text-zinc-600">DE WARISAN IBUNDA ENTERPRISE (201003028216)</p>
          <p className="mt-1 text-sm text-zinc-500">Effective Date: 21 FEB 2026</p>

          <section className="mt-6 space-y-5 text-sm text-zinc-700">
            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">1. General Policy</h2>
              <p className="mt-2 leading-relaxed">
                All orders placed through our platform are final once payment is successfully made.
              </p>
              <p className="mt-2 leading-relaxed">
                We operate under a Strict Replacement Policy. Refunds are generally not provided except where required by applicable law or as
                expressly stated in this policy.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">2. Replacement Eligibility</h2>
              <p className="mt-2 leading-relaxed">Customers may request a replacement only if:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Wrong item was delivered</li>
                <li>Food received is spoiled or unfit for consumption</li>
                <li>Order was not delivered successfully</li>
              </ul>
              <p className="mt-2 leading-relaxed">
                For non-delivery cases, we may arrange replacement or re-delivery at our discretion, subject to verification with the delivery
                partner.
              </p>
              <p className="mt-2 leading-relaxed">
                Claims should be submitted within 2 hours of receipt where reasonably possible, via email, WhatsApp, or any official support
                channel the customer is comfortable using, and must include sufficient proof where requested (e.g., photo evidence).
              </p>
              <p className="mt-2 leading-relaxed">
                Official support channels are those published on TakCakap.com or communicated by us through our official business accounts.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">3. Non-Eligible Cases</h2>
              <p className="mt-2 leading-relaxed">Replacement requests will be rejected if:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Customer changes their mind</li>
                <li>Incorrect order placed by customer</li>
                <li>Delay caused by delivery partner</li>
                <li>Customer unavailable during delivery</li>
                <li>Minor variations in taste, appearance, or packaging</li>
              </ul>
              <p className="mt-2 leading-relaxed">
                Non-eligible cases are not entitled to replacement or refund, except where required by applicable law or approved at our sole
                discretion.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">4. Delivery Delays</h2>
              <p className="mt-2 leading-relaxed">Delivery services are handled by third-party logistics providers.</p>
              <p className="mt-2 leading-relaxed">
                We are not responsible for delivery delays caused by external factors including:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>traffic conditions</li>
                <li>weather</li>
                <li>courier issues</li>
                <li>incorrect address provided</li>
              </ul>
              <p className="mt-2 leading-relaxed">Delivery delays do not qualify for replacement or compensation.</p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">5. No-Refund Policy</h2>
              <p className="mt-2 leading-relaxed">We maintain a strict no-refund policy to prevent fraud and abuse.</p>
              <p className="mt-2 leading-relaxed">
                Customer-initiated cancellation is not allowed after payment confirmation and is not eligible for refund, except where required by
                applicable law or approved at our sole discretion.
              </p>
              <p className="mt-2 leading-relaxed">Refunds will only be issued where:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>required under applicable law, or</li>
                <li>explicitly stated in this policy, or</li>
                <li>determined appropriate at our sole discretion in exceptional cases.</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">6. Order Cancellation by Us</h2>
              <p className="mt-2 leading-relaxed">
                We reserve the right to cancel any order if an item becomes unavailable, cannot be fulfilled, or due to operational limitations.
              </p>
              <p className="mt-2 leading-relaxed">If we cancel an order:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>the customer will be notified, and</li>
                <li>a full refund will be issued using the original payment method.</li>
              </ul>
              <p className="mt-2 leading-relaxed">
                Refunds will be processed within a reasonable timeframe, typically within 3 to 14 business days, depending on the payment
                provider.
              </p>
              <p className="mt-2 leading-relaxed">This clause applies only when cancellation is initiated by us.</p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">7. Verification Process</h2>
              <p className="mt-2 leading-relaxed">We reserve the right to:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>investigate all claims</li>
                <li>request evidence</li>
                <li>refuse requests suspected of abuse or fraud</li>
              </ul>
              <p className="mt-2 leading-relaxed">False claims may result in account suspension or termination.</p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">8. Resolution Method</h2>
              <p className="mt-2 leading-relaxed">Approved claims will be resolved via:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>replacement of item, or</li>
                <li>re-delivery of order</li>
              </ul>
              <p className="mt-2 leading-relaxed">
                Re-delivery may not be provided where delivery fails due to customer unavailability.
              </p>
              <p className="mt-2 leading-relaxed">Resolution method will be determined solely by us.</p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">9. Processing Time</h2>
              <p className="mt-2 leading-relaxed">
                Approved replacements will be processed within a reasonable timeframe depending on:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>product availability</li>
                <li>operational capacity</li>
                <li>courier availability</li>
              </ul>
            </div>
          </section>

          <div className="mt-8 flex flex-wrap gap-3 border-t border-zinc-200 pt-5">
            <Link
              to="/privacy-policy"
              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-background-dark hover:border-primary/60 hover:text-primary"
            >
              View Privacy Policy
            </Link>
            <Link
              to="/terms-of-service"
              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-background-dark hover:border-primary/60 hover:text-primary"
            >
              View Terms & Conditions
            </Link>
            <Link
              to="/delivery-policy"
              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-background-dark hover:border-primary/60 hover:text-primary"
            >
              View Delivery Policy
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

export default RefundReplacementPolicy;
