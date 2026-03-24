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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Key Middleware
  const apiKeyMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const providedKey = req.headers['x-api-key'];
    const systemKey = process.env.APP_API_KEY;

    if (!systemKey) {
      return res.status(500).json({ error: "System API key not configured in environment (APP_API_KEY)." });
    }

    if (providedKey !== systemKey) {
      return res.status(401).json({ error: "Unauthorized: Invalid API Key." });
    }
    next();
  };

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", system: "PhytoScan AI" });
  });

  // Protected API Endpoint for Analysis
  app.post("/api/analyze", apiKeyMiddleware, async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) return res.status(400).json({ error: "Image data required." });

      const model = "gemini-3-flash-preview";
      const prompt = `
        You are an expert plant pathologist. Analyze this image of a plant leaf.
        Perform the following:
        1. Identify the plant species.
        2. Detect any diseases or pests.
        3. Estimate the infection area percentage (0-100%).
        4. Provide a concise diagnosis, treatment plan, and prevention steps.
        5. Estimate your confidence level.
        6. Use the Google Search tool to find supporting evidence, recent research, or verified agricultural data that validates the detected disease and the recommended treatment solutions. Provide a summary in 'supportingEvidence' that specifically backs up the proposed actions.
        
        Return the analysis in the specified JSON format. Keep descriptions and summaries extremely brief (max 2 sentences each).
      `;

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
                    materialsNeeded: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: ["task", "priority", "estimatedTime", "materialsNeeded"]
                }
              }
            },
            required: [
              "diseaseName", "scientificName", "severityScore", 
              "severityDescription", "infectionAreaPercentage", 
              "treatmentPlan", "preventionSteps", "confidence", 
              "segmentationSummary", "detectedPlant",
              "environmentalFactors", "riskLevel", "estimatedRecoveryTime",
              "economicImpact", "workOrder", "supportingEvidence"
            ]
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("No response from AI");
      
      const result = JSON.parse(text);
      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (groundingChunks) {
        result.groundingSources = groundingChunks
          .filter(chunk => chunk.web)
          .map(chunk => ({
            title: chunk.web!.title || "Source",
            uri: chunk.web!.uri || "#"
          }));
      }

      res.json(result);
    } catch (error: any) {
      console.error("API Error:", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
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
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
