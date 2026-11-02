# Glint 0.2.3

This patch fixes the tray restore sequence behind the reported white flash when bringing Glint back to the foreground.

- A left tray click restores the app on mouse release only. Previously both press and release requested restoration.
- Open Glint and Settings use one shared, coalesced restore task after the tray/menu callback has finished, rather than changing foreground state inside that callback.
- Hidden minimized windows synchronize the framework's visible state before restoring. This avoids its intermediate restore-then-hide sequence.
- An already-visible, restored window is focused without another native show transition.
- The existing acrylic palette, dropdown materials, window dimensions and native maximize/restore controls are retained.

Windows x64 setup, MSI and an application ZIP with recording sidecars are provided. OCR and caption engines remain separate optional downloads. Installers retain the existing unsigned distribution setup.

This focused patch uses targeted tray regression tests and package checks. It does not claim a new exhaustive visual or hardware review. Windows acrylic can still resample its blurred backdrop when window bounds change.
