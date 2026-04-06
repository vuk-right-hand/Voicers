import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Voicer",
};

export default function TermsPage() {
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
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">Terms of Service</h1>
        <p className="text-sm text-zinc-600 mb-12">Last updated: April 6, 2026</p>

        <div className="space-y-10 text-zinc-400 leading-relaxed text-sm">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. What You&apos;re Agreeing To</h2>
            <p>
              By using Voicer (&ldquo;the Service&rdquo;), you agree to these terms. Voicer is a
              Progressive Web App that lets you remotely control your development machine from your
              phone via voice commands, gestures, and screen mirroring. The Service is provided by
              Voicer (&ldquo;we&rdquo;, &ldquo;us&rdquo;).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Accounts</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>You must provide a valid email address or authenticate via GitHub/Google.</li>
              <li>You are responsible for maintaining the security of your account credentials.</li>
              <li>One person, one account. Shared accounts are not permitted.</li>
              <li>You must be at least 16 years old to use the Service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. What You Get</h2>
            <p className="mb-3">Both paid plans include full access to all features:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Live screen mirroring via WebRTC (peer-to-peer)</li>
              <li>Voice input and dictation</li>
              <li>Gesture controls — trackpad, zoom, precision tap, scroll</li>
              <li>Command wheel</li>
              <li>Clipboard sync</li>
              <li>Pocket mode</li>
            </ul>
            <p className="mt-3">
              <strong className="text-zinc-300">BYOK plan ($4/month):</strong> You provide your own
              API keys for third-party services (e.g., Gemini for STT).
            </p>
            <p className="mt-2">
              <strong className="text-zinc-300">Full Infrastructure plan ($9/month):</strong> We
              provide and manage all required API keys and infrastructure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. Payment &amp; Billing</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Paid plans are billed monthly via Stripe.</li>
              <li>You can cancel at any time. Cancellation takes effect at the end of the current billing period.</li>
              <li>We do not offer refunds for partial months, but we won&apos;t charge you after cancellation.</li>
              <li>Prices may change with 30 days&apos; notice via email.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Your Responsibilities</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-zinc-300">Your machine, your responsibility.</strong> Voicer
                sends input commands (keystrokes, mouse movements, clicks) to your computer. You are
                responsible for what runs on your machine.
              </li>
              <li>
                <strong className="text-zinc-300">Your keys, your responsibility.</strong> If you use
                the BYOK plan, you are responsible for the security and usage costs of your own API
                keys.
              </li>
              <li>
                Do not use the Service for any illegal activity or to access machines you are not
                authorized to control.
              </li>
              <li>
                Do not attempt to reverse-engineer, overload, or abuse the Service infrastructure.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. What We&apos;re Responsible For</h2>
            <p>
              We will make reasonable efforts to keep the Service available and functional. However:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>
                The Service is provided <strong className="text-zinc-300">&ldquo;as is&rdquo;</strong> without
                warranties of any kind, express or implied.
              </li>
              <li>
                We are not liable for data loss, missed connections, or any damages resulting from
                use of the Service.
              </li>
              <li>
                WebRTC connections depend on your network conditions. We cannot guarantee stream
                quality or uptime on all networks.
              </li>
              <li>
                Our total liability is limited to the amount you paid us in the 12 months preceding
                any claim.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Intellectual Property</h2>
            <p>
              Voicer is our product. You may not copy, modify, or redistribute the Service or its
              source code beyond what is permitted by applicable open-source licenses. Your code,
              content, and data remain yours — we claim no ownership over anything that passes through
              the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Termination</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>You can delete your account at any time.</li>
              <li>
                We may suspend or terminate your account if you violate these terms, abuse the
                infrastructure, or use the Service for illegal purposes.
              </li>
              <li>
                Upon termination, your right to use the Service ends immediately. Data deletion
                follows our privacy policy timeline (30 days).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Changes to These Terms</h2>
            <p>
              We may update these terms as the product evolves. Material changes will be communicated
              via email at least 14 days before taking effect. Continued use after changes constitutes
              acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Contact</h2>
            <p>
              Questions about these terms? Email us at{" "}
              <a href="mailto:legal@voicer.dev" className="text-blue-400 hover:underline">legal@voicer.dev</a>.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-white/[0.04] py-8 px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between text-xs text-zinc-600">
          <span>Voicer</span>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/tos" className="text-zinc-400">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
