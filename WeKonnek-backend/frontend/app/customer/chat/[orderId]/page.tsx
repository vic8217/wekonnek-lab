'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ChatMessage {
  id: string;
  sender: 'user' | 'rider';
  text: string;
  timestamp: string;
}

const QUICK_REPLIES = ["I'm at the lobby", 'Please call me', 'Take your time'];

const MOCK_MESSAGES: ChatMessage[] = [
  {
    id: '1',
    sender: 'rider',
    text: "Hi! I've picked up your order from the restaurant.",
    timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  },
  {
    id: '2',
    sender: 'user',
    text: 'Great, thanks! How long until you arrive?',
    timestamp: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
  },
  {
    id: '3',
    sender: 'rider',
    text: 'Around 15 minutes. Traffic is a bit heavy on Osmena Blvd.',
    timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  },
  {
    id: '4',
    sender: 'user',
    text: 'No worries, take your time.',
    timestamp: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
  },
  {
    id: '5',
    sender: 'rider',
    text: "I'm now near your area. Can you share your exact location?",
    timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
];

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.orderId as string;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [riderName, setRiderName] = useState('Mark Santos');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMessages();
  }, [orderId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchMessages = async () => {
    try {
      const token = getToken();
      if (!token) throw new Error('No token');

      const res = await fetch(`${API}/api/orders/${orderId}/chat`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');

      const data = await res.json();
      const chatData = data.data || data;
      if (chatData.rider?.name) setRiderName(chatData.rider.name);
      setMessages(
        (chatData.messages || []).map((m: any) => ({
          id: m.id?.toString(),
          sender: m.sender === 'customer' || m.sender === 'user' ? 'user' : 'rider',
          text: m.text || m.message || m.content,
          timestamp: m.timestamp || m.created_at || m.createdAt,
        }))
      );
    } catch {
      setMessages(MOCK_MESSAGES);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    const newMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: text.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, newMsg]);
    setInput('');

    try {
      const token = getToken();
      await fetch(`${API}/api/orders/${orderId}/chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text.trim() }),
      });
    } catch {
      toast.error('Failed to send message');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] lg:h-[calc(100vh-5rem)] max-w-2xl mx-auto">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="w-10 h-10 bg-[#DB0002] rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="font-bold text-gray-900 text-sm">{riderName}</p>
          <p className="text-xs text-green-500 font-medium">Online</p>
        </div>
        <span className="text-xs text-gray-400 bg-gray-50 px-2.5 py-1 rounded-full">Order #{orderId}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gray-50">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                msg.sender === 'user'
                  ? 'bg-[#DB0002] text-white rounded-br-md'
                  : 'bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-md'
              }`}
            >
              <p className="text-sm leading-relaxed">{msg.text}</p>
              <p
                className={`text-[10px] mt-1 ${
                  msg.sender === 'user' ? 'text-red-200' : 'text-gray-400'
                }`}
              >
                {formatTime(msg.timestamp)}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Replies */}
      <div className="bg-white border-t px-4 py-2 flex gap-2 overflow-x-auto shrink-0">
        {QUICK_REPLIES.map((reply) => (
          <button
            key={reply}
            onClick={() => sendMessage(reply)}
            className="shrink-0 px-3 py-1.5 text-xs font-medium text-[#DB0002] bg-red-50 rounded-full hover:bg-red-100 transition-colors border border-red-100"
          >
            {reply}
          </button>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="bg-white border-t px-4 py-3 flex gap-2 shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 px-4 py-2.5 bg-gray-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:bg-white border border-transparent focus:border-[#DB0002]/30 transition-all"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="w-10 h-10 bg-[#DB0002] text-white rounded-full flex items-center justify-center hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </button>
      </form>
    </div>
  );
}
