import React, { useState, useEffect, useRef } from "react";
import { supabase, isSupabaseConfigured } from "./lib/supabase";
import { 
  Mic2, 
  Download, 
  Trash2, 
  Play, 
  AlertTriangle, 
  Clock, 
  User, 
  Settings2,
  LogOut,
  RefreshCw,
  Plus,
  Database,
  ExternalLink,
  Code2,
  Key,
  ShieldCheck,
  Zap,
  Trash,
  Copy,
  ChevronRight,
  Sparkles,
  Volume2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// --- SQL Block for Supabase Editor ---
const SETUP_SQL = `-- Run this in your Supabase SQL Editor
-- 1. Create Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  credits INTEGER DEFAULT 3000,
  tier TEXT DEFAULT 'free',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 2. Create Audio Logs Table
CREATE TABLE IF NOT EXISTS public.audio_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  text TEXT,
  voice TEXT,
  audio_data TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 3. Automatic Profile Trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fixed Trigger creation
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
  END IF;
END $$;

-- 4. Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users manage own logs" ON audio_logs FOR ALL USING (auth.uid() = user_id);
`;

// --- Types ---

interface Profile {
  id: string;
  email: string;
  credits: number;
  tier: string;
}

interface AudioLog {
  id: string;
  text: string;
  voice: string;
  audio_data: string;
  expires_at: string;
  created_at: string;
}

// --- Components ---

const ProgressBar = ({ value, max, label }: { value: number, max: number, label: string }) => {
  const percentage = Math.min((value / max) * 100, 100);
  return (
    <div className="w-full">
      <div className="flex justify-between text-[10px] mb-2 font-black text-gray-500 uppercase tracking-[0.2em]">
        <span>{label}</span>
        <span className="text-indigo-400">{value} / {max}</span>
      </div>
      <div className="h-3 w-full bg-black/40 border border-white/5 rounded-full overflow-hidden p-0.5">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          className={`h-full rounded-full ${percentage < 20 ? 'bg-red-500' : 'bg-gradient-to-r from-indigo-600 to-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.4)]'}`}
        />
      </div>
    </div>
  );
};

const Timer = ({ expiry, onExpire }: { expiry: string, onExpire: () => void }) => {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    const calculate = () => {
      const diff = new Date(expiry).getTime() - Date.now();
      if (diff <= 0) {
        onExpire();
        return 0;
      }
      return Math.floor(diff / 1000);
    };

    setTimeLeft(calculate());
    const interval = setInterval(() => {
      const remaining = calculate();
      setTimeLeft(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [expiry]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className={`flex items-center gap-1.5 font-mono text-sm ${timeLeft < 60 ? 'text-red-500 animate-pulse' : 'text-orange-400'}`}>
      <Clock size={14} />
      <span>{minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}</span>
    </div>
  );
};

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [logs, setLogs] = useState<AudioLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  
  // Auth Form State
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Form State
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("Madhur");
  const [emotion, setEmotion] = useState("neutral");
  const [pitch, setPitch] = useState(1.0);
  const [speed, setSpeed] = useState(1.0);
  const [reverb, setReverb] = useState(0.0);
  const [isKidsMode, setIsKidsMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // --- Ad System Hook (Hidden for Future Use) ---
  const handleRewardAd = () => {
    console.log("Preparing reward ad sequence...");
    // Future implementation for Adsense/Admob reward hooks
  };

  const stopAllPlayback = () => {
    // Stop Web Speech API
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    // Stop HTML Audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchUserData(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserData(session.user.id);
      else {
        setProfile(null);
        setLogs([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserData = async (userId: string) => {
    if (!supabase) return;
    const { data: prof } = await supabase.from("profiles").select("*").eq("id", userId).single();
    const { data: audioLogs } = await supabase
      .from("audio_logs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (prof) setProfile(prof);
    if (audioLogs) setLogs(audioLogs);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setAuthLoading(true);

    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        alert("Signup successful! Please check your email for confirmation.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const generateAudio = async () => {
    if (!session || !text.trim() || !profile) return;
    
    // Stop any existing playback first
    stopAllPlayback();

    // 1. Instant Playback via Web Speech API (Browser's built-in voice)
    // This satisfies the "instant" requirement.
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      // Try to find matching voice
      const voices = window.speechSynthesis.getVoices();
      
      // Attempt to pick a voice that matches our selection if possible, otherwise default to Hindi or first available
      let selectedVoice = null;
      if (voice === "Swara" || voice === "Ananya") selectedVoice = voices.find(v => v.name.includes("Female"));
      if (!selectedVoice) selectedVoice = voices.find(v => v.lang.startsWith('hi')) || voices.find(v => v.lang.startsWith('en')) || voices[0];
      
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.pitch = pitch;
      utterance.rate = speed;
      window.speechSynthesis.speak(utterance);
    }

    setGenerating(true);

    try {
      const textLength = text.length;
      if (profile.credits < textLength) {
        throw new Error(`Insufficient credits. You need ${textLength} but have ${profile.credits}.`);
      }

      // 2. Generate High-Quality Edge TTS via Server API (for History/Download)
      const res = await fetch("/api/generate-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: session.user.id,
          text,
          voice,
          emotion,
          pitch,
          speed,
          reverb,
          kidsMode: isKidsMode
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      const audioData = data.audioData;
      
      if (!audioData) {
        throw new Error("Failed to generate audio log. The server did not return media.");
      }

      // 3. Refresh state (History)
      await fetchUserData(session.user.id);
      setText("");
      
    } catch (err: any) {
      console.error(err);
      // We don't alert if the synthesis already worked, but logging is good
      if (!('speechSynthesis' in window)) {
        alert(err.message || "An error occurred during generation.");
      }
    } finally {
      setGenerating(false);
    }
  };

  const downloadAudio = (base64: string, filename: string) => {
    const link = document.createElement("a");
    link.href = `data:audio/mpeg;base64,${base64}`;
    link.download = `${filename}.mp3`;
    link.click();
  };

  const deleteLog = async (id: string) => {
    if (!supabase) return;
    await supabase.from("audio_logs").delete().eq("id", id);
    setLogs(logs.filter(l => l.id !== id));
  };

  if (loading) return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin shadow-[0_0_20px_rgba(99,102,241,0.2)]" />
        <span className="text-xs font-black text-indigo-400 tracking-widest animate-pulse">TOONPUR AI</span>
      </div>
    </div>
  );

  const PolicyModal = ({ title, isOpen, onClose, children }: { title: string, isOpen: boolean, onClose: () => void, children: React.ReactNode }) => (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-2xl bg-zinc-900 border border-white/10 rounded-[2.5rem] p-10 overflow-hidden shadow-2xl"
          >
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black tracking-tight text-white uppercase">{title}</h2>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <Plus size={24} className="rotate-45 text-gray-400" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto pr-4 text-gray-400 text-sm leading-relaxed space-y-6 custom-scrollbar">
              {children}
            </div>
            <div className="mt-8 pt-6 border-t border-white/5 flex justify-end">
              <button 
                onClick={onClose}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-3 rounded-xl transition-all"
              >
                Accept & Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  // --- Configuration Requirement Screen ---
  if (!isSupabaseConfigured) return (
    <div className="min-h-screen bg-[#050505] text-white p-6 md:p-12 font-sans overflow-x-hidden">
      <div className="max-w-4xl mx-auto space-y-12">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-red-500/10 rounded-2xl border border-red-500/20">
            <AlertTriangle className="text-red-500" size={32} />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Configuration Required</h1>
            <p className="text-gray-500">Enable Supabase to stop Permission Denied errors.</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-8 space-y-4 shadow-xl">
              <div className="flex items-center gap-3 text-indigo-400 font-bold mb-2">
                <Database size={20} />
                <span>1. Setup Database</span>
              </div>
              <p className="text-sm text-gray-400">Paste the SQL code (on the right) into your <span className="text-indigo-400">Supabase SQL Editor</span> to create the tables and triggers.</p>
              
              <div className="flex items-center gap-3 text-indigo-400 font-bold mt-8 mb-2">
                <ShieldCheck size={20} />
                <span>2. Enable Auth</span>
              </div>
              <p className="text-sm text-gray-400">Go to <span className="text-white font-medium">Authentication {">"} Providers</span> and enable <span className="text-white font-medium">GitHub</span> using your client ID and secret.</p>

              <div className="flex items-center gap-3 text-indigo-400 font-bold mt-8 mb-2">
                <Key size={20} />
                <span>3. Set Environment</span>
              </div>
              <p className="text-sm text-gray-400">Add these to the <span className="text-indigo-400">Settings {">"} Secrets</span> panel in AI Studio:</p>
              <ul className="text-xs font-mono space-y-2 pt-2 text-gray-500">
                <li className="flex justify-between items-center bg-black/40 p-2 rounded"><span>VITE_SUPABASE_URL</span> <Zap size={10} className="text-yellow-500" /></li>
                <li className="flex justify-between items-center bg-black/40 p-2 rounded"><span>VITE_SUPABASE_ANON_KEY</span> <Zap size={10} className="text-yellow-500" /></li>
                <li className="flex justify-between items-center bg-black/40 p-2 rounded"><span>SUPABASE_SERVICE_ROLE_KEY</span> <Zap size={10} className="text-yellow-500" /></li>
              </ul>
            </div>

            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-3xl p-6 flex items-start gap-4">
              <Code2 className="text-indigo-500 shrink-0" size={24} />
              <div>
                <h4 className="font-bold text-sm mb-1 uppercase tracking-wider text-indigo-400">Developer Note</h4>
                <p className="text-xs text-gray-400 leading-relaxed">
                  We've switched to <b>Edge TTS</b> and <b>Web Speech API</b>. No Gemini API key is needed for voice generation!
                </p>
              </div>
            </div>
          </div>

          <div className="relative group">
            <div className="absolute -top-4 right-4 flex gap-2">
               <button 
                onClick={() => {
                  navigator.clipboard.writeText(SETUP_SQL);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg transition-all flex items-center gap-2"
              >
                {copied ? <ShieldCheck size={14} /> : <Plus size={14} />}
                {copied ? "Copied!" : "Copy SQL"}
              </button>
              <a 
                href="https://supabase.com/dashboard" target="_blank"
                className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg backdrop-blur flex items-center gap-2"
              >
                Dashboard <ExternalLink size={12} />
              </a>
            </div>
            <div className="bg-black border border-white/10 rounded-3xl p-6 h-full font-mono text-[10px] text-gray-500 overflow-y-auto max-h-[550px] shadow-2xl leading-relaxed whitespace-pre">
              {SETUP_SQL}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (!session) return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full space-y-8 bg-zinc-900/50 p-10 rounded-[2.5rem] border border-white/5 backdrop-blur-xl shadow-2xl">
          <div className="text-center space-y-4">
            <div className="flex justify-center mb-6">
              <div className="p-5 bg-indigo-600 rounded-[2rem] shadow-[0_0_50px_rgba(79,70,229,0.3)]">
                <Mic2 size={42} className="text-white" />
              </div>
            </div>
            <h1 className="text-4xl font-black text-white tracking-tighter uppercase">TOONPUR AI</h1>
            <p className="text-gray-500 text-xs font-bold tracking-widest uppercase">The Future of Hindi AI Voice</p>
          </div>
          
          <form onSubmit={handleAuth} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 px-1">Email Address</label>
            <input 
              type="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500/50 transition-all outline-none text-sm text-white placeholder:text-gray-500 shadow-inner"
              placeholder="name@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-300 px-1">Password</label>
            <input 
              type="password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500/50 transition-all outline-none text-sm text-white placeholder:text-gray-500 shadow-inner"
              placeholder="••••••••"
            />
          </div>
          <button 
            type="submit"
            disabled={authLoading}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-bold py-4 rounded-xl transition-all shadow-[0_10px_20px_-10px_rgba(99,102,241,0.5)] active:scale-[0.98] mt-2 flex items-center justify-center gap-2"
          >
            {authLoading ? <RefreshCw size={18} className="animate-spin" /> : <Zap size={18} />}
            {authMode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="text-center">
          <button 
            onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
            className="text-sm text-gray-500 hover:text-indigo-400 transition-colors font-medium"
          >
            {authMode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Log In"}
          </button>
        </div>
        
        <p className="text-[10px] text-gray-700 text-center uppercase tracking-widest font-bold">Secure Infrastructure</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#080808] text-white font-sans selection:bg-indigo-500/30">
      {/* Navbar */}
      <nav className="border-b border-white/5 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 group cursor-default">
            <div className="p-2 bg-indigo-600 rounded-xl shadow-[0_0_20px_rgba(79,70,229,0.4)] transition-transform hover:scale-110">
              <Mic2 size={20} className="text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-black text-2xl tracking-tighter bg-gradient-to-r from-white via-gray-200 to-gray-500 bg-clip-text text-transparent leading-none">
                TOONPUR AI
              </span>
              <span className="text-[10px] font-bold text-indigo-400 tracking-[0.2em] uppercase">Premium TTS</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-xs text-gray-500 uppercase font-bold tracking-widest leading-none mb-1">Authenticated as</span>
              <span className="text-sm font-medium text-gray-300">{session.user.email}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-10 grid lg:grid-cols-12 gap-8">
        
        {/* Left Column: Dashboard & Controls */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="lg:col-span-8 space-y-8"
        >
          
          {/* Credit Dashboard & Usage Bar */}
          <section className="bg-zinc-900/40 border border-white/5 rounded-[2rem] p-8 relative overflow-hidden backdrop-blur-md shadow-2xl group transition-all hover:bg-zinc-900/60">
            <div className="relative z-10 grid md:grid-cols-2 gap-8 items-end">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-6 bg-indigo-500 rounded-full" />
                  <h2 className="text-2xl font-black tracking-tight uppercase italic underline decoration-indigo-500/30 underline-offset-4">Intelligence Stats</h2>
                  <span className="bg-indigo-500 text-white text-[10px] px-2 py-0.5 rounded-full font-black uppercase tracking-widest shadow-[0_0_10px_rgba(99,102,241,0.5)]">Core-Ready</span>
                </div>
                <div className="space-y-1">
                  <p className="text-gray-400 text-sm">Welcome back, <span className="text-white font-medium">{session.user.email?.split('@')[0]}</span></p>
                  <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-widest">
                    <Sparkles size={12} className="animate-pulse" />
                    Tier Status: {profile?.tier} Neural Access
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <ProgressBar 
                  label="Available Neural Credits" 
                  value={profile?.credits || 0} 
                  max={3000} 
                />
                <div className="flex justify-between items-center px-1">
                  <span className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em] flex items-center gap-1.5">
                    <Clock size={10} />
                    Syncing in 12h 45m
                  </span>
                  <button className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest hover:text-white transition-colors flex items-center gap-1">
                    Upgrade to Elite <ChevronRight size={10} />
                  </button>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-indigo-600/10 blur-[100px] rounded-full group-hover:bg-indigo-600/20 transition-all" />
          </section>

          {/* Main Input Area */}
          <section className="bg-zinc-900/50 border border-white/5 rounded-[2rem] overflow-hidden backdrop-blur-sm shadow-xl relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />
            <div className="p-8 space-y-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center border border-indigo-500/20 shadow-inner">
                    <Settings2 size={18} className="text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black tracking-tight text-white uppercase italic">Vocal Studio</h3>
                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest leading-none">Neural Processing Engine</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-[10px] font-black tracking-widest uppercase px-3 py-1 rounded-full border transition-colors ${text.length > 3000 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-white/5 border-white/5 text-gray-400'}`}>
                    {text.length} <span className="text-gray-600">/</span> 3000
                  </span>
                </div>
              </div>
              
              <div className="relative group">
                <textarea 
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type Hindi/Hinglish text here... Example: 'सबको नमस्कार! आज हम तूनपुर एआई का उपयोग कर रहे हैं।'"
                  className="w-full h-56 bg-black/40 border border-white/5 rounded-3xl p-8 text-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 resize-none transition-all placeholder:text-gray-700 font-medium leading-relaxed shadow-inner"
                />
                <div className="absolute bottom-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => setText("")}
                    className="p-2.5 bg-zinc-900 border border-white/10 rounded-xl text-gray-500 hover:text-red-400 hover:border-red-500/30 transition-all"
                    title="Clear Text"
                  >
                    <Trash size={16} />
                  </button>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(text);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="p-2.5 bg-zinc-900 border border-white/10 rounded-xl text-gray-500 hover:text-indigo-400 hover:border-indigo-500/30 transition-all"
                    title="Copy Text"
                  >
                    {copied ? <ShieldCheck size={16} className="text-green-500" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {/* Advanced Controls */}
              <div className="space-y-8">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-[0.2em]">Neural Voice Engine (22 Profiles)</label>
                    <div className="flex items-center gap-3 bg-black/40 px-3 py-1.5 rounded-full border border-white/5">
                      <span className={`text-[10px] font-black uppercase tracking-widest ${isKidsMode ? 'text-indigo-400' : 'text-gray-500'}`}>Kids Mode</span>
                      <button 
                        onClick={() => setIsKidsMode(!isKidsMode)}
                        className={`w-10 h-5 rounded-full relative transition-colors ${isKidsMode ? 'bg-indigo-600' : 'bg-zinc-800 border border-white/5'}`}
                      >
                        <motion.div 
                          animate={{ x: isKidsMode ? 20 : 2 }}
                          className="absolute top-1 w-3 h-3 bg-white rounded-full shadow-lg"
                        />
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar p-1">
                    {[
                      { id: 'Madhur', name: 'Madhur', desc: 'Studio', lang: 'Hindi', type: 'Male' },
                      { id: 'Hemant', name: 'Hemant', desc: 'Friendly', lang: 'Hindi', type: 'Male' },
                      { id: 'Swara', name: 'Swara', desc: 'Calm', lang: 'Hindi', type: 'Female' },
                      { id: 'Ananya', name: 'Ananya', desc: 'Pure', lang: 'Bhojpuri', type: 'Female' },
                      { id: 'Kavya', name: 'Kavya', desc: 'Warm', lang: 'Bhojpuri', type: 'Female' },
                      { id: 'Prabhat', name: 'Prabhat', desc: 'Formal', lang: 'English', type: 'Male' },
                      { id: 'Neerja', name: 'Neerja', desc: 'Soft', lang: 'English', type: 'Female' },
                      { id: 'Ravi', name: 'Ravi', desc: 'Deep', lang: 'English', type: 'Male' },
                      { id: 'Aarohi', name: 'Aarohi', desc: 'Marathi', lang: 'Regional', type: 'Female' },
                      { id: 'Manohar', name: 'Manohar', desc: 'Marathi', lang: 'Regional', type: 'Male' },
                      { id: 'Bashkar', name: 'Bashkar', desc: 'Bengali', lang: 'Regional', type: 'Male' },
                      { id: 'Tanishaa', name: 'Tanishaa', desc: 'Bengali', lang: 'Regional', type: 'Female' },
                      { id: 'Pallavi', name: 'Pallavi', desc: 'Tamil', lang: 'Regional', type: 'Female' },
                      { id: 'Valluvar', name: 'Valluvar', desc: 'Tamil', lang: 'Regional', type: 'Male' },
                      { id: 'Mohan', name: 'Mohan', desc: 'Telugu', lang: 'Regional', type: 'Male' },
                      { id: 'Shruti', name: 'Shruti', desc: 'Telugu', lang: 'Regional', type: 'Female' },
                      { id: 'Dhwani', name: 'Dhwani', desc: 'Gujarati', lang: 'Regional', type: 'Female' },
                      { id: 'Sapna', name: 'Sapna', desc: 'Kannada', lang: 'Regional', type: 'Female' },
                      { id: 'Sobhana', name: 'Sobhana', desc: 'Malayalam', lang: 'Regional', type: 'Female' },
                      { id: 'Steffan', name: 'Steffan', desc: 'Boy', lang: 'Kids-HQ', type: 'Male' },
                      { id: 'Michelle', name: 'Michelle', desc: 'Girl', lang: 'Kids-HQ', type: 'Female' },
                      { id: 'Emma', name: 'Emma', desc: 'British', lang: 'Smooth', type: 'Female' },
                      { id: 'Liam', name: 'Liam', desc: 'Global', lang: 'Clean', type: 'Male' }
                    ].map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setVoice(v.id)}
                        className={`flex flex-col items-center justify-center p-4 rounded-[1.5rem] border transition-all text-center relative overflow-hidden group hover:scale-[1.02] ${
                          voice === v.id 
                            ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_10px_30px_rgba(99,102,241,0.2)]' 
                            : 'bg-black/20 border-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-full mb-3 flex items-center justify-center transition-colors ${voice === v.id ? 'bg-indigo-500 text-white' : 'bg-white/5 text-gray-500 group-hover:text-gray-300'}`}>
                          <User size={14} />
                        </div>
                        <span className={`text-[11px] font-black uppercase tracking-tighter ${voice === v.id ? 'text-white' : 'text-gray-400 group-hover:text-gray-200'}`}>
                          {v.name}
                        </span>
                        <div className={`mt-2 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-tighter ${
                          voice === v.id 
                          ? 'bg-indigo-500 text-white' 
                          : v.lang === 'Hindi' ? 'bg-orange-500/10 text-orange-400/80' :
                             v.lang === 'Bhojpuri' ? 'bg-green-500/10 text-green-400/80' :
                             v.lang === 'English' ? 'bg-blue-500/10 text-blue-400/80' :
                             'bg-zinc-800 text-gray-500'
                        }`}>
                          {v.lang}
                        </div>
                        {voice === v.id && (
                          <motion.div 
                            layoutId="activeVoice"
                            className="absolute inset-0 border-[3px] border-indigo-500/50 pointer-events-none rounded-[1.5rem]"
                          />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-[0.2em]">Tempo / Speed</label>
                      <span className="text-xs font-mono text-indigo-400">{speed}x</span>
                    </div>
                    <input 
                      type="range" min="0.5" max="2.0" step="0.1" 
                      value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-[0.2em]">Manual Pitch Control</label>
                      <span className="text-xs font-mono text-indigo-400">{pitch}x</span>
                    </div>
                    <input 
                      type="range" min="0.5" max="1.5" step="0.1" 
                      value={pitch} onChange={(e) => setPitch(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-6 flex flex-col md:flex-row gap-8 items-center border-t border-white/5">
                <div className="flex-1 w-full space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-[0.2em]">Environment Reverb</label>
                    <span className="text-xs font-mono text-indigo-400">{Math.round(reverb * 100)}%</span>
                  </div>
                  <input 
                    type="range" min="0" max="1.0" step="0.1" 
                    value={reverb} onChange={(e) => setReverb(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>
                <button 
                  onClick={generateAudio}
                  disabled={generating || !text.trim() || text.length > 3000}
                  className="w-full md:w-auto bg-white text-black hover:bg-gray-200 disabled:opacity-20 disabled:cursor-not-allowed font-black px-12 py-5 rounded-2xl shadow-[0_20px_40px_-10px_rgba(255,255,255,0.2)] transition-all active:scale-95 flex items-center justify-center gap-3 group"
                >
                  {generating ? <RefreshCw className="animate-spin" size={20} /> : <Zap size={20} className="fill-black" />}
                  {generating ? "PROCESSING..." : "GENERATE SPEECH"}
                </button>
              </div>
            </div>
          </section>

          {/* Coming Soon Section */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-[2rem] p-6 flex items-center gap-4 group">
              <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center transition-transform group-hover:rotate-6">
                <AnimatePresence>
                  <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                    <Mic2 size={24} className="text-indigo-400" />
                  </motion.div>
                </AnimatePresence>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm">Voice Cloning</h4>
                  <span className="text-[8px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded uppercase font-black tracking-tighter">SOON</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">Upload 30s audio to clone any voice.</p>
              </div>
            </div>
            <div className="bg-white/5 border border-white/5 rounded-[2rem] p-6 flex items-center gap-4 grayscale opacity-60">
              <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                <Database size={24} className="text-gray-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm">API Integration</h4>
                  <span className="text-[8px] bg-white/10 text-gray-400 px-1.5 py-0.5 rounded uppercase font-black tracking-tighter">ELITE</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">Automate voice generation via our endpoint.</p>
              </div>
            </div>
          </section>
        </motion.div>

        {/* Right Column: History & Purge Timer */}
        <div className="lg:col-span-4 space-y-6">
          <div className="sticky top-24">
            <div className="bg-zinc-900 border border-white/5 rounded-3xl p-6 mb-6 shadow-xl">
              <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                <Clock size={18} className="text-indigo-400" />
                Auto-Purge System
              </h3>
              <p className="text-xs text-gray-500 leading-relaxed font-medium">
                To maximize system performance, all non-downloaded audio is purged <span className="text-indigo-400 font-bold">10 minutes</span> after generation.
              </p>
              <div className="mt-4 pt-4 border-t border-white/5">
                <p className="text-[10px] text-gray-600 font-bold uppercase tracking-[0.15em]">Security Protocol Active</p>
              </div>
            </div>

            <div className="flex items-center justify-between px-2 mb-4">
              <h4 className="text-xs text-white uppercase font-black tracking-widest">Library</h4>
              <span className="text-[10px] text-gray-500 font-bold">Limit: 50 Logs</span>
            </div>
            
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {logs.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-center py-12 bg-white/5 rounded-3xl border border-white/5 border-dashed"
                  >
                    <Mic2 className="mx-auto text-gray-700 mb-2" />
                    <p className="text-sm text-gray-600">Empty generation history</p>
                  </motion.div>
                ) : (
                  logs.map((log) => (
                    <motion.div 
                      key={log.id}
                      layout
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-zinc-900 border border-white/5 rounded-2xl p-4 hover:border-white/10 transition-colors group"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-gray-200 line-clamp-1 italic">"{log.text}"</p>
                          <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">{log.voice} Model</span>
                        </div>
                        <Timer expiry={log.expires_at} onExpire={() => deleteLog(log.id)} />
                      </div>
                      
                      <div className="flex items-center gap-2 mt-4">
                        <button 
                          onClick={() => {
                            stopAllPlayback();
                            try {
                              const audio = new Audio(`data:audio/mpeg;base64,${log.audio_data}`);
                              audioRef.current = audio;
                              audio.onerror = (e) => {
                                console.error("Audio Load Error:", e);
                                alert("Failed to load audio. The data might be corrupted or in an unsupported format.");
                              };
                              audio.play().catch(err => {
                                console.error("Playback error:", err);
                                alert("Playback failed. Please try again or download the file.");
                              });
                            } catch (err) {
                              console.error("Audio creation error:", err);
                              alert("Could not initialize audio player.");
                            }
                          }}
                          className="flex-1 flex items-center justify-center gap-2 py-2 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500 text-xs font-bold rounded-xl transition-all hover:text-white"
                        >
                          <Play size={14} /> Play
                        </button>
                        <button 
                          onClick={() => downloadAudio(log.audio_data, `voice_${log.id.slice(0,5)}`)}
                          className="p-2 bg-white/5 hover:bg-emerald-500/20 text-gray-400 hover:text-emerald-400 rounded-xl transition-all"
                          title="Download MP3"
                        >
                          <Download size={14} />
                        </button>
                        <button 
                          onClick={() => deleteLog(log.id)}
                          className="p-2 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-xl transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-white/5">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-col items-center md:items-start gap-1">
            <span className="text-[10px] font-black text-gray-600 tracking-[0.3em] uppercase">© 2026 Toonpur AI Voice</span>
            <span className="text-[9px] text-gray-700 font-bold uppercase tracking-widest">Built for Professional Creators</span>
          </div>
          
          <div className="flex items-center gap-8">
            <button 
              onClick={() => setShowPrivacy(true)}
              className="text-[10px] text-gray-500 hover:text-indigo-400 font-bold uppercase tracking-widest transition-colors"
            >
              Privacy Policy
            </button>
            <button 
              onClick={() => setShowTerms(true)}
              className="text-[10px] text-gray-500 hover:text-indigo-400 font-bold uppercase tracking-widest transition-colors"
            >
              Terms of Service
            </button>
          </div>

          <div className="flex items-center gap-4">
            {/* Invisible Reward Bridge */}
            <button 
              id="reward-ad-btn" 
              onClick={handleRewardAd}
              className="opacity-0 pointer-events-none absolute"
              aria-hidden="true"
            />
            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center border border-white/5 grayscale opacity-30">
              <ShieldCheck size={14} className="text-gray-400" />
            </div>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <PolicyModal title="Privacy Policy" isOpen={showPrivacy} onClose={() => setShowPrivacy(false)}>
        <p>At <strong>Toonpur AI Voice</strong>, your privacy is our top priority. This policy outlines how we handle your data.</p>
        <section className="space-y-2">
          <h4 className="text-white font-bold uppercase text-xs tracking-wider">1. Data Storage</h4>
          <p>We do not sell, rent, or trade your personal data with third parties. Your account information is used strictly for authentication and credit management.</p>
        </section>
        <section className="space-y-2">
          <h4 className="text-white font-bold uppercase text-xs tracking-wider">2. Audio Retention</h4>
          <p>To maximize system performance and security, generated audio files are automatically purged from our servers 10 minutes after creation. We do not maintain long-term archives of your generated content.</p>
        </section>
        <section className="space-y-2">
          <h4 className="text-white font-bold uppercase text-xs tracking-wider">3. AI Training</h4>
          <p>We do not use your generated text or voice outputs to train our primary models without explicit consent. Your content remains yours.</p>
        </section>
      </PolicyModal>

      <PolicyModal title="Terms of Service" isOpen={showTerms} onClose={() => setShowTerms(false)}>
        <p>By using <strong>Toonpur AI Voice</strong>, you agree to the following conditions.</p>
        <section className="space-y-2">
          <h4 className="text-white font-bold uppercase text-xs tracking-wider">1. Usage Limits</h4>
          <p>The standard creator tier is limited to 3,000 characters per 24-hour cycle. Scripted bypassing of these limits is strictly prohibited.</p>
        </section>
        <section className="space-y-2">
          <h4 className="text-white font-bold uppercase text-xs tracking-wider">2. Content Compliance</h4>
          <p>You may not use Toonpur AI Voice to generate hate speech, illegal content, or deepfake audio intended for harassment or fraud.</p>
        </section>
        <section className="space-y-2">
          <h4 className="text-white font-bold uppercase text-xs tracking-wider">3. Service Availability</h4>
          <p>This is a professional-grade AI tool. While we strive for 99.9% uptime, we are not liable for any losses resulting from temporary service interruptions or the auto-purge system.</p>
        </section>
      </PolicyModal>
    </div>
  );
}
