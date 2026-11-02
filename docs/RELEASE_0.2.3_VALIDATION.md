# Glint 0.2.3 targeted release checks

Windows x64, 2 November 2026. This patch is limited to tray restoration and version/release documentation.

- Seven targeted tray tests pass, including one pointer gesture producing exactly one reopen request and right-click gestures producing none.
- TypeScript and the production frontend build pass as part of packaging.
- The acrylic implementation, material palette, dropdown styling, window dimensions and maximize/restore control are unchanged from 0.2.2.
- No fresh manual tray automation or broad visual/hardware test pass was performed, following the requested focused release workflow.
- Optimized x64 executable, setup and MSI build successfully. All 21 packaging checks pass, including version consistency, production identity, installer/ZIP contents, optional OCR pin and checksums.

Artifact sizes and SHA-256 values are recorded in `validation/release-0.2.3.json` and the distributed `SHA256SUMS.txt`.

All five public downloads match the local assets byte for byte and by SHA-256. GitHub latest resolves to v0.2.3. See `validation/release-0.2.3-public.json`.

Windows acrylic can still resample its blurred backdrop when window bounds change. Installers retain the existing unsigned distribution setup; OCR and caption engines remain optional downloads.
