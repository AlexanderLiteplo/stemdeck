import {
  SECTION_KEY_LABELS,
  sectionPress,
  setSectionPhrase,
  toggleSectionLoop
} from '../sections'
import { useStore } from '../state/store'
import { tip } from './TooltipLayer'

const PHRASES = [1, 2, 4, 8]

/** Ten keyboard-mapped section pads: play a song like a piano without losing the beat. */
export function SectionPads({ deckIndex }: { deckIndex: number }) {
  const deck = useStore((s) => s.decks[deckIndex])
  const sections = useStore(
    (s) => s.library.find((t) => t.id === s.decks[deckIndex].trackId)?.sections ?? null
  )
  const keys = SECTION_KEY_LABELS[deckIndex]
  const disabled = !deck.trackId || deck.loading

  return (
    <div className="section-pads">
      <span
        className="section-label"
        {...tip(
          'Song keys',
          `Map parts of the song to your keyboard (${keys[0]}–${keys[9]}). Press an empty key to save the current bar. Press a saved key to jump there — you land on the same beat you pressed it on, so the groove never breaks. Shift+key re-saves, Alt+key clears.`
        )}
      >
        KEYS
      </span>
      {keys.map((label, slot) => {
        const set = sections?.[slot] !== null && sections?.[slot] !== undefined
        return (
          <button
            key={label}
            disabled={disabled}
            className={`pad section-pad ${set ? 'set' : ''} ${deck.activeSection === slot && set ? 'active' : ''}`}
            onClick={(e) =>
              sectionPress(deckIndex, slot, e.altKey ? 'clear' : e.shiftKey ? 'set' : 'trigger')
            }
            onContextMenu={(e) => {
              e.preventDefault()
              sectionPress(deckIndex, slot, 'clear')
            }}
            {...tip(
              set ? `Section ${label}` : `Empty key ${label}`,
              set
                ? `Jump here in time with the beat. Shift+click re-saves at the playhead, right-click or Alt+click clears.`
                : `Click (or press ${label}) to save the current bar as a section.`
            )}
          >
            {label}
          </button>
        )
      })}
      <span className="row-gap" />
      <div
        className="seg"
        {...tip(
          'Phrase lock',
          '1 = keep your beat within the bar. 2/4/8 = also keep which bar of the phrase you are in (e.g. bar 3 of 4 lands in bar 3 of the section). Also sets the loop length.'
        )}
      >
        {PHRASES.map((bars) => (
          <button
            key={bars}
            className={deck.sectionPhrase === bars ? 'active' : ''}
            onClick={() => setSectionPhrase(deckIndex, bars)}
          >
            {bars}
          </button>
        ))}
      </div>
      <button
        className={`toggle mini ${deck.sectionLoop ? 'active' : ''}`}
        onClick={() => toggleSectionLoop(deckIndex)}
        {...tip(
          'Loop sections',
          'On: each section key loops its phrase (1/2/4/8 bars) until you hit another key — like a sampler. Off: the song keeps playing forward from the section.'
        )}
      >
        LOOP
      </button>
    </div>
  )
}
