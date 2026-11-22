/** The business chosen for restore during onboarding (kept in memory between screens). */
let current = '';
export const restoreBusinessId = () => current;
export const setRestoreBusinessId = (id: string) => {
  current = id;
};
