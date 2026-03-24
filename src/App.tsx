import React, { useState, useRef, useEffect } from 'react';
import { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  HeadingLevel, 
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType
} from 'docx';
import { 
  Camera, 
  Upload, 
  Leaf, 
  AlertTriangle, 
  CheckCircle2, 
  Info, 
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  Zap,
  Microscope,
  Droplets,
  Sprout,
  Send,
  MessageSquare,
  User,
  Bot,
  X,
  Plus,
  Image as ImageIcon,
  FileText,
  Download,
  ClipboardList,
  Clock,
  Hammer,
  TrendingDown,
  Search,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzePlantImage, sendChatMessage } from './services/geminiService';
import { DiagnosisResult, AnalysisState, ChatMessage, ChatState } from './types';
import { cn } from './lib/utils';
import ReactMarkdown from 'react-markdown';

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({
    isLoading: false,
    error: null,
    result: null,
  });
  
  const [chat, setChat] = useState<ChatState>({
    messages: [{
      role: 'model',
      text: "Hello! I'm your **PhytoScan AI** assistant. Please upload a photo of a plant leaf, and I'll analyze it for diseases and provide a treatment plan."
    }],
    isTyping: false,
  });
  const [chatInput, setChatInput] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chat.messages, chat.isTyping]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setImage(base64);
        runAnalysis(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const runAnalysis = async (imgData: string) => {
    setChat(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'user', text: "Analyzing this specimen..." }],
      isTyping: true
    }));

    setAnalysis({ isLoading: true, error: null, result: null });
    try {
      const result = await analyzePlantImage(imgData);
      setAnalysis({ isLoading: false, error: null, result });
      
      setChat(prev => ({
        ...prev,
        messages: [...prev.messages, { 
          role: 'model', 
          text: `Analysis complete. I've detected **${result.diseaseName}** on your **${result.detectedPlant} (${result.scientificName})**. Here is the full pathology report and your generated Work Order:`,
          isAnalysisReport: true,
          analysisResult: result,
          analysisImage: imgData
        }],
        isTyping: false
      }));
    } catch (err) {
      setAnalysis({ 
        isLoading: false, 
        error: "Failed to analyze image. Please try again.", 
        result: null 
      });
      setChat(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'model', text: "I'm sorry, I couldn't analyze that image. Please make sure it's a clear photo of a plant leaf." }],
        isTyping: false
      }));
      console.error(err);
    }
  };

  const downloadReport = async (res: DiagnosisResult) => {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: "PHYTO-SCAN AI: PATHOLOGY REPORT",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Generated: ${new Date().toLocaleString()}`, italics: true }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),
          
          new Paragraph({ text: "1. SPECIMEN OVERVIEW", heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: "Plant: ", bold: true }), new TextRun(res.detectedPlant)] }),
          new Paragraph({ children: [new TextRun({ text: "Diagnosis: ", bold: true }), new TextRun(res.diseaseName)] }),
          new Paragraph({ children: [new TextRun({ text: "Scientific Name: ", bold: true }), new TextRun(res.scientificName)] }),
          new Paragraph({ children: [new TextRun({ text: "Confidence Level: ", bold: true }), new TextRun(`${(res.confidence * 100).toFixed(1)}%`)] }),
          
          new Paragraph({ text: "2. PATHOLOGY ANALYSIS", heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: "Severity: ", bold: true }), new TextRun(`${res.severityDescription} (${res.severityScore}/100)`)] }),
          new Paragraph({ children: [new TextRun({ text: "Infection Area: ", bold: true }), new TextRun(`${res.infectionAreaPercentage}%`)] }),
          new Paragraph({ children: [new TextRun({ text: "Risk Level: ", bold: true }), new TextRun(res.riskLevel)] }),
          new Paragraph({ children: [new TextRun({ text: "Economic Impact: ", bold: true }), new TextRun(res.economicImpact)] }),
          new Paragraph({ children: [new TextRun({ text: "Environmental Factors: ", bold: true }), new TextRun(res.environmentalFactors.join(', '))] }),
          
          new Paragraph({ text: "3. VISUAL SEGMENTATION SUMMARY", heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }),
          new Paragraph({ text: res.segmentationSummary }),
          
          res.supportingEvidence ? new Paragraph({ text: "4. SUPPORTING EVIDENCE (RAG)", heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }) : new Paragraph({ text: "" }),
          res.supportingEvidence ? new Paragraph({ children: [new TextRun({ text: res.supportingEvidence, italics: true })] }) : new Paragraph({ text: "" }),
          ...(res.groundingSources?.map(s => new Paragraph({ 
            children: [
              new TextRun({ text: "Source: ", bold: true }),
              new TextRun({ text: `${s.title} (${s.uri})`, color: "0000FF", underline: {} })
            ],
            bullet: { level: 0 }
          })) || []),

          new Paragraph({ text: "5. TREATMENT PLAN", heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }),
          ...res.treatmentPlan.map((s, i) => new Paragraph({ text: `${i + 1}. ${s}`, bullet: { level: 0 } })),
          
          new Paragraph({ text: "6. PREVENTION STRATEGIES", heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }),
          ...res.preventionSteps.map((s, i) => new Paragraph({ text: s, bullet: { level: 0 } })),
          
          new Paragraph({ text: "7. ESTIMATED RECOVERY", heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: "Estimated Time: ", bold: true }), new TextRun(res.estimatedRecoveryTime)] }),
          
          new Paragraph({ text: "8. TREATMENT WORK ORDER", heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Task", bold: true })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Priority", bold: true })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Est. Time", bold: true })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Materials", bold: true })] })] }),
                ],
              }),
              ...res.workOrder.map(w => new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph(w.task)] }),
                  new TableCell({ children: [new Paragraph(w.priority)] }),
                  new TableCell({ children: [new Paragraph(w.estimatedTime)] }),
                  new TableCell({ children: [new Paragraph(w.materialsNeeded.join(', '))] }),
                ],
              })),
            ],
          }),
          
          new Paragraph({
            children: [
              new TextRun({
                text: "DISCLAIMER: This report is AI-generated for informational purposes. Consult a local agricultural expert for critical decisions.",
                italics: true,
              }),
            ],
            spacing: { before: 800 },
            alignment: AlignmentType.CENTER,
          }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PhytoScan_Report_${res.diseaseName.replace(/\s+/g, '_')}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!chatInput.trim() || chat.isTyping) return;

    const userMessage: ChatMessage = { role: 'user', text: chatInput };
    setChat(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isTyping: true
    }));
    setChatInput('');

    try {
      const response = analysis.result 
        ? await sendChatMessage(chat.messages, chatInput, analysis.result)
        : "Please upload an image first so I can provide a specific diagnosis and treatment plan.";
        
      setChat(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'model', text: response }],
        isTyping: false
      }));
    } catch (err) {
      console.error(err);
      setChat(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'model', text: "I'm sorry, I encountered an error while processing your question." }],
        isTyping: false
      }));
    }
  };

  const reset = () => {
    setImage(null);
    setAnalysis({ isLoading: false, error: null, result: null });
    setChat({
      messages: [{
        role: 'model',
        text: "Hello! I'm your **PhytoScan AI** assistant. Please upload a photo of a plant leaf, and I'll analyze it for diseases and provide a treatment plan."
      }],
      isTyping: false,
    });
  };

  return (
    <div className="h-screen bg-[#F8F9FA] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-slate-200 bg-white flex items-center px-6 shrink-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
            <Leaf className="text-white w-5 h-5" />
          </div>
          <h1 className="font-bold text-lg tracking-tight text-slate-900">PhytoScan <span className="text-emerald-600">AI</span></h1>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <button 
            onClick={reset}
            className="text-[10px] font-bold text-slate-400 hover:text-rose-500 uppercase tracking-widest transition-colors flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Reset Session
          </button>
          <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full border border-slate-200">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Neural Engine Active</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Scrollable Container (Analysis + Chat) */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#F8F9FA]">
          <div className="max-w-4xl mx-auto p-4 md:p-6 flex flex-col gap-8 pb-32">
            {/* Chat Messages Area */}
            <div className="w-full max-w-2xl mx-auto flex flex-col gap-6">
              <AnimatePresence initial={false}>
                {chat.messages.map((msg, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex flex-col gap-4",
                      msg.role === 'user' ? "items-end" : "items-start"
                    )}
                  >
                    <div className={cn(
                      "flex gap-4 w-full",
                      msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                    )}>
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 shadow-sm",
                        msg.role === 'user' ? "bg-slate-200" : "bg-emerald-600"
                      )}>
                        {msg.role === 'user' ? <User className="w-4 h-4 text-slate-500" /> : <Bot className="w-4 h-4 text-white" />}
                      </div>
                      
                      <div className={cn(
                        "flex flex-col gap-2 max-w-[85%]",
                        msg.role === 'user' ? "items-end" : "items-start"
                      )}>
                        <div className={cn(
                          "p-4 rounded-2xl text-sm leading-relaxed shadow-sm",
                          msg.role === 'user' 
                            ? "bg-emerald-600 text-white rounded-tr-none" 
                            : "bg-white border border-slate-200 text-slate-700 rounded-tl-none"
                        )}>
                          <div className={cn(
                            "prose prose-sm max-w-none",
                            msg.role === 'user' ? "prose-invert" : "prose-slate"
                          )}>
                            <ReactMarkdown>{msg.text}</ReactMarkdown>
                          </div>
                        </div>

                        {/* Inline Analysis Report */}
                        {msg.isAnalysisReport && msg.analysisResult && msg.analysisImage && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="w-full bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                          >
                            <div className="p-4 md:p-8 flex flex-col gap-8">
                              {/* Row 1: Analyzed Specimen */}
                              <div className="w-full">
                                <div className="flex items-center gap-2 mb-4">
                                  <div className="w-1.5 h-6 bg-emerald-600 rounded-full" />
                                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">01. Analyzed Specimen</h4>
                                </div>
                                <div className="glass-card overflow-hidden border-emerald-100 shadow-sm rounded-xl aspect-video md:aspect-[21/9] relative group bg-black">
                                  <img src={msg.analysisImage} className="w-full h-full object-contain" alt="Specimen" referrerPolicy="no-referrer" />
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                                    <p className="text-white text-[10px] font-medium tracking-wider uppercase">High-Resolution Neural Scan</p>
                                  </div>
                                </div>
                              </div>

                              {/* Row 2: Pathology Report */}
                              <div className="w-full">
                                <div className="flex items-center gap-2 mb-4">
                                  <div className="w-1.5 h-6 bg-emerald-600 rounded-full" />
                                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">02. Pathology Report</h4>
                                </div>
                                <div className="bg-slate-50/50 rounded-2xl p-6 border border-slate-100">
                                  <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-6">
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <h3 className="text-2xl font-bold text-slate-900 leading-tight">{msg.analysisResult.diseaseName}</h3>
                                        {msg.analysisResult.groundingSources?.[0] && (
                                          <a 
                                            href={msg.analysisResult.groundingSources[0].uri}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-1.5 bg-slate-100 hover:bg-blue-100 text-slate-400 hover:text-blue-600 rounded-lg transition-colors"
                                            title="View Scientific Reference"
                                          >
                                            <ExternalLink className="w-3.5 h-3.5" />
                                          </a>
                                        )}
                                      </div>
                                      <p className="text-slate-500 italic text-sm mt-1">{msg.analysisResult.scientificName}</p>
                                    </div>
                                    <span className={cn(
                                      "text-[10px] font-bold px-4 py-1.5 rounded-full uppercase tracking-widest shadow-sm shrink-0",
                                      msg.analysisResult.riskLevel === 'Critical' ? "bg-rose-600 text-white" :
                                      msg.analysisResult.riskLevel === 'High' ? "bg-rose-100 text-rose-600" :
                                      msg.analysisResult.riskLevel === 'Moderate' ? "bg-amber-100 text-amber-600" :
                                      "bg-emerald-100 text-emerald-600"
                                    )}>
                                      {msg.analysisResult.riskLevel} Risk
                                    </span>
                                  </div>

                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="space-y-1">
                                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Plant Type</p>
                                      <p className="text-sm font-bold text-slate-800">{msg.analysisResult.detectedPlant}</p>
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Infection Area</p>
                                      <p className="text-sm font-bold text-slate-800">{msg.analysisResult.infectionAreaPercentage}%</p>
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Recovery Time</p>
                                      <p className="text-sm font-bold text-slate-800">{msg.analysisResult.estimatedRecoveryTime}</p>
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Economic Impact</p>
                                      <p className="text-sm font-bold text-slate-800">{msg.analysisResult.economicImpact}</p>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Row 3: Supporting Evidence (RAG) */}
                              {msg.analysisResult.supportingEvidence && (
                                <div className="w-full">
                                  <div className="flex items-center gap-2 mb-4">
                                    <div className="w-1.5 h-6 bg-blue-600 rounded-full" />
                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">03. Supporting Evidence (RAG)</h4>
                                  </div>
                                  <div className="bg-blue-50/30 rounded-2xl p-6 border border-blue-100/50">
                                    <div className="flex items-start gap-4 mb-4">
                                      <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                                        <Search className="w-5 h-5 text-blue-600" />
                                      </div>
                                      <div>
                                        {msg.analysisResult.groundingSources && msg.analysisResult.groundingSources.length > 0 ? (
                                          <a 
                                            href={msg.analysisResult.groundingSources[0].uri}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm text-blue-700 leading-relaxed italic hover:underline decoration-blue-300 underline-offset-4 flex items-start gap-1 group/link"
                                          >
                                            "{msg.analysisResult.supportingEvidence}"
                                            <ExternalLink className="w-3 h-3 mt-1 shrink-0 opacity-50 group-hover/link:opacity-100 transition-opacity" />
                                          </a>
                                        ) : (
                                          <p className="text-sm text-slate-700 leading-relaxed italic">
                                            "{msg.analysisResult.supportingEvidence}"
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                    
                                    {msg.analysisResult.groundingSources && msg.analysisResult.groundingSources.length > 0 && (
                                      <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-blue-100/50">
                                        {msg.analysisResult.groundingSources.map((source, idx) => (
                                          <a 
                                            key={idx}
                                            href={source.uri}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1.5 px-3 py-1 bg-white border border-blue-200 rounded-full text-[10px] font-bold text-blue-600 hover:bg-blue-50 transition-colors shadow-sm"
                                          >
                                            <ExternalLink className="w-3 h-3" />
                                            {source.title}
                                          </a>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Row 4: Solution and Work Order */}
                              <div className="w-full">
                                <div className="flex items-center justify-between mb-4">
                                  <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-6 bg-emerald-600 rounded-full" />
                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">04. Solution & Work Order</h4>
                                  </div>
                                  {msg.analysisResult.groundingSources?.[0] && (
                                    <a 
                                      href={msg.analysisResult.groundingSources[0].uri}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1.5 text-[10px] font-bold text-blue-600 hover:underline decoration-blue-300 underline-offset-4"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                      Verified Solution Reference
                                    </a>
                                  )}
                                </div>
                                <div className="space-y-4">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {msg.analysisResult.workOrder.map((work, idx) => (
                                      <div key={idx} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm hover:border-emerald-200 transition-colors group">
                                        <div className="flex items-start justify-between mb-3">
                                          <div className="flex items-center gap-2">
                                            <div className={cn(
                                              "w-2 h-2 rounded-full",
                                              work.priority === 'High' ? "bg-rose-500" :
                                              work.priority === 'Medium' ? "bg-amber-500" :
                                              "bg-emerald-500"
                                            )} />
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{work.priority} Priority</span>
                                          </div>
                                          <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                                            <Clock className="w-3 h-3" />
                                            {work.estimatedTime}
                                          </div>
                                        </div>
                                        <p className="text-sm font-bold text-slate-800 mb-3 group-hover:text-emerald-700 transition-colors">{work.task}</p>
                                        <div className="flex flex-wrap gap-1.5">
                                          {work.materialsNeeded.map((mat, mIdx) => (
                                            <span key={mIdx} className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-medium text-slate-600">
                                              {mat}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>

                                  <button 
                                    onClick={() => downloadReport(msg.analysisResult!)}
                                    className="w-full py-4 bg-slate-900 hover:bg-black text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg uppercase tracking-widest group mt-4"
                                  >
                                    <Download className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
                                    Download Full Pathology Report (.docx)
                                  </button>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {chat.isTyping && (
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center shrink-0 shadow-sm">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-white border border-slate-200 p-4 rounded-2xl rounded-tl-none flex gap-1 shadow-sm">
                    <span className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-bounce" />
                    <span className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-bounce [animation-delay:0.2s]" />
                    <span className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </div>
        </div>

        {/* Chat Input Bar (Fixed at bottom) */}
        <div className="p-4 md:p-6 bg-white border-t border-slate-200 shrink-0 z-20">
          <div className="max-w-2xl mx-auto flex flex-col gap-3">
              {analysis.isLoading && (
                <div className="flex items-center gap-2 p-2 bg-emerald-50 rounded-lg border border-emerald-100">
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
                  <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Processing Specimen...</span>
                </div>
              )}

              <form 
                onSubmit={handleSendMessage}
                className="relative flex items-center gap-2"
              >
                <button 
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-12 h-12 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center hover:bg-slate-100 transition-colors shrink-0 group"
                  title="Attach specimen photo"
                >
                  <Camera className="w-5 h-5 text-slate-400 group-hover:text-emerald-600" />
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
                
                <div className="relative flex-1">
                  <input 
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={analysis.result ? "Ask about treatment or symptoms..." : "Upload a leaf specimen to begin..."}
                    className="w-full pl-4 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                  />
                  <button 
                    type="submit"
                    disabled={!chatInput.trim() || chat.isTyping}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-emerald-600 text-white rounded-lg flex items-center justify-center hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </form>
              
              <div className="flex items-center justify-center gap-4">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-1">
                  <Zap className="w-2 h-2" />
                  Powered by Gemini 3.1 Flash
                </p>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-1">
                  <ShieldCheck className="w-2 h-2" />
                  Expert-Verified Knowledge
                </p>
              </div>
            </div>
          </div>
      </main>
    </div>
  );
}
