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
  Github,
  Database,
  ExternalLink,
  Code2,
  Key,
  ShieldCheck,
  Zap
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// --- SQL Block for Supabase Editor ---
const SETUP_SQL = `-- Run this in your Supabase SQL Editor
-- 1. Create Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  credits INTEGER DEFAULT 2000,
  tier TEXT DEFAULT 'free',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
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
      <div className="flex justify-between text-xs mb-1 font-medium text-gray-400 uppercase tracking-wider">
        <span>{label}</span>
        <span>{value} / {max}</span>
      </div>
      <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          className={`h-full ${percentage < 20 ? 'bg-red-500' : 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]'}`}
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
  const [copied, setCopied] = useState(false);
  
  // Form State
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("Charon");
  const [emotion, setEmotion] = useState("neutral");
  const [pitch, setPitch] = useState(1.0);
  const [speed, setSpeed] = useState(1.0);
  const [reverb, setReverb] = useState(0.0);

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

  const handleLogin = async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.origin }
    });
  };

  const handleLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const generateAudio = async () => {
    if (!session || !text.trim()) return;
    setGenerating(true);

    try {
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
          reverb
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Refresh list and profile
      await fetchUserData(session.user.id);
      setText("");
      
      // Play immediately
      const audio = new Audio(`data:audio/mp3;base64,${data.audioData}`);
      audio.play();

    } catch (err: any) {
      alert(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const downloadAudio = (base64: string, filename: string) => {
    const link = document.createElement("a");
    link.href = `data:audio/mp3;base64,${base64}`;
    link.download = `${filename}.mp3`;
    link.click();
  };

  const deleteLog = async (id: string) => {
    if (!supabase) return;
    await supabase.from("audio_logs").delete().eq("id", id);
    setLogs(logs.filter(l => l.id !== id));
  };

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <RefreshCw className="animate-spin text-indigo-500" size={32} />
    </div>
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
                <li className="flex justify-between items-center bg-black/40 p-2 rounded"><span>GEMINI_API_KEY</span> <Zap size={10} className="text-yellow-500" /></li>
              </ul>
            </div>

            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-3xl p-6 flex items-start gap-4">
              <Code2 className="text-indigo-500 shrink-0" size={24} />
              <div>
                <h4 className="font-bold text-sm mb-1 uppercase tracking-wider text-indigo-400">Developer Note</h4>
                <p className="text-xs text-gray-400 leading-relaxed">
                  We've removed all Firebase references. Once you add your Supabase credentials, the app will automatically unlock.
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
      <div className="max-w-md w-full text-center space-y-8">
        <div className="space-y-2">
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 shadow-[0_0_30px_rgba(99,102,241,0.15)]">
              <Mic2 size={48} className="text-indigo-500" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">Creator Voice</h1>
          <p className="text-gray-400">High-Fidelity Regional TTS for Content Creators.</p>
        </div>
        
        <button 
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 bg-white text-black font-semibold py-4 rounded-xl hover:bg-gray-100 transition-all shadow-xl active:scale-95"
        >
          <Github size={20} />
          Continue with GitHub
        </button>
        
        <p className="text-xs text-gray-600">Secure Authentication powered by Supabase.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#080808] text-white font-sans selection:bg-indigo-500/30">
      {/* Navbar */}
      <nav className="border-b border-white/5 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 group cursor-default">
            <div className="p-2 bg-indigo-500 rounded-lg shadow-lg group-hover:rotate-12 transition-transform">
              <Mic2 size={18} className="text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              Creator Voice
            </span>
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
        <div className="lg:col-span-8 space-y-8">
          
          {/* Credit Dashboard */}
          <section className="bg-gradient-to-br from-indigo-500/10 to-transparent border border-indigo-500/20 rounded-3xl p-8 relative overflow-hidden backdrop-blur-sm">
            <div className="relative z-10 grid md:grid-cols-2 gap-8 items-center">
              <div>
                <h2 className="text-2xl font-bold mb-1">Your Dashboard</h2>
                <p className="text-gray-400 text-sm mb-6">Real-time credit management & tier status.</p>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-500/20 text-indigo-400 rounded-full text-xs font-bold uppercase tracking-wider mb-2">
                  <User size={12} />
                  Tier: {profile?.tier}
                </div>
              </div>
              <div className="space-y-4">
                <ProgressBar 
                  label="Daily Credits" 
                  value={profile?.credits || 0} 
                  max={2000} 
                />
                <p className="text-[10px] text-gray-500 text-right italic">* Credits reset every 24 hours.</p>
              </div>
            </div>
            {/* Background Accent */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 blur-[100px] rounded-full -mr-20 -mt-20" />
          </section>

          {/* Main Input Area */}
          <section className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden backdrop-blur-sm">
            <div className="p-8 space-y-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                   <Settings2 size={18} className="text-indigo-400" />
                   Audio Generation
                </h3>
                <span className={`text-xs font-medium px-2 py-1 rounded-md ${text.length > 2000 ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-gray-400'}`}>
                  {text.length} / 2000
                </span>
              </div>
              
              <textarea 
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Enter text in Hindi, English, or Bhojpuri... For example: 'नमस्ते दोस्तों, आपका स्वागत है!'"
                className="w-full h-40 bg-black/40 border border-white/10 rounded-2xl p-6 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none transition-all placeholder:text-gray-700"
              />

              {/* Advanced Controls */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                <div className="space-y-3">
                  <label className="text-xs text-gray-500 font-bold uppercase tracking-widest">Voice Model</label>
                  <select 
                    value={voice}
                    onChange={(e) => setVoice(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500/50 outline-none appearance-none cursor-pointer"
                  >
                    <option value="Charon">Charon (Male Deep)</option>
                    <option value="Puck">Puck (Cheerful Child)</option>
                    <option value="Kore">Kore (Sharp Female)</option>
                  </select>
                </div>
                
                <div className="space-y-3">
                  <label className="text-xs text-gray-500 font-bold uppercase tracking-widest">Speed ({speed}x)</label>
                  <input 
                    type="range" min="0.5" max="2.0" step="0.1" 
                    value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500 mt-2"
                  />
                </div>

                <div className="space-y-3">
                  <label className="text-xs text-gray-500 font-bold uppercase tracking-widest">Pitch ({pitch}x)</label>
                  <input 
                    type="range" min="0.5" max="1.5" step="0.1" 
                    value={pitch} onChange={(e) => setPitch(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500 mt-2"
                  />
                </div>
              </div>

              <div className="pt-4 flex flex-col md:flex-row gap-6">
                <div className="flex-1 space-y-3">
                  <label className="text-xs text-gray-500 font-bold uppercase tracking-widest flex justify-between">
                    Reverb / Echo Intensity <span>{Math.round(reverb * 100)}%</span>
                  </label>
                  <input 
                    type="range" min="0" max="1.0" step="0.1" 
                    value={reverb} onChange={(e) => setReverb(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500 mt-2"
                  />
                </div>
                <button 
                  onClick={generateAudio}
                  disabled={generating || !text.trim() || text.length > 2000}
                  className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-10 py-4 rounded-2xl shadow-[0_0_20px_rgba(99,102,241,0.3)] transition-all active:scale-95 flex items-center justify-center gap-3"
                >
                  {generating ? <RefreshCw className="animate-spin" size={20} /> : <Play size={20} />}
                  {generating ? "Crafting Voice..." : "Generate Audio"}
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: History & Purge Timer */}
        <div className="lg:col-span-4 space-y-6">
          <div className="sticky top-24">
            <div className="bg-zinc-900 border border-white/5 rounded-3xl p-6 mb-6">
              <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
                <AlertTriangle size={18} className="text-orange-500" />
                Audio Purge Warning
              </h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                To keep our infrastructure clean, all generated audio is purged <span className="text-white font-medium">10 minutes</span> after creation. Please download your files immediately!
              </p>
            </div>

            <h4 className="text-xs text-gray-500 uppercase font-bold tracking-widest px-2 mb-4">Recent Generations</h4>
            
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
                            const audio = new Audio(`data:audio/mp3;base64,${log.audio_data}`);
                            audio.play();
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
    </div>
  );
}
