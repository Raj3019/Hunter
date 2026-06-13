import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type PageLoadingOverlayProps = {
  title: string;
  description?: string;
  className?: string;
};

function PageLoadingOverlay({ title, description, className }: PageLoadingOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn("fixed inset-0 z-[70] flex items-center justify-center bg-white px-6 text-center", className)}
    >
      <div className="flex max-w-md flex-col items-center gap-3">
        <Spinner className="size-9 text-brand-pine" />
        <p className="text-sm font-extrabold text-brand-pine">{title}</p>
        {description && <p className="text-xs font-medium leading-5 text-zinc-500">{description}</p>}
      </div>
    </div>
  );
}

export { PageLoadingOverlay };
