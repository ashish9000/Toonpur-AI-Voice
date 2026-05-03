import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Initialization ---

// Voice mapping for Edge TTS
const VOICE_MAP: Record<string, string> = {
  // --- Hindi ---
  "Madhur": "hi-IN-MadhurNeural",
  "Hemant": "hi-IN-HemantNeural",
  "Swara": "hi-IN-SwaraNeural",
  "Ananya": "hi-IN-AnanyaNeural",
  "Kavya": "hi-IN-KavyaNeural",
  // --- English India ---
  "Prabhat": "en-IN-PrabhatNeural",
  "Neerja": "en-IN-NeerjaNeural",
  "Ravi": "en-IN-RaviNeural",
  // --- Regional Indian Languages ---
  "Aarohi": "mr-IN-AarohiNeural",    // Marathi
  "Manohar": "mr-IN-ManoharNeural",  // Marathi
  "Bashkar": "bn-IN-BashkarNeural",  // Bengali
  "Tanishaa": "bn-IN-TanishaaNeural", // Bengali
  "Pallavi": "ta-IN-PallaviNeural",  // Tamil
  "Valluvar": "ta-IN-ValluvarNeural", // Tamil
  "Mohan": "te-IN-MohanNeural",      // Telugu
  "Shruti": "te-IN-ShrutiNeural",    // Telugu
  "Dhwani": "gu-IN-DhwaniNeural",    // Gujarati
  "Sapna": "kn-IN-SapnaNeural",      // Kannada
  "Sobhana": "ml-IN-SobhanaNeural",  // Malayalam
  // --- Kid-Friendly / Popular International Fallbacks ---
  "Steffan": "en-US-SteffanNeural",  // Young Boy (US)
  "Michelle": "en-US-MichelleNeural", // Young Girl (US)
  "Emma": "en-GB-SoniaNeural",      // Smooth British
  "Liam": "en-CA-LiamNeural"        // Clean Canadian
};

// Supabase (Service Role for Admin Tasks)
let supabaseAdmin: any;
function getSupabase() {
  if (!supabaseAdmin) {
    const url = process.env.VITE_SUPABASE_URL;
    // Prefer service role key for backend actions, fallback to anon key if that's all there is
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                       process.env.SUPABASE_KEY || 
                       process.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !serviceKey) {
      console.error("Supabase config missing:", { url: !!url, key: !!serviceKey });
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

  // Background Purge Task (Every 5 minutes)
  setInterval(async () => {
    try {
      const supabase = getSupabase();
      const { count } = await supabase
        .from("audio_logs")
        .delete({ count: 'exact' })
        .lt("expires_at", new Date().toISOString());
      if (count && count > 0) console.log(`Auto-Purge: Cleaned ${count} expired audio files.`);
    } catch (e) {
      console.error("Purge Task Error:", e);
    }
  }, 5 * 60 * 1000);

  // TTS Generation with Credit Check & Deduction
  app.post("/api/generate-audio", async (req, res) => {
    const { userId, text, voice, emotion, pitch, speed, reverb, kidsMode } = req.body;
    
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
      
      // 2. Credit Check & Daily Reset Logic
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (profileError || !profile) {
        return res.status(404).json({ error: "User profile not found" });
      }

      // Check if we need a daily reset (fallback to created_at if updated_at is missing)
      const lastUpdateStr = profile.updated_at || profile.created_at;
      const lastUpdate = lastUpdateStr ? new Date(lastUpdateStr).setHours(0,0,0,0) : 0;
      const today = new Date().setHours(0,0,0,0);
      
      let currentCredits = profile.credits;
      if (lastUpdateStr && today > lastUpdate) {
        console.log(`Resetting credits for user: ${userId}`);
        currentCredits = 3000;
      }

      if (currentCredits < textLength) {
        return res.status(403).json({ error: "Insufficient credits", remaining: currentCredits });
      }

      // 3. Generate TTS via Free Edge TTS
      console.log(`Generating TTS for ${userId}, length: ${textLength} (KidsMode: ${!!kidsMode})`);
      
      const tts = new MsEdgeTTS({ enableLogger: true });
      const edgeVoice = VOICE_MAP[voice] || "hi-IN-MadhurNeural";
      
      // Set metadata (pitch/speed/reverb)
      // Kids Mode effectively shifts the baseline
      let finalPitch = pitch || 1.0;
      let finalSpeed = speed || 1.0;
      
      if (kidsMode) {
        // Boost pitch for high-pitched child voice
        finalPitch += 0.45; 
        finalSpeed += 0.05; // Slightly faster for childish cadence
      }

      const edgePitch = `${Math.round((finalPitch - 1) * 100)}%`;
      const edgeSpeed = `${Math.round((finalSpeed - 1) * 100)}%`;

      // Initializing metadata for each call ensures clean state
      await tts.setMetadata(edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      
      // Convert stream to buffer
      const audioData = await new Promise<string>((resolve, reject) => {
        const { audioStream } = tts.toStream(text, {
          pitch: edgePitch,
          rate: edgeSpeed
        });
        const chunks: Buffer[] = [];
        let hasData = false;

        audioStream.on("data", (chunk) => {
          hasData = true;
          chunks.push(chunk);
        });

        audioStream.on("end", () => {
          if (!hasData) {
            tts.close();
            return reject(new Error("Edge TTS stream ended without any data."));
          }
          const buffer = Buffer.concat(chunks);
          console.log(`Edge TTS Success: ${buffer.length} bytes generated.`);
          tts.close();
          resolve(buffer.toString("base64"));
        });

        audioStream.on("error", (err) => {
          console.error("Edge TTS Stream Error:", err);
          tts.close();
          reject(err);
        });

        // Safety timeout
        setTimeout(() => {
          if (!hasData) {
            tts.close();
            reject(new Error("Edge TTS generation timed out after 15s."));
          }
        }, 15000);
      });
      
      const mimeType = "audio/mpeg";

      // 4. Update Credits & Log Task
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ 
          credits: currentCredits - textLength
          // Omitted updated_at to prevent "column not found" error if user hasn't run SQL yet
        })
        .eq("id", userId);

      if (updateError) throw updateError;

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); 
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
        mimeType,
        logId: logEntry.id,
        newCredits: currentCredits - textLength,
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
