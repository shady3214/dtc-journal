$env:GH_TOKEN = "" # Set this in your environment, do not commit secrets!
& "C:\Program Files\GitHub CLI\gh.exe" release create v0.1.1 `
  "F:\journal\src-tauri\target\release\bundle\nsis\Forex Journal_0.1.1_x64-setup.exe" `
  "F:\journal\src-tauri\target\release\bundle\nsis\Forex Journal_0.1.1_x64-setup.exe.sig" `
  "F:\journal\src-tauri\target\release\bundle\msi\Forex Journal_0.1.1_x64_en-US.msi" `
  "F:\journal\src-tauri\target\release\bundle\msi\Forex Journal_0.1.1_x64_en-US.msi.sig" `
  "F:\journal\src-tauri\target\release\bundle\latest.json" `
  --repo shady3214/dtc-journal `
  --title "v0.1.1" `
  --notes "Persistent storage, display name, direct P&L default, symbol search overhaul, price fetch fixes, DST-aware NY open notification, London open 12:30 PM IST, low impact events removed" `
  --latest
