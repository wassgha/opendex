# macOS window controls

This Node-API addon runs inside Electron main, preserving the app's Accessibility permission identity. It retains one AX window reference after a successful minimize request and restores that window, even when another window is foreground. The reference is released when replaced or the process exits. Restore does not survive an app restart. Closed or inaccessible windows return an error, never a title-based substitute.

`pnpm build` compiles the addon with Xcode command-line tools and the development dependency `node-api-headers`. `pnpm dev` also builds it. Other host platforms skip compilation. The addon is emitted into `out/native` and unpacked from ASAR for packaging. Build on the target Mac architecture; cross-architecture packaging and signed distribution still need validation. No runtime compiler or extra helper process is used.

AX minimized state changes are asynchronous; the TypeScript wrapper verifies minimize/restore with bounded polling. Maximize checks native setter results; apps with fixed sizes can constrain the requested bounds. Native messaging uses a one-second timeout.

Named application quitting uses `requestQuit(path)` and `appRunning(pid)`.
It requests normal termination once and verifies exit asynchronously in the Open
skill. It never force-terminates, launches an app to quit it, or dismisses a save
prompt. Dex itself, Finder, background agents, and ambiguous multiple instances
are rejected. A bounded wait returning still-running is not reported as success.
