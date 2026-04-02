import { GoogleGenAI, Content, Modality } from "@google/genai";

let apiKey = (window as any).GEMINI_API_KEY || process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';

// If key is still missing, try to fetch it from the server
if (!apiKey) {
  fetch('/api/config')
    .then(res => res.json())
    .then(config => {
      if (config.apiKey) {
        apiKey = config.apiKey;
        (window as any).GEMINI_API_KEY = apiKey;
      }
    })
    .catch(err => console.error('Failed to fetch API config:', err));
}

const ai = new GoogleGenAI({ apiKey: apiKey || 'dummy-key' });

let chatInstance: any = null;

const INSTRUCTIONS = {
  friendly: "You are a friendly companion. Your goal is to have a natural, casual conversation in English. Check in on the user's day, be supportive, and keep the vibe light. Do NOT correct their grammar unless it's completely unintelligible. Just chat like a real friend.",
  coach: "You are an expert English Speaking Coach. Your goal is to help the user speak like a native American. Actively correct their grammar, suggest more natural idioms, and provide feedback on how to say things better in a professional but encouraging way."
};

export type ChatMode = 'friendly' | 'coach';

export function getChat(history: Content[] = [], mode: ChatMode = 'friendly') {
  chatInstance = ai.chats.create({
    model: "gemini-1.5-flash", 
    history: history,
    config: {
      systemInstruction: INSTRUCTIONS[mode],
    },
  });
  return chatInstance;
}

export async function sendMessage(message: string, history: Content[] = [], mode: ChatMode = 'friendly') {
  const chat = chatInstance || getChat(history, mode);
  const response = await chat.sendMessage({ message });
  return response.text;
}

export async function* sendMessageStream(message: string, history: Content[] = [], mode: ChatMode = 'friendly') {
  const chat = chatInstance || getChat(history, mode);
  const response = await chat.sendMessageStream({ message });
  for await (const chunk of response) {
    yield chunk.text;
  }
}

export async function generateSpeech(text: string) {
  try {
    // Using gemini-1.5-flash for TTS capability if supported, 
    // or keep using the specialized tts model
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash", // Using 1.5-flash which is widely available
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' }, // Options: Puck, Charon, Kore, Fenrir, Zephyr
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio;
  } catch (err) {
    console.error('TTS error:', err);
    return null;
  }
}
