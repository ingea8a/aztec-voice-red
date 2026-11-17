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
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Users,
  Volume2,
  BookMarked,
} from 'lucide-react';

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
    text: 'Resumen de captura: arquitectura modular con Tauri 2 + React + Whisper local.',
    timestamp: 'Ayer, 18:30',
    durationSec: 4,
    language: 'es',
  },
];

const INITIAL_DICTIONARY: DictionaryEntry[] = [
  { id: 'd-1', term: 'Aztec Voice', replacement: 'Aztec Voice', note: 'Nombre de producto' },
  { id: 'd-2', term: 'Whisper', replacement: 'Whisper Large v3', note: 'Modelo local' },
  { id: 'd-3', term: 'Tauri', replacement: 'Tauri v2', note: 'Framework de escritorio' },
];

const INITIAL_MEETING: MeetingNote[] = [
  {
    id: 'm-1',
    speaker: 'Participante 1',
    time: '00:12',
    text: 'Revisamos el estado del lanzamiento v1.9.4 y la nueva paleta rojiza.',
  },
  {
    id: 'm-2',
    speaker: 'Participante 2',
    time: '00:48',
    text: 'La latencia de transcripción local bajó a menos de 400 ms en pruebas.',
  },
];

const DEMO_PHRASES = [
  'Hola, esta es una prueba de dictado en Aztec Voice Edición Roja.',
  'Generar resumen ejecutivo de la reunión semanal y enviarlo por correo.',
  'Agregar soporte para atajos globales con Control más Espacio en Linux y Windows.',
];

