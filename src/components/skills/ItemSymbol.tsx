import { Folder } from './Folder'
import { FlowOrb } from './FlowOrb'
import type { ItemKind } from './hues'

/**
 * An item's picture by what it is: a flow runs, so it turns as an orb;
 * knowledge and analyses are information, so they rest in a folder.
 */
export function ItemSymbol({ kind, hue, seedKey, size, open = false }: { kind: ItemKind; hue: number; seedKey: string; size: number; open?: boolean }) {
  return kind === 'workflow'
    ? <FlowOrb hue={hue} seedKey={seedKey} size={Math.round(size * 0.92)} lively={open} />
    : <Folder hue={hue} size={size} open={open} drift={open} />
}
