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

const getErrorMessage = async (response: Response) => {
  try {
    const data = (await response.json()) as { error?: unknown };

    if (typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }

    return JSON.stringify(data);
  } catch {
    try {
      const text = await response.text();
      return text.trim() || response.statusText || `Request failed with status ${response.status}.`;
    } catch {
      return response.statusText || `Request failed with status ${response.status}.`;
    }
  }
};

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

  const uploadData = (await uploadResponse.json()) as AssemblyAIUploadResponse;

  console.log("Upload response:", uploadData);

  if (!uploadResponse.ok) {
    throw new Error(uploadData.error || `Upload failed with status ${uploadResponse.status}.`);
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

  const transcriptData = (await transcriptResponse.json()) as AssemblyAITranscriptResponse;

  console.log("Transcript response:", transcriptData);

  if (!transcriptResponse.ok) {
    throw new Error(
      transcriptData.error || `Transcript request failed with status ${transcriptResponse.status}.`
    );
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
    await delay(TRANSCRIPT_POLL_INTERVAL_MS);

    const pollingResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript/${trimmedTranscriptId}`, {
      method: "GET",
      headers: createHeaders(),
    });

    if (!pollingResponse.ok) {
      throw new Error(await getErrorMessage(pollingResponse));
    }

    const pollingData = (await pollingResponse.json()) as AssemblyAITranscriptResponse;

    if (pollingData.status === "completed") {
      return pollingData;
    }

    if (pollingData.status === "error") {
      throw new Error(pollingData.error || "AssemblyAI transcription failed.");
    }
  }

  throw new Error("AssemblyAI transcription timed out before completion.");
};

export const transcribeAudioUriWithAssemblyAI = async (audioUri: string): Promise<string> => {
  try {
    const uploadUrl = await uploadAudioToAssemblyAI(audioUri);
    const transcriptData = await requestAssemblyAITranscript(uploadUrl);
    const finalTranscript =
      transcriptData.status === "completed"
        ? transcriptData
        : await pollAssemblyAITranscript(transcriptData.id ?? "");
    const text = finalTranscript.text?.trim() ?? "";

    console.log("Final text:", text);

    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : "AssemblyAI transcription failed.";
    console.error("[AssemblyAI] Speech-to-text failed:", message);
    throw new Error(message);
  }
};
