import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// ── CV Service Config ─────────────────────────────────────────────────────────
// Option A: Cloud Run direct URL
const CV_SERVICE_URL = process.env.CV_SERVICE_URL || "";

// Option B: Vertex AI Endpoint
const VERTEX_PROJECT   = process.env.GOOGLE_CLOUD_PROJECT || "melvin-ai-490502";
const VERTEX_REGION    = process.env.VERTEX_REGION || "us-central1";
const VERTEX_ENDPOINT  = process.env.VERTEX_ENDPOINT_ID || ""; // e.g. "1234567890"

// Use Vertex AI if endpoint ID is set, otherwise use Cloud Run URL
const USE_VERTEX = !!VERTEX_ENDPOINT;
// ─────────────────────────────────────────────────────────────────────────────

interface CVPrediction {
  predictedClass: string;
  confidence: number;
  allScores: Record<string, number>;
  diseaseInfo: {
    fullName: string;
    pathogen: string;
    symptoms: string;
    severity: string;
    treatment: string;
    prevention: string;
  };
  isHighConfidence: boolean;
}

// ── Get Google Auth Token for Vertex AI ──────────────────────────────────────
async function getGoogleAuthToken(): Promise<string> {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token || "";
}

// ── Call Vertex AI Endpoint ───────────────────────────────────────────────────
async function callVertexEndpoint(imageData: string): Promise<CVPrediction | null> {
  try {
    const token = await getGoogleAuthToken();
    const endpointUrl = `https://${VERTEX_REGION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_REGION}/endpoints/${VERTEX_ENDPOINT}:predict`;

    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        instances: [{ image: imageData }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      console.error("Vertex AI error:", await response.text());
      return null;
    }

    const result = await response.json() as { predictions: CVPrediction[] };
    return result.predictions?.[0] || null;
  } catch (err) {
    console.warn("Vertex AI endpoint call failed:", err);
    return null;
  }
}

