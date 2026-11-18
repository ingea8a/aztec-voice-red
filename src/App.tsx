import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Download,
  HelpCircle,
  Home,
  Info,
  Keyboard,
  Mic,
  MicOff,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Users,
  Volume2,
  BookMarked,
} from 'lucide-react';

declare global {
  interface Window {
    voice8aDesktop?: {
      isElectron?: boolean;
      onToggleDictation: (cb: () => void) => () => void;
      getShortcutStatus: () => Promise<{ ok: boolean; shortcut: string }>;
      setShortcut: (acc: string) => Promise<{ ok: boolean; shortcut: string; error?: string }>;
      transcribeWav: (
        wavBuffer: ArrayBuffer,
        lang: string
      ) => Promise<{ ok: boolean; text?: string; error?: string }>;
    };
  }
}

type SectionId =
  | 'home'
  | 'meetings'
  | 'dictionary'
  | 'settings'
  | 'instructions'
  | 'about'
  | 'help';

type RedTheme = 'carmesi' | 'rubi' | 'terracota';

interface HistoryEntry {
  id: string;
  type: 'transcription' | 'writing';
  text: string;
  timestamp: string;
  durationSec: number;
  language: string;
  audioUrl?: string;
}

interface DictionaryEntry {
  id: string;
  term: string;
  replacement: string;
  note: string;
}

interface MeetingNote {
  id: string;
  speaker: string;
  time: string;
  text: string;
}

const INITIAL_HISTORY: HistoryEntry[] = [
  {
    id: 'h-1',
    type: 'transcription',
    text: 'Enviar la propuesta actualizada al equipo de producto antes de las cuatro de la tarde con el nuevo presupuesto.',
    timestamp: 'Hoy, 11:42',
    durationSec: 6,
    language: 'es',
  },
  {
    id: 'h-2',
    type: 'transcription',
    text: 'Recordatorio: revisar el PR de autenticación y validar las variables de entorno en staging.',
    timestamp: 'Hoy, 10:15',
    durationSec: 5,
    language: 'es',
  },
  {
    id: 'h-3',
    type: 'writing',
    text: 'Resumen de captura: arquitectura modular con Electron + React + Voz.',
    timestamp: 'Ayer, 18:30',
    durationSec: 4,
    language: 'es',
  },
];

const INITIAL_DICTIONARY: DictionaryEntry[] = [
  { id: 'd-1', term: 'Voice8a', replacement: 'Voice8a', note: 'Nombre de producto' },
  { id: 'd-2', term: 'Whisper', replacement: 'Whisper Large v3', note: 'Modelo de voz' },
];

