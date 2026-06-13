import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

// Branded portal wordmarks used on the landing page. Pure SVG + text, no data.

export function LinkedInLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex select-none items-center justify-center gap-1.5 sm:gap-2 ${className}`}>
      <svg viewBox="0 0 100 100" className="h-6 w-6 shrink-0 md:h-7 md:w-7 lg:h-8 lg:w-8" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="100" rx="14" fill="#0A66C2" />
        <path d="M26 36H39V82H26V36ZM32.5 18C36.6421 18 40 21.3579 40 25.5C40 29.6421 36.6421 33 32.5 33C28.3579 33 25 29.6421 25 25.5C25 21.3579 28.3579 18 32.5 18Z" fill="white" />
        <path d="M46 36H58V42.5H58.2C60 39 64.5 35 71.5 35C86 35 88.5 44 88.5 56.5V82H75.5V61.5C75.5 56.5 75.3 50 68.5 50C61.5 50 60.5 55.5 60.5 61V82H47.5L46 36Z" fill="white" />
      </svg>
      <span className="mt-0.5 font-sans text-[18px] font-black leading-none tracking-tight text-[#0A66C2] md:text-[21px] lg:text-[25px]">LinkedIn</span>
    </div>
  );
}

export function NaukriLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex select-none items-center justify-center gap-1.5 ${className}`}>
      <svg viewBox="0 0 100 100" className="h-6 w-6 shrink-0 md:h-7 md:w-7 lg:h-8 lg:w-8" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="50" fill="#2460fb" />
        <circle cx="50" cy="30" r="10" fill="white" />
        <path d="M34 50 C44 38, 70 38, 80 50 C80 55, 75 57, 72 56 C62 46, 48 46, 42 56 Z" fill="white" />
        <path d="M34 53 C44 66, 74 79, 79 81 C77 84, 70 84, 66 82 C58 75, 44 65, 34 53 Z" fill="white" className="opacity-95" />
      </svg>
      <span className="mt-0.5 font-sans text-[18px] font-black leading-none tracking-tighter text-[#2460fb] md:text-[21px] lg:text-[25px]">naukri</span>
    </div>
  );
}

export function FounditLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex select-none flex-col items-center justify-center ${className}`}>
      <div className="flex items-center leading-none">
        <span className="font-sans text-[19px] font-black leading-none tracking-tighter text-[#7206A9] md:text-[22px] lg:text-[26px]">foundit</span>
      </div>
      <svg viewBox="0 0 120 18" className="-mt-0.5 h-[8px] w-[70px] md:h-[9px] md:w-[80px] lg:h-[11px] lg:w-[95px]" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 2 Q50 14, 85 2" stroke="#FF9D00" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <path d="M22 6 Q50 19, 78 6" stroke="#00C4FF" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <path d="M29 10 Q50 24, 71 10" stroke="#FF008A" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}

export function IndeedLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex select-none items-center justify-center gap-1.5 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-6 w-6 shrink-0 md:h-7 md:w-7 lg:h-8 lg:w-8" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 14 C4 8, 8 4, 15 4" stroke="#2557A7" strokeWidth="3" strokeLinecap="round" fill="none" />
        <circle cx="15" cy="10" r="3.5" fill="#2557A7" />
        <rect x="13.2" y="15" width="3.6" height="13" rx="1.2" fill="#2557A7" />
      </svg>
      <span className="mt-0.5 font-sans text-[18px] font-black leading-none tracking-tight text-[#2557a7] md:text-[21px] lg:text-[25px]">indeed</span>
    </div>
  );
}

export function InternshalaLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex select-none items-center justify-center gap-1.5 sm:gap-2 ${className}`}>
      <svg viewBox="0 0 100 100" className="h-6 w-6 shrink-0 -rotate-12 md:h-7 md:w-7 lg:h-[30px] lg:w-[30px]" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 45 L85 15 L50 85 L42 56 L10 45 Z" fill="#589BCE" />
        <path d="M85 15 L42 56 L50 85 Z" fill="#3D77A2" />
        <path d="M85 15 L42 56 L46 62 Z" fill="#27567A" className="opacity-95" />
      </svg>
      <div className="flex flex-col items-start justify-center leading-none">
        <span className="font-sans text-[14px] font-black uppercase leading-none tracking-tight text-[#008BD2] md:text-[16px] lg:text-[19px]">
          Internshala
        </span>
        <span className="mt-1 whitespace-nowrap font-sans text-[6.5px] font-bold uppercase leading-none tracking-widest text-zinc-400 md:text-[7.5px] lg:text-[9px]">
          internships that matter
        </span>
      </div>
    </div>
  );
}

