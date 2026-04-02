import Link from "next/link";

/* ── Inline SVG Icons ── */

function MicIcon({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

function ScreenIcon({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function GestureIcon({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v6" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8a6 6 0 0 0 12 0v-4a2 2 0 0 0-4 0" />
    </svg>
  );
}

function WheelIcon({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="2" x2="12" y2="9" />
      <line x1="12" y1="15" x2="12" y2="22" />
      <line x1="2" y1="12" x2="9" y2="12" />
      <line x1="15" y1="12" x2="22" y2="12" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 shrink-0">
      <polyline points="3 8 6.5 11.5 13 5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="8" x2="13" y2="8" />
      <polyline points="9 4 13 8 9 12" />
    </svg>
  );
}

/* ── Feature Card ── */

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="card-glow rounded-2xl border border-white/[0.06] bg-zinc-950 p-6 flex flex-col gap-4">
      <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-zinc-300">
        {icon}
      </div>
      <div>
        <h3 className="text-white font-semibold mb-1.5">{title}</h3>
        <p className="text-sm text-zinc-500 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

/* ── Pricing Card ── */

function PricingCard({
  name,
  price,
  period,
  description,
  features,
  cta,
  highlighted,
}: {
  name: string;
  price: string;
  period?: string;
  description: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`relative rounded-2xl border p-8 flex flex-col ${
        highlighted
          ? "pricing-highlight border-blue-500/20 shadow-[0_0_60px_rgba(59,130,246,0.08)]"
          : "border-white/[0.06] bg-zinc-950"
      }`}
    >
      {highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-blue-500 text-xs font-semibold text-white">
          Popular
        </div>
      )}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-white mb-1">{name}</h3>
        <p className="text-sm text-zinc-500">{description}</p>
      </div>
      <div className="mb-6">
        <span className="text-4xl font-bold text-white">{price}</span>
        {period && <span className="text-zinc-500 ml-1">{period}</span>}
      </div>
      <ul className="space-y-3 mb-8 flex-1">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm text-zinc-300">
            <CheckIcon />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/login"
        className={`block text-center py-3 rounded-full font-medium text-sm transition-all ${
          highlighted
            ? "bg-white text-black hover:bg-zinc-200"
            : "bg-white/[0.06] text-white border border-white/[0.06] hover:bg-white/[0.1]"
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}

/* ── Step ── */

function Step({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center flex flex-col items-center">
      <div className="w-12 h-12 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-sm font-mono text-zinc-400 mb-4">
        {number}
      </div>
      <h3 className="text-white font-semibold mb-2">{title}</h3>
      <p className="text-sm text-zinc-500 leading-relaxed max-w-xs">{description}</p>
    </div>
  );
}

/* ── Page ── */

export default function LandingPage() {
  return (
    <div className="relative min-h-screen bg-black text-white overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-300px] left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-blue-500/[0.04] blur-[100px] animate-glow-pulse" />
      </div>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-black/70 border-b border-white/[0.04]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center">
              <span className="text-black font-bold text-sm">V</span>
            </div>
            <span className="text-base font-semibold tracking-tight">Voicer</span>
          </Link>
          <div className="flex items-center gap-3">
            <a href="#pricing" className="hidden sm:block text-sm text-zinc-500 hover:text-white transition-colors px-3 py-1.5">
              Pricing
            </a>
            <Link
              href="/login"
              className="text-sm text-zinc-400 hover:text-white transition-colors px-3 py-1.5"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              className="text-sm bg-white text-black px-4 py-1.5 rounded-full font-medium hover:bg-zinc-200 transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-20 sm:pt-28 md:pt-36 pb-8 px-6 dot-grid">
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/[0.08] bg-white/[0.03] text-xs text-zinc-500 mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Now in public beta
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[1.08] mb-6">
            <span className="bg-gradient-to-b from-white via-white to-zinc-500 bg-clip-text text-transparent">
              Vibe code from
            </span>
            <br />
            <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              your phone
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-base sm:text-lg text-zinc-400 max-w-xl mx-auto mb-10 leading-relaxed">
            Mirror your desktop, dictate code by voice, and navigate with
            precision gestures. The remote control for developers who code
            from the couch.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3 bg-white text-black rounded-full font-semibold text-sm hover:bg-zinc-200 transition-all hover:shadow-[0_0_40px_rgba(255,255,255,0.08)]"
            >
              Start for free <ArrowRightIcon />
            </Link>
            <a
              href="#how-it-works"
              className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3 border border-white/10 rounded-full text-sm text-zinc-300 hover:bg-white/[0.04] transition-all"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* Hero visual - Code editor mockup */}
        <div className="mt-16 sm:mt-20 max-w-4xl mx-auto animate-float">
          <div className="relative rounded-2xl border border-white/[0.08] bg-zinc-950 shadow-2xl shadow-blue-500/[0.03] overflow-hidden">
            {/* Title bar */}
            <div className="flex items-center gap-2 px-4 py-3 bg-zinc-900/50 border-b border-white/[0.04]">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
              </div>
              <div className="flex-1 mx-8">
                <div className="w-40 h-4 rounded bg-zinc-800/80 mx-auto" />
              </div>
              <div className="w-16" />
            </div>

            {/* Editor content */}
            <div className="p-5 sm:p-8 font-mono text-xs sm:text-sm leading-relaxed">
              <div className="flex gap-6 sm:gap-10">
                {/* Line numbers */}
                <div className="hidden sm:flex flex-col text-zinc-700 select-none text-right w-6">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <div key={n}>{n}</div>
                  ))}
                </div>

                {/* Code */}
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-600">{"// voice-controller.ts"}</div>
                  <div className="h-2" />
                  <div>
                    <span className="text-violet-400">export</span>{" "}
                    <span className="text-blue-400">async function</span>{" "}
                    <span className="text-cyan-300">handleVoiceInput</span>
                    <span className="text-zinc-600">{"() {"}</span>
                  </div>
                  <div className="pl-4 sm:pl-6">
                    <span className="text-blue-400">const</span>{" "}
                    <span className="text-white">stream</span>{" "}
                    <span className="text-zinc-600">=</span>{" "}
                    <span className="text-blue-400">await</span>{" "}
                    <span className="text-amber-300">mic</span>
                    <span className="text-zinc-600">.</span>
                    <span className="text-cyan-300">capture</span>
                    <span className="text-zinc-600">()</span>
                  </div>
                  <div className="pl-4 sm:pl-6">
                    <span className="text-blue-400">const</span>{" "}
                    <span className="text-white">transcript</span>{" "}
                    <span className="text-zinc-600">=</span>{" "}
                    <span className="text-amber-300">gemini</span>
                    <span className="text-zinc-600">.</span>
                    <span className="text-cyan-300">transcribe</span>
                    <span className="text-zinc-600">(</span>
                    <span className="text-white">stream</span>
                    <span className="text-zinc-600">)</span>
                  </div>
                  <div className="pl-4 sm:pl-6">
                    <span className="text-blue-400">return</span>{" "}
                    <span className="text-cyan-300">editor</span>
                    <span className="text-zinc-600">.</span>
                    <span className="text-green-400">insert</span>
                    <span className="text-zinc-600">(</span>
                    <span className="text-white">transcript</span>
                    <span className="text-zinc-600">)</span>
                  </div>
                  <div className="text-zinc-600">{"}"}</div>
                  <div className="h-2" />
                  <div className="flex items-center gap-1">
                    <span className="w-[2px] h-4 bg-blue-400 animate-blink" />
                    <span className="text-zinc-600 italic">
                      {'"add error handling for the stream..."'}
                    </span>
                  </div>
                </div>

                {/* Phone mockup - desktop only */}
                <div className="hidden md:flex flex-col items-center gap-3 pl-6 border-l border-white/[0.04]">
                  <div className="w-[72px] h-[130px] rounded-xl border-2 border-white/[0.08] bg-black flex flex-col items-center justify-center gap-2">
                    <MicIcon className="text-red-400 w-5 h-5" />
                    <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                    <span className="text-[7px] text-zinc-600 uppercase tracking-[0.2em]">
                      Live
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
                    <span className="w-1 h-1 rounded-full bg-emerald-500" />
                    Connected
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="relative py-24 sm:py-32 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-3">
              How it works
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
              Three steps to remote coding
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-4 relative">
            {/* Connector lines - desktop only */}
            <div className="hidden md:block absolute top-6 left-[calc(33.33%+8px)] right-[calc(33.33%+8px)] h-px bg-gradient-to-r from-white/[0.06] via-white/[0.1] to-white/[0.06]" />

            <Step
              number="01"
              title="Install the host"
              description="Run a lightweight Python app on your desktop. It captures your screen and listens for commands."
            />
            <Step
              number="02"
              title="Connect your phone"
              description="Open the PWA, scan the QR code on your desktop. WebRTC connects you peer-to-peer."
            />
            <Step
              number="03"
              title="Code from anywhere"
              description="Dictate code, tap to click, scroll with two fingers. Your phone becomes a full remote."
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative py-24 sm:py-32 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-3">
              Features
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
              Everything you need, nothing you don&apos;t
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              icon={<MicIcon />}
              title="Voice Dictation"
              description="Speak naturally and watch your words appear as code. Gemini auto-corrects coding terms — 'use effect' becomes useEffect."
            />
            <FeatureCard
              icon={<ScreenIcon />}
              title="Live Screen Mirror"
              description="Your desktop streams to your phone in real-time over WebRTC. Low latency, peer-to-peer, no cloud relay."
            />
            <FeatureCard
              icon={<GestureIcon />}
              title="Precision Gestures"
              description="Hold to zoom 2x, tap to click with pixel accuracy, two-finger scroll. A touch interface built for code."
            />
            <FeatureCard
              icon={<WheelIcon />}
              title="Command Wheel"
              description="Hold the comms button to reveal quick actions — run, send, save, clear terminal. No menus, no typing."
            />
            <FeatureCard
              icon={<MoonIcon />}
              title="Pocket Mode"
              description="Screen goes OLED black, mic stays hot. Slip your phone in your pocket and keep dictating. Double-tap to wake."
            />
            <FeatureCard
              icon={<KeyIcon />}
              title="Your Keys, Your Data"
              description="BYOK architecture — API keys live on your machine, never in the cloud. We can't see your code or your credentials."
            />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="relative py-24 sm:py-32 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-3">
              Pricing
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4">
              Start free, scale when ready
            </h2>
            <p className="text-zinc-500 text-sm max-w-lg mx-auto">
              No credit card required. Try everything with the free tier, then
              upgrade when you&apos;re hooked.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
            <PricingCard
              name="Free"
              price="$0"
              description="Try the core experience"
              features={[
                "Screen mirroring",
                "Basic gestures — tap & scroll",
                "30-minute sessions",
                "Community support",
              ]}
              cta="Get started"
            />
            <PricingCard
              name="BYOK"
              price="$4"
              period="/mo"
              description="Bring your own API keys"
              features={[
                "Everything in Free",
                "Voice dictation (your Gemini key)",
                "Unlimited sessions",
                "All gestures + command wheel",
                "Pocket mode",
              ]}
              cta="Start with BYOK"
              highlighted
            />
            <PricingCard
              name="Pro"
              price="$9"
              period="/mo"
              description="Zero config, fully loaded"
              features={[
                "Everything in BYOK",
                "API keys included — no setup",
                "Priority support",
                "Early access to new features",
              ]}
              cta="Go Pro"
            />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative py-24 sm:py-32 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4">
            Ready to code from the couch?
          </h2>
          <p className="text-zinc-500 mb-10 text-sm">
            Set up in under two minutes. Free forever on the starter tier.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-8 py-3 bg-white text-black rounded-full font-semibold text-sm hover:bg-zinc-200 transition-all hover:shadow-[0_0_40px_rgba(255,255,255,0.08)]"
          >
            Get started free <ArrowRightIcon />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-12 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-white flex items-center justify-center">
              <span className="text-black font-bold text-xs">V</span>
            </div>
            <span className="text-sm text-zinc-500">Voicer</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-zinc-600">
            <a
              href="https://github.com/vuk-right-hand/Voicers"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              GitHub
            </a>
            <a href="#pricing" className="hover:text-white transition-colors">
              Pricing
            </a>
            <Link href="/login" className="hover:text-white transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
