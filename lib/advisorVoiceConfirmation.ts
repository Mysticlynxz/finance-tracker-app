import type { AuthSessionIdentity } from "./authSessionGuard";

export interface AdvisorVoiceConfirmationDependencies {
  isSessionCurrent: (session: AuthSessionIdentity) => Promise<boolean>;
  submitMessage: (message: string, session: AuthSessionIdentity) => Promise<void>;
}

export const createAdvisorVoiceConfirmation = (
  session: AuthSessionIdentity,
  dependencies: AdvisorVoiceConfirmationDependencies
) => {
  let finished = false;

  return {
    cancel: () => {
      finished = true;
    },
    send: async (transcript: string): Promise<boolean> => {
      const message = transcript.trim();
      if (finished || !message) return false;

      finished = true;
      if (!(await dependencies.isSessionCurrent(session))) return false;

      await dependencies.submitMessage(message, session);
      return true;
    },
  };
};
