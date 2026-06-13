# Portal logos

Drop portal/company logo image files here. They're served at `/portal-logos/<file>`
and rendered by the `PortalLogo` component (`src/components/ui/PlatformLogos.tsx`).

## How to add a logo

1. Save the image in this folder named by the **lowercased portal key**, e.g.:
   - `wipro.png`, `hcltech.png`, `infosys.png`, `capgemini.png`, `tcs.png`, `cognizant.png`
   - `workday.png`, `taleo.png`
2. If you use a different filename/extension (e.g. `.svg`, `.webp`), update the
   `PORTAL_IMG` map in `src/components/ui/PlatformLogos.tsx`.

## Notes

- Transparent **PNG** or **SVG** work best (they sit on white cards).
- Wide wordmark logos are fine — height is fixed (~16–28px) and width auto-scales.
- If an image is missing or fails to load, the component automatically falls back to
  the built-in SVG mark (for Naukri/Foundit/Indeed/Internshala/LinkedIn/Wellfound) or
  to the portal name as text — so nothing breaks if a file isn't there yet.
- You can also override a built-in logo (e.g. show a real `naukri.png`) by adding a
  `naukri: "/portal-logos/naukri.png"` entry to `PORTAL_IMG`.
