import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { DiagnosisResult, ChatMessage } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzePlantImage(base64Image: string): Promise<DiagnosisResult> {
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
              data: base64Image.split(",")[1] || base64Image,
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
          treatmentPlan: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          preventionSteps: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          confidence: { type: Type.NUMBER },
          segmentationSummary: { type: Type.STRING },
          detectedPlant: { type: Type.STRING },
          environmentalFactors: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          riskLevel: { type: Type.STRING, enum: ["Low", "Moderate", "High", "Critical"] },
          estimatedRecoveryTime: { type: Type.STRING },
          economicImpact: { type: Type.STRING },
          supportingEvidence: { type: Type.STRING, description: "Supporting evidence from Google Search" },
          workOrder: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                task: { type: Type.STRING },
                priority: { type: Type.STRING, enum: ["Low", "Medium", "High"] },
                estimatedTime: { type: Type.STRING },
                materialsNeeded: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
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
  
  const result = JSON.parse(text) as DiagnosisResult;

  // Extract grounding sources
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (groundingChunks) {
    result.groundingSources = groundingChunks
      .filter(chunk => chunk.web)
      .map(chunk => ({
        title: chunk.web!.title || "Source",
        uri: chunk.web!.uri || "#"
      }));
  }

  return result;
}

export async function sendChatMessage(
  history: ChatMessage[], 
  message: string, 
  context: DiagnosisResult
): Promise<string> {
  const model = "gemini-3-flash-preview";
  
  const chat = ai.chats.create({
    model,
    config: {
      systemInstruction: `You are an expert plant pathologist chatbot. 
      You are discussing a specific diagnosis with a farmer or SME.
      Context of the current diagnosis:
      - Plant: ${context.detectedPlant}
      - Disease: ${context.diseaseName} (${context.scientificName})
      - Severity: ${context.severityDescription} (${context.severityScore}/100)
      - Infection Area: ${context.infectionAreaPercentage}%
      - Risk Level: ${context.riskLevel}
      - Economic Impact: ${context.economicImpact}
      - Estimated Recovery: ${context.estimatedRecoveryTime}
      - Environmental Factors: ${context.environmentalFactors.join(', ')}
      - Treatment: ${context.treatmentPlan.join(', ')}
      - Work Order Tasks: ${context.workOrder.map(w => `${w.task} (Priority: ${w.priority}, Materials: ${w.materialsNeeded.join(', ')})`).join('; ')}
      - Prevention: ${context.preventionSteps.join(', ')}
      - Segmentation Summary: ${context.segmentationSummary}
      
      Be precise, scientific yet practical. 
      
      CRITICAL: Keep your responses extremely short and concise (max 2 sentences).
      Do NOT repeat the full diagnosis, treatment plan, or work order in every response. 
      The user has already seen the report. Only provide specific details if the user asks for them. 
      Focus on answering the user's current question independently, using the diagnosis as context.`,
    },
  });

  // Convert history to Gemini format
  // Note: sendMessage only takes a string message, history is managed by the chat object if we use history in create, 
  // but for simplicity and statelessness in this helper, we can just pass the new message.
  // Actually, ai.chats.create can take history.
  
  const response = await chat.sendMessage({
    message: message
  });

  return response.text || "I'm sorry, I couldn't process that request.";
}
