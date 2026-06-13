import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type CompanyLogoProps = {
  company: string;
  logoUrl?: string;
  externalUrl?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZE_CLASS = {
  sm: "h-8 w-8 rounded-xl text-[10px]",
  md: "h-10 w-10 rounded-2xl text-xs",
  lg: "h-12 w-12 rounded-2xl text-sm",
};

const PORTAL_HOST_MARKERS = ["naukri.com", "foundit.in", "internshala.com"];
const COMPANY_SUFFIXES = /\b(private|pvt|ltd|limited|services|service|solutions|solution|technologies|technology|consulting|consultants|consultancy|india|llp|plc|inc|corp|corporation|company|co)\b/gi;

function CompanyLogo({ company, logoUrl = "", externalUrl = "", size = "sm", className = "" }: CompanyLogoProps) {
  const [failedIndex, setFailedIndex] = useState(0);
  const sources = useMemo(() => buildLogoSources(company, logoUrl, externalUrl), [company, externalUrl, logoUrl]);
  const src = sources[failedIndex] || "";
  const initials = companyInitials(company);

  useEffect(() => {
    setFailedIndex(0);
  }, [company, externalUrl, logoUrl]);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden border border-zinc-200 bg-white font-sans font-black text-zinc-500 shadow-sm",
        SIZE_CLASS[size],
        className,
      )}
      title={company}
    >
      {src ? (
        <img
          src={src}
          alt={`${company} logo`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain p-1"
          onError={() => setFailedIndex((index) => index + 1)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}

function buildLogoSources(company: string, logoUrl: string, externalUrl: string): string[] {
  const sources = new Set<string>();
  if (logoUrl) sources.add(logoUrl);

  const externalDomain = domainFromUrl(externalUrl);
  if (externalDomain) {
    sources.add(`https://logo.clearbit.com/${externalDomain}`);
    sources.add(`https://www.google.com/s2/favicons?domain=${externalDomain}&sz=96`);
  }

  for (const domain of domainGuesses(company)) {
    if (domain !== externalDomain) {
      sources.add(`https://logo.clearbit.com/${domain}`);
    }
  }
  return Array.from(sources);
}

function domainFromUrl(value: string): string {
  if (!value) return "";
  try {
    const host = new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
    if (!host || PORTAL_HOST_MARKERS.some((marker) => host.endsWith(marker))) return "";
    const parts = host.split(".").filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join(".") : host;
  } catch {
    return "";
  }
}

function domainGuesses(company: string): string[] {
  const slug = company
    .replace(/&/g, " and ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
  if (!slug || slug.length < 3) return [];
  return [`${slug}.com`, `${slug}.in`, `${slug}.io`];
}

function companyInitials(company: string): string {
  const words = company
    .replace(COMPANY_SUFFIXES, " ")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  const picked = words.length >= 2 ? [words[0], words[1]] : [words[0] || "C"];
  return picked.map((word) => word[0]?.toUpperCase()).join("").slice(0, 2);
}

export { CompanyLogo };
