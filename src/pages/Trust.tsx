// Public Trust Center — the page a client's security reviewer reads. Static, no
// auth, no data fetch. Everything here must be literally true (an overstated
// practice is itself a claim risk); it mirrors security/SECURITY_BASELINE.md.

const UPDATED = 'September 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  )
}

const SUBPROCESSORS: { name: string; purpose: string; region: string }[] = [
  { name: 'Supabase', purpose: 'Database, authentication, and file storage', region: 'United States' },
  { name: 'Vercel', purpose: 'Application hosting and content delivery', region: 'United States' },
  { name: 'Resend', purpose: 'Transactional and notification email', region: 'United States' },
  { name: 'Anthropic', purpose: 'AI contract fact-checking (contracts only)', region: 'United States' },
]

const PRACTICES: { h: string; d: string }[] = [
  { h: 'Tenant isolation', d: 'Row-level security on every database table. One client can never read another client’s data, and a hotel can only ever see its own bid.' },
  { h: 'Encryption', d: 'TLS 1.2+ in transit and AES-256 at rest, provided by our infrastructure.' },
  { h: 'Access control', d: 'Role-based access for staff, scoped per organization; multi-factor authentication available for staff accounts.' },
  { h: 'Hotel links', d: 'Each hotel receives a unique, unguessable 190-bit link that is rate-limited and expires; it grants access to exactly one bid.' },
  { h: 'Monitoring', d: 'Uptime checks every two minutes, error logging, and a daily automated health check.' },
  { h: 'Backups', d: 'The database is backed up nightly, and restores have been tested.' },
  { h: 'Secure development', d: 'Automated tests (including a cross-tenant isolation test) and secret + dependency scanning run on every release. Security posture is reviewed with each change.' },
]

export default function Trust() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-14">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">KJST RFP Platform</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">Trust &amp; Security</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          The RFP platform is built and operated by CYMBUL for KJ Sports Travel. It holds confidential
          hotel pricing and team travel details, so it is designed to keep every client’s data
          isolated, encrypted, monitored, and recoverable. This page summarizes how.
        </p>

        <Section title="Security practices">
          <dl className="space-y-3">
            {PRACTICES.map((p) => (
              <div key={p.h}>
                <dt className="font-semibold text-slate-900">{p.h}</dt>
                <dd className="text-slate-600">{p.d}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Subprocessors">
          <p className="mb-3 text-slate-600">
            We rely on the following vendors to run the platform. Each processes only what its purpose
            requires, under its own data-processing agreement.
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 font-semibold">Vendor</th>
                  <th className="px-4 py-2 font-semibold">Purpose</th>
                  <th className="px-4 py-2 font-semibold">Region</th>
                </tr>
              </thead>
              <tbody>
                {SUBPROCESSORS.map((s) => (
                  <tr key={s.name} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 font-medium text-slate-900">{s.name}</td>
                    <td className="px-4 py-2 text-slate-600">{s.purpose}</td>
                    <td className="px-4 py-2 text-slate-600">{s.region}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Data handling">
          <ul className="list-disc space-y-1 pl-5 text-slate-600">
            <li>Client data is used only to operate the RFP and contracting service. It is never sold.</li>
            <li>On termination, a client’s data is exported on request and then deleted.</li>
            <li>Regulated data categories (health, payment-card, biometric, children’s data) are not accepted without a prior written agreement.</li>
            <li>AI is used only to fact-check uploaded contracts; client data is not used to train models.</li>
          </ul>
        </Section>

        <Section title="Incident response">
          <p className="text-slate-600">
            We maintain a written incident-response plan. In the event of a security incident affecting
            client data, we contain it, preserve evidence, and notify affected clients without undue delay.
          </p>
        </Section>

        <Section title="Compliance">
          <p className="text-slate-600">
            The platform runs on infrastructure that holds independent security certifications: Vercel
            (SOC 2 Type 2, ISO 27001) and Supabase and Resend (SOC 2). CYMBUL is not itself SOC 2
            certified; compliance reports for our subprocessors are available from those vendors on request.
          </p>
        </Section>

        <Section title="Contact">
          <p className="text-slate-600">
            Security questions or to report an issue:{' '}
            <a className="font-medium text-slate-900 underline" href="mailto:info@cymbul.co">info@cymbul.co</a>.
          </p>
        </Section>

        <p className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-400">Last updated {UPDATED}</p>
      </div>
    </div>
  )
}