export function App() {
  const [section, setSection] = useState<SectionId>('home');
  const [redTheme, setRedTheme] = useState<RedTheme>('carmesi');

  // Dictation state
  const [isRecording, setIsRecording] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [pushToTalk, setPushToTalk] = useState(true);
  const [localModelEnabled, setLocalModelEnabled] = useState(true);
  const [chimeEnabled, setChimeEnabled] = useState(true);
  const [selectedLang, setSelectedLang] = useState('auto');
  const [postProcess, setPostProcess] = useState(true);

  // History
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('aztec_red_history');
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
      const saved = localStorage.getItem('aztec_red_dict');
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

  const recognitionRef = useRef<any>(null);
  const recordStartRef = useRef<number>(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-red-theme', redTheme);
  }, [redTheme]);

  useEffect(() => {
    try {
      localStorage.setItem('aztec_red_history', JSON.stringify(history));
    } catch {
      // ignore storage errors
    }
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem('aztec_red_dict', JSON.stringify(dictionary));
    } catch {
      // ignore storage errors
    }
  }, [dictionary]);

  // Meeting timer
  useEffect(() => {
    if (!meetingActive) return;
    const timer = setInterval(() => setMeetingSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [meetingActive]);

  // Global Ctrl+Space shortcut for dictation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        if (!isRecording) {
          startDictation();
        } else if (!pushToTalk) {
          stopDictation();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (pushToTalk && isRecording && (e.code === 'Space' || e.key === 'Control')) {
        stopDictation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  const applyDictionary = (raw: string) => {
    let out = raw;
    for (const item of dictionary) {
      if (item.term.trim() && item.replacement.trim()) {
        const escaped = item.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), item.replacement);
      }
    }
    return out;
  };

  const startDictation = () => {
    setIsRecording(true);
    setLiveText('');
    recordStartRef.current = Date.now();

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const rec = new SpeechRecognition();
        rec.lang = selectedLang === 'en' ? 'en-US' : 'es-MX';
        rec.interimResults = true;
        rec.continuous = true;
        rec.onresult = (event: any) => {
          let transcript = '';
          for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          setLiveText(transcript);
        };
        rec.onerror = () => {
          // Fallback to demo phrase if microphone permission denied
          const demo = DEMO_PHRASES[Math.floor(Math.random() * DEMO_PHRASES.length)];
          setLiveText(demo);
        };
        rec.start();
        recognitionRef.current = rec;
        return;
      } catch {
        // Fallback below
      }
    }

    // Simulated live dictation when Web Speech API is unavailable
    const demo = DEMO_PHRASES[Math.floor(Math.random() * DEMO_PHRASES.length)];
    setLiveText(demo);
  };

  const stopDictation = () => {
    setIsRecording(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const finalRaw =
      liveText.trim() || DEMO_PHRASES[Math.floor(Math.random() * DEMO_PHRASES.length)];
    const finalText = applyDictionary(finalRaw);
    const duration = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));

    const entry: HistoryEntry = {
      id: `h-${Date.now()}`,
      type: 'transcription',
      text: finalText,
      timestamp: 'Ahora mismo',
      durationSec: duration,
      language: selectedLang === 'auto' ? 'es' : selectedLang,
    };
    setHistory((prev) => [entry, ...prev.slice(0, 19)]);
    setLiveText(finalText);
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
      '# Transcripción de Reunión — Aztec Voice',
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
              src="./assets/aztec_logo_icon.png"
              alt="Aztec Voice"
              className="brand-logo-img"
            />
          </div>
          <div>
            <div className="brand-title">Aztec Voice</div>
            <div className="brand-sub">Edición Roja · v1.9.4</div>
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
            <span className="kbd">Ctrl + Space</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {section === 'home' && (
          <>
            <header className="page-header">
              <div>
                <h1 className="page-title">Inicio</h1>
                <p className="page-desc">
                  Convierte tu voz en texto al instante con modelo local o en la nube.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSection('settings')}
              >
                <Settings size={15} />
                Ajustes rápidos
              </button>
            </header>

            <section className="hero-recorder">
              <div className="hero-top">
                <div className="status-badge">
                  <span className={`status-dot ${isRecording ? 'recording' : ''}`} />
                  <span>
                    {isRecording
                      ? 'Escuchando micrófono...'
                      : localModelEnabled
                        ? 'Modelo local listo (Whisper)'
                        : 'Modo nube listo'}
                  </span>
                </div>

                <div className="waveform" aria-hidden="true">
                  {[14, 24, 18, 30, 20, 28, 16, 26, 22, 14].map((h, i) => (
                    <span
                      key={i}
                      className={`wave-bar ${isRecording ? 'active' : ''}`}
                      style={{
                        height: `${isRecording ? h : 8}px`,
                        animationDelay: `${i * 0.08}s`,
                      }}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={isRecording ? stopDictation : startDictation}
                >
                  {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
                  {isRecording ? 'Detener dictado' : 'Iniciar dictado'}
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
                    'Presiona "Iniciar dictado" o mantén Ctrl + Space para transcribir tu voz.'}
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
                          }}
                        >
                          <span>{item.timestamp}</span>
                          <span className="mono">{item.durationSec}s</span>
                          <span className="mono">{item.language.toUpperCase()}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
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
                  placeholder="Término detectado (ej. tauri)"
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Reemplazo exacto (ej. Tauri v2)"
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
                  Personaliza atajos, idioma de transcripción, motor local y tono rojizo de la interfaz.
                </p>
              </div>
            </header>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Push-to-Talk (Ctrl + Space)</div>
                  <div style={{ fontSize: 13, color: 'var(--brand-muted)' }}>
                    Mantén presionado el atajo para grabar y suelta para transcribir.
                  </div>
                </div>
                <button
                  type="button"
                  className={`switch ${pushToTalk ? 'on' : ''}`}
                  onClick={() => setPushToTalk((v) => !v)}
                  aria-label="Alternar Push to Talk"
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Habilitar modelo local (Whisper)</div>
                  <div style={{ fontSize: 13, color: 'var(--brand-muted)' }}>
                    Procesa el audio directamente en tu equipo sin enviarlo a servidores externos.
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
                    Corrige puntuación, mayúsculas y aplica tu diccionario automáticamente.
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
                    Selecciona detección automática o un idioma fijo.
                  </div>
                </div>
                <select
                  className="select"
                  style={{ width: 180 }}
                  value={selectedLang}
                  onChange={(e) => setSelectedLang(e.target.value)}
                >
                  <option value="auto">Auto Detect</option>
                  <option value="es">Español</option>
                  <option value="en">English</option>
                  <option value="pt">Português</option>
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
                <p className="page-desc">Cómo sacar el máximo provecho de Aztec Voice Edición Roja.</p>
              </div>
            </header>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card">
                <h3 style={{ margin: '0 0 6px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Keyboard size={16} color="var(--brand-primary-strong)" /> 1. Dictado rápido con Ctrl + Space
                </h3>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--brand-muted)' }}>
                  Presiona <span className="kbd" style={{ color: 'var(--brand-dark)', background: 'var(--brand-cream)' }}>Ctrl + Space</span> desde cualquier pestaña o haz clic en <strong>Iniciar dictado</strong> en Inicio.
                </p>
              </div>
              <div className="card">
                <h3 style={{ margin: '0 0 6px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sparkles size={16} color="var(--brand-primary-strong)" /> 2. Diccionario automático
                </h3>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--brand-muted)' }}>
                  Agrega nombres propios, siglas o términos técnicos en <strong>Diccionario</strong> para que se reemplacen automáticamente al terminar de dictar.
                </p>
              </div>
              <div className="card">
                <h3 style={{ margin: '0 0 6px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Volume2 size={16} color="var(--brand-primary-strong)" /> 3. Reuniones y exportación
                </h3>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--brand-muted)' }}>
                  Usa la sección <strong>Reuniones</strong> para llevar el registro con marcas de tiempo y descargarlo en formato <span className="mono">transcripcion.md</span>.
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
                <p className="page-desc">Información de versión y arquitectura del clon.</p>
              </div>
            </header>
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                <div className="brand-logo-wrap" style={{ width: 48, height: 48 }}>
                  <img src="./assets/aztec_logo_icon.png" alt="Aztec Voice" className="brand-logo-img" style={{ width: 32, height: 32 }} />
                </div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--brand-dark)' }}>
                    Aztec Voice — Edición Roja
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--brand-muted)' }}>
                    Basado en Aztec Voice v1.9.4 · React + TypeScript + Web Speech API
                  </div>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--brand-muted)', lineHeight: 1.6 }}>
                Clon fiel de la interfaz y flujos principales de Aztec Voice, adaptado con una paleta
                carmesí/rojiza en lugar del verde esmeralda original.
              </p>
            </div>
          </>
        )}

        {section === 'help' && (
          <>
            <header className="page-header">
              <div>
                <h1 className="page-title">Ayuda</h1>
                <p className="page-desc">Preguntas frecuentes y solución rápida de problemas.</p>
              </div>
            </header>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card">
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  ¿Qué pasa si mi navegador no tiene permisos de micrófono?
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--brand-muted)' }}>
                  Si el navegador bloquea el micrófono o no soporta Web Speech API, el botón de dictado usa una frase de demostración para que puedas probar el historial y el diccionario sin bloqueos.
                </div>
              </div>
              <div className="card">
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  ¿Dónde se guarda mi historial y diccionario?
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--brand-muted)' }}>
                  Se almacenan localmente en <span className="mono">localStorage</span> dentro de tu navegador.
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
