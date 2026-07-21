'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

// Web Speech API types (not in the default DOM lib)
interface WKSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: WKSpeechRecognitionEvent) => void) | null;
  onerror: ((event: WKSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
interface WKSpeechRecognitionEvent {
  results: {
    [index: number]: { [index: number]: { transcript: string }; isFinal: boolean };
    length: number;
  };
}
interface WKSpeechRecognitionErrorEvent {
  error: string;
}

interface VoiceSearchButtonProps {
  /** Called with the (interim or final) recognized text as the user speaks. */
  onResult: (text: string) => void;
  /** Optional callback whenever listening starts/stops. */
  onListeningChange?: (listening: boolean) => void;
  className?: string;
}

/**
 * Reusable microphone button that dictates speech into any search box using
 * the browser's Web Speech API. Renders nothing if the browser doesn't support
 * speech recognition (e.g. Firefox), so callers don't need to guard.
 */
export default function VoiceSearchButton({ onResult, onListeningChange, className }: VoiceSearchButtonProps) {
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<WKSpeechRecognition | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const secure =
      window.isSecureContext ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    if (!secure) return;

    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;

    try {
      const recognition = new Ctor() as WKSpeechRecognition;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: WKSpeechRecognitionEvent) => {
        let interim = '';
        let final = '';
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0].transcript;
          if (result.isFinal) final += transcript;
          else interim += transcript;
        }
        const text = (final || interim).trim();
        if (text) onResult(text);
      };

      recognition.onerror = (event: WKSpeechRecognitionErrorEvent) => {
        setIsListening(false);
        onListeningChange?.(false);
        switch (event.error) {
          case 'not-allowed':
            toast.error('Microphone access denied. Allow mic permissions in your browser.');
            break;
          case 'no-speech':
            toast.error('No speech detected. Please try again.');
            break;
          case 'audio-capture':
            toast.error('No microphone found.');
            break;
          case 'network':
            toast.error('Network error. Check your connection.');
            break;
          case 'aborted':
            break;
          default:
            toast.error('Voice search error. Please try again.');
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        onListeningChange?.(false);
      };

      recognitionRef.current = recognition;
      setSupported(true);
    } catch {
      setSupported(false);
    }

    return () => {
      recognitionRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supported) return null;

  const toggle = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
      setIsListening(false);
      onListeningChange?.(false);
      return;
    }
    setIsListening(true);
    onListeningChange?.(true);
    try {
      recognition.start();
    } catch {
      setIsListening(false);
      onListeningChange?.(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isListening ? 'Stop voice search' : 'Voice search'}
      title="Voice Search"
      className={`rounded-full p-1.5 transition-colors ${
        isListening ? 'bg-[#DB0002] text-white animate-pulse' : 'text-gray-400 hover:bg-gray-100'
      } ${className ?? ''}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v3m0-3a4 4 0 004-4V7a4 4 0 00-8 0v4a4 4 0 004 4z" />
      </svg>
    </button>
  );
}
