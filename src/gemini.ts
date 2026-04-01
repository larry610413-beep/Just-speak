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

const SYSTEM_INSTRUCTION = "You are an expert English Speaking Trainer. Your goal is to help the user learn local, natural spoken English. Speak naturally, use idioms, and occasionally correct the user's grammar or suggest better ways to say things in a friendly manner. Keep the conversation engaging and encourage the user to speak more.";

export function getChat(history: Content[] = []) {
  chatInstance = ai.chats.create({
    model: "gemini-3-flash-preview",
    history: history,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
    },
  });
  return chatInstance;
}

export async function sendMessage(message: string, history: Content[] = []) {
  const chat = chatInstance || getChat(history);
  const response = await chat.sendMessage({ message });
  return response.text;
}

export async function* sendMessageStream(message: string, history: Content[] = []) {
  const chat = chatInstance || getChat(history);
  const response = await chat.sendMessageStream({ message });
  for await (const chunk of response) {
    yield chunk.text;
  }
}

export async function generateSpeech(text: string) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          // 'Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'
          prebuiltVoiceConfig: { voiceName: 'Zephyr' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return base64Audio;
}
