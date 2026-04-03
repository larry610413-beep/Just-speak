import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.VITE_GEMINI_API_KEY });

async function test() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Hello, testing audio output.' }] }],
      config: {
        responseModalities: ["TEXT", "AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Aoede" // Supported voices: Aoede, Charon, Fenrir, Kore, Puck
            }
          }
        }
      }
    });

    let hasText = false;
    let hasAudio = false;

    response.candidates[0].content.parts.forEach(part => {
      if (part.text) {
        console.log('Text received:', part.text);
        hasText = true;
      }
      if (part.inlineData) {
        console.log('Audio received, mimeType:', part.inlineData.mimeType, 'length:', part.inlineData.data.length);
        hasAudio = true;
      }
    });

    console.log('Success!', { hasText, hasAudio });
  } catch (e) {
    console.error('Error:', e);
  }
}

test();
