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
  const [isIframe, setIsIframe] = useState(false);
  const [mode, setMode] = useState<ChatMode>('friendly');
  const [isGeneratingSpeech, setIsGeneratingSpeech] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [usage, setUsage] = useState<UsageStats>({ count: 0, lastReset: new Date().toISOString() });
  const [apiKey, setApiKey] = useState(localStorage.getItem('english_trainer_api_key') || '');
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
    // Restart session
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
      
      // Small delay to ensure onresult has fired its final chunk
      setTimeout(() => {
        const finalTranscript = transcriptRef.current.trim() || input.trim();
        if (finalTranscript) {
          handleSend(finalTranscript);
          transcriptRef.current = ''; 
          setInput(''); 
        }
      }, 500);
    }
  };

  useEffect(() => {
    if (!recognition) return;

    recognition.onresult = (event: any) => {
      if (isLoading || isSpeaking || isProcessingRef.current) return;

      const transcript = event.results[0][0].transcript;
      if (transcript.trim()) {
        transcriptRef.current = transcript;
        setInput(transcript); // Show it in the box while speaking as requested
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
    if (!text.trim() || isLoading || isSpeaking || isProcessingRef.current) return;

    if (!hasValidKey()) {
      setHasError('Missing Gemini API Key. Please add it in Settings.');
      setShowSettings(true);
      return;
    }

    isProcessingRef.current = true;
    
    // Update usage count
    const newCount = usage.count + 1;
    const newUsage = { ...usage, count: newCount };
    setUsage(newUsage);
    localStorage.setItem(USAGE_KEY, JSON.stringify(newUsage));

    const userMessage: Message = {
      id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      role: 'user',
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
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

      const stream = sendMessageStream(userMessage.content, history, mode);
      
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
    <div className="flex flex-col h-screen bg-[#F3F4F6] text-[#1F2937] font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-600 rounded-lg shadow-md">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-indigo-900 leading-tight">Just-speak</h1>
            <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">AI English Coach</p>
          </div>
        </div>
        
        {/* Unified Mode Toggle */}
        <button 
          onClick={() => setMode(mode === 'friendly' ? 'coach' : 'friendly')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm border ${
            mode === 'friendly' 
              ? 'bg-white border-indigo-100 text-indigo-600' 
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
            className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-all rounded-lg"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
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

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-indigo-600">
                  <div className="p-2 bg-indigo-50 rounded-lg">
                    <Settings className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold">Preferences</h3>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <Trash2 className="w-5 h-5 rotate-45 transform" /> 
                </button>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-xl space-y-3">
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Daily Practice</p>
                      <h4 className="text-lg font-bold text-gray-800">Usage Stats</h4>
                    </div>
                    <p className="text-sm font-bold text-indigo-600">{usage.count} / 1500</p>
                  </div>
                  
                  <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min((usage.count / 1500) * 100, 100)}%` }}
                      className="h-full bg-indigo-600"
                    />
                  </div>
                  <p className="text-[10px] text-gray-500 italic">Resets every 24 hours. Based on Gemini Free Tier limits.</p>
                </div>

                {/* API Key Input */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Key className="w-4 h-4" />
                    <p className="text-xs font-bold uppercase tracking-wider">Gemini API Key</p>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Paste your key here..."
                      className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-all"
                    />
                    <button 
                      onClick={() => handleSaveKey(apiKey)}
                      className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-md"
                    >
                      Save
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400">Stored only on this device. Never shared with GitHub.</p>
                </div>

                <a 
                  href="https://aistudio.google.com/app/plan_and_billing" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-white border border-gray-200 hover:border-indigo-200 hover:bg-indigo-50 text-gray-600 text-sm font-bold rounded-xl transition-all"
                >
                  Check Cloud Dashboard
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                </a>
              </div>

              <button 
                onClick={() => setShowSettings(false)}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-100"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                <h3 className="text-lg font-bold">Clear History?</h3>
              </div>
              <p className="text-gray-600">This will permanently delete all your conversation history. Continue?</p>
              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleClearHistory}
                  className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-200"
                >
                  Clear All
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
            className="bg-red-50 border-b border-red-100 px-6 py-4 flex flex-col gap-3 overflow-hidden"
          >
            <div className="flex items-start gap-3 text-red-700 text-sm">
              <VolumeX className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="font-bold">{hasError}</p>
                <div className="space-y-1 text-xs opacity-80">
                  <p>How to fix:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Click the lock icon in the address bar and allow Microphone access.</li>
                    <li>If you are in a preview window, try opening in a new tab.</li>
                    <li>Ensure your system settings also allow the browser access.</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setHasError(null)}
                className="px-3 py-1.5 bg-white border border-red-200 text-red-600 text-xs font-bold rounded-lg hover:bg-red-50 transition-all"
              >
                Dismiss
              </button>
              <button 
                onClick={() => { setHasError(null); setShowSettings(true); }}
                className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-all shadow-sm"
              >
                Set API Key
              </button>
              {isIframe && (
                <button 
                  onClick={() => window.open(window.location.href, '_blank')}
                  className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 transition-all shadow-sm"
                >
                  Open in New Tab (Fix Permissions)
                </button>
              )}
            </div>
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
                <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Let's practice English!</h2>
                <p className="text-gray-500 max-w-sm mx-auto text-lg leading-relaxed">
                  I'm your AI partner. Choose <b>Friendly</b> for casual chat, or <b>Coach</b> for active corrections.
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
        <div className="max-w-3xl mx-auto flex flex-col items-center gap-6">
          {/* Text Input Row */}
          <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
            className="w-full flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isListening ? "Listening..." : "Type a message..."}
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

          {/* Voice Button Row (Toggle Mode) */}
          <div className="flex flex-col items-center gap-2 pb-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={toggleListening}
              disabled={isLoading || isSpeaking}
              className={`w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-all relative select-none touch-none ${
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
                {isListening ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
              </div>
            </motion.button>
            
            <div className="text-center h-4">
              <p className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${isListening ? 'text-red-500 animate-pulse' : 'text-gray-500'}`}>
                {isListening ? 'TAP TO STOP' : isSpeaking ? 'AI SPEAKING' : isLoading ? 'THINKING' : 'TAP TO SPEAK'}
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
