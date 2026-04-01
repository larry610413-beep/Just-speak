/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles, Trash2, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { sendMessageStream, getChat, generateSpeech } from './gemini';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'english_trainer_history';

// Speech Recognition setup
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

if (recognition) {
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [hasError, setHasError] = useState<string | null>(null);
  const transcriptRef = useRef('');
  const isProcessingRef = useRef(false);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingQueueRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load history from local storage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem(STORAGE_KEY);
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory);
        // Deduplicate messages by ID just in case
        const uniqueHistory = parsedHistory.filter((msg: Message, index: number, self: Message[]) =>
          index === self.findIndex((m) => m.id === msg.id)
        );
        setMessages(uniqueHistory);
        
        const geminiHistory = uniqueHistory.map((msg: Message) => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        }));
        getChat(geminiHistory);
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    } else {
      getChat([]);
    }
    setIsInitialized(true);
  }, []);

  // Save history to local storage whenever messages change
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
  }, [messages, isInitialized]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleClearHistory = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
    getChat([]);
    setShowClearConfirm(false);
  };

  const playResponse = (text: string) => {
    if (!text.trim()) return;
    
    return new Promise<void>((resolve) => {
      // Use browser's native SpeechSynthesis (FREE and INSTANT)
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Try to find a natural English voice
      const voices = window.speechSynthesis.getVoices();
      const englishVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) || 
                           voices.find(v => v.lang.startsWith('en'));
      
      if (englishVoice) {
        utterance.voice = englishVoice;
      }
      
      utterance.lang = 'en-US';
      utterance.rate = 1.0; // Normal speed
      utterance.pitch = 1.0;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        resolve();
      };
      utterance.onerror = (event) => {
        console.error('SpeechSynthesis error:', event);
        setIsSpeaking(false);
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  };

  const processAudioQueue = async () => {
    if (isPlayingQueueRef.current || audioQueueRef.current.length === 0) return;
    
    isPlayingQueueRef.current = true;
    while (audioQueueRef.current.length > 0) {
      const sentence = audioQueueRef.current.shift();
      if (sentence) {
        await playResponse(sentence);
      }
    }
    isPlayingQueueRef.current = false;
  };

  const queueAudio = (text: string) => {
    audioQueueRef.current.push(text);
    processAudioQueue();
  };

  const startListening = () => {
    if (!recognition) {
      setHasError('您的瀏覽器不支援語音辨識 (Speech Recognition)。請使用 Chrome 或 Safari。');
      return;
    }
    if (isLoading || isSpeaking) return;
    
    transcriptRef.current = '';
    setHasError(null);
    try {
      recognition.start();
      setIsListening(true);
    } catch (e) {
      console.error('Recognition start error:', e);
    }
  };

  const stopListening = () => {
    if (recognition && isListening) {
      setIsListening(false);
      try {
        recognition.stop();
      } catch (e) {}
      
      // Send the accumulated transcript on release
      if (transcriptRef.current.trim()) {
        const textToSend = transcriptRef.current;
        transcriptRef.current = ''; // CRITICAL: Clear immediately to prevent duplicate sends
        setInput(''); // Clear input field as well
        handleSend(textToSend);
      }
    }
  };

  useEffect(() => {
    if (!recognition) return;

    recognition.onresult = (event: any) => {
      if (isLoading || isSpeaking || isProcessingRef.current) return;

      const transcript = event.results[0][0].transcript;
      if (transcript.trim()) {
        transcriptRef.current = transcript;
        // Removed setInput(transcript) to keep voice input separate from text box
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'aborted') return;
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setHasError('麥克風存取被拒絕。請在瀏覽器網址列點擊鎖頭圖示並允許麥克風權限。');
      } else {
        setHasError(`語音辨識錯誤: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };
  }, [isLoading, isSpeaking]); // Add dependencies to ensure the latest state is used

  const handleSend = async (text: string) => {
    if (!text.trim() || isLoading || isSpeaking || isProcessingRef.current) return;

    isProcessingRef.current = true;
    
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setHasError(null);

    const assistantMessageId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantMessageId, role: 'assistant', content: '' },
    ]);

    try {
      let fullResponse = '';
      let lastProcessedIndex = 0;
      const stream = sendMessageStream(userMessage.content);
      
      for await (const chunk of stream) {
        fullResponse += chunk;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId ? { ...msg, content: fullResponse } : msg
          )
        );

        // Find complete sentences to queue for audio
        const remainingText = fullResponse.substring(lastProcessedIndex);
        const sentenceEndMatch = remainingText.match(/[.!?]\s/);
        
        if (sentenceEndMatch) {
          const endPos = sentenceEndMatch.index! + sentenceEndMatch[0].length;
          const sentence = remainingText.substring(0, endPos).trim();
          if (sentence) {
            queueAudio(sentence);
            lastProcessedIndex += endPos;
          }
        }
      }
      
      // Queue any remaining text
      const finalSentence = fullResponse.substring(lastProcessedIndex).trim();
      if (finalSentence) {
        queueAudio(finalSentence);
      }
    } catch (error: any) {
      console.error('Error sending message:', error);
      const errorMessage = error?.message || 'Unknown error';
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: `Error: ${errorMessage}. Please check your connection or API key.` }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
      isProcessingRef.current = false;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#F3F4F6] text-[#1F2937] font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-600 rounded-lg shadow-md">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-indigo-900 leading-tight">English Trainer</h1>
            <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Interactive Voice Lab</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {messages.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all rounded-lg"
              title="Clear History"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {/* Clear History Confirmation Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-3 text-red-600">
                <div className="p-2 bg-red-50 rounded-full">
                  <Trash2 className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold">清除紀錄？</h3>
              </div>
              <p className="text-gray-600">這將會永久刪除你所有的對話歷史，確定要繼續嗎？</p>
              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-all"
                >
                  取消
                </button>
                <button 
                  onClick={handleClearHistory}
                  className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-200"
                >
                  確定清除
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Error Banner */}
      <AnimatePresence>
        {hasError && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-red-50 border-b border-red-100 px-6 py-3 flex items-center gap-3 text-red-700 text-sm overflow-hidden"
          >
            <VolumeX className="w-4 h-4 flex-shrink-0" />
            <p>{hasError}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center h-[50vh] text-center space-y-6"
            >
              <div className="relative">
                <div className="p-8 bg-indigo-50 rounded-full shadow-inner">
                  <Bot className="w-16 h-16 text-indigo-600" />
                </div>
                <motion.div 
                  animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 3 }}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-4 border-white shadow-sm"
                />
              </div>
              <div className="space-y-3">
                <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Let's Talk English!</h2>
                <p className="text-gray-500 max-w-sm mx-auto text-lg">
                  I'm your personal AI coach. Tap the mic and say something like "How's your day?"
                </p>
              </div>
            </motion.div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, scale: 0.98, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`flex gap-3 max-w-[85%] ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center shadow-md ${
                    message.role === 'user' ? 'bg-indigo-600' : 'bg-white border border-gray-200'
                  }`}>
                    {message.role === 'user' ? (
                      <User className="w-6 h-6 text-white" />
                    ) : (
                      <Bot className="w-6 h-6 text-indigo-600" />
                    )}
                  </div>
                  <div className={`p-4 rounded-2xl shadow-sm relative group ${
                    message.role === 'user' 
                      ? 'bg-indigo-600 text-white rounded-tr-none' 
                      : 'bg-white border border-gray-100 text-gray-800 rounded-tl-none'
                  }`}>
                    <p className="text-sm md:text-base whitespace-pre-wrap leading-relaxed font-medium">
                      {message.content || (isLoading && message.role === 'assistant' ? 'Thinking...' : '')}
                    </p>
                    {message.role === 'assistant' && message.content && (
                      <button 
                        onClick={() => playResponse(message.content)}
                        className="absolute -right-10 top-2 p-2 text-indigo-400 hover:text-indigo-600 transition-all opacity-0 group-hover:opacity-100"
                        title="Play Speech"
                      >
                        <Volume2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Voice Control Area */}
      <footer className="p-4 md:p-6 bg-white border-t border-gray-200 shadow-2xl rounded-t-3xl">
        <div className="max-w-3xl mx-auto flex flex-col items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onMouseDown={startListening}
              onMouseUp={stopListening}
              onMouseLeave={isListening ? stopListening : undefined}
              onTouchStart={(e) => { 
                // Don't preventDefault here as it might block permission prompts
                startListening(); 
              }}
              onTouchEnd={(e) => { 
                e.preventDefault(); 
                stopListening(); 
              }}
              disabled={isLoading || isSpeaking}
              className={`w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-all relative select-none touch-none ${
                isListening 
                  ? 'bg-red-500 text-white' 
                  : (isLoading || isSpeaking) ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {isListening && (
                <motion.div 
                  animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="absolute inset-0 bg-red-500 rounded-full"
                />
              )}
              <div className="relative z-10">
                {isListening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </div>
            </motion.button>
            
            <div className="text-center h-4">
              <p className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${isListening ? 'text-red-500' : 'text-gray-500'}`}>
                {isListening ? 'RELEASE TO SEND' : isSpeaking ? 'AI SPEAKING' : isLoading ? 'THINKING' : ''}
              </p>
            </div>
          </div>

          <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
            className="w-full flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type message..."
              className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-all"
              disabled={isLoading || isListening}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim() || isListening}
              className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:bg-gray-200 transition-all shadow-md"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
}
