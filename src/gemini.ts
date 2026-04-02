import { GoogleGenAI, Content } from "@google/genai";

const API_KEY_STORAGE = 'english_trainer_api_key';

function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) 
    || (window as any).GEMINI_API_KEY 
    || (typeof process !== 'undefined' && process?.env ? process.env.GEMINI_API_KEY : '') 
    || (import.meta as any).env?.VITE_GEMINI_API_KEY 
    || '';
}

function getAIInstance() {
  const key = getApiKey();
  // @google/genai 1.x uses the key as the first argument to the constructor
  return new GoogleGenAI(key || 'dummy-key');
}

export function hasValidKey() {
  const key = getApiKey();
  return !!key && key !== 'dummy-key';
}

const INSTRUCTIONS = {
  friendly: "You are a friendly companion. Your goal is to have a natural, casual conversation in English. Check in on the user's day, be supportive, and keep the vibe light. Do NOT correct their grammar unless it's completely unintelligible. Just chat like a real friend.",
  coach: "You are an expert English Speaking Coach. Your goal is to help the user speak like a native American. Actively correct their grammar, suggest more natural idioms, and provide feedback on how to say things better in a professional but encouraging way."
};

export type ChatMode = 'friendly' | 'coach';

// Since @google/genai 1.x is stateless/stateless-leaning, 
// we will manage history externally or use the simple generateContent approach.
export async function* sendMessageStream(message: string, history: Content[] = [], mode: ChatMode = 'friendly') {
  const ai = getAIInstance();
  
  // Format history for the new SDK
  const contents: Content[] = [
    ...history,
    { role: 'user', parts: [{ text: message }] }
  ];

  const response = await ai.models.generateContentStream({
    model: 'gemini-1.5-flash',
    contents: contents,
    config: {
      systemInstruction: INSTRUCTIONS[mode]
    }
  });

  for await (const chunk of response) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}

export async function generateSpeech(text: string): Promise<string | null> {
  return null;
}