const INITIAL_MEETING: MeetingNote[] = [
  {
    id: 'm-1',
    speaker: 'Participante 1',
    time: '00:12',
    text: 'Revisamos el estado del lanzamiento v1.9.5 y la nueva paleta rojiza.',
  },
];

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const targetRate = 16000;
  const ratio = sampleRate / targetRate;
  const newLength = Math.max(1, Math.floor(samples.length / ratio));
  const buffer = new ArrayBuffer(44 + newLength * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + newLength * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, newLength * 2, true);

  let offset = 44;
  for (let i = 0; i < newLength; i++) {
    const idx = Math.min(samples.length - 1, Math.floor(i * ratio));
    const s = Math.max(-1, Math.min(1, samples[idx]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function keyEventToAccelerator(e: KeyboardEvent): string | null {
  const ignored = ['Control', 'Shift', 'Alt', 'Meta'];
  if (ignored.includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let key = e.key;
  if (e.code === 'Space' || key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

function formatAcceleratorLabel(acc: string): string {
  return acc.replace('CommandOrControl', 'Ctrl').replace(/\+/g, ' + ');
}

export function App() {
  const [section, setSection] = useState<SectionId>('home');
  const [redTheme, setRedTheme] = useState<RedTheme>('carmesi');

  // Dictation state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [micLevels, setMicLevels] = useState<number[]>([8, 8, 8, 8, 8, 8, 8, 8, 8, 8]);
  const [localModelEnabled, setLocalModelEnabled] = useState(true);
  const [chimeEnabled, setChimeEnabled] = useState(true);
  const [selectedLang, setSelectedLang] = useState('es');
  const [postProcess, setPostProcess] = useState(true);

  // Global shortcut state
  const [shortcut, setShortcut] = useState(() => {
    return localStorage.getItem('voice8a_shortcut') || 'CommandOrControl+Space';
  });
  const [shortcutOk, setShortcutOk] = useState(true);
  const [capturingShortcut, setCapturingShortcut] = useState(false);
  const [shortcutTestHit, setShortcutTestHit] = useState(false);

  // Optional Whisper API key (Groq or OpenAI)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('voice8a_apikey') || '');
  const [apiProvider, setApiProvider] = useState<'groq' | 'openai'>(
    () => (localStorage.getItem('voice8a_provider') as 'groq' | 'openai') || 'groq'
  );

  // History
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('voice8a_history');
      return saved ? JSON.parse(saved) : INITIAL_HISTORY;
    } catch {
      return INITIAL_HISTORY;
    }
  });
  const [historyTab, setHistoryTab] = useState<'transcription' | 'writing'>('transcription');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Dictionary
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('voice8a_dict');
      return saved ? JSON.parse(saved) : INITIAL_DICTIONARY;
    } catch {
      return INITIAL_DICTIONARY;
    }
  });
  const [newTerm, setNewTerm] = useState('');
  const [newReplacement, setNewReplacement] = useState('');
  const [newNote, setNewNote] = useState('');

  // Meetings
  const [meetingActive, setMeetingActive] = useState(false);
  const [meetingSeconds, setMeetingSeconds] = useState(0);
  const [meetingNotes, setMeetingNotes] = useState<MeetingNote[]>(INITIAL_MEETING);
  const [meetingInput, setMeetingInput] = useState('');

  // Audio recording refs
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef<number>(44100);
  const recordStartRef = useRef<number>(0);

  const toggleDictationRef = useRef<() => void>(() => {});

  useEffect(() => {
    document.documentElement.setAttribute('data-red-theme', redTheme);
  }, [redTheme]);

  useEffect(() => {
    try {
      localStorage.setItem('voice8a_history', JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem('voice8a_dict', JSON.stringify(dictionary));
    } catch {
      // ignore
    }
  }, [dictionary]);

  useEffect(() => {
    localStorage.setItem('voice8a_apikey', apiKey);
    localStorage.setItem('voice8a_provider', apiProvider);
  }, [apiKey, apiProvider]);

  // Sync shortcut with Electron main process on boot
  useEffect(() => {
    if (window.voice8aDesktop?.setShortcut) {
      window.voice8aDesktop.setShortcut(shortcut).then((res) => {
        setShortcutOk(res.ok);
      });
    }
  }, []);

  // Subscribe to Electron global shortcut IPC
  useEffect(() => {
    if (!window.voice8aDesktop?.onToggleDictation) return;
    const unsub = window.voice8aDesktop.onToggleDictation(() => {
      setShortcutTestHit(true);
      setTimeout(() => setShortcutTestHit(false), 1800);
      toggleDictationRef.current();
    });
    return unsub;
  }, []);

  // Browser fallback shortcut (only when NOT in Electron, to avoid double-triggering)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (capturingShortcut) {
        e.preventDefault();
        const acc = keyEventToAccelerator(e);
        if (!acc) return;
        setCapturingShortcut(false);
        setShortcut(acc);
        localStorage.setItem('voice8a_shortcut', acc);
        if (window.voice8aDesktop?.setShortcut) {
          window.voice8aDesktop.setShortcut(acc).then((res) => setShortcutOk(res.ok));
        }
        return;
      }

      if (!window.voice8aDesktop?.isElectron) {
        const acc = keyEventToAccelerator(e);
        if (acc && acc.toLowerCase() === shortcut.toLowerCase()) {
          e.preventDefault();
          setShortcutTestHit(true);
          setTimeout(() => setShortcutTestHit(false), 1800);
          toggleDictationRef.current();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [capturingShortcut, shortcut]);

  // Meeting timer
  useEffect(() => {
    if (!meetingActive) return;
    const timer = setInterval(() => setMeetingSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [meetingActive]);

  const playChime = (freq: number) => {
    if (!chimeEnabled) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      // ignore
    }
  };

  const applyDictionary = (raw: string) => {
    let out = raw;
    for (const item of dictionary) {
      if (item.term.trim() && item.replacement.trim()) {
        const escaped = item.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), item.replacement);
      }
    }
    if (postProcess && out.length > 0) {
      out = out.charAt(0).toUpperCase() + out.slice(1);
    }
    return out;
  };

  const startDictation = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;
      chunksRef.current = [];

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(input));
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);
        const h = Math.min(32, Math.max(6, Math.round(rms * 240)));
        setMicLevels((prev) => [...prev.slice(1), h]);
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      recordStartRef.current = Date.now();
      setIsRecording(true);
      setLiveText('Grabando audio del micrófono... habla ahora y vuelve a presionar para transcribir.');
      playChime(580);
    } catch (err) {
      setLiveText(`No se pudo acceder al micrófono: ${String(err)}`);
    }
  };

  const stopDictation = async () => {
    setIsRecording(false);
    setMicLevels([8, 8, 8, 8, 8, 8, 8, 8, 8, 8]);
    playChime(420);

    try {
      processorRef.current?.disconnect();
      audioCtxRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }

    const totalLen = chunksRef.current.reduce((acc, c) => acc + c.length, 0);
    if (totalLen === 0) {
      setLiveText('No se capturó audio. Intenta hablar más cerca del micrófono.');
      return;
    }

    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunksRef.current) {
      merged.set(c, offset);
      offset += c.length;
    }

    const wavBuffer = encodeWav(merged, sampleRateRef.current);
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    const audioUrl = URL.createObjectURL(wavBlob);
    const duration = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));

    setIsTranscribing(true);
    setLiveText('Transcribiendo audio...');

    let transcribed = '';

    // 1. If user provided Groq or OpenAI API Key, use Whisper API
    if (apiKey.trim()) {
      try {
        const endpoint =
          apiProvider === 'groq'
            ? 'https://api.groq.com/openai/v1/audio/transcriptions'
            : 'https://api.openai.com/v1/audio/transcriptions';
        const model = apiProvider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';
        const form = new FormData();
        form.append('file', wavBlob, 'audio.wav');
        form.append('model', model);
        if (selectedLang !== 'auto') form.append('language', selectedLang);

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey.trim()}` },
          body: form,
        });
        if (resp.ok) {
          const data = await resp.json();
          transcribed = (data.text || '').trim();
        }
      } catch {
        // fallback to Windows local speech below
      }
    }

    // 2. Otherwise try Windows local System.Speech via Electron IPC
    if (!transcribed && window.voice8aDesktop?.transcribeWav) {
      const res = await window.voice8aDesktop.transcribeWav(wavBuffer, selectedLang);
      if (res.ok && res.text) {
        transcribed = res.text;
      }
    }

    setIsTranscribing(false);

    const finalText = transcribed
      ? applyDictionary(transcribed)
      : 'Audio grabado correctamente (para transcripción automática en Windows configura el reconocimiento de voz de Windows o agrega tu API key gratuita de Groq en Configuración).';

    setLiveText(finalText);

    const entry: HistoryEntry = {
      id: `h-${Date.now()}`,
      type: 'transcription',
      text: finalText,
      timestamp: 'Ahora mismo',
      durationSec: duration,
      language: selectedLang === 'auto' ? 'es' : selectedLang,
      audioUrl,
    };
    setHistory((prev) => [entry, ...prev.slice(0, 19)]);
  };

  toggleDictationRef.current = () => {
    if (isRecording) stopDictation();
    else if (!isTranscribing) startDictation();
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const deleteHistory = (id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
  };

  const addDictionaryEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTerm.trim()) return;
    setDictionary((prev) => [
      {
        id: `d-${Date.now()}`,
        term: newTerm.trim(),
        replacement: newReplacement.trim() || newTerm.trim(),
        note: newNote.trim() || 'Personalizado',
      },
      ...prev,
    ]);
    setNewTerm('');
    setNewReplacement('');
    setNewNote('');
  };

  const addMeetingNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingInput.trim()) return;
    const mins = String(Math.floor(meetingSeconds / 60)).padStart(2, '0');
    const secs = String(meetingSeconds % 60).padStart(2, '0');
    setMeetingNotes((prev) => [
      ...prev,
      {
        id: `m-${Date.now()}`,
        speaker: 'Tú',
        time: `${mins}:${secs}`,
        text: applyDictionary(meetingInput.trim()),
      },
    ]);
    setMeetingInput('');
  };

  const exportMeetingMarkdown = () => {
    const md = [
      '# Transcripción de Reunión — Voice8a',
      '',
      ...meetingNotes.map((n) => `- **[${n.time}] ${n.speaker}:** ${n.text}`),
    ].join('\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcripcion.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredHistory = history.filter(
    (h) =>
      h.type === historyTab &&
      h.text.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  const navItems: { id: SectionId; label: string; icon: typeof Home }[] = [
    { id: 'home', label: 'Inicio', icon: Home },
    { id: 'meetings', label: 'Reuniones', icon: Users },
    { id: 'dictionary', label: 'Diccionario', icon: BookMarked },
    { id: 'settings', label: 'Configuración', icon: Settings },
    { id: 'instructions', label: 'Instrucciones', icon: BookOpen },
    { id: 'about', label: 'Acerca de', icon: Info },
    { id: 'help', label: 'Ayuda', icon: HelpCircle },
  ];

  const totalWords = history.reduce(
    (acc, item) => acc + item.text.trim().split(/\s+/).filter(Boolean).length,
    0
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-header">
          <div className="brand-logo-wrap">
            <img
              src="./assets/voice8a_logo_icon.png"
              alt="Voice8a"
              className="brand-logo-img"
            />
          </div>
          <div>
            <div className="brand-title">Voice8a</div>
            <div className="brand-sub">Edición Roja · v1.9.5</div>
          </div>
        </div>

        <nav className="nav-list" aria-label="Navegación principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-btn ${section === item.id ? 'active' : ''}`}
                onClick={() => setSection(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="shortcut-pill">
            <span>Atajo global</span>
            <span className="kbd">{formatAcceleratorLabel(shortcut)}</span>
          </div>
          {!shortcutOk && (
            <div style={{ fontSize: 11, color: '#fda4af', marginTop: 6, paddingInline: 4 }}>
              Atajo ocupado en Windows. Cámbialo en Configuración.
            </div>
          )}
        </div>
      </aside>

      <main className="main-content">
        {section === 'home' && (
          <>
            <header className="page-header">
              <div>
                <h1 className="page-title">Inicio</h1>
                <p className="page-desc">
                  Convierte tu voz en texto al instante con el micrófono de tu PC.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSection('settings')}
              >
                <Settings size={15} />
                Atajo y ajustes
              </button>
            </header>

            <section className="hero-recorder">
              <div className="hero-top">
                <div className="status-badge">
                  <span className={`status-dot ${isRecording ? 'recording' : ''}`} />
                  <span>
                    {isRecording
                      ? 'Grabando micrófono...'
                      : isTranscribing
                        ? 'Transcribiendo...'
                        : apiKey.trim()
                          ? `Whisper (${apiProvider.toUpperCase()}) listo`
                          : 'Motor local de Windows listo'}
                  </span>
                </div>

                <div className="waveform" aria-hidden="true">
                  {micLevels.map((h, i) => (
                    <span
                      key={i}
                      className={`wave-bar ${isRecording ? 'active' : ''}`}
                      style={{ height: `${isRecording ? h : 8}px` }}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={isTranscribing}
                  onClick={() => toggleDictationRef.current()}
                >
                  {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
                  {isRecording ? 'Detener y transcribir' : 'Iniciar dictado'}
                </button>
              </div>

              <div
                style={{
                  background: 'rgba(0,0,0,0.22)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  fontSize: 14,
                  color: '#ffe4e6',
                  minHeight: 48,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <span>
                  {liveText ||
                    `Presiona "Iniciar dictado" o ${formatAcceleratorLabel(shortcut)} para grabar tu voz.`}
                </span>
                {liveText && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ color: '#fecdd3', flexShrink: 0 }}
                    onClick={() => copyText('live', liveText)}
                  >
                    {copiedId === 'live' ? <Check size={14} /> : <Copy size={14} />}
                    {copiedId === 'live' ? 'Copiado' : 'Copiar'}
                  </button>
                )}
              </div>
            </section>

            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Transcripciones guardadas</div>
                <div className="stat-value">{history.length}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Palabras procesadas</div>
                <div className="stat-value">{totalWords}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Términos en diccionario</div>
                <div className="stat-value">{dictionary.length}</div>
              </div>
            </div>

            <section id="work-history" style={{ marginTop: 32 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--brand-dark)' }}>
                    Historial
                  </h2>
                  <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--brand-muted)' }}>
                    Tus últimos 20 trabajos de escritura y transcripciones se guardan en este equipo.
                  </p>
                </div>
                <div style={{ position: 'relative', width: 240 }}>
                  <Search
                    size={14}
                    style={{
                      position: 'absolute',
                      left: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--brand-muted)',
                    }}
                  />
                  <input
                    className="input"
                    style={{ paddingLeft: 30 }}
                    placeholder="Buscar en historial..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className="tabs" role="tablist" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={historyTab === 'transcription'}
                  className={`tab-btn ${historyTab === 'transcription' ? 'active' : ''}`}
                  onClick={() => setHistoryTab('transcription')}
                >
                  Transcripciones
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={historyTab === 'writing'}
                  className={`tab-btn ${historyTab === 'writing' ? 'active' : ''}`}
                  onClick={() => setHistoryTab('writing')}
                >
                  Escritura y Capturas
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredHistory.length === 0 ? (
                  <div className="card" style={{ color: 'var(--brand-muted)', fontSize: 13.5 }}>
                    No hay elementos que coincidan con tu búsqueda.
                  </div>
                ) : (
                  filteredHistory.map((item) => (
                    <div key={item.id} className="history-item">
                      <div>
                        <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--brand-text)' }}>
                          {item.text}
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: 12,
                            color: 'var(--brand-muted)',
                            display: 'flex',
                            gap: 12,
                            alignItems: 'center',
                          }}
                        >
                          <span>{item.timestamp}</span>
                          <span className="mono">{item.durationSec}s</span>
                          <span className="mono">{item.language.toUpperCase()}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {item.audioUrl && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => new Audio(item.audioUrl).play()}
                            title="Escuchar grabación"
                          >
                            <Play size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => copyText(item.id, item.text)}
                          title="Copiar texto"
                        >
                          {copiedId === item.id ? <Check size={15} /> : <Copy size={15} />}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => deleteHistory(item.id)}
                          title="Eliminar"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}

        {section === 'meetings' && (
          <>
            <header className="page-header">
              <div>
                <h1 className="page-title">Reuniones</h1>
                <p className="page-desc">
                  Graba llamadas, organiza intervenciones y exporta la minuta en Markdown.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={exportMeetingMarkdown}
                >
                  <Download size={15} />
                  Exportar .md
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setMeetingActive((v) => !v)}
                >
                  {meetingActive ? <MicOff size={15} /> : <Mic size={15} />}
                  {meetingActive ? 'Pausar reunión' : 'Grabar reunión'}
                </button>
              </div>
            </header>

            <div className="card" style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <div className="status-badge" style={{ background: 'var(--brand-cream)', color: 'var(--brand-dark)' }}>
                  <span className={`status-dot ${meetingActive ? 'recording' : ''}`} />
                  <span>{meetingActive ? 'Grabando audio de la llamada' : 'Reunión en pausa'}</span>
                </div>
                <span className="mono" style={{ fontWeight: 600, color: 'var(--brand-dark)' }}>
                  {String(Math.floor(meetingSeconds / 60)).padStart(2, '0')}:
                  {String(meetingSeconds % 60).padStart(2, '0')}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {meetingNotes.map((note) => (
                  <div
                    key={note.id}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: 'var(--brand-cream)',
                      border: '1px solid var(--brand-border)',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-primary-strong)' }}>
                      {note.speaker} · <span className="mono">{note.time}</span>
                    </div>
                    <div style={{ fontSize: 13.5, marginTop: 4 }}>{note.text}</div>
                  </div>
                ))}
              </div>

              <form onSubmit={addMeetingNote} style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <input
                  className="input"
                  placeholder="Agregar nota o transcripción manual a la reunión..."
                  value={meetingInput}
                  onChange={(e) => setMeetingInput(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" style={{ flexShrink: 0 }}>
                  <Plus size={15} />
                  Agregar
                </button>
              </form>
            </div>
          </>
        )}

        {section === 'dictionary' && (
          <>
            <header className="page-header">
              <div>
                <h1 className="page-title">Diccionario</h1>
                <p className="page-desc">
                  Define términos personalizados y reemplazos automáticos para mejorar la precisión.
                </p>
              </div>
            </header>

            <form className="card" onSubmit={addDictionaryEntry} style={{ marginBottom: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10 }}>
                <input
                  className="input"
                  placeholder="Término detectado"
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Reemplazo exacto"
                  value={newReplacement}
                  onChange={(e) => setNewReplacement(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Nota opcional"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
                <button type="submit" className="btn btn-primary">
                  <Plus size={15} />
                  Añadir
                </button>
              </div>
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dictionary.map((entry) => (
                <div key={entry.id} className="history-item">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--brand-dark)' }}>
                      {entry.term} → <span style={{ color: 'var(--brand-primary-strong)' }}>{entry.replacement}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--brand-muted)', marginTop: 3 }}>
                      {entry.note}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setDictionary((prev) => prev.filter((d) => d.id !== entry.id))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {section === 'settings' && (
          <>
            <header className="page-header">
              <div>
                <h1 className="page-title">Configuración</h1>
                <p className="page-desc">
                  Configura y prueba el atajo global, el motor de transcripción y el tono rojizo.
                </p>
              </div>
            </header>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      Atajo global de dictado ({shortcutOk ? 'Activo en Windows' : 'Ocupado por otra app'})
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--brand-muted)', marginTop: 2 }}>
                      Si <span className="mono">Ctrl + Space</span> está ocupado en tu PC, cámbialo por otro (ej. <span className="mono">Ctrl + Alt + Space</span> o <span className="mono">F9</span>).
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="kbd" style={{ background: 'var(--brand-cream)', color: 'var(--brand-dark)', padding: '6px 12px', fontSize: 13 }}>
                      {capturingShortcut ? 'Presiona las teclas...' : formatAcceleratorLabel(shortcut)}
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setCapturingShortcut((v) => !v)}
                    >
                      <Keyboard size={15} />
                      {capturingShortcut ? 'Cancelar' : 'Cambiar atajo'}
                    </button>
                  </div>
                </div>
                {shortcutTestHit && (
                  <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--brand-primary-soft)', color: 'var(--brand-primary-strong)', fontSize: 13, fontWeight: 600 }}>
                    Atajo detectado correctamente ({formatAcceleratorLabel(shortcut)}).
                  </div>
                )}
              </div>

              <div className="card">
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  API Key de Whisper (Opcional — Groq gratis u OpenAI)
                </div>
                <div style={{ fontSize: 13, color: 'var(--brand-muted)', marginBottom: 10 }}>
                  Sin API key usa el reconocimiento local de Windows. Con una key de Groq/OpenAI obtienes transcripción Whisper de máxima precisión en español.
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <select
                    className="select"
                    style={{ width: 150 }}
                    value={apiProvider}
                    onChange={(e) => setApiProvider(e.target.value as 'groq' | 'openai')}
                  >
                    <option value="groq">Groq Whisper</option>
                    <option value="openai">OpenAI Whisper</option>
                  </select>
                  <input
                    type="password"
                    className="input"
                    style={{ flex: 1, minWidth: 220 }}
                    placeholder="gsk_... o sk-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
              </div>

              <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Paleta rojiza</div>
                  <div style={{ fontSize: 13, color: 'var(--brand-muted)' }}>
                    Elige la intensidad del tema rojo en barra lateral, botones y acentos.
                  </div>
                </div>
                <select
                  className="select"
                  style={{ width: 180 }}
                  value={redTheme}
                  onChange={(e) => setRedTheme(e.target.value as RedTheme)}
                >
                  <option value="carmesi">Carmesí (Por defecto)</option>
                  <option value="rubi">Rubí Intenso</option>
                  <option value="terracota">Terracota Cálido</option>
                </select>
              </div>

              <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Habilitar motor local de Windows</div>
                  <div style={{ fontSize: 13, color: 'var(--brand-muted)' }}>
                    Usa el reconocimiento de voz nativo de Windows cuando no hay API key.
                  </div>
                </div>
                <button
                  type="button"
                  className={`switch ${localModelEnabled ? 'on' : ''}`}
                  onClick={() => setLocalModelEnabled((v) => !v)}
                  aria-label="Alternar modelo local"
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Post-procesamiento inteligente</div>
                  <div style={{ fontSize: 13, color: 'var(--brand-muted)' }}>
                    Corrige mayúsculas y aplica tu diccionario automáticamente.
                  </div>
                </div>
                <button
                  type="button"
                  className={`switch ${postProcess ? 'on' : ''}`}
                  onClick={() => setPostProcess((v) => !v)}
                  aria-label="Alternar post-procesamiento"
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Sonido de inicio y fin</div>
                  <div style={{ fontSize: 13, color: 'var(--brand-muted)' }}>
                    Reproduce un tono suave al comenzar y terminar de dictar.
                  </div>
                </div>
                <button
                  type="button"
                  className={`switch ${chimeEnabled ? 'on' : ''}`}
                  onClick={() => setChimeEnabled((v) => !v)}
                  aria-label="Alternar sonido"
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Idioma de transcripción</div>
                  <div style={{ fontSize: 13, color: 'var(--brand-muted)' }}>
                    Selecciona el idioma del micrófono.
                  </div>
                </div>
                <select
                  className="select"
                  style={{ width: 180 }}
                  value={selectedLang}
                  onChange={(e) => setSelectedLang(e.target.value)}
                >
                  <option value="es">Español</option>
                  <option value="en">English</option>
                  <option value="auto">Auto Detect</option>
                </select>
              </div>
            </div>
          </>
        )}

        {section === 'instructions' && (
          <>
            <header className="page-header">
              <div>
                <h1 className="page-title">Instrucciones</h1>
                <p className="page-desc">Cómo usar Voice8a Edición Roja en Windows.</p>
              </div>
            </header>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card">
                <h3 style={{ margin: '0 0 6px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Keyboard size={16} color="var(--brand-primary-strong)" /> 1. Atajo global configurable
                </h3>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--brand-muted)' }}>
                  Presiona <span className="kbd" style={{ color: 'var(--brand-dark)', background: 'var(--brand-cream)' }}>{formatAcceleratorLabel(shortcut)}</span> para iniciar o detener la grabación. Puedes cambiarlo en <strong>Configuración</strong>.
                </p>
              </div>
              <div className="card">
                <h3 style={{ margin: '0 0 6px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sparkles size={16} color="var(--brand-primary-strong)" /> 2. Diccionario automático
                </h3>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--brand-muted)' }}>
                  Agrega nombres propios o siglas en <strong>Diccionario</strong> para reemplazarlos automáticamente al terminar de dictar.
                </p>
              </div>
              <div className="card">
                <h3 style={{ margin: '0 0 6px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Volume2 size={16} color="var(--brand-primary-strong)" /> 3. Reuniones y exportación
                </h3>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--brand-muted)' }}>
                  Usa <strong>Reuniones</strong> para registrar notas con marca de tiempo y exportarlas en <span className="mono">transcripcion.md</span>.
                </p>
              </div>
            </div>
          </>
        )}

        {section === 'about' && (
          <>
            <header className="page-header">
              <div>
                <h1 className="page-title">Acerca de</h1>
                <p className="page-desc">Información de versión.</p>
              </div>
            </header>
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                <div className="brand-logo-wrap" style={{ width: 48, height: 48 }}>
                  <img src="./assets/voice8a_logo_icon.png" alt="Voice8a" className="brand-logo-img" style={{ width: 32, height: 32 }} />
                </div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--brand-dark)' }}>
                    Voice8a v1.9.5
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--brand-muted)' }}>
                    Electron + React + Audio WAV + Windows Speech / Whisper
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {section === 'help' && (
          <>
            <header className="page-header">
              <div>
                <h1 className="page-title">Ayuda</h1>
                <p className="page-desc">Solución rápida de problemas.</p>
              </div>
            </header>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card">
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  ¿El atajo Ctrl + Space no responde?
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--brand-muted)' }}>
                  En Windows algunas apps (como PowerToys o el selector de idioma) reservan Ctrl + Space. Ve a <strong>Configuración</strong>, haz clic en <strong>Cambiar atajo</strong> y asigna por ejemplo <span className="mono">Ctrl + Alt + Space</span> o <span className="mono">F9</span>.
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
