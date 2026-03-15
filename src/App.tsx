import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  BookOpen, 
  Settings as SettingsIcon, 
  Plus, 
  ChevronRight, 
  ChevronLeft,
  Clock, 
  CheckCircle2, 
  FileText,
  Trash2,
  Bell,
  ExternalLink,
  Edit2,
  Save,
  X,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Download,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { getAllBooks, saveBook, PDFBook, deleteBook, getAllSessions, StudySession, saveSession, AnnotationPath, Chapter } from './db';
import { parsePDFChapters } from './pdfService';
import * as pdfjsLib from 'pdfjs-dist';

// --- Components ---

const Card = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <div className={`glass-card p-6 ${className}`}>
    {children}
  </div>
);

const ProgressBar = ({ progress }: { progress: number }) => (
  <div className="w-full bg-bg-dim h-1.5 rounded-full overflow-hidden">
    <motion.div 
      initial={{ width: 0 }}
      animate={{ width: `${progress}%` }}
      className="bg-accent-dim h-full rounded-full"
    />
  </div>
);

// --- Main App ---

export default function App() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered');
      // Check for updates every 30 minutes
      if (r) {
        setInterval(() => {
          r.update();
        }, 30 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('SW registration error', error);
    },
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'books' | 'settings'>('dashboard');
  const [books, setBooks] = useState<PDFBook[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [selectedBook, setSelectedBook] = useState<PDFBook | null>(null);
  const [viewingPage, setViewingPage] = useState<number | null>(null);
  const [studyStartTime, setStudyStartTime] = useState<number | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [editingBookName, setEditingBookName] = useState("");
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editChapterTitle, setEditChapterTitle] = useState("");
  const [editStartPage, setEditStartPage] = useState<number>(1);
  const [editEndPage, setEditEndPage] = useState<number>(1);
  const [pdfZoom, setPdfZoom] = useState(1.5);
  const [showCompletionMessage, setShowCompletionMessage] = useState(false);
  const [isManualSegmenting, setIsManualSegmenting] = useState(false);
  const [manualChapters, setManualChapters] = useState<Chapter[]>([]);
  const [currentManualChapterName, setCurrentManualChapterName] = useState("");
  const [manualStartPage, setManualStartPage] = useState<number>(1);
  const [manualEndPage, setManualEndPage] = useState<number>(1);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    loadData();
    // Daily notification reminder logic
    const checkNotification = () => {
      if (!('Notification' in window)) return;
      
      const lastReminder = localStorage.getItem('lastStudyReminder');
      const today = new Date().toDateString();
      
      if (lastReminder !== today && window.Notification.permission === 'granted') {
        new window.Notification('Çalışma Vakti! 📚', {
          body: 'Bugünkü hedeflerine göz atmak ister misin?',
          icon: '/favicon.ico'
        });
        localStorage.setItem('lastStudyReminder', today);
      }
    };

    const interval = setInterval(checkNotification, 1000 * 60 * 60); // Check every hour
    checkNotification();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const startStudySession = (chapterId: string, pageNumber: number) => {
    // If we have a lastPage for this book, and it's within this chapter, use it
    let initialPage = pageNumber;
    if (selectedBook?.lastPage) {
      const chapter = selectedBook.chapters.find(c => c.id === chapterId);
      if (chapter && selectedBook.lastPage >= chapter.pageNumber && selectedBook.lastPage <= (chapter.endPage || chapter.pageNumber)) {
        initialPage = selectedBook.lastPage;
      }
    }
    setViewingPage(initialPage);
    setActiveChapterId(chapterId);
    setStudyStartTime(Date.now());
  };

  const endStudySession = async (markCompleted: boolean = false) => {
    if (studyStartTime && activeChapterId && selectedBook) {
      const duration = Math.round((Date.now() - studyStartTime) / (1000 * 60));
      
      const newSession: StudySession = {
        id: crypto.randomUUID(),
        bookId: selectedBook.id,
        chapterId: activeChapterId,
        durationMinutes: duration,
        timestamp: Date.now()
      };

      await saveSession(newSession);
      
      // Update chapter completion if requested
      const updatedChapters = selectedBook.chapters.map(c => 
        (c.id === activeChapterId && markCompleted) ? { ...c, isCompleted: true } : c
      );
      const updatedBook = { ...selectedBook, chapters: updatedChapters };
      await saveBook(updatedBook);
      
      // Update both books list and current selected book
      setSelectedBook(updatedBook);
      await loadData();
      
      setStudyStartTime(null);
      setActiveChapterId(null);
      setViewingPage(null);
    }
  };

  const loadData = async () => {
    const [loadedBooks, loadedSessions] = await Promise.all([
      getAllBooks(),
      getAllSessions()
    ]);
    setBooks(loadedBooks);
    setSessions(loadedSessions);
  };

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      await window.Notification.requestPermission();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadProgress(0);
    try {
      const arrayBuffer = await file.arrayBuffer();
      // Use a copy for parsing to avoid detaching the original buffer which needs to be saved to IndexedDB
      const chapters = await parsePDFChapters(arrayBuffer.slice(0), (progress) => {
        setUploadProgress(progress);
      });
      
      // Get total pages to calculate last chapter length
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
      const pdf = await loadingTask.promise;
      const totalPages = pdf.numPages;

      const newBook: PDFBook = {
        id: crypto.randomUUID(),
        name: file.name,
        data: arrayBuffer,
        chapters: chapters.map((c, idx) => {
          const nextPage = chapters[idx + 1]?.pageNumber || (totalPages + 1);
          const pageCount = nextPage - c.pageNumber;
          return {
            ...c,
            id: crypto.randomUUID(),
            isCompleted: false,
            endPage: nextPage - 1,
            estimatedMinutes: Math.max(5, pageCount * 2) // Estimate 2 mins per page, min 5 mins
          };
        }),
        addedAt: Date.now()
      };

      await saveBook(newBook);
      await loadData();
      
      // Removed automatic manual segmentation start
    } catch (error) {
      console.error("PDF upload error:", error);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const startManualSegmentation = () => {
    setIsManualSegmenting(true);
    setManualChapters([]);
    setCurrentManualChapterName("Bölüm 1");
    setManualStartPage(1);
    setManualEndPage(1);
    setViewingPage(1);
  };

  const addManualChapter = () => {
    if (!currentManualChapterName || manualEndPage < manualStartPage) return;
    
    const newChapter: Chapter = {
      id: crypto.randomUUID(),
      title: currentManualChapterName,
      pageNumber: manualStartPage,
      endPage: manualEndPage,
      isCompleted: false,
      estimatedMinutes: (manualEndPage - manualStartPage + 1) * 2
    };

    const updatedManualChapters = [...manualChapters, newChapter];
    setManualChapters(updatedManualChapters);
    
    // Set up for next chapter
    setCurrentManualChapterName(`Bölüm ${updatedManualChapters.length + 1}`);
    setManualStartPage(manualEndPage + 1);
    setManualEndPage(manualEndPage + 1);
    setViewingPage(manualEndPage + 1);
  };

  const finishManualSegmentation = async () => {
    if (!selectedBook) return;
    
    // Add the last chapter if it has a name and valid range
    let finalChapters = [...manualChapters];
    if (currentManualChapterName && manualEndPage >= manualStartPage) {
      finalChapters.push({
        id: crypto.randomUUID(),
        title: currentManualChapterName,
        pageNumber: manualStartPage,
        endPage: manualEndPage,
        isCompleted: false,
        estimatedMinutes: (manualEndPage - manualStartPage + 1) * 2
      });
    }

    if (finalChapters.length === 0) {
      setIsManualSegmenting(false);
      setViewingPage(null);
      return;
    }

    const updatedBook = { ...selectedBook, chapters: finalChapters };
    await saveBook(updatedBook);
    setSelectedBook(updatedBook);
    await loadData();
    setIsManualSegmenting(false);
    setViewingPage(null);
  };

  const handleDeleteBook = async (id: string) => {
    await deleteBook(id);
    await loadData();
  };

  const handleRenameBook = async (bookId: string) => {
    const book = books.find(b => b.id === bookId);
    if (book && editingBookName.trim()) {
      const updatedBook = { ...book, name: editingBookName.trim() };
      await saveBook(updatedBook);
      setEditingBookId(null);
      await loadData();
    }
  };

  const handleUpdateChapterRange = async (bookId: string, chapterId: string) => {
    const book = books.find(b => b.id === bookId);
    if (book) {
      const updatedChapters = book.chapters.map(c => 
        c.id === chapterId ? { 
          ...c, 
          title: editChapterTitle.trim() || c.title,
          pageNumber: editStartPage, 
          endPage: editEndPage, 
          estimatedMinutes: Math.max(5, (editEndPage - editStartPage + 1) * 2) 
        } : c
      );
      const updatedBook = { ...book, chapters: updatedChapters };
      await saveBook(updatedBook);
      setEditingChapterId(null);
      if (selectedBook?.id === bookId) {
        setSelectedBook(updatedBook);
      }
      await loadData();
    }
  };

  const handleNextPage = async () => {
    if (!selectedBook || !activeChapterId || viewingPage === null) return;
    
    const currentChapter = selectedBook.chapters.find(c => c.id === activeChapterId);
    if (currentChapter && viewingPage >= (currentChapter.endPage || currentChapter.pageNumber)) {
      // Already on last page, do nothing (user must click "Tamamla")
    } else {
      setViewingPage(viewingPage + 1);
    }
  };

  // --- Renderers ---

  const renderDashboard = () => {
    const totalChapters = books.reduce((acc, b) => acc + b.chapters.length, 0);
    const completedChapters = books.reduce((acc, b) => acc + b.chapters.filter(c => c.isCompleted).length, 0);
    const progress = totalChapters > 0 ? (completedChapters / totalChapters) * 100 : 0;
    const totalStudyMinutes = sessions.reduce((acc, s) => acc + s.durationMinutes, 0);

    return (
      <div className="flex flex-col h-full space-y-5">
        <header className="flex justify-between items-center shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-text-dim tracking-tight">StudyFlow</h1>
              {!isOnline && (
                <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest border border-amber-200">
                  Çevrimdışı
                </span>
              )}
            </div>
            <p className="text-text-dim/50 text-sm">Bugün neler öğreneceğiz?</p>
          </div>
          <button className="p-2.5 bg-surface-dim rounded-2xl shadow-sm border border-white/5 text-text-dim/70">
            <Bell size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          <Card className="bg-gradient-to-br from-accent-dim to-blue-600 text-white border-none relative overflow-hidden">
            <div className="absolute top-[-20%] right-[-10%] w-32 h-32 bg-white/20 blur-3xl rounded-full" />
            <div className="flex justify-between items-end mb-4 relative z-10">
              <div>
                <p className="text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">Genel İlerleme</p>
                <h2 className="text-4xl font-black mt-1">%{Math.round(progress)}</h2>
              </div>
              <div className="text-right">
                <p className="text-white/90 text-xs font-bold bg-black/10 px-3 py-1 rounded-full">{completedChapters}/{totalChapters} Bölüm</p>
              </div>
            </div>
            <div className="w-full bg-black/10 h-2 rounded-full overflow-hidden relative z-10">
              <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} className="bg-white h-full rounded-full shadow-[0_0_15px_rgba(255,255,255,0.3)]" />
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Card className="flex flex-col items-center justify-center py-6 border-white/5">
              <div className="w-12 h-12 bg-accent-dim/20 rounded-2xl flex items-center justify-center text-accent-dim mb-3 shadow-inner">
                <Clock size={24} />
              </div>
              <p className="text-text-dim/40 text-[10px] uppercase font-black tracking-widest">Çalışma</p>
              <p className="text-xl font-black text-text-dim mt-1">{Math.floor(totalStudyMinutes / 60)}s {totalStudyMinutes % 60}d</p>
            </Card>
            <Card className="flex flex-col items-center justify-center py-6 border-white/5">
              <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400 mb-3 shadow-inner">
                <BookOpen size={24} />
              </div>
              <p className="text-text-dim/40 text-[10px] uppercase font-black tracking-widest">Kitaplar</p>
              <p className="text-xl font-black text-text-dim mt-1">{books.length}</p>
            </Card>
          </div>

          <div>
            <h3 className="text-sm font-bold text-text-dim/40 uppercase tracking-widest mb-3">Devam Edenler</h3>
            <div className="space-y-2">
              {books.slice(0, 3).map(book => (
                <button 
                  key={book.id}
                  onClick={() => setSelectedBook(book)}
                  className="w-full flex items-center p-3.5 bg-surface-dim rounded-2xl border border-white/5 shadow-sm hover:border-accent-dim/30 transition-colors"
                >
                  <div className="w-9 h-9 bg-bg-dim rounded-xl flex items-center justify-center text-text-dim/30 mr-3">
                    <FileText size={18} />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-text-dim text-sm truncate max-w-[150px]">{book.name}</p>
                    <p className="text-[10px] text-text-dim/40 uppercase font-bold">{book.chapters.length} Bölüm</p>
                  </div>
                  <ChevronRight size={16} className="text-text-dim/20" />
                </button>
              ))}
              {books.length === 0 && (
                <p className="text-center py-6 text-text-dim/30 text-sm italic">Kitaplık boş.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderBooks = () => (
    <div className="flex flex-col h-full space-y-5">
      <div className="flex justify-between items-center shrink-0">
        <h1 className="text-2xl font-semibold text-text-dim">Kitaplığım</h1>
        <label className="cursor-pointer bg-gradient-to-br from-accent-dim to-blue-500 text-white p-3 rounded-2xl shadow-lg shadow-accent-dim/20 flex items-center gap-2 px-5 transition-all hover:scale-105 active:scale-95">
          <Plus size={20} />
          <span className="text-xs font-black uppercase tracking-widest">Yeni Kitap</span>
          <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {isUploading && (
          <div className="p-4 bg-accent-dim/10 text-accent-dim rounded-2xl text-center space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest animate-pulse">PDF İşleniyor... %{uploadProgress}</p>
            <div className="w-full h-1 bg-accent-dim/10 rounded-full overflow-hidden">
              <div 
                className="h-full bg-accent-dim transition-all duration-300" 
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {books.map(book => (
          <div key={book.id}>
            <Card className="relative group p-4">
              <div className="flex items-start justify-between">
                <div className="flex gap-3 cursor-pointer flex-1 min-w-0" onClick={() => !editingBookId && setSelectedBook(book)}>
                  <div className="w-12 h-16 bg-bg-dim rounded-xl flex items-center justify-center text-text-dim/20 shrink-0">
                    <FileText size={24} />
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingBookId === book.id ? (
                      <div className="flex items-center gap-2 mb-1">
                        <input 
                          autoFocus
                          className="bg-bg-dim border border-white/10 rounded-lg px-2 py-1 text-sm font-bold text-text-dim w-full focus:outline-none focus:border-accent-dim"
                          value={editingBookName}
                          onChange={(e) => setEditingBookName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleRenameBook(book.id)}
                        />
                        <button onClick={() => handleRenameBook(book.id)} className="text-accent-dim shrink-0"><Save size={16} /></button>
                        <button onClick={() => setEditingBookId(null)} className="text-text-dim/40 shrink-0"><X size={16} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group/title min-w-0">
                        <h3 className="font-bold text-text-dim text-sm mb-0.5 truncate">{book.name}</h3>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingBookId(book.id);
                            setEditingBookName(book.name);
                          }}
                          className="opacity-0 group-hover/title:opacity-100 p-1 text-text-dim/30 hover:text-accent-dim transition-all shrink-0"
                        >
                          <Edit2 size={12} />
                        </button>
                      </div>
                    )}
                    <p className="text-[10px] text-text-dim/40 uppercase font-bold mb-2">{book.chapters.length} Bölüm</p>
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 size={12} className="text-accent-dim" />
                      <span className="text-[10px] font-bold text-text-dim/60 uppercase">
                        %{Math.round((book.chapters.filter(c => c.isCompleted).length / book.chapters.length) * 100)} Tamam
                      </span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => handleDeleteBook(book.id)}
                  className="p-2 text-text-dim/10 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );

  // --- PDF Viewer Modal ---
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (viewingPage && selectedBook && pdfCanvasRef.current) {
      renderPDFPage(selectedBook.data, viewingPage);
      
      // Save last page
      if (selectedBook.lastPage !== viewingPage) {
        const updatedBook = { ...selectedBook, lastPage: viewingPage };
        saveBook(updatedBook).then(() => {
          setBooks(prev => prev.map(b => b.id === selectedBook.id ? updatedBook : b));
        });
      }
    }
  }, [viewingPage, selectedBook, pdfZoom]);

  const renderPDFPage = async (data: ArrayBuffer, pageNum: number) => {
    // Use a copy to prevent detaching the original buffer in state
    const loadingTask = pdfjsLib.getDocument({ data: data.slice(0) });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNum);
    
    const viewport = page.getViewport({ scale: pdfZoom });
    const canvas = pdfCanvasRef.current;
    if (!canvas) return;
    
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: context,
      viewport: viewport
    };
    await page.render(renderContext).promise;

    // Draw annotations
    if (selectedBook.annotations && selectedBook.annotations[pageNum]) {
      const pageAnnotations = selectedBook.annotations[pageNum];
      pageAnnotations.forEach(path => {
        context.beginPath();
        context.strokeStyle = path.color;
        context.lineWidth = path.width;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        if (path.type === 'highlighter') {
          context.globalAlpha = 0.3;
        } else {
          context.globalAlpha = 1.0;
        }
        
        path.points.forEach((p, i) => {
          if (i === 0) context.moveTo(p.x, p.y);
          else context.lineTo(p.x, p.y);
        });
        context.stroke();
      });
      context.globalAlpha = 1.0;
    }
  };

  const exportChapterAsPDF = async () => {
    if (!selectedBook || !activeChapterId) return;
    const chapter = selectedBook.chapters.find(c => c.id === activeChapterId);
    if (!chapter) return;

    const doc = new jsPDF();
    const loadingTask = pdfjsLib.getDocument({ data: selectedBook.data.slice(0) });
    const pdf = await loadingTask.promise;

    const start = chapter.pageNumber;
    const end = chapter.endPage || chapter.pageNumber;

    for (let i = start; i <= end; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      if (!context) continue;

      await page.render({ canvasContext: context, viewport }).promise;

      // Draw annotations on export too
      if (selectedBook.annotations && selectedBook.annotations[i]) {
        selectedBook.annotations[i].forEach(path => {
          context.beginPath();
          context.strokeStyle = path.color;
          context.lineWidth = path.width;
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.globalAlpha = path.type === 'highlighter' ? 0.3 : 1.0;
          path.points.forEach((p, idx) => {
            if (idx === 0) context.moveTo(p.x, p.y);
            else context.lineTo(p.x, p.y);
          });
          context.stroke();
        });
      }

      const imgData = canvas.toDataURL('image/jpeg', 0.8);
      if (i > start) doc.addPage([viewport.width, viewport.height], viewport.width > viewport.height ? 'l' : 'p');
      else {
        // First page, set initial size
        doc.deletePage(1);
        doc.addPage([viewport.width, viewport.height], viewport.width > viewport.height ? 'l' : 'p');
      }
      doc.addImage(imgData, 'JPEG', 0, 0, viewport.width, viewport.height);
    }

    doc.save(`${selectedBook.name.replace('.pdf', '')}_${chapter.title}.pdf`);
  };

  const renderPDFViewer = () => {
    if (!selectedBook) return null;

    const currentChapter = activeChapterId ? selectedBook.chapters.find(c => c.id === activeChapterId) : null;
    const isLastPage = currentChapter && viewingPage === (currentChapter.endPage || currentChapter.pageNumber);
    const totalChapterPages = currentChapter ? (currentChapter.endPage || currentChapter.pageNumber) - currentChapter.pageNumber + 1 : 0;
    const relativePage = currentChapter && viewingPage ? viewingPage - currentChapter.pageNumber + 1 : 0;

    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 z-50 bg-bg-dim flex flex-col max-w-[800px] mx-auto w-full shadow-2xl border-x border-white/5"
      >
        <header className="p-4 bg-surface-dim border-b border-white/5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button onClick={async () => {
                if (viewingPage) await endStudySession(false);
                else setSelectedBook(null);
              }} className="bg-surface-dim border border-white/5 text-text-dim/60 px-4 py-1.5 rounded-full font-bold text-[10px] uppercase tracking-widest hover:text-accent-dim transition-colors">
                Geri Dön
              </button>
              {isLastPage && (
                <button onClick={async () => {
                  setShowCompletionMessage(true);
                  setTimeout(async () => {
                    setShowCompletionMessage(false);
                    await endStudySession(true);
                  }, 2000);
                }} className="bg-emerald-500 text-white px-4 py-1.5 rounded-full font-bold text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20">
                  Tamamla
                </button>
              )}
            </div>

            {viewingPage && (
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setViewingPage(Math.max(1, viewingPage - 1))}
                  className="p-1.5 bg-bg-dim rounded-lg text-text-dim/40 hover:text-accent-dim transition-colors"
                >
                  <ChevronLeftIcon size={16} />
                </button>
                <div className="bg-accent-dim/10 text-accent-dim px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest">
                  {relativePage}/{totalChapterPages}
                </div>
                <button 
                  onClick={handleNextPage}
                  className="p-1.5 bg-bg-dim rounded-lg text-text-dim/40 hover:text-accent-dim transition-colors"
                >
                  <ChevronRightIcon size={16} />
                </button>
              </div>
            )}

            <div className="flex items-center gap-2">
              {viewingPage && (
                <div className="flex items-center bg-bg-dim rounded-xl p-1 border border-white/5 mr-2">
                  <button 
                    onClick={() => setPdfZoom(prev => Math.max(0.5, prev - 0.25))}
                    className="p-1.5 text-text-dim/40 hover:text-accent-dim transition-colors"
                  >
                    <ZoomOut size={14} />
                  </button>
                  <span className="text-[10px] font-bold text-text-dim/60 w-10 text-center">%{Math.round(pdfZoom * 100)}</span>
                  <button 
                    onClick={() => setPdfZoom(prev => Math.min(3, prev + 0.25))}
                    className="p-1.5 text-text-dim/40 hover:text-accent-dim transition-colors"
                  >
                    <ZoomIn size={14} />
                  </button>
                </div>
              )}
              {!viewingPage && !isManualSegmenting && (
                <button 
                  onClick={startManualSegmentation}
                  className="bg-accent-dim/10 text-accent-dim px-4 py-1.5 rounded-full font-bold text-[10px] uppercase tracking-widest hover:bg-accent-dim/20 transition-colors mr-2"
                >
                  Bölümleri Düzenle
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {isManualSegmenting ? (
            <div className="flex flex-col items-center gap-4 max-w-2xl mx-auto w-full">
              <Card className="w-full space-y-4 border border-accent-dim/30">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-accent-dim">Bölüm Tanımlama</h3>
                  <div className="text-[10px] font-bold text-text-dim/40 uppercase tracking-widest">
                    Tanımlanan: {manualChapters.length} Bölüm
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-text-dim/40 uppercase tracking-widest">Bölüm Adı</label>
                    <input 
                      type="text" 
                      value={currentManualChapterName}
                      onChange={(e) => setCurrentManualChapterName(e.target.value)}
                      className="w-full bg-bg-dim border border-white/10 rounded-xl px-4 py-2 text-sm font-medium focus:border-accent-dim/50 outline-none transition-colors"
                      placeholder="Bölüm Adı..."
                    />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] font-bold text-text-dim/40 uppercase tracking-widest">Başlangıç</label>
                      <div className="bg-bg-dim border border-white/10 rounded-xl px-4 py-2 text-sm font-medium text-text-dim/60">
                        {manualStartPage}
                      </div>
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] font-bold text-text-dim/40 uppercase tracking-widest">Bitiş</label>
                      <div className="bg-bg-dim border border-white/10 rounded-xl px-4 py-2 text-sm font-medium text-text-dim/60">
                        {manualEndPage}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={() => setManualEndPage(viewingPage || 1)}
                    className="flex-1 bg-surface-dim border border-white/5 text-text-dim/80 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-white/5 transition-colors"
                  >
                    Şu Anki Sayfayı Bitiş Yap
                  </button>
                  <button 
                    onClick={addManualChapter}
                    className="flex-1 bg-accent-dim text-white py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-accent-dim/90 transition-colors shadow-lg shadow-accent-dim/20"
                  >
                    Sonraki Bölüm
                  </button>
                  <button 
                    onClick={finishManualSegmentation}
                    className="flex-1 bg-emerald-500 text-white py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20"
                  >
                    Bitir
                  </button>
                </div>
              </Card>

              <div className="flex items-center justify-between w-full">
                <button 
                  onClick={() => setViewingPage(Math.max(1, (viewingPage || 1) - 1))}
                  className="p-2 bg-surface-dim rounded-xl text-text-dim/40 hover:text-accent-dim transition-colors"
                >
                  <ChevronLeftIcon size={20} />
                </button>
                <div className="bg-accent-dim/10 text-accent-dim px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest">
                  Sayfa {viewingPage}
                </div>
                <button 
                  onClick={() => setViewingPage((viewingPage || 1) + 1)}
                  className="p-2 bg-surface-dim rounded-xl text-text-dim/40 hover:text-accent-dim transition-colors"
                >
                  <ChevronRightIcon size={20} />
                </button>
              </div>

              <div className="flex justify-center bg-surface-dim p-1.5 rounded-2xl overflow-hidden w-full shadow-2xl relative">
                <canvas 
                  ref={pdfCanvasRef} 
                  className="max-w-full rounded-xl grayscale-[0.2] sepia-[0.1]"
                />
              </div>
            </div>
          ) : viewingPage ? (
            <div className="flex flex-col items-center gap-4 max-w-2xl mx-auto w-full">
              <AnimatePresence>
                {showCompletionMessage && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="bg-emerald-500 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-emerald-500/20 z-50"
                  >
                    Bölümü Tamamladınız! 🎉
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex justify-center bg-surface-dim p-1.5 rounded-2xl overflow-hidden w-full shadow-2xl relative">
                <canvas 
                  ref={pdfCanvasRef} 
                  className="max-w-full rounded-xl grayscale-[0.2] sepia-[0.1]"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="mb-6">
                <p className="text-[10px] font-bold text-accent-dim uppercase tracking-[0.2em] mb-1">Seçili Kitap</p>
                <h2 className="text-xl font-bold text-text-dim leading-tight break-words">{selectedBook.name}</h2>
              </div>
              <h3 className="text-[10px] font-bold text-text-dim/40 uppercase tracking-widest mb-2">Bölümler</h3>
              {selectedBook.chapters.map((chapter, idx) => (
                <div key={chapter.id} className="group relative">
                  {editingChapterId === chapter.id ? (
                    <div className="w-full p-4 bg-surface-dim rounded-2xl border border-accent-dim/30 shadow-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase text-text-dim/40">Bölüm Düzenle</span>
                        <div className="flex gap-2">
                          <button onClick={() => handleUpdateChapterRange(selectedBook.id, chapter.id)} className="text-accent-dim"><Save size={16} /></button>
                          <button onClick={() => setEditingChapterId(null)} className="text-text-dim/40"><X size={16} /></button>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase text-text-dim/40 mb-1">Bölüm Adı</p>
                          <input 
                            type="text"
                            className="bg-bg-dim border border-white/10 rounded-lg px-2 py-1.5 text-sm font-bold text-text-dim w-full"
                            value={editChapterTitle}
                            onChange={(e) => setEditChapterTitle(e.target.value)}
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <p className="text-[10px] font-bold uppercase text-text-dim/40 mb-1">Başlangıç</p>
                            <input 
                              type="number"
                              className="bg-bg-dim border border-white/10 rounded-lg px-2 py-1.5 text-sm font-bold text-text-dim w-full"
                              value={editStartPage}
                              onChange={(e) => setEditStartPage(parseInt(e.target.value))}
                            />
                          </div>
                          <div className="flex-1">
                            <p className="text-[10px] font-bold uppercase text-text-dim/40 mb-1">Bitiş</p>
                            <input 
                              type="number"
                              className="bg-bg-dim border border-white/10 rounded-lg px-2 py-1.5 text-sm font-bold text-text-dim w-full"
                              value={editEndPage}
                              onChange={(e) => setEditEndPage(parseInt(e.target.value))}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => startStudySession(chapter.id, chapter.pageNumber)}
                        className="flex-1 flex items-center p-4 bg-surface-dim rounded-2xl border border-white/5 shadow-sm text-left transition-transform active:scale-[0.98]"
                      >
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center mr-3 transition-colors ${chapter.isCompleted ? 'bg-emerald-500 text-white' : 'bg-bg-dim text-text-dim/20'}`}>
                          {chapter.isCompleted ? <CheckCircle2 size={16} /> : <span className="text-xs font-bold">{idx + 1}</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-text-dim text-sm break-words">{chapter.title}</p>
                          <p className="text-[10px] text-text-dim/40 font-bold uppercase">
                            Sayfa {chapter.pageNumber} - {chapter.endPage || (selectedBook.chapters[idx + 1] ? selectedBook.chapters[idx + 1].pageNumber - 1 : '?')} • {chapter.estimatedMinutes} dk
                          </p>
                        </div>
                        <ChevronRight size={16} className="text-text-dim/10" />
                      </button>
                      <button 
                        onClick={() => {
                          setEditingChapterId(chapter.id);
                          setEditChapterTitle(chapter.title);
                          setEditStartPage(chapter.pageNumber);
                          setEditEndPage(chapter.endPage || chapter.pageNumber);
                        }}
                        className="p-3 bg-surface-dim rounded-2xl border border-white/5 text-text-dim/20 hover:text-accent-dim transition-colors"
                      >
                        <Edit2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <div className="h-[100dvh] bg-bg-dim text-text-dim flex flex-col overflow-hidden font-sans selection:bg-accent-dim/30 relative">
      {/* Background Glows */}
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent-dim/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/10 blur-[120px] rounded-full pointer-events-none" />

      <main className="flex-1 overflow-hidden p-6 max-w-[800px] mx-auto w-full relative z-10">
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'books' && renderBooks()}
        {activeTab === 'settings' && (
          <div className="flex flex-col h-full space-y-5">
            <h1 className="text-2xl font-semibold text-text-dim">Hakkında</h1>
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <Card className="space-y-4">
                <h3 className="text-sm font-bold text-text-dim/80">Uygulama Hakkında</h3>
                <p className="text-xs text-text-dim/60 leading-relaxed">
                  StudyFlow, PDF tabanlı ders kitaplarınızı akıllı bölümlere ayırarak çalışma verimliliğinizi artıran bir asistan uygulamadır. 
                  Her bölüm için tahmini çalışma süresi hesaplar ve ilerlemenizi gerçek zamanlı olarak takip eder.
                </p>
                <div className="pt-2 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-text-dim/70">
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    <span>Otomatik Bölüm Tespiti</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-dim/70">
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    <span>Çalışma Süresi Analizi</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-dim/70">
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    <span>Cihaz İçi Güvenli Depolama</span>
                  </div>
                </div>
              </Card>

              <Card className="space-y-4">
                <h3 className="text-sm font-bold text-text-dim/80">Önemli Notlar</h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-bold text-text-dim/40 uppercase tracking-widest mb-1">Arka Plan İşlemleri</p>
                    <p className="text-xs text-text-dim/60 leading-relaxed">
                      Tarayıcılar, enerji tasarrufu için arka plandaki sekmelerin işlemci kullanımını kısıtlar. 
                      PDF analizi sırasında sekme değiştirirseniz işlem duraklayabilir. En hızlı sonuç için analiz bitene kadar sekmeyi aktif tutmanızı öneririz.
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-text-dim/40 uppercase tracking-widest mb-1">Veri Saklama</p>
                    <p className="text-xs text-text-dim/60 leading-relaxed">Tüm verileriniz cihazınızda (IndexedDB) saklanır. Uygulama silinmediği sürece verileriniz güvendedir.</p>
                  </div>
                </div>
              </Card>

              <Card className="mt-auto">
                <div className="flex flex-col gap-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-bold text-text-dim/40 uppercase tracking-widest mb-1">Versiyon</p>
                      <p className="text-sm font-medium">Study Flow v1.4.1</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-text-dim/40 uppercase tracking-widest mb-1">Durum</p>
                      <p className={`text-xs font-bold uppercase tracking-widest ${needRefresh ? 'text-orange-500 animate-pulse' : 'text-emerald-500'}`}>
                        {needRefresh ? 'Güncelleme Hazır' : 'Güncel'}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={async () => {
                      if (needRefresh) {
                        updateServiceWorker(true);
                      } else {
                        // Manual check
                        if ('serviceWorker' in navigator) {
                          const registration = await navigator.serviceWorker.getRegistration();
                          if (registration) {
                            await registration.update();
                            // If after update check needRefresh is still false, it's up to date
                            setTimeout(() => {
                              if (!needRefresh) {
                                alert('Uygulama güncel! En son sürümü (v1.4.1) kullanıyorsunuz.');
                              }
                            }, 1000);
                          } else {
                            alert('Uygulama güncel!');
                          }
                        }
                      }
                    }}
                    className={`w-full text-[10px] font-bold uppercase tracking-widest py-3 rounded-xl transition-all ${needRefresh ? 'bg-accent-dim text-white shadow-lg shadow-accent-dim/20' : 'text-accent-dim border border-accent-dim/30 hover:bg-accent-dim/10'}`}
                  >
                    {needRefresh ? 'Şimdi Güncelle ve Yeniden Başlat' : 'Güncellemeleri Kontrol Et'}
                  </button>
                </div>
              </Card>
            </div>
          </div>
        )}
      </main>

      <AnimatePresence>
        {selectedBook && renderPDFViewer()}
      </AnimatePresence>

      {/* Navigation Bar */}
      {!selectedBook && (
        <div className="p-6 pt-0 shrink-0 max-w-[800px] mx-auto w-full relative z-50">
          <nav className="glass rounded-[2.5rem] p-2 flex justify-around items-center shadow-2xl border-white/10">
            {[
              { id: 'dashboard', icon: LayoutDashboard, label: 'Panel' },
              { id: 'books', icon: BookOpen, label: 'Kitaplar' },
              { id: 'settings', icon: SettingsIcon, label: 'Hakkında' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex flex-col items-center py-3 px-8 rounded-[2rem] transition-all duration-500 relative ${activeTab === tab.id ? 'text-white' : 'text-text-dim/30 hover:text-text-dim/60'}`}
              >
                {activeTab === tab.id && (
                  <motion.div 
                    layoutId="activeTab"
                    className="absolute inset-0 bg-gradient-to-br from-accent-dim to-blue-600 rounded-[2rem] shadow-lg shadow-accent-dim/20"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <div className="relative z-10 flex flex-col items-center">
                  <tab.icon size={20} />
                  <span className="text-[10px] mt-1 font-black uppercase tracking-wider">{tab.label}</span>
                </div>
              </button>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
