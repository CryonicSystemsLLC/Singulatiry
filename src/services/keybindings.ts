export interface Keybinding {
  id: string;
  key: string; // e.g., 'ctrl+shift+p', 'ctrl+b'
  action: () => void;
  when?: string; // context condition
}

class KeybindingRegistry {
  private bindings: Keybinding[] = [];
  private listener: ((e: KeyboardEvent) => void) | null = null;

  register(binding: Keybinding) {
    // Remove existing binding for same id
    this.bindings = this.bindings.filter(b => b.id !== binding.id);
    this.bindings.push(binding);
  }

  unregister(id: string) {
    this.bindings = this.bindings.filter(b => b.id !== id);
  }

  private parseKey(keyStr: string): { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string } {
    const parts = keyStr.toLowerCase().split('+');
    return {
      ctrl: parts.includes('ctrl') || parts.includes('cmd'),
      shift: parts.includes('shift'),
      alt: parts.includes('alt'),
      meta: parts.includes('meta'),
      key: parts.filter(p => !['ctrl', 'cmd', 'shift', 'alt', 'meta'].includes(p))[0] || ''
    };
  }

  private matchEvent(e: KeyboardEvent, keyStr: string): boolean {
    const parsed = this.parseKey(keyStr);
    const eventKey = e.key.toLowerCase();

    // Map common key names
    const keyMap: Record<string, string> = {
      '`': '`',
      'backquote': '`',
    };

    const normalizedKey = keyMap[eventKey] || eventKey;

    // On macOS, Cmd (metaKey) should match ctrl bindings so that
    // shortcuts registered as "ctrl+..." fire when the user presses Cmd.
    const ctrlMatch = parsed.ctrl ? (e.ctrlKey || e.metaKey) : (!e.ctrlKey && !e.metaKey);

    return (
      ctrlMatch &&
      e.shiftKey === parsed.shift &&
      e.altKey === parsed.alt &&
      (normalizedKey === parsed.key || e.code.toLowerCase() === `key${parsed.key}`)
    );
  }

  startListening() {
    if (this.listener) return;

    this.listener = (e: KeyboardEvent) => {
      // Don't handle if in an input/textarea (unless it's a global shortcut like ctrl+shift+p)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      for (const binding of this.bindings) {
        if (this.matchEvent(e, binding.key)) {
          // Allow global shortcuts even in inputs
          const isGlobal = binding.key.includes('ctrl+shift') || binding.key.includes('ctrl+p') || binding.key.includes('ctrl+b') || binding.key.includes('ctrl+j') || binding.key.includes('ctrl+w');
          if (isInput && !isGlobal) continue;

          e.preventDefault();
          e.stopPropagation();
          binding.action();
          return;
        }
      }
    };

    window.addEventListener('keydown', this.listener, true);
  }

  stopListening() {
    if (this.listener) {
      window.removeEventListener('keydown', this.listener, true);
      this.listener = null;
    }
  }

  getAll(): Keybinding[] {
    return [...this.bindings];
  }
}

export const keybindingRegistry = new KeybindingRegistry();