export function WellfoundLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex select-none items-center justify-center gap-1.5 ${className}`}>
      <span className="font-sans text-[18px] font-extrabold leading-none tracking-tighter text-zinc-950 md:text-[21px] lg:text-[25px]">wellfound</span>
      <span className="-mt-0.5 shrink-0 animate-bounce font-sans text-base font-black text-[#FF4F00] md:text-lg lg:text-xl">✌️</span>
    </div>
  );
}

// Portals shown in the rotating hero badge — the ones Hunter actually supports.
const PLATFORMS = [
  { id: "naukri", border: "hover:border-[#2460fb]/40" },
  { id: "foundit", border: "hover:border-[#7206A9]/40" },
  { id: "internshala", border: "hover:border-[#008BD2]/40" },
  { id: "infosys", border: "hover:border-[#007cc3]/40" },
  { id: "tcs", border: "hover:border-zinc-400" },
  { id: "wipro", border: "hover:border-zinc-400" },
  { id: "hcltech", border: "hover:border-[#0075c9]/40" },
  { id: "capgemini", border: "hover:border-[#0070ad]/40" },
  { id: "cognizant", border: "hover:border-zinc-400" },
];

export function FlippingLogoBadge({ interval = 1000 }: { interval?: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % PLATFORMS.length);
    }, interval);
    return () => clearInterval(timer);
  }, [interval]);

  return (
    <span
      style={{ perspective: "1000px" }}
      className="relative mx-2 inline-flex h-[48px] w-[170px] items-center justify-center align-middle sm:mx-3 md:h-[58px] md:w-[200px] lg:h-[68px] lg:w-[245px]"
    >
      <AnimatePresence mode="popLayout">
        <motion.span
          key={index}
          initial={{ opacity: 0, rotateX: -90, y: 10 }}
          animate={{ opacity: 1, rotateX: 0, y: 0 }}
          exit={{ opacity: 0, rotateX: 90, y: -10 }}
          transition={{ type: "tween", duration: 0.4, ease: "easeInOut" }}
          className={`absolute inset-0 flex items-center justify-center rounded-xl border border-zinc-200/90 bg-white px-4 shadow-[0_5px_18px_rgba(0,0,0,0.03),0_1.5px_3px_rgba(0,0,0,0.015)] transition-all duration-300 sm:rounded-2xl sm:px-6 ${PLATFORMS[index].border}`}
          style={{ width: "100%", height: "100%", transformStyle: "preserve-3d", backfaceVisibility: "hidden" }}
        >
          <span className="flex w-full transform-gpu items-center justify-center text-center">
            <PortalLogo name={PLATFORMS[index].id} size="lg" />
          </span>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export const PORTAL_LOGOS = PLATFORMS.map((p) => p.id);

const LOGO_BY_NAME: Record<string, (props: { className?: string }) => JSX.Element> = {
  naukri: NaukriLogo,
  foundit: FounditLogo,
  indeed: IndeedLogo,
  internshala: InternshalaLogo,
  linkedin: LinkedInLogo,
  wellfound: WellfoundLogo,
};

/**
 * Image logos. Drop files in `frontend/public/portal-logos/` named by the lowercased
 * portal key, then map them here. Missing/broken images fall back to the built-in
 * SVG mark (if any), then to the portal name text. You can also override a built-in
 * SVG (e.g. naukri) by adding it here.
 */
const PORTAL_IMG: Record<string, string> = {
  naukri: "/portal-logos/naukri.svg",
  foundit: "/portal-logos/foundit.png",
  // internshala intentionally omitted — falls back to the built-in SVG wordmark.
  // To use an image, drop `internshala.png` here and re-add the line above.
  wipro: "/portal-logos/wipro.png",
  hcltech: "/portal-logos/hcltech.png",
  infosys: "/portal-logos/infosys.png",
  capgemini: "/portal-logos/capgemini.svg",
  tcs: "/portal-logos/tcs.png",
  cognizant: "/portal-logos/cognizant.png",
};

// Per-logo size multiplier — some source images (e.g. Internshala, which includes a
// tagline) read small at a fixed height, so nudge them up.
const PORTAL_IMG_SCALE: Record<string, number> = {};

function LogoImage({ src, alt, h, maxW }: { src: string; alt: string; h: number; maxW: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="font-mono text-[11px] font-bold uppercase tracking-tight text-zinc-700">{alt}</span>;
  return (
    <span className="inline-flex items-center" style={{ height: h }}>
      <img src={src} alt={alt} className="max-h-full w-auto object-contain" style={{ maxWidth: maxW }} onError={() => setFailed(true)} />
    </span>
  );
}

/** Brand portal mark with a few sizes; image → SVG → name-text fallback. */
export function PortalLogo({ name, size = "sm" }: { name: string; size?: "badge" | "sm" | "md" | "lg" }) {
  const key = name?.toLowerCase();
  const mul = PORTAL_IMG_SCALE[key] ?? 1;
  const h = (size === "badge" ? 18 : size === "sm" ? 24 : size === "md" ? 30 : 40) * mul;
  const maxW = (size === "badge" ? 92 : size === "sm" ? 120 : size === "md" ? 150 : 200) * mul;
  const img = PORTAL_IMG[key];
  if (img) return <LogoImage src={img} alt={name} h={h} maxW={maxW} />;

  const Logo = LOGO_BY_NAME[key];
  const scale = size === "badge" ? 0.55 : size === "sm" ? 0.7 : size === "md" ? 0.85 : 1;
  if (Logo) {
    return (
      <span className="inline-flex origin-left items-center overflow-visible" style={{ height: size === "badge" ? 14 : size === "sm" ? 18 : size === "md" ? 24 : 30 }}>
        <span className="inline-flex origin-left" style={{ transform: `scale(${scale})` }}>
          <Logo />
        </span>
      </span>
    );
  }
  return <span className="font-mono text-[11px] font-bold uppercase tracking-tight text-zinc-700">{name}</span>;
}
