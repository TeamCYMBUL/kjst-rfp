// Public legal pages (Privacy Policy + Terms of Service), linked from the
// hotel-facing RFP/contract forms and the staff login. These are additive,
// static, unauthenticated pages — no platform data or logic is touched.
//
// NOTE: this is a solid, honest starting scaffold reflecting how the platform
// actually handles data. It is NOT legal advice and should be reviewed by
// counsel before being relied on. Update the bracketed items and the
// "last updated" date as needed.
import { Link } from 'react-router-dom'

const LAST_UPDATED = 'August 21, 2026'
const CONTACT = 'info@cymbul.co'
const COMPANY = 'KJ Sports Travel, Inc.'

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-widest text-slate-500">KJ Sports Travel</div>
          <Link to="/login" className="text-sm text-[#1C1008] underline">Back to sign in</Link>
        </div>
        <h1 className="mb-1 text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mb-8 text-xs text-slate-400">Last updated: {LAST_UPDATED}</p>
        <div className="space-y-5 text-sm leading-relaxed text-slate-700">{children}</div>
        <div className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-400">
          <Link to="/privacy" className="underline">Privacy Policy</Link>
          {' · '}
          <Link to="/terms" className="underline">Terms of Service</Link>
        </div>
      </div>
    </div>
  )
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-3 text-base font-semibold text-slate-900">{children}</h2>
}

export function PrivacyPolicy() {
  return (
    <Shell title="Privacy Policy">
      <p>
        This RFP platform is operated by {COMPANY} ("we," "us") to request and manage hotel proposals
        on behalf of our clients. This policy explains what information we collect through the platform,
        how we use it, and the choices available to you. It applies to the hotel-facing request forms and
        the internal staff application.
      </p>

      <H>Information we collect</H>
      <p>
        <strong>From hotels responding to a request:</strong> the contact name and email address we send a
        request to, and the rate, availability, concession, and comment information you enter and submit in
        the response form. <strong>From our staff users:</strong> account name and email used to sign in.
        We do not collect payment card information, and the platform does not process payments.
      </p>

      <H>How we use it</H>
      <p>
        We use this information solely to source, compare, and administer hotel proposals for our clients'
        travel programs, to communicate about a specific request, and to operate and secure the platform.
        We do not sell personal information, and we do not use it for advertising.
      </p>

      <H>Cookies</H>
      <p>
        We use only strictly necessary cookies required to keep a signed-in staff session active. We do not
        use advertising or analytics/tracking cookies, so no cookie-consent banner is required.
      </p>

      <H>Service providers</H>
      <p>
        We host and operate the platform using a small set of vetted providers who process data on our behalf
        under their data-processing terms: Supabase (database and hosting), Vercel (application hosting), and
        Resend (transactional email). These providers process data only to provide their services to us.
      </p>

      <H>Data retention</H>
      <p>
        We retain request and response data for as long as needed to administer the relevant travel program
        and our business records, and then delete or archive it. You may request deletion of your personal
        information as described below.
      </p>

      <H>Your rights</H>
      <p>
        Depending on your location (including under the EU/UK GDPR and the California CCPA/CPRA), you may have
        the right to access, correct, delete, or restrict the use of your personal information, and to object
        to certain processing. To exercise any of these rights, contact us at{' '}
        <a href={`mailto:${CONTACT}`} className="text-[#1C1008] underline">{CONTACT}</a>. We will respond within
        the timeframe required by applicable law.
      </p>

      <H>International data</H>
      <p>
        The platform and its providers store data in the United States. If you contact us from outside the
        United States, your information will be processed in the United States.
      </p>

      <H>Contact</H>
      <p>
        Questions about this policy or your data: <a href={`mailto:${CONTACT}`} className="text-[#1C1008] underline">{CONTACT}</a>.
      </p>
    </Shell>
  )
}

export function TermsOfService() {
  return (
    <Shell title="Terms of Service">
      <p>
        These terms govern use of this RFP platform operated by {COMPANY}. By accessing a request form or
        signing in, you agree to these terms.
      </p>

      <H>Permitted use</H>
      <p>
        The platform is provided to invited hotels (to submit proposals) and to authorized staff (to manage
        requests). You agree to use it only for its intended purpose, to provide accurate information, and not
        to attempt to access data belonging to any other party.
      </p>

      <H>Submissions</H>
      <p>
        Rates and terms you submit are a proposal for consideration and do not create a binding agreement
        until separately confirmed in writing. You are responsible for the accuracy of what you submit and may
        be asked to confirm or update it.
      </p>

      <H>Confidentiality</H>
      <p>
        Pricing and proposal details submitted through the platform are treated as confidential and are shared
        only with the relevant client and authorized staff. Each response link grants access to a single
        response only.
      </p>

      <H>Availability and changes</H>
      <p>
        We provide the platform "as is" and may update, suspend, or modify features to improve or secure it.
        We are not liable for indirect or consequential damages arising from use of the platform to the extent
        permitted by law.
      </p>

      <H>Contact</H>
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT}`} className="text-[#1C1008] underline">{CONTACT}</a>.
      </p>
    </Shell>
  )
}
