import Link from "next/link";
import Image from "next/image";

export default function LandingPage() {
  return (
    <div className="relative min-h-screen bg-black text-white overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-blue-500/[0.03] blur-[120px] animate-glow-pulse" />
      </div>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-black/70 border-b border-white/[0.04]">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/icons/icon-512.png" alt="Voicer" width={28} height={28} className="rounded-lg" />
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

      {/* ── Copy ── */}
      <article className="relative z-10 max-w-2xl mx-auto px-6 pt-24 sm:pt-32 pb-20 text-[15px] sm:text-base leading-relaxed text-zinc-400">

        <p>Let&apos;s kick the elephant out of the room - will this actually work for vibecoding?</p>

        <br />

        <Image src="/Images/Kicking elephant.png" alt="Kicking the elephant out of the room" width={1200} height={800} className="w-[65%] h-auto rounded-xl my-6" />

        <br />

        <p>
          <a href="https://vibecodershq.io" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline decoration-blue-400/60 hover:decoration-blue-400">vibecodershq.io</a>{" "}
          I built 90% of it with Voicer. Only social platform dedicated solely for vibecoders. 20+ features, mini algorithm, search, tracking, tags, comments, auth, quizzes, profiles, creators&hellip;
        </p>

        <br />

        <p className="text-white font-semibold">So&hellip; yes, it will.</p>

        <br /><br />

        <p>Now&hellip;</p>

        <br />

        <p className="text-white font-bold text-3xl sm:text-4xl text-center">Voicer&hellip;</p>

        <br />

        <p>Once upon a time&hellip; I was taking a sh*t 🧻</p>

        <br />

        <p>Meanwhile Claude was going YOLO.</p>

        <br />

        <p>Turning my masterstroke into a shitshow&hellip; Okay, it didn&apos;t. But it wasn&apos;t doing anything for 38 minutes and I got bored.</p>

        <br />

        <p>A moment of genius struck me while on the throne.</p>

        <br />

        <Image src="/Images/Toilet lightbulb.png" alt="Moment of genius on the throne" width={1200} height={800} className="w-[65%] h-auto rounded-xl my-6" />

        <br />

        <p className="text-blue-400 font-bold">I wanna be coding!!</p>

        <br />

        <p>&hellip;</p>

        <br />

        <p>Let&apos;s get real for a moment&hellip; to be a true <span className="text-white font-semibold">VIBE-CODER</span>, like Google&apos;s CTO level, you&apos;ve gotta&hellip;</p>

        <br /><br />

        <p className="text-red-400 font-bold text-3xl sm:text-4xl text-center">Code from the toilet-seat!</p>

        <br />

        <p className="text-zinc-600">They in hammock.</p>
        <p className="text-white">You in hammock but code.</p>

        <br />

        <p className="text-zinc-600">They walkin.</p>
        <p className="text-white">You walkin but code.</p>

        <br />

        <p className="text-zinc-600">They barbequing. <span className="italic text-zinc-300">(it&apos;s Q)</span>.</p>
        <p className="text-white">You barbequing but code.</p>

        <br />

        <p className="text-zinc-600">They sh*ttin.</p>
        <p className="text-white">You aint just sh*ttin no mo&hellip; you code.</p>

        <br />

        <p className="text-zinc-600">They on treadmill.</p>
        <p className="text-zinc-500">You&hellip; no treadmill that sh*t&apos;s dangerous.</p>

        <br /><br />

        <p className="text-white font-bold">Voicer takes your computer and places it inside your phone.</p>

        <br />

        <Image src="/Images/Voicer vs Vibe.png" alt="Voicer vs Vibe coding" width={1200} height={800} className="w-[65%] h-auto rounded-xl my-6" />

        <br />

        <p className="text-zinc-400">You get a cyber remote-controller for your vibe-coding station. And cut the leash from yourself and your chair.</p>

        <br />

        <p>Listen&hellip;</p>

        <br /><br />

        <p>I&apos;ll be honest&hellip;</p>

        <br />

        <p className="text-white font-bold text-3xl sm:text-4xl text-center">I built this for me&hellip; <span className="italic text-zinc-300">(duh)</span></p>

        <br /><br />

        <p>I didn&apos;t see no gaps in the market, no fancy research scrapping reddits, X, and youtube comments&hellip;</p>

        <br />

        <p>I have a lower back problem and I was stuck in the chair for 12 hours a day <span className="italic text-zinc-300">(I know&hellip; I&apos;m addicted - c&apos;mon this is literally the best thing since 25-man raiding Ice Crown in World of Warcraft.)</span></p>

        <br />

        <Image src="/Images/Bed coding.png" alt="Coding from bed" width={1200} height={800} className="w-[65%] h-auto rounded-xl my-6" />

        <br />

        <p>I just wanted to code from my bed. I wanted to see my desktop and navigate. That&apos;s it.</p>

        <br />

        <p>And the solutions&hellip; 🤮💩💨</p>

        <br /><br />

        <p className="text-white font-bold text-xl sm:text-2xl text-center">So&hellip; I started a list.</p>

        <br />

        <p>I wanted voice commands.</p>
        <p>And keyboard. <span className="italic text-zinc-300">(custom made!!!)</span></p>
        <p>And copy/paste. Back and forth, phone to computer and vice versa. <span className="italic text-zinc-300">(no 1999 sending emails to myself)</span></p>
        <p>And trackpad - like literally using my mouse. And highlighting. And seeing the damn cursor <span className="italic text-zinc-300">(8 hours of coding&hellip;I&apos;m not a dev, ok.)</span></p>
        <p>And open folders and files. With a thumb-tap.</p>
        <p>And have a scroll-pad on the side!!!</p>
        <p>I didn&apos;t want &ldquo;fat-fingering&rdquo; so first thumb hold <span className="text-white font-semibold">ZOOMS!</span> To 200%, second hold to 300% then - tap and highlight and&hellip; then copy&hellip; and paste&hellip;</p>

        <br />

        <p className="text-red-400 font-semibold">Imagine! 🤔</p>

        <br />

        <Image src="/Images/Sandwich disconnect.png" alt="Sandwich disconnect" width={1200} height={800} className="w-[65%] h-auto rounded-xl my-6" />

        <br /><br />

        <p>But then I placed the phone on the bed to grab a sangwich&hellip; And got disconnected!!</p>

        <br />

        <p className="text-zinc-300 font-medium">So&hellip; app stays live in the background forever.</p>

        <br />

        <p>2 pm. Battery 7%. F#%$!</p>

        <br />

        <p className="text-zinc-300 font-medium">Turn the screen off in 120 seconds.</p>

        <br />

        <p>First time it happened, felt like my phone died&hellip; Add a 10 seconds countdown at 110 seconds! Tap to cancel! Fu*k yeah!</p>

        <br />

        <p>Walk outside.</p>

        <br />

        <p>Pocket-disaster.</p>

        <br />

        <p className="text-zinc-300 font-medium">So&hellip; Pocket mode!</p>

        <br />

        <p>One tap. Black screen. No commands pass through.</p>

        <br />

        <p>Double tap to wake up&hellip; the button&hellip; tap the button, screen is back. <span className="italic text-blue-400">(so fu*king proud - you should be too!).</span></p>

        <br />

        <p>Google/git auth <span className="italic text-zinc-300">(pain in the bu*t)</span>. But did it for you&hellip; Password and email as well.</p>

        <br />

        <p>Seamless connection between devices - one link tap <span className="italic text-zinc-300">(50 hours of code)</span>.</p>

        <br />

        <p>Portrait. Landscape.</p>

        <br />

        <p>4g/5g to WiFi connection so the app is actually usable - just don&apos;t ask, 12 hour session to discover something called a &ldquo;TURN&rdquo; server to make it work.</p>

        <br />

        <p>And for all of my non-tech people&hellip;</p>

        <br />

        <p className="text-zinc-300">A Tesla level genius&hellip;</p>

        <br />

        <Image src="/Images/Tesla handshake.png" alt="Tesla level genius" width={1200} height={800} className="w-[65%] h-auto rounded-xl my-6" />

        <br />

        <p className="text-red-400 font-bold text-xl sm:text-2xl text-center">An &ldquo;.exe installer&rdquo;!</p>

        <br />

        <p className="text-zinc-500">&hellip;so you don&apos;t have to run a freaking uvicorn <span className="italic text-zinc-300">(still don&apos;t know what it is)</span> every time you turn on the computer - the damn thing runs on boot.</p>

        <br /><br />

        <p>And the exorbitant pricing&hellip;</p>

        <br />

        <p>But wait there&apos;s more&hellip; <span className="italic text-zinc-300">(for younger people that&apos;s teleshop = TikTok shop for millennials).</span></p>

        <br /><br />

        <p>OK&hellip; get real for a second <span className="italic text-zinc-300">(seriously)</span> I did the math.</p>

        <br />

        <p className="text-blue-400 font-bold text-2xl sm:text-3xl text-center">2-5 hours a day of FREE vibecoding.</p>

        <br />

        <p>Commute, traffic, family time, barbeQues, walking, toilet-seat&hellip; <span className="italic text-zinc-300">(pick yours)</span></p>

        <br />

        <p className="text-zinc-300 font-bold">PLUSSSS&hellip;</p>

        <br />

        <p className="text-zinc-300 font-bold">The weekends!</p>

        <br />

        <p className="text-red-400">80-140 hours a month of newfound coding.</p>

        <br />

        <p>Like literally up to 5 hours a day.</p>

        <br />

        <p>And, I don&apos;t know about you&hellip;</p>

        <br />

        <p>&hellip;but seeing claude code at 37% weekly limit 12 hours before reset&hellip; Not sure how anxiety feels, but I&apos;m pretty positive that&apos;s it.</p>

        <br />

        <Image src="/Images/99%25 usage.png" alt="99% usage anxiety" width={1200} height={800} className="w-[65%] h-auto rounded-xl my-6" />

        <br />

        <p>Anyways&hellip;</p>

        <br /><br />

        {/* ── PRICING CARDS ── */}
        <div id="pricing">
          <p className="text-white font-bold text-2xl sm:text-3xl text-center mb-10">3 tiers. All features in all 3.</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
            {/* Free */}
            <div className="rounded-2xl border border-white/[0.06] bg-zinc-950 p-6 flex flex-col">
              <p className="text-xs uppercase tracking-[0.15em] text-zinc-600 mb-3">Open Source</p>
              <p className="text-3xl font-bold text-white mb-1">Free</p>
              <p className="text-sm text-zinc-500 mb-4">forever</p>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6 flex-1">
                Devs&hellip; this is for you. Link to the git repo, set up Supabase, TURN, and STT API. Run it locally and Godspeed!
              </p>
              <a
                href="https://github.com/vuk-right-hand/Voicers"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center py-3 rounded-full font-medium text-sm bg-white/[0.06] text-white border border-white/[0.06] hover:bg-white/[0.1] transition-all"
              >
                View on GitHub
              </a>
            </div>

            {/* BYOK $4 */}
            <div className="relative rounded-2xl border border-blue-500/20 bg-zinc-950 p-6 flex flex-col pricing-highlight shadow-[0_0_60px_rgba(59,130,246,0.06)]">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-blue-500 text-xs font-semibold text-white whitespace-nowrap">
                For my people
              </div>
              <p className="text-xs uppercase tracking-[0.15em] text-zinc-600 mb-3">BYOK</p>
              <div className="flex items-baseline gap-1 mb-1">
                <p className="text-3xl font-bold text-white">$4</p>
                <span className="text-zinc-500">/mo</span>
              </div>
              <p className="text-sm text-zinc-500 mb-4">bucks for my people 🙂</p>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6 flex-1">
                Just go to google ai studio, copy your gemini API key and paste it in the installer <span className="italic">(it&apos;ll ask you)</span> everything else is on me.
              </p>
              <Link
                href="/login?plan=byok"
                className="block text-center py-3 rounded-full font-medium text-sm bg-white text-black hover:bg-zinc-200 transition-all"
              >
                Get started &mdash; $4/mo
              </Link>
            </div>

            {/* Pro $9 */}
            <div className="rounded-2xl border border-white/[0.06] bg-zinc-950 p-6 flex flex-col">
              <p className="text-xs uppercase tracking-[0.15em] text-zinc-600 mb-3">Full Setup</p>
              <div className="flex items-baseline gap-1 mb-1">
                <p className="text-3xl font-bold text-white">$9</p>
                <span className="text-zinc-500">/mo</span>
              </div>
              <p className="text-sm text-red-400 mb-4">most UNpopular</p>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6 flex-1">
                Don&apos;t be lazy, do not pay $9/m when you can pay $4. Copy the google API key <span className="italic">(if you&apos;re a dinosaur online it&apos;ll take you 90 seconds)</span>. If not, 9 bucks a month and it&apos;s ALL on me.
              </p>
              <Link
                href="/login?plan=pro"
                className="block text-center py-3 rounded-full font-medium text-sm bg-white/[0.06] text-white border border-white/[0.06] hover:bg-white/[0.1] transition-all"
              >
                Get started &mdash; $9/mo
              </Link>
            </div>
          </div>
        </div>

        <br />

        <p>That&apos;s it&hellip;</p>

        <br />

        <p>Ohh yes&hellip;</p>

        <br />

        <p className="text-white font-bold text-xl sm:text-2xl text-center">The setup&hellip;</p>

        <br /><br />

        <p className="text-blue-400 font-bold">94 seconds&hellip; don&apos;t laugh, I timed it.</p>

        <br />

        <p>Scan QR code with your phone - 5 seconds</p>
        <p>No app stores - PWA. Open in your browser, tap add to home screen - 12 seconds <span className="italic text-zinc-300">(cause of iPhone, it&apos;d be 4)</span></p>
        <p>Tap &ldquo;connect my rig&rdquo; - 12 seconds</p>
        <p>Leave your chair and enjoy your day while coding 24/7 - 13 seconds</p>

        <br />

        <p className="text-zinc-600 font-mono text-sm">12 + 12 + 13 + 5 = <span className="line-through">42s</span> 94s</p>

        <br />

        <p className="text-zinc-300">Total 94 seconds, told you.</p>

        <br />

        <Image src="/Images/1st place throphy.png" alt="1st place trophy" width={1200} height={800} className="w-[65%] h-auto rounded-xl my-6" />

        <br /><br />

        <p>All jokes aside&hellip;</p>

        <br />

        <p className="text-red-400 font-bold text-3xl sm:text-4xl text-center">Freaking 140 hours a month&hellip;</p>

        <br />

        <p className="text-white text-lg font-semibold">Wasted.</p>

        <br />

        <p>Traffic. Lines. Walks. Commute. Couch. Movies. And of course 🧻.</p>

        <br />

        <p>Your machine is on. Subscriptions are ticking. The project is open.</p>

        <br />

        <p className="text-zinc-300">The only thing missing is you&hellip; And with Voicer <span className="text-blue-400 font-semibold">you&apos;re always there!</span></p>

        <br />

        <p className="italic text-zinc-300 text-sm">(See how I finished it like a true marketer/copywriter).</p>

        <br />

        <p>Hope to see your feature requests in my inbox - <a href="mailto:vuk@vibecodershq.io" className="text-blue-400 hover:underline">vuk@vibecodershq.io</a> 🙂</p>

        <br /><br />

        <div className="flex justify-center">
          <a
            href="#pricing"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-white text-black rounded-full font-semibold text-sm hover:bg-zinc-200 transition-all hover:shadow-[0_0_40px_rgba(255,255,255,0.08)]"
          >
            Get Voicer
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="8" x2="13" y2="8" />
              <polyline points="9 4 13 8 9 12" />
            </svg>
          </a>
        </div>

      </article>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-12 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Image src="/icons/icon-512.png" alt="Voicer" width={24} height={24} className="rounded-md" />
            <span className="text-sm text-zinc-600 italic">Your laptop stays open. You leave the chair.</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-zinc-600">
            <a href="https://github.com/vuk-right-hand/Voicers" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GitHub</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/tos" className="hover:text-white transition-colors">Terms</Link>
            <Link href="/login" className="hover:text-white transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
