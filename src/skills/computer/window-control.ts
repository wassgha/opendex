import { createRequire } from 'node:module';
import { app } from 'electron';
import { join } from 'node:path';
let native: { visibleControls(): string; control(action: string, target: string): boolean; savedMinimized(): boolean; appPath(name: string): string; activateApp(path: string): number; appVisible(pid: number): boolean; requestQuit(path: string): number; appRunning(pid: number): boolean } | undefined;
export async function controlMacWindow(action: 'minimize' | 'restore' | 'maximize', target = 'current'): Promise<void> {
  native ??= createRequire(import.meta.url)(join(app.getAppPath(), 'out/native/window-control.node'));
  native!.control(action, target);
  if (action === 'minimize' || action === 'restore') {
    const expected = action === 'minimize';
    for (let attempt = 0; attempt < 15; attempt++) {
      if (native!.savedMinimized() === expected) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('macOS accepted the request, but the window did not reach the requested state.');
  }
}

export function macAppControls() {
  native ??= createRequire(import.meta.url)(join(app.getAppPath(), 'out/native/window-control.node'));
  return native!;
}
