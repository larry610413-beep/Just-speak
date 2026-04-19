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
  friendly: "You are a friendly English conversation partner. Chat casually about their day, work, or news. Don't correct grammar unless unintelligible. Reply in 1-2 short sentences max.",
  coach: "You are an English Speaking Coach. Correct grammar and suggest natural idioms briefly. Ask about work or daily life. Reply in 1-2 short sentences max.",
  kids: "You are a fun chat buddy for a 10-year-old. Use simple vocabulary about school, games, animals. Reply in 1-2 very short sentences."
};

export type ChatMode = 'friendly' | 'coach' | 'kids';

export async function* sendMessageStream(
  message: string, 
  history: Content[] = [], 
  mode: ChatMode = 'friendly', 
  apiKey?: string, 
  dbText: string = '',
  dbEnabled: boolean = false
) {
  const ai = getAIInstance(apiKey);
  
  // Limit history to last 6 messages to save input tokens
  const limitedHistory = history.slice(-6);
  
  const contents: Content[] = [
    ...limitedHistory,
    { role: 'user', parts: [{ text: message }] }
  ];

  let currentInstruction = INSTRUCTIONS[mode];
  
  if (dbEnabled && dbText.trim().length > 0) {
    currentInstruction += `\n\nBACKGROUND DATABASE:\nThe user is currently trying to learn and practice the following materials. YOU MUST try to naturalistically weave in concepts, phrases, or vocabulary from this text in your response to help them learn:\n${dbText}\n`;
  }

  let response;
  try {
    response = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: contents,
      config: {
        systemInstruction: currentInstruction,
        maxOutputTokens: 100,
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
      }
    });
  } catch (error: any) {
    const errorMsg = error?.message?.toLowerCase() || '';
    if (errorMsg.includes('quota') || errorMsg.includes('429') || errorMsg.includes('503') || errorMsg.includes('unavailable') || errorMsg.includes('high demand')) {
      console.warn('Primary model unavailable, falling back to gemini-2.0-flash...');
      response = await ai.models.generateContentStream({
        model: 'gemini-2.0-flash',
        contents: contents,
        config: {
          systemInstruction: currentInstruction,
          maxOutputTokens: 100,
          temperature: 0.7,
          topP: 0.8,
          topK: 40,
        }
      });
    } else {
      throw error;
    }
  }

  for await (const chunk of response) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}

export async function generateSpeech(text: string, apiKey?: string): Promise<{ data: string, mimeType: string } | null> {
  try {
    const key = apiKey || getApiKey();
    if (!key) throw new Error('No API key');

    const model = 'gemini-2.5-flash-preview-tts';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text } ] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' }
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Gemini TTS HTTP error:', response.status, errData);
      return null;
    }

    const data = await response.json();
    const part = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData != null);
    if (part && part.inlineData && part.inlineData.data) {
      return {
        data: part.inlineData.data,
        mimeType: part.inlineData.mimeType || 'audio/L16;codec=pcm;rate=24000'
      };
    }

    return null;
  } catch (error) {
    console.error('Gemini TTS API failed:', error);
    return null;
  }
}

export async function generateSuggestion(history: Content[], mode: ChatMode = 'friendly', apiKey?: string): Promise<string> {
  try {
    const ai = getAIInstance(apiKey);
    const limitedHistory = history.slice(-6);
    
    let prompt = "Provide EXACTLY ONE short, natural sentence that the user could say to reply to your last message. Give ONLY the suggested sentence. No quotes, no intro.";
    if (mode === 'kids') {
      prompt = "Provide EXACTLY ONE very simple, basic English sentence that a 10-year-old child could say to reply to your last message. Give ONLY the suggested sentence. No quotes, no intro.";
    }

    const contents: Content[] = [
      ...limitedHistory,
      { role: 'user', parts: [{ text: prompt }] }
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
      config: {
        maxOutputTokens: 40,
        temperature: 0.7,
      }
    });

    return response.text?.replace(/["']/g, '').trim() || '';
  } catch (e) {
    console.error("Suggestion error:", e);
    return "";
  }
}
