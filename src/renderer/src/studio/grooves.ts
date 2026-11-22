/** One-click drum grooves: the classic patterns of each style, ready to edit. */
import type { DrumRows } from './drumtext'

export interface Groove {
  id: string
  label: string
  /** Tempo the groove is written for. */
  bpm: number
  /** The factory kit it was voiced with. */
  kit: string
  bars: 1 | 2 | 4
  rows: DrumRows
}

export const GROOVES: Groove[] = [
  {
    id: 'boombap',
    label: 'Boom bap',
    bpm: 90,
    kit: 'Boom Bap',
    bars: 2,
    rows: {
      kick: 'x.........x..... x......x..x.....',
      snare: '....x.......x... ....x.......x..o',
      hat: 'x.m.x.m.x.m.x.m. x.m.x.m.x.m.xmm.',
      perc: '.......o........ ......o.........'
    }
  },
  {
    id: 'trap',
    label: 'Trap',
    bpm: 140,
    kit: 'Real 808 Trap',
    bars: 2,
    rows: {
      kick: 'x......x..x..... x.....x...x...x.',
      snare: '........x....... ........x.....o.',
      clap: '........x....... ........x.......',
      hat: 'x.x.x.x.x.x.x3x. x.x.x3x.x.x.2222',
      bass808: 'x......x..x..... x.....x...x...x.'
    }
  },
  {
    id: 'drill',
    label: 'Drill',
    bpm: 142,
    kit: 'Off The Grid Drill',
    bars: 2,
    rows: {
      kick: 'x.........x..... ..x.......x.....',
      snare: '........x....... ........x.....x.',
      hat: 'x..x..x.x..x..x. x..x..x.x.3.x3x.',
      bass808: 'x.........x..... ..x.......x.....'
    }
  },
  {
    id: 'house',
    label: 'House',
    bpm: 124,
    kit: 'uzu Analog',
    bars: 2,
    rows: {
      kick: 'x...x...x...x... x...x...x...x...',
      clap: '....x.......x... ....x.......x...',
      openhat: '..x...x...x...x. ..x...x...x...x.',
      hat: '...o...o...o...o ...o...o...o...o',
      perc: '.......m........ ..m.....m.......'
    }
  },
  {
    id: 'techno',
    label: 'Techno',
    bpm: 130,
    kit: 'uzu Punch',
    bars: 2,
    rows: {
      kick: 'x...x...x...x... x...x...x...x...',
      clap: '....m.......m... ....m.......m...',
      hat: '..x...x...x...x. ..x...x...x...x.',
      crash: 'o.o.o.o.o.o.o.o. o.o.o.o.o.o.o.o.',
      perc: '.......o.....o.. ...o......o.....'
    }
  },
  {
    id: 'jungle',
    label: 'Jungle (Amen)',
    bpm: 165,
    kit: 'Jungle Break',
    bars: 4,
    rows: {
      kick: 'x.x.......xx.... x.x.......xx.... x.x.......x..... ..xx......x.....',
      snare: '....x..o.o..x..o ....x..o.o..x..o ....x..o.o....x. .o..x..o.o....x.',
      hat: 'x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x.',
      crash: '................ ................ ................ ..........m.....'
    }
  },
  {
    id: 'dembow',
    label: 'Reggaeton (dembow)',
    bpm: 95,
    kit: 'Real 808',
    bars: 2,
    rows: {
      kick: 'x...x...x...x... x...x...x...x...',
      snare: '...x..x....x..x. ...x..x....x..x.',
      hat: 'm.o.m.o.m.o.m.o. m.o.m.o.m.o.m.o.'
    }
  },
  {
    id: 'funk',
    label: 'Funk break',
    bpm: 100,
    kit: 'Boom Bap',
    bars: 2,
    rows: {
      kick: 'x.x.......x..x.. x.x.......x....x',
      snare: '....x..o.o.ox..o ....x..o.o.ox.o.',
      hat: 'xmxmxmxmxmxmx.xm xmxmxmxmxmxmxmxm',
      openhat: '.............m.. ................'
    }
  }
]
