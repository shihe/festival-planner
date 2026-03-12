import React, { useState, useEffect, useRef } from 'react';
import { Upload, Calendar, Users, Sparkles, Trash2, ChevronRight, ChevronLeft, Plus, Share2, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import LZString from 'lz-string';
import { extractScheduleFromImage, optimizeSchedule, Act, Vote } from './services/geminiService';
import { cn } from './lib/utils';

// --- Types ---
interface UserProfile {
  user_id: string;
  name: string;
  color: string;
}

interface FestivalData {
  id: string;
  name: string;
  acts: Act[];
  votes: Vote[];
  users: UserProfile[];
}

const COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

export default function App() {
  const [festival, setFestival] = useState<FestivalData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("EXTRACTING SCHEDULE...");
  const [userId, setUserId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('s')) {
      // Always fresh ID for shared links
      return Math.random().toString(36).substring(7);
    }
    const saved = localStorage.getItem('fest_user_id');
    if (saved) return saved;
    const id = Math.random().toString(36).substring(7);
    localStorage.setItem('fest_user_id', id);
    return id;
  });
  const [userName, setUserName] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('s')) return ''; // Force name entry for shared links
    return localStorage.getItem('fest_user_name') || '';
  });
  const [userColor, setUserColor] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('s')) return COLORS[0]; // Reset color for shared links
    return localStorage.getItem('fest_user_color') || COLORS[0];
  });
  const [isJoining, setIsJoining] = useState(false);
  
  const [optimalActIds, setOptimalActIds] = useState<string[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  useEffect(() => {
    if (!isProcessing) return;
    const messages = [
      "EXTRACTING SCHEDULE...",
      "IDENTIFYING STAGES...",
      "CALCULATING SET TIMES...",
      "MAPPING THE VIBE...",
      "ALMOST THERE..."
    ];
    let i = 0;
    const interval = setInterval(() => {
      setProcessingMessage(messages[i % messages.length]);
      i++;
    }, 2000);
    return () => clearInterval(interval);
  }, [isProcessing]);

  // --- State Encoding ---
  const encodeState = (data: FestivalData) => {
    try {
      return LZString.compressToEncodedURIComponent(JSON.stringify(data));
    } catch (e) {
      console.error("Encoding failed", e);
      return "";
    }
  };

  const decodeState = (encoded: string): FestivalData | null => {
    try {
      const decompressed = LZString.decompressFromEncodedURIComponent(encoded);
      if (!decompressed) return null;
      return JSON.parse(decompressed);
    } catch (e) {
      console.error("Decoding failed", e);
      return null;
    }
  };

  // --- Initial Load ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encodedState = params.get('s');
    
    if (encodedState) {
      const decoded = decodeState(encodedState);
      if (decoded) {
        setFestival(decoded);
        if (decoded.acts.length > 0) {
          setSelectedDay(decoded.acts[0].day);
        }
        
        // Always prompt to join when using a shared link
        setIsJoining(true);
      }
    }
  }, []);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim() || !festival) return;
    localStorage.setItem('fest_user_name', userName);
    localStorage.setItem('fest_user_color', userColor);
    
    setFestival(prev => {
      if (!prev) return prev;
      const newUser = { user_id: userId, name: userName, color: userColor };
      const otherUsers = prev.users.filter(u => u.user_id !== userId);
      return {
        ...prev,
        users: [...otherUsers, newUser]
      };
    });
    
    setIsJoining(false);
  };

  // --- Handlers ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        const result = await extractScheduleFromImage(base64);
        
        const festivalId = Math.random().toString(36).substring(7);
        const newFestival: FestivalData = {
          id: festivalId,
          name: result.festivalName,
          acts: result.acts,
          votes: [],
          users: userName ? [{ user_id: userId, name: userName, color: userColor }] : [],
        };

        setFestival(newFestival);
        if (result.acts.length > 0) {
          setSelectedDay(result.acts[0].day);
        }
        
        if (!userName) {
          setIsJoining(true);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      alert("Failed to process image. Make sure it's a clear schedule.");
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleVote = (actId: string) => {
    if (!festival || !userName) {
      if (!userName) setIsJoining(true);
      return;
    }
    
    setFestival(prev => {
      if (!prev) return prev;
      const existingVote = prev.votes.find(v => v.act_id === actId && v.user_id === userId);
      let newVotes;
      if (existingVote) {
        newVotes = prev.votes.filter(v => !(v.act_id === actId && v.user_id === userId));
      } else {
        newVotes = [...prev.votes, { act_id: actId, user_id: userId }];
      }
      return { ...prev, votes: newVotes };
    });
  };

  const handleOptimize = async () => {
    if (!festival) return;
    setIsOptimizing(true);
    try {
      // Map votes to include color for optimization logic if needed
      const votesWithColor = festival.votes.map(v => {
        const user = festival.users.find(u => u.user_id === v.user_id);
        return { ...v, color: user?.color || '#000' };
      });
      const result = await optimizeSchedule(festival.acts, votesWithColor);
      setOptimalActIds(result);
    } catch (err) {
      console.error(err);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleShare = () => {
    if (!festival) return;
    const encoded = encodeState(festival);
    const url = `${window.location.origin}${window.location.pathname}?s=${encoded}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    
    // Also update current URL to reflect state
    window.history.pushState({}, '', `?s=${encoded}`);
  };

  // --- Helpers ---
  const days = Array.from(new Set(festival?.acts.map(a => a.day) || [])) as string[];
  const stages = Array.from(new Set(festival?.acts.map(a => a.stage) || [])) as string[];
  
  const getActsForDayAndStage = (day: string, stage: string) => {
    return festival?.acts.filter(a => a.day === day && a.stage === stage)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)) || [];
  };

  const getVotesForAct = (actId: string) => {
    return festival?.votes.filter(v => v.act_id === actId) || [];
  };

  const getUserById = (id: string) => {
    return festival?.users.find(u => u.user_id === id);
  };

  // --- Render ---
  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans">
      {/* Loading Overlay */}
      <AnimatePresence>
        {isProcessing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#E4E3E0]/90 backdrop-blur-xl"
          >
            <div className="text-center space-y-6">
              <div className="relative">
                <div className="w-24 h-24 border-4 border-[#141414]/10 rounded-full mx-auto" />
                <div className="absolute inset-0 w-24 h-24 border-4 border-[#141414] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
              <div className="space-y-2">
                <p className="text-2xl font-serif italic animate-pulse">{processingMessage}</p>
                <p className="text-[10px] font-mono uppercase opacity-40 tracking-widest">AI is analyzing your schedule</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!festival ? (
        <div className="min-h-screen flex flex-col items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md w-full text-center space-y-8"
          >
            <div className="space-y-2">
              <h1 className="text-5xl font-serif italic text-[#141414]">FestSync</h1>
              <p className="text-[#141414]/60 uppercase tracking-widest text-xs font-mono">AI Festival Optimizer</p>
            </div>

            <div className="relative group">
              <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-[#141414]/20 rounded-3xl cursor-pointer hover:border-[#141414] transition-all bg-white/50 backdrop-blur-sm">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-12 h-12 mb-4 text-[#141414]/40 group-hover:text-[#141414] transition-colors" />
                  <p className="mb-2 text-lg font-medium text-[#141414]">Upload Schedule Image</p>
                  <p className="text-xs text-[#141414]/40 font-mono">PNG, JPG or WEBP</p>
                </div>
                <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} disabled={isProcessing} />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-1 border-t border-[#141414]/10" />
              ))}
            </div>

            <div className="text-left space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-[#141414] text-white flex items-center justify-center text-xs font-mono">01</div>
                <p className="text-sm text-[#141414]/80">Upload a photo of the festival set times.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-[#141414] text-white flex items-center justify-center text-xs font-mono">02</div>
                <p className="text-sm text-[#141414]/80">Share the link with your group to vote on acts.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-[#141414] text-white flex items-center justify-center text-xs font-mono">03</div>
                <p className="text-sm text-[#141414]/80">Let AI resolve conflicts for the perfect run.</p>
              </div>
            </div>
          </motion.div>
        </div>
      ) : (
        <>
          {/* Join Modal */}
          <AnimatePresence>
            {isJoining && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#E4E3E0]/90 backdrop-blur-xl"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white p-8 rounded-[32px] shadow-2xl max-w-sm w-full space-y-8 border border-[#141414]/5"
            >
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-serif italic">Join the Group</h2>
                <p className="text-[10px] font-mono uppercase opacity-40">Set your profile to start voting</p>
              </div>

              <form onSubmit={handleJoinSubmit} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-mono uppercase opacity-40 ml-1">Your Name</label>
                  <input 
                    autoFocus
                    required
                    type="text" 
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Enter your name..."
                    className="w-full px-5 py-4 bg-[#E4E3E0]/30 rounded-2xl border border-transparent focus:border-[#141414]/10 focus:bg-white transition-all outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono uppercase opacity-40 ml-1">Pick a Color</label>
                  <div className="grid grid-cols-4 gap-3">
                    {COLORS.map(color => {
                      const isTaken = festival?.users.some(u => u.color === color);
                      return (
                        <button
                          key={color}
                          type="button"
                          disabled={isTaken}
                          onClick={() => setUserColor(color)}
                          className={cn(
                            "aspect-square rounded-full transition-all border-4 relative",
                            userColor === color ? "border-[#141414] scale-110" : "border-transparent scale-100",
                            isTaken && "opacity-20 cursor-not-allowed grayscale"
                          )}
                          style={{ backgroundColor: color }}
                        >
                          {isTaken && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-full h-[2px] bg-[#141414] rotate-45" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {festival?.users.some(u => u.color === userColor) && (
                    <p className="text-[8px] font-mono text-red-500 uppercase mt-1">This color is already taken!</p>
                  )}
                </div>

                <button 
                  type="submit"
                  className="w-full py-4 bg-[#141414] text-white rounded-2xl font-mono uppercase tracking-widest text-xs hover:bg-[#141414]/90 transition-all"
                >
                  Start Syncing
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#E4E3E0]/80 backdrop-blur-md border-b border-[#141414]/10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-serif italic">{festival.name}</h1>
            <div className="h-4 w-[1px] bg-[#141414]/20 hidden sm:block" />
            <button 
              onClick={() => setIsJoining(true)}
              className="hidden sm:flex items-center gap-2 hover:opacity-70 transition-opacity"
            >
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: userColor }} />
              <span className="text-[10px] font-mono uppercase opacity-50">{userName || 'Set Name'}</span>
            </button>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
            <button 
              onClick={handleShare}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-[#141414]/10 rounded-full text-[10px] font-mono uppercase tracking-widest hover:bg-[#141414]/5 transition-all"
            >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Share2 size={14} />}
              <span className="hidden xs:inline">{copied ? 'Copied!' : 'Share'}</span>
            </button>
            <button 
              onClick={handleOptimize}
              disabled={isOptimizing}
              className="flex items-center gap-2 px-4 py-2 bg-[#141414] text-white rounded-full text-[10px] font-mono uppercase tracking-widest hover:bg-[#141414]/90 transition-all disabled:opacity-50"
            >
              {isOptimizing ? (
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              {optimalActIds.length > 0 ? 'Re-Optimize' : 'Optimize Run'}
            </button>
            <button 
              onClick={() => {
                setFestival(null);
                window.history.pushState({}, '', window.location.pathname);
              }}
              className="p-2 hover:bg-[#141414]/5 rounded-full transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-8">
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
          <Share2 className="text-amber-600 shrink-0 mt-0.5" size={16} />
          <p className="text-[10px] font-mono text-amber-800 uppercase leading-relaxed">
            Note: This app is serverless. To share your votes with others, you must click <span className="font-bold">SHARE</span> to generate a new link after making changes.
          </p>
        </div>
        {/* User Legend */}
        <div className="flex flex-wrap gap-4 p-4 bg-white/30 rounded-2xl border border-[#141414]/5">
          <span className="text-[10px] font-mono uppercase opacity-40 w-full mb-1">Group Members</span>
          {festival.users.map(user => (
            <div key={user.user_id} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-[#141414]/5 shadow-sm">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: user.color }} />
              <span className="text-[10px] font-mono uppercase tracking-tight">{user.name}</span>
              {user.user_id === userId && <span className="text-[8px] font-mono opacity-30">(You)</span>}
            </div>
          ))}
          {festival.users.length === 0 && (
            <p className="text-[10px] font-mono opacity-30 italic">No one has joined yet...</p>
          )}
        </div>

        {/* Day Selector */}
        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          {days.map(day => (
            <button
              key={day}
              onClick={() => setSelectedDay(day)}
              className={cn(
                "px-6 py-2 rounded-full text-xs font-mono uppercase tracking-widest transition-all border border-[#141414]/10 whitespace-nowrap",
                selectedDay === day ? "bg-[#141414] text-white" : "bg-white/50 hover:bg-white"
              )}
            >
              {day}
            </button>
          ))}
        </div>

        {/* Schedule Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-start">
          {stages.map(stage => (
            <div key={stage} className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#141414] pb-2">
                <h3 className="font-serif italic text-lg truncate pr-2">{stage}</h3>
                <span className="text-[10px] font-mono opacity-40 uppercase shrink-0">Stage</span>
              </div>
              
              <div className="space-y-3">
                {getActsForDayAndStage(selectedDay!, stage).map(act => {
                  const votes = getVotesForAct(act.id);
                  const isOptimal = optimalActIds.includes(act.id);
                  const hasVoted = votes.some(v => v.user_id === userId);

                  return (
                    <motion.div
                      layout
                      key={act.id}
                      onClick={() => toggleVote(act.id)}
                      className={cn(
                        "group relative p-4 rounded-2xl border transition-all cursor-pointer",
                        isOptimal 
                          ? "bg-[#141414] text-white border-[#141414] shadow-xl scale-[1.02]" 
                          : "bg-white border-[#141414]/5 hover:border-[#141414]/20"
                      )}
                    >
                      {isOptimal && (
                        <div className="absolute -top-2 -right-2 bg-emerald-500 text-white p-1 rounded-full shadow-lg">
                          <Sparkles size={12} />
                        </div>
                      )}

                      <div className="flex justify-between items-start mb-2">
                        <span className={cn(
                          "text-[10px] font-mono uppercase tracking-tighter",
                          isOptimal ? "text-white/60" : "text-[#141414]/40"
                        )}>
                          {act.startTime} — {act.endTime}
                        </span>
                        <div className="flex -space-x-1">
                          {votes.map((v, i) => {
                            const user = getUserById(v.user_id);
                            return (
                              <div 
                                key={i} 
                                title={user?.name}
                                className="w-2.5 h-2.5 rounded-full border border-white shadow-sm" 
                                style={{ backgroundColor: user?.color || '#000' }} 
                              />
                            );
                          })}
                        </div>
                      </div>

                      <h4 className="font-medium text-sm mb-1 leading-tight">{act.name}</h4>
                      
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-1">
                          <Users size={10} className={isOptimal ? "text-white/40" : "text-[#141414]/20"} />
                          <span className={cn("text-[10px] font-mono", isOptimal ? "text-white/40" : "text-[#141414]/40")}>
                            {votes.length} Votes
                          </span>
                        </div>
                        {hasVoted && (
                          <div className="flex items-center gap-1">
                            <span className={cn("text-[8px] font-mono uppercase", isOptimal ? "text-white/40" : "text-[#141414]/40")}>You</span>
                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: userColor }} />
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Footer Info */}
      <footer className="max-w-7xl mx-auto p-6 border-t border-[#141414]/5 mt-12">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] font-mono uppercase tracking-widest opacity-40">
          <p>© 2026 FestSync AI</p>
          <div className="flex gap-6">
            <span>Serverless Mode</span>
            <span>Gemini 3.1 Pro Optimization</span>
          </div>
        </div>
      </footer>
      </>
    )}
    </div>
  );
}