// ── Call Cloud Run CV Service ─────────────────────────────────────────────────
async function callCloudRunService(imageData: string): Promise<CVPrediction | null> {
  try {
    const response = await fetch(`${CV_SERVICE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageData }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    return await response.json() as CVPrediction;
  } catch (err) {
    console.warn("Cloud Run CV service call failed:", err);
    return null;
  }
}

// ── Main CV Prediction (tries Vertex AI first, falls back to Cloud Run) ───────
async function getCVPrediction(imageData: string): Promise<CVPrediction | null> {
  if (USE_VERTEX) {
    console.log("Using Vertex AI endpoint for CV prediction...");
    const result = await callVertexEndpoint(imageData);
    if (result) return result;
    console.log("Vertex AI failed, falling back to Cloud Run...");
  }

  if (CV_SERVICE_URL) {
    console.log("Using Cloud Run for CV prediction...");
    return await callCloudRunService(imageData);
  }

  console.log("No CV service configured, skipping CV prediction.");
  return null;
}

// ── Build enriched Gemini prompt with CV results ──────────────────────────────
function buildAnalysisPrompt(cvResult: CVPrediction | null): string {
  const cvContext = cvResult
    ? `
A specialized CV (Computer Vision) model has already pre-analyzed this image:

CV MODEL PREDICTION:
- Detected Disease: ${cvResult.diseaseInfo?.fullName || cvResult.predictedClass}
- Confidence: ${(cvResult.confidence * 100).toFixed(1)}%
- All class scores: ${Object.entries(cvResult.allScores)
        .map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`)
        .join(", ")}

CV DISEASE DATABASE:
- Pathogen: ${cvResult.diseaseInfo?.pathogen}
- Symptoms: ${cvResult.diseaseInfo?.symptoms}
- Severity: ${cvResult.diseaseInfo?.severity}
- Treatment: ${cvResult.diseaseInfo?.treatment}
- Prevention: ${cvResult.diseaseInfo?.prevention}

${!cvResult.isHighConfidence ? "⚠️ CV model confidence is below 70%. Examine carefully and consider alternative diagnoses." : ""}

Use the CV model results as strong prior knowledge. Confirm, refine, or correct based on your own visual analysis.`
    : "No CV pre-analysis available. Perform a full visual analysis.";

  return `
You are an expert plant pathologist. Analyze this image of a plant leaf.
${cvContext}

Perform the following:
1. Identify the plant species.
2. Detect any diseases or pests (reference CV model results if available).
3. Estimate the infection area percentage (0-100%).
4. Provide a concise diagnosis, treatment plan, and prevention steps.
5. Estimate your confidence level.
6. Use the Google Search tool to find supporting evidence and recent research.

Return the analysis in the specified JSON format. Keep descriptions brief (max 2 sentences each).
`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  // ── API Key Middleware ──────────────────────────────────────────────────────
  const apiKeyMiddleware = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const providedKey = req.headers["x-api-key"];
    const systemKey = process.env.APP_API_KEY;
    if (!systemKey) {
      return res.status(500).json({ error: "System API key not configured (APP_API_KEY)." });
    }
    if (providedKey !== systemKey) {
      return res.status(401).json({ error: "Unauthorized: Invalid API Key." });
    }
    next();
  };

  // ── Health Check ───────────────────────────────────────────────────────────
  app.get("/api/health", async (req, res) => {
    let cvStatus = "not configured";

    if (USE_VERTEX) {
      cvStatus = `Vertex AI endpoint: ${VERTEX_ENDPOINT}`;
    } else if (CV_SERVICE_URL) {
      try {
        const r = await fetch(`${CV_SERVICE_URL}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        cvStatus = r.ok ? "Cloud Run: ready" : "Cloud Run: unreachable";
      } catch {
        cvStatus = "Cloud Run: unreachable";
      }
    }

    res.json({ status: "ok", system: "PhytoScan AI", cvService: cvStatus });
  });

  // ── CV-only prediction endpoint ────────────────────────────────────────────
  app.post("/api/cv-predict", apiKeyMiddleware, async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) return res.status(400).json({ error: "Image data required." });
      const cvResult = await getCVPrediction(image);
      if (!cvResult) return res.status(503).json({ error: "CV service unavailable." });
      res.json(cvResult);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Main Analysis: CV + Gemini combined ───────────────────────────────────
  app.post("/api/analyze", apiKeyMiddleware, async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) return res.status(400).json({ error: "Image data required." });

      // Step 1: CV model prediction
      const cvResult = await getCVPrediction(image);
      if (cvResult) {
        console.log(`CV: ${cvResult.diseaseInfo?.fullName} (${(cvResult.confidence * 100).toFixed(1)}%)`);
      }

      // Step 2: Gemini analysis with CV context
      const prompt = buildAnalysisPrompt(cvResult);
      const model = "gemini-2.5-flash-preview-04-17";

      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: image.split(",")[1] || image,
                },
              },
            ],
          },
        ],
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              diseaseName: { type: Type.STRING },
              scientificName: { type: Type.STRING },
              severityScore: { type: Type.NUMBER },
              severityDescription: { type: Type.STRING },
              infectionAreaPercentage: { type: Type.NUMBER },
              treatmentPlan: { type: Type.ARRAY, items: { type: Type.STRING } },
              preventionSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
              confidence: { type: Type.NUMBER },
              segmentationSummary: { type: Type.STRING },
              detectedPlant: { type: Type.STRING },
              environmentalFactors: { type: Type.ARRAY, items: { type: Type.STRING } },
              riskLevel: { type: Type.STRING, enum: ["Low", "Moderate", "High", "Critical"] },
              estimatedRecoveryTime: { type: Type.STRING },
              economicImpact: { type: Type.STRING },
              supportingEvidence: { type: Type.STRING },
              workOrder: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    task: { type: Type.STRING },
                    priority: { type: Type.STRING, enum: ["Low", "Medium", "High"] },
                    estimatedTime: { type: Type.STRING },
                    materialsNeeded: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ["task", "priority", "estimatedTime", "materialsNeeded"],
                },
              },
            },
            required: [
              "diseaseName", "scientificName", "severityScore",
              "severityDescription", "infectionAreaPercentage",
              "treatmentPlan", "preventionSteps", "confidence",
              "segmentationSummary", "detectedPlant",
              "environmentalFactors", "riskLevel", "estimatedRecoveryTime",
              "economicImpact", "workOrder", "supportingEvidence",
            ],
          },
        },
      });

      const text = response.text;
      if (!text) throw new Error("No response from Gemini");

      const result = JSON.parse(text);

      // Attach grounding sources
      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (groundingChunks) {
        result.groundingSources = groundingChunks
          .filter((chunk: any) => chunk.web)
          .map((chunk: any) => ({ title: chunk.web!.title || "Source", uri: chunk.web!.uri || "#" }));
      }

      // Attach CV results for frontend display
      if (cvResult) {
        result.cvPrediction = {
          predictedClass: cvResult.predictedClass,
          fullName: cvResult.diseaseInfo?.fullName,
          confidence: cvResult.confidence,
          allScores: cvResult.allScores,
          isHighConfidence: cvResult.isHighConfidence,
        };
      }

      res.json(result);
    } catch (error: any) {
      console.error("API Error:", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  // ── Vite Dev / Production Static ───────────────────────────────────────────
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
    console.log(`CV Mode: ${USE_VERTEX ? `Vertex AI (${VERTEX_ENDPOINT})` : CV_SERVICE_URL ? `Cloud Run (${CV_SERVICE_URL})` : "disabled"}`);
  });
}

startServer();
