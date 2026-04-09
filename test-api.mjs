const API_KEY = process.argv[2];
if (!API_KEY) { console.error('Usage: node test-api.mjs <API_KEY>'); process.exit(1); }

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Test 1: Chat (gemini-2.5-flash)
async function testChat() {
  console.log('\n=== TEST 1: Chat (gemini-2.5-flash) ===');
  const res = await fetch(`${BASE}/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Say hello in one sentence.' }] }],
      generationConfig: { maxOutputTokens: 50 }
    })
  });
  const data = await res.json();
  if (!res.ok) { console.log('❌ FAIL:', data?.error?.message); return false; }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  console.log('✅ Response:', text);
  return true;
}

// Test 2: TTS - try multiple models to find one that works
async function testTTS() {
  const models = ['gemini-2.0-flash-exp', 'gemini-2.0-flash', 'gemini-2.5-flash'];
  for (const model of models) {
    console.log(`\n=== TEST 2: TTS (${model}) ===`);
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Say ONLY this text aloud: "Hello, this is a test."' }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } }
        }
      })
    });
    const data = await res.json();
    if (!res.ok) { console.log(`❌ ${model}: ${data?.error?.message}`); continue; }
    const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (part?.inlineData?.data) {
      console.log(`✅ ${model} WORKS! mimeType: ${part.inlineData.mimeType} | size: ${part.inlineData.data.length}`);
      return model;
    }
    console.log(`❌ ${model}: no audio data`, JSON.stringify(data).slice(0, 200));
  }
  return null;
}

// Test 3: Suggestion (gemini-1.5-flash-8b)
async function testSuggestion() {
  console.log('\n=== TEST 3: Suggestion (gemini-1.5-flash-8b) ===');
  const res = await fetch(`${BASE}/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { role: 'model', parts: [{ text: "Hey! How's your day going?" }] },
        { role: 'user', parts: [{ text: 'Provide EXACTLY ONE short natural reply sentence. No quotes, no intro.' }] }
      ],
      generationConfig: { maxOutputTokens: 50, temperature: 0.7 }
    })
  });
  const data = await res.json();
  if (!res.ok) { console.log('❌ FAIL:', data?.error?.message); return false; }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  console.log('✅ Suggestion:', text?.trim());
  return true;
}

(async () => {
  const [r1, r2, r3] = await Promise.all([testChat(), testTTS(), testSuggestion()]);
  console.log('\n=== SUMMARY ===');
  console.log('Chat:      ', r1 ? '✅ OK' : '❌ FAIL');
  console.log('TTS Audio: ', r2 ? '✅ OK' : '❌ FAIL');
  console.log('Suggestion:', r3 ? '✅ OK' : '❌ FAIL');
})();
