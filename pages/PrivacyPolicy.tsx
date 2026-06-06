import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-[#fcfbff] to-[#f4fff4] px-4 py-8 sm:py-12">
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

          <h1 className="mt-6 text-3xl font-extrabold text-background-dark">Privacy Policy</h1>
          <p className="mt-2 text-sm font-semibold text-zinc-600">DE WARISAN IBUNDA ENTERPRISE (201003028216)</p>
          <p className="mt-1 text-sm text-zinc-500">Effective Date: 21 FEB 2026</p>

          <section className="mt-6 space-y-5 text-sm text-zinc-700">
            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">1. Introduction</h2>
              <p className="mt-2 leading-relaxed">
                This Privacy Policy explains how DE WARISAN IBUNDA ENTERPRISE ("we", "our", or "us") collects, uses, discloses, and protects
                your personal data when you use our platform TakCakap.
              </p>
              <p className="mt-2 leading-relaxed">
                By using our platform, you consent to the collection and use of your information in accordance with this policy.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">2. Personal Data We Collect</h2>
              <p className="mt-2 leading-relaxed">We may collect the following personal data:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Full name</li>
                <li>Phone number</li>
                <li>Email address</li>
                <li>Delivery or pickup address</li>
              </ul>
              <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
                <h3 className="font-semibold text-background-dark">Third-Party Authentication Data</h3>
                <p className="mt-1 leading-relaxed">
                  We may collect personal data from third-party authentication providers (such as Google) when you
                  choose to sign in using those services. This may include your name, email address, and profile
                  information authorized by you.
                </p>
              </div>
              <p className="mt-2 leading-relaxed">
                We only collect information necessary to process your orders and operate our services.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">3. How We Use Your Data</h2>
              <p className="mt-2 leading-relaxed">Your data is used strictly for operational purposes, including:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Processing orders</li>
                <li>Contacting you regarding your order</li>
                <li>Delivery coordination</li>
                <li>Customer support</li>
                <li>Preventing fraud or abuse</li>
              </ul>
              <p className="mt-2 leading-relaxed">We do not sell or rent your personal data to third parties.</p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">4. Data Sharing</h2>
              <p className="mt-2 leading-relaxed">We may share limited data only when necessary:</p>
              <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
                <h3 className="font-semibold text-background-dark">Delivery Partners</h3>
                <p className="mt-1 leading-relaxed">We share only:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>phone number</li>
                  <li>delivery address or coordinates</li>
                </ul>
                <p className="mt-2 leading-relaxed">This is solely for order fulfillment.</p>
              </div>
              <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
                <h3 className="font-semibold text-background-dark">Payment Gateway</h3>
                <p className="mt-1 leading-relaxed">Payments are processed through third-party provider Razorpay Curlec.</p>
                <p className="mt-2 leading-relaxed">The payment gateway may collect payment-related information such as:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>payment details</li>
                  <li>name</li>
                  <li>phone number</li>
                </ul>
                <p className="mt-2 leading-relaxed">We do not store any sensitive payment details on our servers.</p>
                <p className="mt-2 leading-relaxed">
                  Payment processing is governed by the payment provider's own privacy and security policies.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">5. Data Storage & Security</h2>
              <p className="mt-2 leading-relaxed">
                Your personal data is primarily stored on servers hosted in Malaysia and managed by DE WARISAN IBUNDA ENTERPRISE.
              </p>
              <p className="mt-2 leading-relaxed">
                Certain data may be processed by third-party service providers (including payment gateways and logistics partners) according to
                their own privacy and security policies.
              </p>
              <p className="mt-2 leading-relaxed">
                We implement reasonable administrative and technical safeguards to protect personal data against:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>unauthorized access</li>
                <li>misuse</li>
                <li>disclosure</li>
              </ul>
              <p className="mt-2 leading-relaxed">
                However, no system is 100% secure. By using our platform, you acknowledge this risk.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">6. Data Retention</h2>
              <p className="mt-2 leading-relaxed">We retain personal data only as long as necessary for:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>order records</li>
                <li>legal obligations</li>
                <li>dispute resolution</li>
                <li>business operations</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">7. Cookies & Tracking</h2>
              <p className="mt-2 leading-relaxed">
                We currently do not use tracking tools, analytics software, or advertising pixels.
              </p>
              <p className="mt-2 leading-relaxed">
                If this changes in the future, this policy will be updated.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">8. User Rights (PDPA Compliance)</h2>
              <p className="mt-2 leading-relaxed">Under Malaysian Personal Data Protection laws, you have the right to:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>request access to your personal data</li>
                <li>request correction of inaccurate data</li>
                <li>withdraw consent for data processing</li>
              </ul>
              <p className="mt-2 leading-relaxed">
                Withdrawing consent may affect our ability to provide services, including processing orders and deliveries.
              </p>
              <p className="mt-2 leading-relaxed">
                Requests may be submitted through our official contact channels, including email, WhatsApp, or other support channels.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">9. Third-Party Links</h2>
              <p className="mt-2 leading-relaxed">
                Our platform may contain links to third-party services. We are not responsible for their privacy practices.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">10. Data Breach Response</h2>
              <p className="mt-2 leading-relaxed">
                In the event of a data breach affecting personal data, we will take reasonable steps to investigate, mitigate risks, and notify
                affected users where required by law.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">11. Policy Updates</h2>
              <p className="mt-2 leading-relaxed">
                We may update this Privacy Policy from time to time. Changes will be posted on this page with a revised effective date.
              </p>
              <p className="mt-2 leading-relaxed">
                Updates will be posted on this page and may be notified via platform announcement where appropriate.
              </p>
              <p className="mt-2 leading-relaxed">Continued use of our platform indicates acceptance of updates.</p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
              <h2 className="font-bold text-background-dark">12. Contact Us</h2>
              <p className="mt-2 leading-relaxed">For privacy-related inquiries:</p>
              <ul className="mt-2 list-none space-y-1 pl-0">
                <li><span className="font-semibold">Business Name:</span> DE WARISAN IBUNDA ENTERPRISE</li>
                <li><span className="font-semibold">Email:</span> support@takcakap.com</li>
                <li><span className="font-semibold">Phone:</span> +6011667670365</li>
              </ul>
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
              to="/refund-replacement-policy"
              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-background-dark hover:border-primary/60 hover:text-primary"
            >
              View Refund & Replacement Policy
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

export default PrivacyPolicy;
