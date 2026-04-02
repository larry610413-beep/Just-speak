const key = 'AIzaSyBnsxnUYsv17DVRxNDX3MyZfOraVOQ_mEw';
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Hello!' }]}]
  })
}).then(r => r.json()).then(console.log).catch(console.error);
