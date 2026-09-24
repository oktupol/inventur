import { describe, expect, it } from 'vitest';
import {
  defaultSelection,
  effectiveSelection,
  interpretKey,
  moveRowSelection,
  type KeyState,
} from './keyboard.ts';

const empty: KeyState = { text: '', quantityDigits: null, choiceOpen: false };

/** Feeds a sequence of keys, applying the text changes a browser would make. */
function typeKeys(keys: string[]) {
  let state = { ...empty };
  const commands = [];
  for (const key of keys) {
    const command = interpretKey(state, key);
    commands.push(command.type);
    if (command.type === 'none' && key.length === 1) state = { ...state, text: state.text + key };
    if (command.type === 'start_quantity') state = { ...state, quantityDigits: '' };
    if (command.type === 'quantity_input') state = { ...state, quantityDigits: command.digits };
  }
  return { state, commands };
}

describe('shortcuts with an empty input', () => {
  it.each([
    ['Delete', 'delete'],
    ['+', 'increment'],
    ['-', 'decrement'],
    ['=', 'start_quantity'],
    ['*', 'start_quantity'],
    ['Escape', 'reset_selection'],
  ])('%s → %s', (key, type) => {
    expect(interpretKey(empty, key).type).toBe(type);
  });

  it('selects other lines with the arrow keys', () => {
    expect(interpretKey(empty, 'ArrowUp')).toEqual({ type: 'select', delta: -1 });
    expect(interpretKey(empty, 'ArrowDown')).toEqual({ type: 'select', delta: 1 });
  });

  it('lets other keys through', () => {
    for (const key of ['a', '4', 'Enter', 'Tab', 'Shift']) {
      expect(interpretKey(empty, key).type).toBe('none');
    }
  });
});

describe('manual capture', () => {
  it('opens with F2, with or without text and in quantity mode', () => {
    expect(interpretKey(empty, 'F2').type).toBe('manual');
    expect(interpretKey({ ...empty, text: '4099' }, 'F2').type).toBe('manual');
    expect(interpretKey({ ...empty, quantityDigits: '2' }, 'F2').type).toBe('manual');
  });

  it('waits while a choice is open', () => {
    expect(interpretKey({ ...empty, choiceOpen: true }, 'F2').type).toBe('none');
  });
});

describe('typing into a non-empty input', () => {
  it('treats "AB-123" as input, not as a decrement', () => {
    const { state, commands } = typeKeys(['A', 'B', '-', '1', '2', '3']);
    expect(state.text).toBe('AB-123');
    expect(commands.every((type) => type === 'none')).toBe(true);
  });

  it.each(['+', '-', '=', '*', 'Delete', 'ArrowUp', 'Escape'])('lets %s through', (key) => {
    expect(interpretKey({ ...empty, text: 'X' }, key).type).toBe('none');
  });

  it('leaves arrow keys to an open choice', () => {
    expect(interpretKey({ ...empty, choiceOpen: true }, 'ArrowDown').type).toBe('none');
    expect(interpretKey({ ...empty, choiceOpen: true }, '+').type).toBe('none');
  });
});

describe('quantity mode', () => {
  it('sets the quantity with "= 20 Enter" and "* 20 Enter"', () => {
    for (const start of ['=', '*']) {
      const { state } = typeKeys([start, '2', '0']);
      expect(state.quantityDigits).toBe('20');
      expect(interpretKey(state, 'Enter')).toEqual({ type: 'set_quantity', quantity: 20 });
    }
  });

  it('accepts only digits', () => {
    const { state, commands } = typeKeys(['=', '1', 'a', '-', '+', ',', '5']);
    expect(state.quantityDigits).toBe('15');
    expect(commands.slice(2, 6)).toEqual(['ignore', 'ignore', 'ignore', 'ignore']);
  });

  it('removes digits with Backspace', () => {
    expect(interpretKey({ ...empty, quantityDigits: '12' }, 'Backspace')).toEqual({
      type: 'quantity_input',
      digits: '1',
    });
  });

  it('requires a quantity of at least 1', () => {
    expect(interpretKey({ ...empty, quantityDigits: '' }, 'Enter').type).toBe('invalid_quantity');
    expect(interpretKey({ ...empty, quantityDigits: '0' }, 'Enter').type).toBe('invalid_quantity');
    expect(interpretKey({ ...empty, quantityDigits: '007' }, 'Enter')).toEqual({
      type: 'set_quantity',
      quantity: 7,
    });
  });

  it('limits the number of digits to the maximum quantity', () => {
    const { state } = typeKeys(['=', '1', '2', '3', '4', '5', '6']);
    expect(state.quantityDigits).toBe('12345');
  });

  it('is cancelled with Esc', () => {
    expect(interpretKey({ ...empty, quantityDigits: '3' }, 'Escape').type).toBe('cancel_quantity');
  });
});

describe('row selection', () => {
  const kasse = { id: 1, name: 'Kasse' };
  const lager = { id: 2, name: 'Lager' };
  // Newest first, as in the list.
  const entries = [
    { id: 14, workstation: lager },
    { id: 13, workstation: kasse },
    { id: 12, workstation: lager },
    { id: 11, workstation: kasse },
  ];

  it('defaults to the newest line of the own workstation', () => {
    expect(defaultSelection(entries, kasse.id)).toBe(13);
    expect(defaultSelection(entries, 99)).toBeNull();
  });

  it('keeps a chosen line while it exists and falls back to the default', () => {
    expect(effectiveSelection(entries, 12, kasse.id)).toBe(12);
    expect(effectiveSelection(entries, 99, kasse.id)).toBe(13);
    expect(effectiveSelection(entries, null, kasse.id)).toBe(13);
  });

  it('moves up and down within the list without wrapping', () => {
    expect(moveRowSelection(entries, 13, -1)).toBe(14);
    expect(moveRowSelection(entries, 13, 1)).toBe(12);
    expect(moveRowSelection(entries, 14, -1)).toBe(14);
    expect(moveRowSelection(entries, 11, 1)).toBe(11);
  });

  it('starts at the top without a selection', () => {
    expect(moveRowSelection(entries, null, 1)).toBe(14);
    expect(moveRowSelection([], null, 1)).toBeNull();
  });
});
