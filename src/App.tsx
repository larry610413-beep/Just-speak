/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles, Trash2, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { sendMessageStream, generateSpeech, ChatMode } from './gemini';
import { Settings, Shield, Coffee, Key } from 'lucide-react';
import { hasValidKey } from './gemini';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'english_trainer_history';
const USAGE_KEY = 'english_trainer_usage';

interface UsageStats {
  count: number;
  lastReset: string; // ISO date string
}

// Speech Recognition setup
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

if (recognition) {
  recognition.continuous = true;
  recognition.interimResults = true;
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
  const [isIframe, setIsIframe] = useState(false);
  const [mode, setMode] = useState<ChatMode>('friendly');
  const [isGeneratingSpeech, setIsGeneratingSpeech] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [usage, setUsage] = useState<UsageStats>({ count: 0, lastReset: new Date().toISOString() });
  const [apiKey, setApiKey] = useState(() => {
    const saved = localStorage.getItem('english_trainer_api_key');
    return (saved && saved.trim().length > 10) ? saved : '';
  });
  const [isKeySaved, setIsKeySaved] = useState(false);
  const transcriptRef = useRef('');
  const isProcessingRef = useRef(false);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingQueueRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load history from local storage on mount
  useEffect(() => {
    setIsIframe(window.self !== window.top);
    const savedHistory = localStorage.getItem(STORAGE_KEY);
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory);
        // Deduplicate messages by ID just in case
        const uniqueHistory = parsedHistory.filter((msg: Message, index: number, self: Message[]) =>
          index === self.findIndex((m) => m.id === msg.id)
        );
        setMessages(uniqueHistory);
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }
    // Load usage stats
    const savedUsage = localStorage.getItem(USAGE_KEY);
    if (savedUsage) {
      try {
        const parsedUsage = JSON.parse(savedUsage) as UsageStats;
        const lastReset = new Date(parsedUsage.lastReset);
        const now = new Date();
        
        // Reset if it's a new day
        if (lastReset.toDateString() !== now.toDateString()) {
          const newUsage = { count: 0, lastReset: now.toISOString() };
          setUsage(newUsage);
          localStorage.setItem(USAGE_KEY, JSON.stringify(newUsage));
        } else {
          setUsage(parsedUsage);
        }
      } catch (e) {
        console.error('Failed to parse usage stats', e);
      }
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
    setShowClearConfirm(false);
  };

  const playResponse = async (text: string) => {
    if (!text.trim() || isGeneratingSpeech) return;
    
    setIsGeneratingSpeech(true);
    try {
      const base64Audio = await generateSpeech(text);
      if (base64Audio) {
        const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
        setIsSpeaking(true);
        audio.onended = () => {
          setIsSpeaking(false);
          setIsGeneratingSpeech(false);
        };
        await audio.play();
      } else {
        // Fallback to browser TTS if Gemini TTS fails
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => {
          setIsSpeaking(false);
          setIsGeneratingSpeech(false);
        };
        window.speechSynthesis.speak(utterance);
      }
    } catch (err) {
      console.error('Playback error:', err);
      setIsGeneratingSpeech(false);
      setIsSpeaking(false);
    }
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

  const handleSaveKey = (key: string) => {
    localStorage.setItem('english_trainer_api_key', key);
    setApiKey(key);
    setHasError(null);
    setIsKeySaved(true);
    // Persistent green state, no timeout reset
  };

  const toggleListening = () => {
    if (!recognition) {
      setHasError('Your browser does not support Speech Recognition. Please use Google Chrome or Safari.');
      return;
    }
    
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const startListening = () => {
    if (isLoading || isSpeaking) return;
    
    // Add haptic feedback for mobile
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }

    transcriptRef.current = '';
    setInput(''); // Clear input box for a fresh recording session
    setHasError(null);
    try {
      if (recognition) {
        // Abort any existing recognition to reset the state
        try { recognition.abort(); } catch (e) {}
        
        // Small delay to ensure the abort is processed by the browser
        setTimeout(() => {
          try {
            recognition.start();
            setIsListening(true);
          } catch (err: any) {
             setHasError(`Voice recognition busy. Please wait a moment: ${err.message}`);
             setIsListening(false);
          }
        }, 50);
      }
    } catch (e: any) {
      console.error('Recognition start error:', e);
      setIsListening(false);
      
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' || (e.message && e.message.includes('denied'))) {
        setHasError('Microphone access denied. Please allow it in browser settings.');
      } else if (e.name === 'InvalidStateError') {
        setHasError('Recognition service is busy. Please try again.');
      } else {
        setHasError(`Speech start failed: ${e.message || 'Unknown error'}`);
      }
    }
  };

  const stopListening = () => {
    if (recognition && isListening) {
      setIsListening(false);
      
      // Add haptic feedback for mobile
      if ('vibrate' in navigator) {
        navigator.vibrate([30, 30]);
      }

      try {
        recognition.stop();
      } catch (e) {}
      
      // Capture everything we have immediately (including interim if needed)
      const finalTranscript = transcriptRef.current.trim();
      if (finalTranscript) {
        handleSend(finalTranscript);
        transcriptRef.current = ''; 
      }
    }
  };

  useEffect(() => {
    if (!recognition) return;

    recognition.onresult = (event: any) => {
      // CRITICAL: Only process NEW results from event.resultIndex
      // Starting from 0 causes duplication on every interim update
      let newText = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        newText += event.results[i][0].transcript;
      }
      if (newText.trim()) {
        // Append to existing transcript instead of rebuilding from scratch
        const updated = (transcriptRef.current + ' ' + newText).trim();
        transcriptRef.current = updated;
        setInput(updated);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'aborted') return;
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      
      if (event.error === 'not-allowed') {
        setHasError('Microphone access denied. Please allow it in browser settings.');
      } else if (event.error === 'network') {
        setHasError('Network connection issue. Please check your internet.');
      } else if (event.error === 'no-speech') {
        // Ignore
      } else if (event.error === 'service-not-allowed') {
        setHasError('This browser does not allow speech recognition on this site.');
      } else {
        setHasError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };
  }, [isLoading, isSpeaking]); // Add dependencies to ensure the latest state is used

  const handleSend = async (text: string) => {
    if (!text.trim()) return;

    // Add user message to UI immediately no matter what
    const userMessage: Message = {
      id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      role: 'user',
      content: text,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    // Pre-flight checks for the model
    const currentKey = apiKey || localStorage.getItem('english_trainer_api_key') || '';
    if (!currentKey || currentKey.length < 10) {
      setHasError('Gemini API Key missing or too short. Click Settings (gear icon) to fix.');
      setShowSettings(true);
      return;
    }

    // Update usage count
    const newCount = usage.count + 1;
    const newUsage = { ...usage, count: newCount };
    setUsage(newUsage);
    localStorage.setItem('english_trainer_usage', JSON.stringify(newUsage));

    isProcessingRef.current = true;
    setIsLoading(true);
    setHasError(null);

    const assistantMessageId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    setMessages((prev) => [
      ...prev,
      { id: assistantMessageId, role: 'assistant', content: '' },
    ]);

    try {
      let fullResponse = '';
      let lastProcessedIndex = 0;
      
      // Convert messages to Gemini Content format for history
      const history = messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));

      const currentKey = apiKey || localStorage.getItem('english_trainer_api_key') || '';
      const stream = sendMessageStream(userMessage.content, history, mode, currentKey);
      
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
      let errorMessage = 'AI connection lost. Please try again.';
      
      try {
        const errorText = error?.message || '';
        if (errorText.includes('{')) {
          const jsonStart = errorText.indexOf('{');
          const jsonStr = errorText.substring(jsonStart);
          const parsed = JSON.parse(jsonStr);
          errorMessage = parsed?.error?.message || parsed?.message || 'API connection error';
        } else {
          errorMessage = errorText;
        }
      } catch (e) {
        errorMessage = 'Could not parse AI response. Check your connection.';
      }

      // Translate common API errors to English
      if (errorMessage.toLowerCase().includes('api key not valid')) {
        errorMessage = 'Initializing AI key. Please refresh or wait a moment.';
      } else if (errorMessage.toLowerCase().includes('quota')) {
        errorMessage = 'System is busy (Quota reached). Please wait a minute.';
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: `[System]: ${errorMessage}` }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
      isProcessingRef.current = false;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="flex-none flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-800 shadow-2xl z-20">
        <div className="flex items-center">
          <motion.div 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="p-2.5 bg-indigo-600 rounded-2xl shadow-xl shadow-indigo-500/20"
          >
            <Bot className="w-5 h-5 text-white" />
          </motion.div>
        </div>
        
        <button 
          onClick={() => setMode(mode === 'friendly' ? 'coach' : 'friendly')}
          className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-black transition-all shadow-xl border ${
            mode === 'friendly' 
              ? 'bg-slate-800 border-slate-700 text-slate-100' 
              : 'bg-indigo-600 border-indigo-700 text-white'
          }`}
        >
          {mode === 'friendly' ? (
            <>
              <Coffee className="w-4 h-4" />
              <span>Friendly</span>
            </>
          ) : (
            <>
              <Shield className="w-4 h-4" />
              <span>Coach</span>
            </>
          )}
        </button>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowSettings(true)}
            className="p-2.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition-all rounded-2xl"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
          {messages.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="p-2.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all rounded-2xl"
              title="Clear History"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl space-y-8 overflow-hidden relative"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <Settings className="w-32 h-32 text-indigo-500" />
              </div>
              <div className="flex items-center justify-between relative">
                <div className="flex items-center gap-3 text-indigo-400">
                  <div className="p-3 bg-indigo-500/10 rounded-2xl">
                    <Settings className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-black tracking-tight">Preferences</h3>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-3 text-slate-500 hover:text-slate-300 rounded-2xl hover:bg-slate-800 transition-all"
                >
                  <Trash2 className="w-5 h-5 rotate-45 transform" /> 
                </button>
              </div>

              <div className="space-y-4">
                <div className="bg-slate-800/50 p-6 rounded-3xl border border-slate-700/50 space-y-3 shadow-inner relative">
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">Daily Practice</p>
                      <h4 className="text-xl font-black text-slate-100 tracking-tight">Usage Stats</h4>
                    </div>
                    <p className="text-sm font-black text-indigo-400">{usage.count} <span className="text-slate-600">/ 1500</span></p>
                  </div>
                  
                  <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-700/30">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min((usage.count / 1500) * 100, 100)}%` }}
                      className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 italic">Resets every 24 hours.</p>
                </div>

                {/* API Key Input */}
                <div className="space-y-3 relative">
                  <div className="flex items-center gap-2 text-slate-400">
                    <Key className="w-4 h-4" />
                    <p className="text-[10px] font-black uppercase tracking-widest">Gemini API Key</p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <input 
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Paste your key here..."
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 px-5 py-4 rounded-3xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-sm transition-all placeholder:text-slate-700"
                    />
                    <button 
                      onClick={() => handleSaveKey(apiKey)}
                      className={`w-full py-4 font-black rounded-3xl transition-all shadow-xl tracking-tight ${
                        (localStorage.getItem('english_trainer_api_key') === apiKey && apiKey.length > 10)
                          ? 'bg-green-600 text-white shadow-green-500/20' 
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {(localStorage.getItem('english_trainer_api_key') === apiKey && apiKey.length > 10) 
                        ? '✓ KEY IS SECURED' 
                        : 'SAVE KEY TO DEVICE'}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-600">Stored locally on your S24 Ultra.</p>
                </div>

                <a 
                  href="https://aistudio.google.com/app/plan_and_billing" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-4 px-4 bg-slate-950 border border-slate-700 hover:border-indigo-500/50 text-slate-400 text-[10px] font-black uppercase tracking-widest rounded-3xl transition-all"
                >
                  Cloud Dashboard
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                </a>
              </div>

              <button 
                onClick={() => setShowSettings(false)}
                className="w-full py-4 px-4 bg-slate-800 hover:bg-slate-700 text-slate-100 font-black rounded-3xl transition-all border border-slate-700 relative"
              >
                CLOSE
              </button>

              <div className="text-center pt-2 border-t border-slate-800">
                <p className="text-[10px] text-slate-700 font-black tracking-widest uppercase">Version 1.0.1+DirectVoice</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Clear History Confirmation Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-slate-900 border border-red-500/20 rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl space-y-6"
            >
              <div className="flex items-center gap-3 text-red-400">
                <div className="p-3 bg-red-500/10 rounded-2xl">
                  <Trash2 className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-black tracking-tight">Clear History?</h3>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">This will permanently delete all your conversation history from this device. Continue?</p>
              <div className="flex gap-4 pt-2">
                <button 
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-4 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-black rounded-3xl transition-all border border-slate-700"
                >
                  CANCEL
                </button>
                <button 
                  onClick={handleClearHistory}
                  className="flex-1 py-4 px-4 bg-red-600 hover:bg-red-700 text-white font-black rounded-3xl transition-all shadow-2xl shadow-red-950"
                >
                  CLEAR ALL
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
            className="bg-red-500/10 border-b border-red-500/20 px-6 py-6 flex flex-col gap-4 overflow-hidden z-20"
          >
            <div className="flex items-start gap-3 text-red-400 text-sm">
              <VolumeX className="w-6 h-6 flex-shrink-0" />
              <div className="space-y-2">
                <p className="font-black uppercase tracking-tight">{hasError}</p>
                <div className="space-y-1 text-xs opacity-60">
                  <p>Troubleshooting:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Allow Microphone in address bar settings.</li>
                    <li>Ensure you are in a secure context (HTTPS).</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setHasError(null)}
                className="px-5 py-2.5 bg-slate-900 border border-slate-800 text-slate-300 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-slate-800 transition-all"
              >
                Dismiss
              </button>
              <button 
                onClick={() => { setHasError(null); setShowSettings(true); }}
                className="px-5 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-950"
              >
                Set API Key
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 bg-slate-950">
        <div className="max-w-3xl mx-auto space-y-8">
          {messages.length === 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center h-[50vh] text-center space-y-8"
            >
              <div className="relative">
                <div className="p-10 bg-indigo-500/5 rounded-[3rem] shadow-inner border border-indigo-500/10">
                  <Bot className="w-16 h-16 text-indigo-500" />
                </div>
                <motion.div 
                  animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.6, 0.3] }}
                  transition={{ repeat: Infinity, duration: 3 }}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full border-4 border-slate-950 shadow-2xl"
                />
              </div>
              <div className="space-y-4">
                <h2 className="text-4xl font-black text-slate-100 tracking-tight">Let's practice English</h2>
                <p className="text-slate-500 max-w-sm mx-auto text-lg leading-relaxed font-medium">
                  Tap the microphone and start speaking to your AI partner.
                </p>
              </div>
            </motion.div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, scale: 0.98, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`flex gap-4 max-w-[90%] ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`flex-shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center shadow-2xl ${
                    message.role === 'user' ? 'bg-indigo-600' : 'bg-slate-900 border border-slate-800'
                  }`}>
                    {message.role === 'user' ? (
                      <User className="w-6 h-6 text-white" />
                    ) : (
                      <Bot className="w-6 h-6 text-indigo-400" />
                    )}
                  </div>
                  <div className={`p-5 rounded-[2rem] shadow-2xl relative group ${
                    message.role === 'user' 
                      ? 'bg-indigo-600 text-white rounded-tr-none shadow-indigo-500/10' 
                      : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-none shadow-black/20'
                  }`}>
                    <p className="text-sm md:text-base whitespace-pre-wrap leading-relaxed font-semibold tracking-tight">
                      {message.content || (isLoading && message.role === 'assistant' ? 'Thinking...' : '')}
                    </p>
                    {message.role === 'assistant' && message.content && (
                      <button 
                        onClick={() => playResponse(message.content)}
                        className="absolute -right-12 top-2 p-3 text-slate-600 hover:text-indigo-400 transition-all opacity-0 group-hover:opacity-100 bg-slate-900/50 rounded-2xl border border-slate-800"
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
      <footer className="flex-none p-4 md:p-5 bg-slate-900 border-t border-slate-800 shadow-2xl rounded-t-[2.5rem] z-20">
        <div className="max-w-3xl mx-auto flex flex-col items-center gap-6">
          {/* Text Input Row */}
          <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
            className="w-full flex gap-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isListening ? "[ Speaking... ]" : "Type a message..."}
              className="flex-1 p-4 bg-slate-950 border border-slate-700 rounded-[2rem] focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-slate-100 text-sm transition-all placeholder:text-indigo-400 placeholder:animate-pulse"
              disabled={isLoading || isListening}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim() || isListening}
              className="p-4 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-600 transition-all shadow-xl shadow-indigo-950"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>

          <div className="flex flex-col items-center gap-3 pb-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.9 }}
              onClick={toggleListening}
              disabled={isLoading || isSpeaking}
              className={`w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all relative select-none touch-none ${
                isListening 
                  ? 'bg-red-500 text-white shadow-red-500/40' 
                  : (isLoading || isSpeaking) ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-500/40'
              }`}
            >
              {isListening && (
                <motion.div 
                  animate={{ scale: [1, 1.8, 1], opacity: [0.4, 0, 0.4] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="absolute inset-0 bg-red-500 rounded-full"
                />
              )}
              <div className="relative z-10 scale-125">
                {isListening ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
              </div>
            </motion.button>
            
            <div className="text-center h-4">
              <p className={`text-[10px] font-black uppercase tracking-[0.25em] transition-colors ${isListening ? 'text-red-500 animate-pulse' : 'text-slate-600'}`}>
                {isListening ? 'RECORDING' : isSpeaking ? 'AI SPEAKING' : isLoading ? 'THINKING' : 'TAP TO SPEAK'}
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
