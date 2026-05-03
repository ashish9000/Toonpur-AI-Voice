import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI, Modality } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Initialization ---

// Gemini AI
let genAI: GoogleGenAI;
function getGenAI() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
}

// Supabase (Service Role for Admin Tasks)
let supabaseAdmin: any;
function getSupabase() {
  if (!supabaseAdmin) {
    const url = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error("Supabase URL or Service Role Key missing in environment");
    }
    supabaseAdmin = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  return supabaseAdmin;
}

// Rate Limiting Map
const rateLimit = new Map<string, number>();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // API Routes

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // TTS Generation with Credit Check & Deduction
  app.post("/api/generate-audio", async (req, res) => {
    const { userId, text, voice, emotion, pitch, speed, reverb } = req.body;
    
    if (!userId || !text) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 1. Rate Limiting Check (Bot Security)
    const now = Date.now();
    const lastCall = rateLimit.get(userId) || 0;
    if (now - lastCall < 3000) { // 3 second cooldown
      return res.status(429).json({ error: "Rate limit exceeded. Please wait 3s." });
    }
    rateLimit.set(userId, now);

    const textLength = text.length;

    try {
      const supabase = getSupabase();
      
      // 2. Credit Check
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", userId)
        .single();

      if (profileError || !profile) {
        return res.status(404).json({ error: "User profile not found" });
      }

      if (profile.credits < textLength) {
        return res.status(403).json({ error: "Insufficient credits", remaining: profile.credits });
      }

      // 3. Generate TTS via Gemini 2.0 Flash
      console.log(`Generating TTS for ${userId}, length: ${textLength}`);
      const ai = getGenAI();
      
      // Enhanced prompt with reverb/echo instructions if requested
      const prompt = `You are an expert voice actor specializing in North Indian regional accents (Hindi, Bhojpuri, Maithili).
Generate high-quality audio for this text.
Voice Personality: ${voice || 'Charon'}
Emotion: [${emotion || 'neutral'}]
Pitch: ${pitch > 1.0 ? 'High' : pitch < 1.0 ? 'Low' : 'Normal'}
Speed: ${speed > 1.0 ? 'Fast' : speed < 1.0 ? 'Slow' : 'Normal'}
Environment: ${reverb > 0.5 ? 'Large Hall with Reverb/Echo' : 'Professional Studio'}

Text to speak:
${text}`;

      // Using the latest flash model as requested for speed and quality
      const model = ai.getGenerativeModel({ model: "gemini-2.0-flash" });
      
      const ttsResult = await (model as any).generateContent({
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice || 'Charon' },
            },
          },
        },
      });

      const audioData = ttsResult.response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) {
        throw new Error("Gemini returned no audio data. The model might be busy or the request was filtered.");
      }

      // 4. Update Credits & Log Task
      // We do this in a transaction-like way (sequential updates)
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ credits: profile.credits - textLength })
        .eq("id", userId);

      if (updateError) throw updateError;

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes purge
      const { data: logEntry, error: logError } = await supabase
        .from("audio_logs")
        .insert({
          user_id: userId,
          text: text.substring(0, 100),
          voice,
          audio_data: audioData,
          expires_at: expiresAt
        })
        .select()
        .single();

      if (logError) throw logError;

      res.json({ 
        success: true, 
        audioData,
        logId: logEntry.id,
        newCredits: profile.credits - textLength,
        expiresAt
      });

    } catch (error: any) {
      console.error("Error in generate-audio:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // Data Purge Route (Manual or via Timer)
  app.post("/api/purge-expired", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { count, error } = await supabase
        .from("audio_logs")
        .delete({ count: 'exact' })
        .lt("expires_at", new Date().toISOString());

      if (error) throw error;
      res.json({ success: true, purgedCount: count });
    } catch (error) {
      res.status(500).json({ error: "Purge failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
