const https = require('https');
const url = "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en-US&q=Hello+world";
https.get(url, (res) => {
  console.log("Status:", res.statusCode);
  console.log("Headers:", res.headers['content-type']);
});
