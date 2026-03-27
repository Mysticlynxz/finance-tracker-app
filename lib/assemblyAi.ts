const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2";
const TRANSCRIPT_POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 100;

type AssemblyAITranscriptStatus = "queued" | "processing" | "completed" | "error";

interface AssemblyAIUploadResponse {
  upload_url?: string;
  error?: string;
}

interface AssemblyAITranscriptResponse {
  id?: string;
  status?: AssemblyAITranscriptStatus;
  text?: string | null;
  error?: string;
}

const getAssemblyAIApiKey = () => {
  const apiKey = process.env.EXPO_PUBLIC_ASSEMBLYAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing EXPO_PUBLIC_ASSEMBLYAI_API_KEY.");
  }

  return apiKey;
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  const responseText = await response.text();

  if (!responseText.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error(
      responseText.trim() || `Expected a JSON response with status ${response.status}.`
    );
  }
};

const getErrorMessage = (
  response: Response,
  data?: {
    error?: string;
  }
) => data?.error?.trim() || response.statusText || `Request failed with status ${response.status}.`;

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const createHeaders = (contentType?: string): HeadersInit => {
  const headers: Record<string, string> = {
    authorization: getAssemblyAIApiKey(),
  };

  if (contentType) {
    headers["content-type"] = contentType;
  }

  return headers;
};

export const uploadAudioToAssemblyAI = async (audioUri: string): Promise<string> => {
  const trimmedAudioUri = audioUri.trim();

  if (!trimmedAudioUri) {
    throw new Error("Audio URI is required.");
  }

  const audioFileResponse = await fetch(trimmedAudioUri);

  if (!audioFileResponse.ok) {
    throw new Error(`Failed to read audio file from URI: ${trimmedAudioUri}`);
  }

  const audioBlob = await audioFileResponse.blob();

  if (audioBlob.size === 0) {
    throw new Error("Audio file is empty.");
  }

  const uploadResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/upload`, {
    method: "POST",
    headers: createHeaders("application/octet-stream"),
    body: audioBlob,
  });

  const uploadData = await parseJsonResponse<AssemblyAIUploadResponse>(uploadResponse);

  console.log("Upload response:", uploadData);

  if (!uploadResponse.ok) {
    throw new Error(getErrorMessage(uploadResponse, uploadData));
  }

  if (!uploadData.upload_url) {
    throw new Error("AssemblyAI upload response did not include upload_url.");
  }

  return uploadData.upload_url;
};

export const requestAssemblyAITranscript = async (
  uploadUrl: string
): Promise<AssemblyAITranscriptResponse> => {
  const trimmedUploadUrl = uploadUrl.trim();

  if (!trimmedUploadUrl) {
    throw new Error("Upload URL is required.");
  }

  const transcriptResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript`, {
    method: "POST",
    headers: createHeaders("application/json"),
    body: JSON.stringify({
      audio_url: trimmedUploadUrl,
    }),
  });

  const transcriptData = await parseJsonResponse<AssemblyAITranscriptResponse>(transcriptResponse);

  console.log("Transcript request:", transcriptData);

  if (!transcriptResponse.ok) {
    throw new Error(getErrorMessage(transcriptResponse, transcriptData));
  }

  if (!transcriptData.id) {
    throw new Error("AssemblyAI transcript response did not include an id.");
  }

  if (transcriptData.status === "error") {
    throw new Error(transcriptData.error || "AssemblyAI transcription failed.");
  }

  return transcriptData;
};

export const pollAssemblyAITranscript = async (
  transcriptId: string
): Promise<AssemblyAITranscriptResponse> => {
  const trimmedTranscriptId = transcriptId.trim();

  if (!trimmedTranscriptId) {
    throw new Error("Transcript id is required.");
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const pollingResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript/${trimmedTranscriptId}`, {
      method: "GET",
      headers: createHeaders(),
    });

    const pollingData = await parseJsonResponse<AssemblyAITranscriptResponse>(pollingResponse);

    console.log("Polling result:", pollingData);

    if (!pollingResponse.ok) {
      throw new Error(getErrorMessage(pollingResponse, pollingData));
    }

    if (pollingData.status === "completed") {
      return pollingData;
    }

    if (pollingData.status === "error") {
      throw new Error(pollingData.error || "AssemblyAI transcription failed.");
    }

    if (attempt < MAX_POLL_ATTEMPTS - 1) {
      await delay(TRANSCRIPT_POLL_INTERVAL_MS);
    }
  }

  throw new Error("AssemblyAI transcription timed out before completion.");
};

export const transcribeAudioUriWithAssemblyAI = async (audioUri: string): Promise<string> => {
  try {
    const trimmedAudioUri = audioUri.trim();

    if (!trimmedAudioUri) {
      throw new Error("Audio URI is required.");
    }

    console.log("Audio URI:", trimmedAudioUri);

    const uploadUrl = await uploadAudioToAssemblyAI(trimmedAudioUri);
    const transcriptData = await requestAssemblyAITranscript(uploadUrl);

    if (!transcriptData.id) {
      throw new Error("AssemblyAI transcript response did not include an id.");
    }

    const pollData = await pollAssemblyAITranscript(transcriptData.id);

    console.log("Final text:", pollData.text);

    return pollData.text?.trim() ?? "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "AssemblyAI transcription failed.";
    console.error("[AssemblyAI] Speech-to-text failed:", message);
    throw new Error(message);
  }
};
