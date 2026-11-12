export const MutationAtomicityHeaderName = 'x-mutation-atomicity';

export const MutationAtomicityHeaderValue = {
  ON: 'on',
  OFF: 'off',
} as const;

export type MutationAtomicityHeaderValue =
  (typeof MutationAtomicityHeaderValue)[keyof typeof MutationAtomicityHeaderValue];
