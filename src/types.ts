export interface WorkOrderStep {
  task: string;
  priority: 'Low' | 'Medium' | 'High';
  estimatedTime: string;
  materialsNeeded: string[];
}

export interface DiagnosisResult {
  diseaseName: string;
  scientificName: string;
  severityScore: number; // 0-100
  severityDescription: string;
  infectionAreaPercentage: number;
  treatmentPlan: string[];
  preventionSteps: string[];
  confidence: number; // 0-1
  segmentationSummary: string;
  detectedPlant: string;
  // New detailed fields
  environmentalFactors: string[];
  riskLevel: 'Low' | 'Moderate' | 'High' | 'Critical';
  estimatedRecoveryTime: string;
  economicImpact: string;
  workOrder: WorkOrderStep[];
  supportingEvidence?: string;
  groundingSources?: { title: string; uri: string }[];
}

export interface AnalysisState {
  isLoading: boolean;
  error: string | null;
  result: DiagnosisResult | null;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  isAnalysisReport?: boolean;
  analysisResult?: DiagnosisResult;
  analysisImage?: string;
}

export interface ChatState {
  messages: ChatMessage[];
  isTyping: boolean;
}
