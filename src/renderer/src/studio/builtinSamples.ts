/**
 * Drum samples bundled with the app (src/renderer/public/samples, credits in
 * CREDITS.md there). Generated from the curated folders — keep in step with them.
 */
import type { DrumVoiceId } from './types'

export interface BuiltinSample {
  /** 'builtin:<file under public/samples>' */
  path: string
  label: string
  pack: 'TR-808' | 'uzu'
  /** Pads this sound suits best; it can still go on any pad. */
  pads: DrumVoiceId[]
}

export const BUILTIN_SAMPLES: BuiltinSample[] = [
  { path: 'builtin:tr808/bd0000.wav', label: '808 kick · tight · soft', pack: 'TR-808', pads: ['kick'] },
  { path: 'builtin:tr808/bd0025.wav', label: '808 kick · short · soft', pack: 'TR-808', pads: ['kick'] },
  { path: 'builtin:tr808/bd0050.wav', label: '808 kick · medium · soft', pack: 'TR-808', pads: ['kick'] },
  { path: 'builtin:tr808/bd0075.wav', label: '808 kick · long · soft', pack: 'TR-808', pads: ['kick', 'bass808'] },
  { path: 'builtin:tr808/bd0010.wav', label: '808 kick · huge · soft', pack: 'TR-808', pads: ['kick', 'bass808'] },
  { path: 'builtin:tr808/bd5000.wav', label: '808 kick · tight', pack: 'TR-808', pads: ['kick'] },
  { path: 'builtin:tr808/bd5025.wav', label: '808 kick · short', pack: 'TR-808', pads: ['kick'] },
  { path: 'builtin:tr808/bd5050.wav', label: '808 kick · medium', pack: 'TR-808', pads: ['kick'] },
  { path: 'builtin:tr808/bd5075.wav', label: '808 kick · long', pack: 'TR-808', pads: ['kick', 'bass808'] },
  { path: 'builtin:tr808/bd5010.wav', label: '808 kick · huge', pack: 'TR-808', pads: ['kick', 'bass808'] },
  { path: 'builtin:tr808/bd1000.wav', label: '808 kick · tight · clicky', pack: 'TR-808', pads: ['kick'] },
  { path: 'builtin:tr808/bd1025.wav', label: '808 kick · short · clicky', pack: 'TR-808', pads: ['kick'] },
  { path: 'builtin:tr808/bd1050.wav', label: '808 kick · medium · clicky', pack: 'TR-808', pads: ['kick'] },
  { path: 'builtin:tr808/bd1075.wav', label: '808 kick · long · clicky', pack: 'TR-808', pads: ['kick', 'bass808'] },
  { path: 'builtin:tr808/bd1010.wav', label: '808 kick · huge · clicky', pack: 'TR-808', pads: ['kick', 'bass808'] },
  { path: 'builtin:tr808/sd0000.wav', label: '808 snare · low · body', pack: 'TR-808', pads: ['snare'] },
  { path: 'builtin:tr808/sd0050.wav', label: '808 snare · low', pack: 'TR-808', pads: ['snare'] },
  { path: 'builtin:tr808/sd0010.wav', label: '808 snare · low · snappy', pack: 'TR-808', pads: ['snare'] },
  { path: 'builtin:tr808/sd5000.wav', label: '808 snare · body', pack: 'TR-808', pads: ['snare'] },
  { path: 'builtin:tr808/sd5050.wav', label: '808 snare', pack: 'TR-808', pads: ['snare'] },
  { path: 'builtin:tr808/sd5010.wav', label: '808 snare · snappy', pack: 'TR-808', pads: ['snare'] },
  { path: 'builtin:tr808/sd1000.wav', label: '808 snare · high · body', pack: 'TR-808', pads: ['snare'] },
  { path: 'builtin:tr808/sd1050.wav', label: '808 snare · high', pack: 'TR-808', pads: ['snare'] },
  { path: 'builtin:tr808/sd1010.wav', label: '808 snare · high · snappy', pack: 'TR-808', pads: ['snare'] },
  { path: 'builtin:tr808/ch.wav', label: '808 closed hat', pack: 'TR-808', pads: ['hat'] },
  { path: 'builtin:tr808/oh25.wav', label: '808 open hat · short', pack: 'TR-808', pads: ['openhat'] },
  { path: 'builtin:tr808/oh50.wav', label: '808 open hat · medium', pack: 'TR-808', pads: ['openhat'] },
  { path: 'builtin:tr808/oh75.wav', label: '808 open hat · long', pack: 'TR-808', pads: ['openhat'] },
  { path: 'builtin:tr808/cp.wav', label: '808 clap', pack: 'TR-808', pads: ['clap'] },
  { path: 'builtin:tr808/rs.wav', label: '808 rimshot', pack: 'TR-808', pads: ['perc', 'snare'] },
  { path: 'builtin:tr808/cb.wav', label: '808 cowbell', pack: 'TR-808', pads: ['perc'] },
  { path: 'builtin:tr808/cl.wav', label: '808 claves', pack: 'TR-808', pads: ['perc'] },
  { path: 'builtin:tr808/ma.wav', label: '808 maracas', pack: 'TR-808', pads: ['perc', 'hat'] },
  { path: 'builtin:tr808/cy5025.wav', label: '808 cymbal · short', pack: 'TR-808', pads: ['crash'] },
  { path: 'builtin:tr808/cy5050.wav', label: '808 cymbal · medium', pack: 'TR-808', pads: ['crash'] },
  { path: 'builtin:tr808/cy5075.wav', label: '808 cymbal · long', pack: 'TR-808', pads: ['crash'] },
  { path: 'builtin:tr808/lt50.wav', label: '808 low tom', pack: 'TR-808', pads: ['perc'] },
  { path: 'builtin:tr808/mt50.wav', label: '808 mid tom', pack: 'TR-808', pads: ['perc'] },
  { path: 'builtin:tr808/ht50.wav', label: '808 high tom', pack: 'TR-808', pads: ['perc'] },
  { path: 'builtin:tr808/lc50.wav', label: '808 low conga', pack: 'TR-808', pads: ['perc'] },
  { path: 'builtin:tr808/mc50.wav', label: '808 mid conga', pack: 'TR-808', pads: ['perc'] },
  { path: 'builtin:tr808/hc50.wav', label: '808 high conga', pack: 'TR-808', pads: ['perc'] },
  { path: 'builtin:uzu/bd-10_bd_switchangel.wav', label: 'uzu kick 1', pack: 'uzu', pads: ['kick'] },
  { path: 'builtin:uzu/bd-11_bd_mot4i.wav', label: 'uzu kick 2', pack: 'uzu', pads: ['kick'] },
  { path: 'builtin:uzu/bd-12_bd_mot4i.wav', label: 'uzu kick 3', pack: 'uzu', pads: ['kick'] },
  { path: 'builtin:uzu/bd-13_bd_mot4i.wav', label: 'uzu kick 4', pack: 'uzu', pads: ['kick'] },
  { path: 'builtin:uzu/bd-14_bd_switchangel.wav', label: 'uzu kick 5', pack: 'uzu', pads: ['kick'] },
  { path: 'builtin:uzu/bd-15_bd_switchangel.wav', label: 'uzu kick 6', pack: 'uzu', pads: ['kick'] },
  { path: 'builtin:uzu/bd-16_bd_switchangel.wav', label: 'uzu kick 7', pack: 'uzu', pads: ['kick'] },
  { path: 'builtin:uzu/bd-17_bd_switchangel.wav', label: 'uzu long kick (808)', pack: 'uzu', pads: ['bass808', 'kick'] },
  { path: 'builtin:uzu/sd-10_sd_switchangel-bounce-2.wav', label: 'uzu snare 1', pack: 'uzu', pads: ['snare'] },
  { path: 'builtin:uzu/sd-11_sd_switchangel_3.wav', label: 'uzu snare 2', pack: 'uzu', pads: ['snare'] },
  { path: 'builtin:uzu/sd-12_sd_switchangel_2.wav', label: 'uzu snare 3', pack: 'uzu', pads: ['snare'] },
  { path: 'builtin:uzu/sd-13_sd_switchangel_2.wav', label: 'uzu snare 4', pack: 'uzu', pads: ['snare'] },
  { path: 'builtin:uzu/sd-14_sd.wav', label: 'uzu snare 5', pack: 'uzu', pads: ['snare'] },
  { path: 'builtin:uzu/cp-10_cp_switchangel.wav', label: 'uzu clap 1', pack: 'uzu', pads: ['clap'] },
  { path: 'builtin:uzu/cp-11_cp_mot4i.wav', label: 'uzu clap 2', pack: 'uzu', pads: ['clap'] },
  { path: 'builtin:uzu/hh-10_hh_switchangel.wav', label: 'uzu hat 1', pack: 'uzu', pads: ['hat'] },
  { path: 'builtin:uzu/hh-11_hh_mot4i.wav', label: 'uzu hat 2', pack: 'uzu', pads: ['hat'] },
  { path: 'builtin:uzu/hh-12_hh_switchangel.wav', label: 'uzu hat 3', pack: 'uzu', pads: ['hat'] },
  { path: 'builtin:uzu/hh-13_hh_switchangel.wav', label: 'uzu hat 4', pack: 'uzu', pads: ['hat'] },
  { path: 'builtin:uzu/hh-14_hh_mot4i.wav', label: 'uzu hat 5', pack: 'uzu', pads: ['hat'] },
  { path: 'builtin:uzu/oh-10_oh_switchangel.wav', label: 'uzu open hat 1', pack: 'uzu', pads: ['openhat'] },
  { path: 'builtin:uzu/oh-11_oh_switchangel.wav', label: 'uzu open hat 2', pack: 'uzu', pads: ['openhat'] },
  { path: 'builtin:uzu/oh-12_oh_switchangel.wav', label: 'uzu open hat 3', pack: 'uzu', pads: ['openhat'] },
  { path: 'builtin:uzu/oh-13_oh_switchangel.wav', label: 'uzu open hat 4', pack: 'uzu', pads: ['openhat'] },
  { path: 'builtin:uzu/cr-10_cr_switchangel.wav', label: 'uzu crash 1', pack: 'uzu', pads: ['crash'] },
  { path: 'builtin:uzu/cr-11_cr_mot4i.wav', label: 'uzu crash 2', pack: 'uzu', pads: ['crash'] },
  { path: 'builtin:uzu/rd-10_rd_switchangel.wav', label: 'uzu ride', pack: 'uzu', pads: ['crash'] },
  { path: 'builtin:uzu/rim-10_rim_switchangel.wav', label: 'uzu rim 1', pack: 'uzu', pads: ['perc', 'snare'] },
  { path: 'builtin:uzu/rim-11_rim_switch_angel.wav', label: 'uzu rim 2', pack: 'uzu', pads: ['perc', 'snare'] },
  { path: 'builtin:uzu/cb-10_perc_switchangel.wav', label: 'uzu perc', pack: 'uzu', pads: ['perc'] },
  { path: 'builtin:uzu/sh-10_sh_switchangel.wav', label: 'uzu shaker', pack: 'uzu', pads: ['hat', 'perc'] },
  { path: 'builtin:uzu/lt-10_lt_mot4i.wav', label: 'uzu low tom', pack: 'uzu', pads: ['perc'] },
  { path: 'builtin:uzu/mt-10_mt_mot4i.wav', label: 'uzu mid tom', pack: 'uzu', pads: ['perc'] },
  { path: 'builtin:uzu/ht-10_ht_mot4i.wav', label: 'uzu high tom', pack: 'uzu', pads: ['perc'] },
  { path: 'builtin:uzu/misc-10_misc_switchangel_ludens.wav', label: 'uzu modular blip 1', pack: 'uzu', pads: ['perc'] },
  { path: 'builtin:uzu/misc-11_misc_switchangel_ludens.wav', label: 'uzu modular blip 2', pack: 'uzu', pads: ['perc'] },
  { path: 'builtin:uzu/misc-12_misc_switchangel_ludens.wav', label: 'uzu modular blip 3', pack: 'uzu', pads: ['perc'] },
  { path: 'builtin:uzu/misc-13_misc_switchangel_ludens.wav', label: 'uzu modular blip 4', pack: 'uzu', pads: ['perc'] },
  { path: 'builtin:uzu/misc-14_misc_switchangel_ludens.wav', label: 'uzu modular blip 5', pack: 'uzu', pads: ['perc'] },
  { path: 'builtin:uzu/tb-10_tb.wav', label: 'uzu perc', pack: 'uzu', pads: ['perc'] }
]

export const BUILTIN_PREFIX = 'builtin:'

/** The label of a built-in sample path, or null for a user file. */
export const builtinLabel = (path: string): string | null => BUILTIN_SAMPLES.find((s) => s.path === path)?.label ?? null
