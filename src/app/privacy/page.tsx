import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Voicer",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-black/70 border-b border-white/[0.04]">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center">
              <span className="text-black font-bold text-sm">V</span>
            </div>
            <span className="text-base font-semibold tracking-tight">Voicer</span>
          </Link>
          <Link href="/login" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Sign in
          </Link>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-16 sm:py-24">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">Privacy Policy</h1>
        <p className="text-sm text-zinc-600 mb-12">Last updated: April 6, 2026</p>

        <div className="space-y-10 text-zinc-400 leading-relaxed text-sm">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. What Voicer Is</h2>
            <p>
              Voicer is a voice-first Progressive Web App (PWA) that turns your phone into a remote
              controller for your development machine. It streams your desktop screen to your phone
              via WebRTC and lets you interact using voice commands, gestures, and a virtual trackpad.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Data We Collect</h2>
            <p className="mb-3">We collect the minimum data required to operate the service:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-zinc-300">Account information:</strong> Email address and
                hashed password (or OAuth profile from GitHub/Google) when you create an account.
              </li>
              <li>
                <strong className="text-zinc-300">Session metadata:</strong> Device identifiers and
                connection timestamps stored in Supabase for WebRTC signaling. This is transient and
                used only to establish peer-to-peer connections.
              </li>
              <li>
                <strong className="text-zinc-300">Payment information:</strong> If you subscribe to a
                paid plan, payment is processed by Stripe. We do not store your card number, CVC, or
                billing address on our servers.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. Data We Do NOT Collect</h2>
            <p className="mb-3">This is the important part:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-zinc-300">Your screen content:</strong> Video streams are
                peer-to-peer (WebRTC). Your desktop screen goes directly from your machine to your
                phone. It never passes through our servers.
              </li>
              <li>
                <strong className="text-zinc-300">Your voice audio:</strong> Audio from your
                microphone is processed locally on the host machine or sent directly to the STT
                provider you configure. We never receive, store, or listen to your voice.
              </li>
              <li>
                <strong className="text-zinc-300">Your code:</strong> We have no access to your
                codebase, editor contents, terminal output, or clipboard data.
              </li>
              <li>
                <strong className="text-zinc-300">Your API keys:</strong> Voicer uses a BYOK (Bring
                Your Own Key) architecture. API keys are stored exclusively on your local machine or
                in your browser&apos;s localStorage. They never touch our database.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. How We Use Your Data</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Authenticate you and manage your session.</li>
              <li>Facilitate the initial WebRTC signaling handshake between your devices.</li>
              <li>Process subscription payments via Stripe.</li>
              <li>Send transactional emails (account verification, device linking).</li>
            </ul>
            <p className="mt-3">
              We do not sell, rent, or share your personal data with third parties for marketing
              purposes. Ever.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Third-Party Services</h2>
            <p className="mb-3">Voicer integrates with the following services:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-zinc-300">Supabase</strong> — Authentication, database, and
                realtime signaling. Data stored in Supabase is subject to their{" "}
                <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">privacy policy</a>.
              </li>
              <li>
                <strong className="text-zinc-300">Stripe</strong> — Payment processing. Subject to{" "}
                <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Stripe&apos;s privacy policy</a>.
              </li>
              <li>
                <strong className="text-zinc-300">Vercel</strong> — Hosting. Subject to{" "}
                <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Vercel&apos;s privacy policy</a>.
              </li>
              <li>
                <strong className="text-zinc-300">Google / GitHub</strong> — Optional OAuth
                authentication. We receive only your email and basic profile info.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Data Retention</h2>
            <p>
              Account data is retained for as long as your account is active. If you delete your
              account, we will delete your personal data within 30 days. Transient signaling data
              (SDP offers, ICE candidates) is ephemeral and not persisted beyond the active session.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Security</h2>
            <p>
              All connections use TLS encryption. WebRTC streams are encrypted end-to-end via DTLS-SRTP.
              Authentication tokens are managed by Supabase with industry-standard security practices.
              API keys stored in localStorage are scoped to your browser and never transmitted to our
              infrastructure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Your Rights</h2>
            <p>You can:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>Request a copy of the data we hold about you.</li>
              <li>Request deletion of your account and associated data.</li>
              <li>Withdraw consent for optional data processing at any time.</li>
            </ul>
            <p className="mt-3">
              Contact us at{" "}
              <a href="mailto:privacy@voicer.dev" className="text-blue-400 hover:underline">privacy@voicer.dev</a>{" "}
              for any privacy-related requests.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Changes</h2>
            <p>
              We may update this policy as the product evolves. Significant changes will be
              communicated via email or an in-app notice. Continued use of Voicer after changes
              constitutes acceptance of the updated policy.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-white/[0.04] py-8 px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between text-xs text-zinc-600">
          <span>Voicer</span>
          <div className="flex gap-4">
            <Link href="/privacy" className="text-zinc-400">Privacy</Link>
            <Link href="/tos" className="hover:text-white transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
