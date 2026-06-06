import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';

type TermsSection = {
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

const sections: TermsSection[] = [
  {
    title: '1. Acceptance of Terms',
    paragraphs: [
      'By accessing or using the TakCakap.com platform, you agree to be legally bound by these Terms and Conditions and all related policies referenced herein.',
      'If you do not agree, you must discontinue use immediately.'
    ]
  },
  {
    title: '2. Definitions',
    paragraphs: [],
    bullets: [
      'Platform - TakCakap.com website and whole system within the site',
      'Company / We / Us - DE WARISAN IBUNDA ENTERPRISE',
      'User / Customer - any person accessing or placing orders',
      'Vendor - any third-party supplier whose products may be offered'
    ]
  },
  {
    title: '3. Eligibility',
    paragraphs: [
      'Users under 18 may use the platform only with consent and supervision of a parent or legal guardian who agrees to be responsible for the order.'
    ]
  },
  {
    title: '4. Account Registration',
    paragraphs: [
      'Users may create accounts to place orders. You agree to:'
    ],
    bullets: [
      'provide accurate information',
      'keep login credentials secure',
      'accept responsibility for activity under your account'
    ]
  },
  {
    title: '5. Orders & Payment',
    paragraphs: [
      'All orders must be paid online in full before processing.',
      'Cash payments are not accepted.',
      'Orders become final immediately after payment confirmation, except where cancellation is required under applicable consumer protection laws.',
      'Customer-initiated cancellation is not allowed after payment confirmation.',
      'Customer-initiated cancellation is not eligible for refund except where required by applicable law or approved at our sole discretion.',
      'Pricing and availability are subject to change without prior notice.'
    ]
  },
  {
    title: '6. Products & Vendors',
    paragraphs: [
      'Most food items are prepared directly by us. Some items may be supplied by third-party vendors.',
      'We strive for accuracy in product descriptions but do not guarantee that descriptions, images, or availability are always error-free.'
    ]
  },
  {
    title: '7. Delivery & Pickup',
    paragraphs: [
      'We offer:'
    ],
    bullets: [
      'Self-pickup',
      'Delivery via third-party logistics providers - Lalamove'
    ]
  },
  {
    title: '8. Refunds & Replacements',
    paragraphs: [
      'All purchases are subject to our Refund & Replacement Policy, which forms part of these Terms.',
      'Summary:',
      'No refunds after payment, except where required by applicable law or approved at our sole discretion.',
      'Eligible issues may be resolved via replacement or re-delivery at our discretion.',
      'Claims should be submitted within 2 hours of receipt where reasonably possible, via email, WhatsApp, or any official support channel, and require verification and evidence.',
      'Official support channels are those published on TakCakap.com or communicated by us through our official business accounts.',
      'Refunds may only be issued where required by applicable law or at our discretion in exceptional cases.'
    ]
  },
  {
    title: '9. Customer Responsibilities',
    paragraphs: [
      'Customers agree to:'
    ],
    bullets: [
      'provide accurate delivery information',
      'be available to receive deliveries',
      'review order details before payment'
    ]
  },
  {
    title: '10. Third-Party Services',
    paragraphs: [
      'Our platform may rely on third parties including:'
    ],
    bullets: [
      'payment processors',
      'logistics providers'
    ]
  },
  {
    title: '11. Privacy & Data Protection',
    paragraphs: [
      'Your personal data is processed according to our Privacy Policy, which forms part of these Terms.',
      'By using our platform, you consent to our data practices as described in that policy.'
    ]
  },
  {
    title: '12. Platform Availability',
    paragraphs: [
      'We do not guarantee uninterrupted access. Service may be interrupted due to:'
    ],
    bullets: [
      'maintenance',
      'updates',
      'technical issues',
      'external factors'
    ]
  },
  {
    title: '13. Limitation of Liability',
    paragraphs: [
      'To the fullest extent permitted by Malaysian law, we shall not be liable for:'
    ],
    bullets: [
      'indirect losses',
      'courier delays',
      'service interruptions',
      'third-party failures',
      'customer input errors'
    ]
  },
  {
    title: '14. Abuse & Fraud Prevention',
    paragraphs: [
      'We reserve the right to investigate suspicious activity including:'
    ],
    bullets: [
      'repeated claims',
      'false reports',
      'abuse of policies'
    ]
  },
  {
    title: '15. Right to Refuse Service',
    paragraphs: [
      'We reserve the right to refuse service or cancel orders at our discretion where necessary to protect our operations, users, or business interests.'
    ]
  },
  {
    title: '16. Intellectual Property',
    paragraphs: [
      'All platform content including branding, system design, text, and graphics is owned by us unless otherwise stated.',
      'Unauthorized use is prohibited.'
    ]
  },
  {
    title: '17. Policy Integration Clause',
    paragraphs: [
      'The following policies form an integral part of these Terms:'
    ],
    bullets: [
      'Privacy Policy',
      'Refund & Replacement Policy',
      'Delivery Policy',
      'Any additional policies published on the platform'
    ]
  },
  {
    title: '18. Changes to Terms',
    paragraphs: [
      'We may update these Terms at any time. Updates become effective upon posting.',
      'Updates will be posted on this page and may be notified via platform announcement where appropriate.',
      'Continued use of the platform constitutes acceptance of updated Terms.'
    ]
  },
  {
    title: '19. Governing Law',
    paragraphs: [
      'These Terms shall be governed by and interpreted under the laws of Malaysia.',
      'Disputes shall be subject to Malaysian courts.'
    ]
  },
  {
    title: '20. Severability',
    paragraphs: [
      'If any provision of these Terms is found invalid or unenforceable, the remaining provisions shall remain in full force and effect.'
    ]
  }
];

const TermsOfService: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-[#fffdf8] to-[#f4fff4] px-4 py-8 sm:py-12">
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

          <h1 className="mt-6 text-3xl font-extrabold text-background-dark">Terms and Conditions</h1>
          <p className="mt-2 text-sm font-semibold text-zinc-600">DE WARISAN IBUNDA ENTERPRISE (201003028216)</p>
          <p className="mt-1 text-sm text-zinc-500">Effective Date: 21 FEB 2026</p>
          <p className="mt-4 text-sm leading-relaxed text-zinc-600">
            This Terms and Conditions document governs use of the TakCakap.com platform and all related services.
          </p>

          <section className="mt-6 space-y-5 text-sm text-zinc-700">
            {sections.map((section) => (
              <div key={section.title} className="rounded-2xl border border-zinc-200 bg-white/80 p-4 sm:p-5">
                <h2 className="font-bold text-background-dark">{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mt-2 leading-relaxed">
                    {paragraph}
                  </p>
                ))}
                {section.bullets && (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="leading-relaxed">{bullet}</li>
                    ))}
                  </ul>
                )}
                {section.title === '4. Account Registration' && (
                  <p className="mt-2 leading-relaxed">
                    We reserve the right to suspend or terminate accounts that violate policies, abuse promotions, submit fraudulent claims, or
                    interfere with platform operations.
                  </p>
                )}
                {section.title === '7. Delivery & Pickup' && (
                  <>
                    <p className="mt-2 leading-relaxed">
                      Delivery services are governed by our Delivery Policy, which forms part of these Terms.
                    </p>
                    <p className="mt-2 leading-relaxed">Key conditions:</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      <li className="leading-relaxed">delivery times are estimates only</li>
                      <li className="leading-relaxed">delays are not guaranteed against</li>
                      <li className="leading-relaxed">once an order is handed to the delivery partner, delivery execution is managed by the third-party courier</li>
                    </ul>
                  </>
                )}
                {section.title === '9. Customer Responsibilities' && (
                  <p className="mt-2 leading-relaxed">
                    Failure to comply may result in failed delivery without replacement or refund, except where required by applicable law or
                    approved at our sole discretion.
                  </p>
                )}
                {section.title === '10. Third-Party Services' && (
                  <p className="mt-2 leading-relaxed">
                    We shall not be responsible for failures caused solely by third-party services beyond our control.
                  </p>
                )}
                {section.title === '14. Abuse & Fraud Prevention' && (
                  <p className="mt-2 leading-relaxed">
                    Accounts involved may be restricted or terminated without notice.
                  </p>
                )}
                {section.title === '17. Policy Integration Clause' && (
                  <p className="mt-2 leading-relaxed">
                    In case of conflict, the specific policy shall prevail over general terms.
                  </p>
                )}
              </div>
            ))}
          </section>

          <div className="mt-8 flex flex-wrap gap-3 border-t border-zinc-200 pt-5">
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

export default TermsOfService;
