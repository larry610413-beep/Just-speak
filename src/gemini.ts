import { GoogleGenAI, Content } from "@google/genai";

const API_KEY_STORAGE = 'english_trainer_api_key';

function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) 
    || (window as any).GEMINI_API_KEY 
    || (typeof process !== 'undefined' && process?.env ? process.env.GEMINI_API_KEY : '') 
    || (import.meta as any).env?.VITE_GEMINI_API_KEY 
    || '';
}

function getAIInstance(apiKey?: string) {
  const key = apiKey || getApiKey();
  if (!key) {
    throw new Error('An API Key must be provided.');
  }
  // NEW: @google/genai 1.x uses a configuration object
  return new GoogleGenAI({ apiKey: key });
}

export function hasValidKey() {
  const key = getApiKey();
  return !!key && key.length > 20;
}

const INSTRUCTIONS = {
  friendly: "You are a friendly companion. Your goal is to have a natural, casual conversation in English. Check in on the user's day, be supportive, and keep the vibe light. Do NOT correct their grammar unless it's completely unintelligible. Just chat like a real friend.",
  coach: "You are an expert English Speaking Coach. Your goal is to help the user speak like a native American. Actively correct their grammar, suggest more natural idioms, and provide feedback on how to say things better in a professional but encouraging way."
};

export type ChatMode = 'friendly' | 'coach';

export async function* sendMessageStream(message: string, history: Content[] = [], mode: ChatMode = 'friendly', apiKey?: string) {
  const ai = getAIInstance(apiKey);
  
  // Limit history to last 12 messages for performance
  const limitedHistory = history.slice(-12);
  
  const contents: Content[] = [
    ...limitedHistory,
    { role: 'user', parts: [{ text: message }] }
  ];

  const response = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: contents,
    config: {
      systemInstruction: INSTRUCTIONS[mode],
      maxOutputTokens: 256,
      temperature: 0.7,
      topP: 0.8,
      topK: 40,
    }
  });

  for await (const chunk of response) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}

export async function generateSpeech(text: string, apiKey?: string): Promise<{ data: string, mimeType: string } | null> {
  try {
    const ai = getAIInstance(apiKey);
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: `Say ONLY this text aloud, exactly as it is written: "${text}"` }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Aoede" // Aoede = Natural US Female, Puck = Natural US Male
            }
          }
        }
      }
    });

    const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData != null);
    if (part && part.inlineData && part.inlineData.data) {
      return { 
        data: part.inlineData.data, 
        mimeType: part.inlineData.mimeType || 'audio/wav' 
      };
    }
    
    return null;
  } catch (error) {
    console.error('Gemini TTS API failed:', error);
    return null;
  }
}
