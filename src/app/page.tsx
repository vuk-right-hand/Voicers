import Link from "next/link";

/* ── Icons ── */

function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="8" x2="13" y2="8" />
      <polyline points="9 4 13 8 9 12" />
    </svg>
  );
}

function CheckIcon({ dim }: { dim?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={dim ? "text-zinc-700" : "text-emerald-400"}>
      <polyline points="3 9 7.5 13.5 15 5" />
    </svg>
  );
}

/* ── Feature Block UI Mockups ── */

function VoiceMockup() {
  return (
    <div className="w-full rounded-2xl border border-white/[0.06] bg-zinc-950 p-5 font-mono text-xs space-y-3">
      <div className="flex items-center gap-2 text-zinc-600">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
        Listening...
      </div>
      <div className="text-zinc-400">&ldquo;add a useEffect that fetches user data on mount&rdquo;</div>
      <div className="h-px bg-white/[0.04]" />
      <div className="text-zinc-600">→ inserting at cursor</div>
      <div className="pl-3 space-y-1 text-[11px]">
        <div><span className="text-blue-400">useEffect</span><span className="text-zinc-500">{"(() => {"}</span></div>
        <div className="pl-4"><span className="text-cyan-300">fetchUser</span><span className="text-zinc-500">()</span></div>
        <div><span className="text-zinc-500">{"}, [])"}</span></div>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-emerald-500">
        <span className="w-1 h-1 rounded-full bg-emerald-500" />
        Inserted
      </div>
    </div>
  );
}

function PocketModeMockup() {
  return (
    <div className="w-full rounded-2xl border border-white/[0.06] bg-black p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-700">Pocket Mode</span>
        <span className="text-[10px] text-zinc-700">2:14 PM</span>
      </div>
      <div className="h-24 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border border-white/[0.04] flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-700">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        </div>
      </div>
      <div className="text-center text-[10px] text-zinc-700">Screen dark. Mic alive. Double-tap to wake.</div>
    </div>
  );
}

