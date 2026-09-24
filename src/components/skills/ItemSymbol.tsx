import { Folder } from './Folder'
import { FlowSymbol } from './FlowSymbol'
import type { ItemKind } from './hues'

/**
 * An item's picture by what it is: a flow runs step by step, so it shows its steps;
 * knowledge and analyses are information, so they rest in a folder.
 */
export function ItemSymbol({ kind, hue, size, open = false }: { kind: ItemKind; hue: number; seedKey?: string; size: number; open?: boolean }) {
  return kind === 'workflow'
    ? <FlowSymbol hue={hue} size={size} />
    : <Folder hue={hue} size={size} open={open} drift={open} />
}
