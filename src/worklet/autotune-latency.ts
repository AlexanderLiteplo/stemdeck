/**
 * Latency the autotune PSOLA path adds, in samples.
 *
 * Shared by both worklets: the DSP reports it, and the deck processor reads the
 * vocal stem this far AHEAD so the corrected vocal lands back in time with the
 * rest of the mix. Compensating here rather than delaying the main output keeps
 * the deck itself sample-aligned with the other deck, so beatmatching is unaffected.
 */
export const AUTOTUNE_LATENCY_SAMPLES = 2048