function WheelMockup() {
  const commands = ["Run", "Push", "Kill", "Save", "Deploy", "Clear"];
  const angles = [270, 330, 30, 90, 150, 210];
  return (
    <div className="w-full rounded-2xl border border-white/[0.06] bg-zinc-950 p-5 flex items-center justify-center" style={{ minHeight: 200 }}>
      <div className="relative w-44 h-44">
        {commands.map((cmd, i) => {
          const angle = (angles[i] * Math.PI) / 180;
          const r = 68;
          const x = 88 + r * Math.cos(angle) - 20;
          const y = 88 + r * Math.sin(angle) - 14;
          const isActive = i === 0;
          return (
            <div key={cmd} className={`absolute flex items-center justify-center w-10 h-7 rounded-lg text-[10px] font-medium transition-all ${isActive ? "bg-white text-black" : "bg-white/[0.04] border border-white/[0.06] text-zinc-500"}`}
              style={{ left: x, top: y }}>
              {cmd}
            </div>
          );
        })}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
            <span className="text-[8px] text-zinc-500">hold</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackpadMockup() {
  return (
    <div className="w-full rounded-2xl border border-white/[0.06] bg-zinc-950 p-5 space-y-3">
      <div className="flex items-center justify-between text-[10px] text-zinc-600 uppercase tracking-widest">
        <span>Trackpad</span>
        <span className="text-blue-400">2.0×</span>
      </div>
      <div className="relative h-28 rounded-xl border border-white/[0.04] bg-black/40 overflow-hidden">
        {/* Cursor */}
        <div className="absolute" style={{ left: "54%", top: "42%" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="white" className="drop-shadow-lg">
            <path d="M2 2L12 6L7 7.5L5.5 12Z" />
          </svg>
        </div>
        {/* Selection highlight */}
        <div className="absolute left-6 top-8 right-6 h-4 bg-blue-500/20 rounded" />
        {/* Code lines */}
        <div className="absolute left-6 top-4 right-14 space-y-2 font-mono text-[8px] text-zinc-600">
          <div className="w-3/4 h-1.5 bg-zinc-800 rounded" />
          <div className="w-full h-1.5 bg-blue-500/30 rounded" />
          <div className="w-1/2 h-1.5 bg-zinc-800 rounded" />
          <div className="w-5/6 h-1.5 bg-zinc-800 rounded" />
        </div>
      </div>
      <div className="text-[10px] text-zinc-600">Cursor follows your thumb. Not its own agenda.</div>
    </div>
  );
}

function ClipboardMockup() {
  return (
    <div className="w-full rounded-2xl border border-white/[0.06] bg-zinc-950 p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 rounded-lg bg-zinc-900 border border-white/[0.04] p-3 text-[10px] text-zinc-400 font-mono">
          <div className="text-[9px] text-zinc-600 mb-1">📱 Phone</div>
          stackoverflow.com/a/4837…<br />
          <span className="text-emerald-400">→ copied</span>
        </div>
        <div className="flex flex-col gap-1">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-600"><line x1="8" y1="2" x2="8" y2="14" /><polyline points="4 10 8 14 12 10" /></svg>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-600 rotate-180"><line x1="8" y1="2" x2="8" y2="14" /><polyline points="4 10 8 14 12 10" /></svg>
        </div>
        <div className="flex-1 rounded-lg bg-zinc-900 border border-white/[0.04] p-3 text-[10px] text-zinc-400 font-mono">
          <div className="text-[9px] text-zinc-600 mb-1">💻 Desktop</div>
          <span className="text-blue-400">Ctrl+V</span> ready<br />
          <span className="text-emerald-400">✓ synced</span>
        </div>
      </div>
      <div className="text-[10px] text-zinc-600 text-center">No Airdrop. No self-email. No 2009 energy.</div>
    </div>
  );
}

function ZoomMockup() {
  return (
    <div className="w-full rounded-2xl border border-white/[0.06] bg-zinc-950 p-5 space-y-3">
      <div className="flex items-center justify-between text-[10px] text-zinc-600">
        <span className="uppercase tracking-widest">Zoom</span>
        <span className="text-blue-400 font-mono">2.0×</span>
      </div>
      <div className="relative h-24 rounded-xl border border-white/[0.04] bg-black/40 overflow-hidden font-mono text-[10px]">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="space-y-1.5 scale-125 origin-center">
            <div className="flex gap-1.5">
              <span className="text-blue-400">const</span>
              <span className="text-white">handler</span>
              <span className="text-zinc-500">=</span>
              <span className="text-amber-300">useCallback</span>
            </div>
            <div className="pl-3 flex gap-1.5">
              <span className="text-zinc-500">{"(e:"}</span>
              <span className="text-cyan-300 bg-blue-500/20 rounded px-0.5">Event</span>
              <span className="text-zinc-500">{")"}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="text-[10px] text-zinc-600">Hold 200ms → 2× zoom. Tap to click at exact position. Lifts zoom after.</div>
    </div>
  );
}

/* ── Feature Block ── */

function FeatureBlock({
  index,
  tag,
  problem,
  solution,
  mockup,
}: {
  index: number;
  tag: string;
  problem: string;
  solution: string;
  mockup: React.ReactNode;
}) {
  const isEven = index % 2 === 0;
  return (
    <div className={`flex flex-col ${isEven ? "md:flex-row" : "md:flex-row-reverse"} gap-8 md:gap-16 items-start`}>
      {/* Text */}
      <div className="flex-1 space-y-6">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-600">{tag}</p>
        <div className="space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-700 mb-2">The problem</p>
            <p className="text-zinc-400 leading-relaxed text-sm">{problem}</p>
          </div>
          <div className="w-full h-px bg-white/[0.04]" />
          <div>
            <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-700 mb-2">The fix</p>
            <p className="text-zinc-300 leading-relaxed text-sm">{solution}</p>
          </div>
        </div>
      </div>
      {/* Mockup */}
      <div className="w-full md:w-80 shrink-0">{mockup}</div>
    </div>
  );
}

/* ── Page ── */

export default function LandingPage() {
  return (
    <div className="relative min-h-screen bg-black text-white overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-blue-500/[0.04] blur-[100px] animate-glow-pulse" />
      </div>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-black/70 border-b border-white/[0.04]">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
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
            <Link href="/login" className="text-sm text-zinc-400 hover:text-white transition-colors px-3 py-1.5">
              Sign in
            </Link>
            <Link href="/login" className="text-sm bg-white text-black px-4 py-1.5 rounded-full font-medium hover:bg-zinc-200 transition-colors">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-20 sm:pt-28 md:pt-36 pb-16 px-6 dot-grid">
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/[0.08] bg-white/[0.03] text-xs text-zinc-500 mb-10">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Now in public beta
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-8">
            <span className="bg-gradient-to-b from-white via-white to-zinc-500 bg-clip-text text-transparent">
              Get Those &ldquo;Toilet-Seat Hours&rdquo; Back.
            </span>
          </h1>

          {/* Checklist */}
          <div className="inline-flex flex-col items-start gap-2.5 mb-10 text-left">
            {[
              "Code from a hammock",
              "Code while walking",
              "Code on a treadmill",
              "Code at a barbecue",
              "Code from the place where kings sit and think",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <CheckIcon />
                <span className="text-zinc-300 text-sm sm:text-base">{item}</span>
              </div>
            ))}
          </div>

          {/* Subhead */}
          <p className="text-base sm:text-lg text-zinc-400 max-w-xl mx-auto mb-3 leading-relaxed">
            Voicer turns your phone into a remote cockpit for your dev machine.
            Voice commands. Trackpad. Command wheel. Clipboard sync.
          </p>
          <p className="text-base sm:text-lg text-zinc-500 max-w-xl mx-auto mb-10">
            Your laptop stays open. You leave the chair.
          </p>

          {/* CTA */}
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-white text-black rounded-full font-semibold text-sm hover:bg-zinc-200 transition-all hover:shadow-[0_0_40px_rgba(255,255,255,0.08)]"
          >
            Start Coding From Anywhere <ArrowRightIcon />
          </Link>
        </div>
      </section>

      {/* ── PERSONAL ADMISSION ── */}
      <section className="relative py-24 sm:py-32 px-6 border-t border-white/[0.04]">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-8">
            I&apos;ll be honest. I built this for me.
          </h2>
          <div className="space-y-5 text-zinc-400 leading-relaxed">
            <p>
              Lower back screaming after 11 hours in the chair. Two hours a day in traffic doing nothing.
              Three kids who schedule their chaos around my deepest focus blocks. Barbecues where I&apos;m
              &ldquo;that guy&rdquo; sneaking back inside. Workouts I kept skipping because
              &ldquo;just one more prompt.&rdquo;
            </p>
            <p>
              I ran the numbers on one month. Between traffic, standing in lines, walks, couch time, and
              every other situation where I <em className="text-zinc-300">could</em> be coding but my laptop
              wasn&apos;t an option — I was bleeding 3 to 5 hours a day.
            </p>
            <p className="text-zinc-300 font-medium">
              That&apos;s 150 hours of vibecoding. Every month. Gone.
            </p>
            <p>
              And not sure about you — but when I see that weekly token reset ticking with 5 hours left and
              I&apos;m sitting at 37% usage... that&apos;s the closest thing to a panic attack a vibecoder
              can have. Wasted tokens. Wasted subscription money. Wasted momentum.
            </p>
            <p className="text-zinc-300">
              So I didn&apos;t build Voicer because I &ldquo;saw a gap in the market.&rdquo;
              <br />I built it because I <em>was</em> the gap.
            </p>
          </div>
        </div>
      </section>

      {/* ── BRIDGE ── */}
      <section className="py-12 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-xl sm:text-2xl text-zinc-300 leading-relaxed">
            Your laptop is already running.
            <br />
            <span className="text-zinc-500">Voicer just cuts the leash between you and the chair.</span>
          </p>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="relative py-16 sm:py-24 px-6 border-t border-white/[0.04]">
        <div className="max-w-5xl mx-auto space-y-20 sm:space-y-28">
          <FeatureBlock
            index={0}
            tag="Voice Input"
            problem="You're walking the dog. The fix hits you. The exact prompt. The perfect chain of commands. Crystal clear. You walk faster. You get home. You sit down. You open the laptop. ...It's gone."
            solution="Voicer's voice input lets you talk to your machine in real time. Dictate prompts, trigger commands, navigate files — hands-free, full speed. The idea hits, you ship it. No commute required."
            mockup={<VoiceMockup />}
          />
          <FeatureBlock
            index={1}
            tag="Pocket Mode"
            problem="You check your build status. You check it again. You tweak one line. You check again. Your phone is at 41% and it's 2pm."
            solution="Pocket mode kicks in after 120 seconds of inactivity. Screen goes dark. Connection stays alive. Pop in your AirPods and code eyes-free with voice commands. Your battery lives to see dinner."
            mockup={<PocketModeMockup />}
          />
          <FeatureBlock
            index={2}
            tag="Command Wheel"
            problem="You want to run a build. On a normal remote app that's: open menu → find terminal → tap command bar → type or scroll → confirm → wait → navigate back. By step 4 you've forgotten why you started."
            solution="The sliced wheel puts your most-used commands one thumb-swipe away. Build. Deploy. Git push. Kill process. One gesture. No menus. No hunting."
            mockup={<WheelMockup />}
          />
          <FeatureBlock
            index={3}
            tag="Mouse Mode + Trackpad"
            problem={`Every "mobile trackpad" you've ever used felt like steering a shopping cart with one jammed wheel. You overshoot the target. You tap the wrong line. You select 47 lines instead of 1.`}
            solution="Actual precision trackpad. Side scroll that doesn't fight you. Thumb highlighting that selects what you meant to select. Zoom that zooms where you're looking. The cursor goes where your thumb says it goes."
            mockup={<TrackpadMockup />}
          />
          <FeatureBlock
            index={4}
            tag="Clipboard Sync"
            problem="You find the perfect Stack Overflow answer on your phone. Now you need to... email it to yourself? Paste it into a note? Airdrop it? What year is this?"
            solution="Copy on phone → paste on PC. Copy on PC → paste on phone. Two clipboards talking to each other. No workarounds. No self-emails. No 2009 energy."
            mockup={<ClipboardMockup />}
          />
          <FeatureBlock
            index={5}
            tag="Thumb Highlighting + Zoom"
            problem="Code on a phone screen looks like a hostage ransom note. You can't read it. You can't select it. You zoom in, lose your place. You zoom out, lose your eyesight."
            solution="Thumb highlighting lets you select code with the precision of a desktop cursor. Zoom is context-aware — it follows where you're working, not where it feels like wandering. Your phone becomes a viewport, not a punishment."
            mockup={<ZoomMockup />}
          />
        </div>
      </section>

      {/* ── THE MATH ── */}
      <section className="relative py-24 sm:py-32 px-6 border-t border-white/[0.04]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-12">
            Let&apos;s do the math you&apos;ve been avoiding.
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/[0.04] rounded-2xl overflow-hidden mb-12">
            {[
              { number: "3–5 hrs", label: "lost per day", sub: "away from machine but could be shipping" },
              { number: "150 hrs", label: "per month", sub: "of vibecoding. Gone." },
              { number: "$7,500", label: "in dead time", sub: "at a $50/hr rate. Monthly." },
            ].map((stat) => (
              <div key={stat.label} className="bg-zinc-950 p-8">
                <div className="text-3xl sm:text-4xl font-bold text-white mb-1">{stat.number}</div>
                <div className="text-sm text-zinc-400 font-medium mb-2">{stat.label}</div>
                <div className="text-xs text-zinc-600 leading-relaxed">{stat.sub}</div>
              </div>
            ))}
          </div>
          <div className="space-y-4 text-zinc-400 text-sm leading-relaxed">
            <p>Voicer doesn&apos;t add another tool to your stack.</p>
            <p>It turns dead hours into shipping hours.</p>
            <p className="text-zinc-300 font-medium">
              At $9/month, the ROI math is... embarrassing. For us.
            </p>
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="relative py-24 sm:py-32 px-6 border-t border-white/[0.04]">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-3">Pricing</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4">
              Two plans. Zero feature-gating.
            </h2>
            <p className="text-zinc-500 text-sm max-w-lg mx-auto">
              Both plans. Every feature. Full access.
              <br />
              No &ldquo;Pro tier&rdquo; unlocks. No &ldquo;upgrade to get clipboard sync.&rdquo;
              <br />
              You pay, you get the whole thing.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {/* BYOK */}
            <div className="rounded-2xl border border-white/[0.06] bg-zinc-950 p-8 flex flex-col">
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-1">BYOK</h3>
                <p className="text-sm text-zinc-500">Bring your own API keys</p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-bold text-white">$4</span>
                <span className="text-zinc-500 ml-1">/mo</span>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed mb-8 flex-1">
                Got your own API keys? Plug them in. Voicer handles the UX,
                the connection, the remote cockpit. You bring the engine.
              </p>
              <Link href="/login" className="block text-center py-3 rounded-full font-medium text-sm bg-white/[0.06] text-white border border-white/[0.06] hover:bg-white/[0.1] transition-all">
                Get started
              </Link>
            </div>

            {/* Full Infrastructure */}
            <div className="relative rounded-2xl border border-blue-500/20 p-8 flex flex-col pricing-highlight shadow-[0_0_60px_rgba(59,130,246,0.08)]">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-blue-500 text-xs font-semibold text-white">
                Popular
              </div>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-1">Full Infrastructure</h3>
                <p className="text-sm text-zinc-500">Zero config, fully loaded</p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-bold text-white">$9</span>
                <span className="text-zinc-500 ml-1">/mo</span>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed mb-8 flex-1">
                We handle everything. Keys, infrastructure, uptime.
                You open the app and code. That&apos;s it.
              </p>
              <Link href="/login" className="block text-center py-3 rounded-full font-medium text-sm bg-white text-black hover:bg-zinc-200 transition-all">
                Go Full Infrastructure
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="relative py-24 sm:py-32 px-6 border-t border-white/[0.04]">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 mb-3">Setup</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
              Setup takes 90 seconds. We timed it.
            </h2>
          </div>
          <div className="space-y-0">
            {[
              { n: "01", title: "Open Voicer in your phone browser", body: "No App Store. No approval delays. No updates you didn't ask for." },
              { n: "02", title: "Add to Home Screen", body: "It's a PWA — install it like an app without the app store politics." },
              { n: "03", title: "Connect to your machine", body: "Scan the QR on your desktop. WebRTC links you peer-to-peer." },
              { n: "04", title: "Leave the chair", body: "That's the whole step." },
            ].map((step, i) => (
              <div key={step.n} className="flex gap-6 sm:gap-8">
                <div className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full border border-white/10 bg-white/[0.02] flex items-center justify-center text-xs font-mono text-zinc-500 shrink-0">
                    {step.n}
                  </div>
                  {i < 3 && <div className="w-px flex-1 bg-white/[0.04] my-2" />}
                </div>
                <div className={`pb-10 ${i === 3 ? "pb-0" : ""}`}>
                  <h3 className="text-white font-semibold mb-1.5">{step.title}</h3>
                  <p className="text-sm text-zinc-500 leading-relaxed">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CLOSING ── */}
      <section className="relative py-24 sm:py-32 px-6 border-t border-white/[0.04]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-5xl sm:text-6xl font-bold tracking-tight text-white mb-8">
            150 hours a month.
          </h2>
          <div className="space-y-4 text-zinc-400 leading-relaxed mb-12 text-base sm:text-lg">
            <p>That&apos;s what&apos;s leaking out of your schedule right now.</p>
            <p>In traffic. In lines. On walks. On the couch. On the... you know where.</p>
            <p>Your machine is already on. Your project is already open.</p>
            <p className="text-zinc-300">
              The only thing missing is you — and you don&apos;t have to be sitting down for that.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-white text-black rounded-full font-semibold text-sm hover:bg-zinc-200 transition-all hover:shadow-[0_0_40px_rgba(255,255,255,0.08)]"
          >
            Get Voicer <ArrowRightIcon />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-12 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-white flex items-center justify-center">
              <span className="text-black font-bold text-xs">V</span>
            </div>
            <span className="text-sm text-zinc-600 italic">Your laptop stays open. You leave the chair.</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-zinc-600">
            <a href="https://github.com/vuk-right-hand/Voicers" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              GitHub
            </a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <Link href="/login" className="hover:text-white transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
