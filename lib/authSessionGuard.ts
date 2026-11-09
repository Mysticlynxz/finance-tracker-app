export interface AuthSessionIdentity {
  userId: string;
  sessionId: string;
  generation: number;
}

export interface AuthSessionSubject {
  userId: string;
  sessionId: string;
}

export const createAuthSessionGuard = (readCurrentSession: () => Promise<AuthSessionSubject>) => {
  let generation = 0;
  let nextTransitionId = 0;
  const pendingTransitions = new Set<number>();

  const isGenerationCurrent = (identity: Pick<AuthSessionIdentity, "generation">) =>
    pendingTransitions.size === 0 && generation === identity.generation;

  return {
    beginTransition: () => {
      generation += 1;
      const transitionId = ++nextTransitionId;
      pendingTransitions.add(transitionId);
      return transitionId;
    },
    finishTransition: (transitionId: number) => {
      if (!pendingTransitions.delete(transitionId)) return;
      generation += 1;
    },
    getGeneration: () => generation,
    isGenerationCurrent,
    capture: async (): Promise<AuthSessionIdentity | null> => {
      if (pendingTransitions.size > 0) return null;
      const capturedGeneration = generation;
      try {
        const subject = await readCurrentSession();
        if (!isGenerationCurrent({ generation: capturedGeneration })) return null;
        return { ...subject, generation: capturedGeneration };
      } catch {
        return null;
      }
    },
    isCurrent: async (identity: AuthSessionIdentity): Promise<boolean> => {
      if (!isGenerationCurrent(identity)) return false;
      try {
        const subject = await readCurrentSession();
        return isGenerationCurrent(identity) &&
          subject.userId === identity.userId &&
          subject.sessionId === identity.sessionId;
      } catch {
        return false;
      }
    },
  };
};
