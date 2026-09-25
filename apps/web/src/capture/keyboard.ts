import { MAX_QUANTITY, type Entry } from '@inventur/shared';

/**
 * Keyboard control of the capture input, independent of React.
 *
 * Shortcuts only apply while the input is empty; otherwise every key types
 * normally, so "AB-123" is an input and not a decrement. Keys are compared by
 * `KeyboardEvent.key`, which is the same for the number pad ("+", "-", "*",
 * digits, "Delete"). With Ctrl (or Cmd), the key is passed as e.g. "Ctrl+z".
 */

export interface KeyState {
  /** Current text of the input. */
  text: string;
  /** Digits typed in quantity mode, or null outside of it. */
  quantityDigits: string | null;
  /** An ambiguous result waits for a choice; arrows and Enter belong to it. */
  choiceOpen: boolean;
  /**
   * The input edits the serial number of a line. Every key types normally,
   * also from a barcode scanner, until Enter or Esc.
   */
  serialMode?: boolean;
}

export type KeyCommand =
  | { type: 'none' }
  | { type: 'ignore' }
  | { type: 'delete' }
  | { type: 'increment' }
  | { type: 'decrement' }
  | { type: 'start_quantity' }
  | { type: 'quantity_input'; digits: string }
  | { type: 'set_quantity'; quantity: number }
  | { type: 'invalid_quantity' }
  | { type: 'cancel_quantity' }
  | { type: 'select'; delta: -1 | 1 }
  | { type: 'reset_selection' }
  | { type: 'manual' }
  | { type: 'checkpoint' }
  | { type: 'undo' }
  | { type: 'start_serial' }
  | { type: 'set_serial' }
  | { type: 'cancel_serial' };

const MAX_DIGITS = String(MAX_QUANTITY).length;

function quantityModeKey(digits: string, key: string): KeyCommand {
  if (/^[0-9]$/.test(key)) {
    return digits.length < MAX_DIGITS
      ? { type: 'quantity_input', digits: digits + key }
      : { type: 'ignore' };
  }
  switch (key) {
    case 'Backspace':
      return { type: 'quantity_input', digits: digits.slice(0, -1) };
    case 'Enter': {
      const quantity = Number(digits);
      return digits !== '' && quantity >= 1
        ? { type: 'set_quantity', quantity }
        : { type: 'invalid_quantity' };
    }
    case 'Escape':
      return { type: 'cancel_quantity' };
    default:
      // Only digits are accepted; other characters are swallowed.
      return key.length === 1 ? { type: 'ignore' } : { type: 'none' };
  }
}

/** Decides what a key press in the capture input does. */
export function interpretKey(state: KeyState, key: string): KeyCommand {
  if (state.serialMode) {
    if (key === 'Enter') return { type: 'set_serial' };
    if (key === 'Escape') return { type: 'cancel_serial' };
    return /^F\d+$/.test(key) ? { type: 'ignore' } : { type: 'none' };
  }
  // Manual capture works at any time, also with text in the input (it becomes the original input).
  if (key === 'F2' && !state.choiceOpen) return { type: 'manual' };
  if (state.quantityDigits !== null) return quantityModeKey(state.quantityDigits, key);
  if (state.choiceOpen || state.text !== '') return { type: 'none' };
  switch (key) {
    case 'Delete':
      return { type: 'delete' };
    case '+':
      return { type: 'increment' };
    case '-':
      return { type: 'decrement' };
    case '=':
    case '*':
      return { type: 'start_quantity' };
    case 'ArrowUp':
      return { type: 'select', delta: -1 };
    case 'ArrowDown':
      return { type: 'select', delta: 1 };
    case 'Escape':
      return { type: 'reset_selection' };
    case 'F3':
      return { type: 'checkpoint' };
    case 'F4':
      return { type: 'start_serial' };
    case 'Ctrl+z':
      return { type: 'undo' };
    default:
      return { type: 'none' };
  }
}

/** The key of a keyboard event as `interpretKey` expects it, e.g. "Ctrl+z" for Ctrl+Z or Cmd+Z. */
export function keyOf(event: { key: string; ctrlKey: boolean; metaKey: boolean }): string {
  return event.ctrlKey || event.metaKey ? `Ctrl+${event.key.toLowerCase()}` : event.key;
}

/** By default the shortcuts act on the newest line of this workstation. */
export function defaultSelection(
  entries: readonly Pick<Entry, 'id' | 'workstation'>[],
  workstationId: number,
): number | null {
  return entries.find((entry) => entry.workstation.id === workstationId)?.id ?? null;
}

/** The selected line: the chosen one while it still exists, otherwise the default. */
export function effectiveSelection(
  entries: readonly Pick<Entry, 'id' | 'workstation'>[],
  selectedId: number | null,
  workstationId: number,
): number | null {
  if (selectedId !== null && entries.some((entry) => entry.id === selectedId)) return selectedId;
  return defaultSelection(entries, workstationId);
}

/**
 * Moves the selection up (newer) or down (older) in the list, which shows the
 * newest line first. Without a selection it starts at the top.
 */
export function moveRowSelection(
  entries: readonly Pick<Entry, 'id'>[],
  currentId: number | null,
  delta: -1 | 1,
): number | null {
  if (entries.length === 0) return null;
  const index = entries.findIndex((entry) => entry.id === currentId);
  if (index === -1) return entries[0]!.id;
  const next = Math.min(entries.length - 1, Math.max(0, index + delta));
  return entries[next]!.id;
}
