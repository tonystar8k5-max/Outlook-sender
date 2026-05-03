import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Users, 
  Mail, 
  Trash2, 
  Plus, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  X,
  RefreshCcw,
  ListOrdered,
  FileText,
  AlertCircle,
  Activity,
  Box,
  Terminal,
  Settings2,
  Settings,
  Code2,
  FileDigit,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Target,
  Zap,
  Edit,
  History,
  MoveHorizontal,
  Copy,
  Lock,
  RotateCcw,
  LogOut
} from 'lucide-react';
import { toPng, toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { motion, AnimatePresence } from 'motion/react';
import { TAGS, replaceTags, getTagMap } from './tagUtils';
import { CUSTOM_NAMES, CUSTOM_ADDRESSES } from './senderData';
import { auth, rtdb, getHWID } from './firebase';
import { 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut as firebaseSignOut,
  User as FirebaseUser
} from 'firebase/auth';
import { ref, onValue, update, get, set } from 'firebase/database';

interface UserData {
  email: string;
  status: 'active' | 'banned' | 'deleted';
  expiry: string;
  maxDevices: number;
  allowedHWIDs: Record<string, boolean>;
  activeDevices: Record<string, boolean>;
}

interface Account {
  id: string;
  email: string;
  raw: string;
  status: 'READY' | 'SENDING' | 'ERROR' | 'SUCCESS' | 'ACTIVE' | 'INACTIVE' | 'VALIDATING';
  message?: string;
}

interface SendLog {
  id: string;
  recipient: string;
  status: 'pending' | 'success' | 'error';
  message?: string;
  account?: string;
  timestamp: Date;
}

interface Attachment {
  id: string;
  filename: string;
  content: string; // base64
  isInline: boolean;
  cid?: string;
  contentType?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'CONFIG' | 'ACCOUNTS' | 'RECIPIENTS' | 'STATS'>('CONFIG');
  
  // Licensing & Auth State
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [hwid] = useState(getHWID());

  useEffect(() => {
    const handleUnload = () => {
      if (auth.currentUser && hwid) {
        // We use set instead of update for the specific key to null/remove it
        // Note: Database operations on unload are unreliable, but we try anyway.
        // For a more robust solution, a 'lastActive' timestamp is better.
        set(ref(rtdb, `users/${auth.currentUser.uid}/activeDevices/${hwid}`), null);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [hwid]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (!user) {
        setUserData(null);
        setIsAuthLoading(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!currentUser) return;

    const userRef = ref(rtdb, `users/${currentUser.uid}`);
    const unsub = onValue(userRef, async (snapshot) => {
      const data = snapshot.val() as UserData | null;
      if (!data) {
        setAuthError("User data not found in registration database.");
        setIsAuthLoading(false);
        return;
      }

      // 1. Check Status
      if (data.status === 'banned' || data.status === 'deleted') {
        setAuthError(`Your account has been ${data.status}.`);
        firebaseSignOut(auth);
        setIsAuthLoading(false);
        return;
      }

      // 2. Check Expiry
      const expiryDate = new Date(data.expiry);
      if (expiryDate < new Date()) {
        setAuthError("Your subscription has expired.");
        firebaseSignOut(auth);
        setIsAuthLoading(false);
        return;
      }

      // 3. HWID Enforcement
      const isHwidAllowed = data.allowedHWIDs && data.allowedHWIDs[hwid];
      const activeCount = data.activeDevices ? Object.keys(data.activeDevices).length : 0;

      if (!isHwidAllowed) {
        if (activeCount >= (data.maxDevices || 1)) {
          setAuthError("Maximum device limit reached. Please reset your sessions.");
          firebaseSignOut(auth);
          setIsAuthLoading(false);
          return;
        } else {
          // Auto-register HWID if slots available
          await update(ref(rtdb, `users/${currentUser.uid}/allowedHWIDs`), {
            [hwid]: true
          });
        }
      }

      // 4. Update Active Sessions (Heartbeat)
      await update(ref(rtdb, `users/${currentUser.uid}/activeDevices`), {
        [hwid]: true
      });
      
      // Update last seen
      await update(ref(rtdb, `users/${currentUser.uid}`), {
        lastSeen: new Date().toISOString()
      });

      setUserData(data);
      setAuthError(null);
      setIsAuthLoading(false);
    });

    return () => unsub();
  }, [currentUser, hwid]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
    } catch (err: any) {
      setAuthError(err.message || "Failed to sign in.");
      setIsAuthLoading(false);
    }
  };

  const handleLogout = () => {
    if (currentUser) {
      // Clear active device on logout
      set(ref(rtdb, `users/${currentUser.uid}/activeDevices/${hwid}`), null);
    }
    firebaseSignOut(auth);
  };

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [tfnValue, setTfnValue] = useState<string>('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachBodyAsDoc, setAttachBodyAsDoc] = useState(false);
  
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [logs, setLogs] = useState<SendLog[]>([]);
  
  const [showAddSenderModal, setShowAddSenderModal] = useState(false);
  const [showAddRecpModal, setShowAddRecpModal] = useState(false);
  const [showTagsModal, setShowTagsModal] = useState(false);
  const [showApiSettingsModal, setShowApiSettingsModal] = useState(false);
  const [customApiUrl, setCustomApiUrl] = useState(localStorage.getItem('custom_server_url') || '');
  
  const [serverStatus, setServerStatus] = useState<'IDLE' | 'CONNECTED' | 'FAILED'>('IDLE');
  
  const getApiUrl = (endpoint: string) => {
    const customUrl = localStorage.getItem('custom_server_url') || '';
    if (customUrl.trim()) {
      const base = customUrl.trim().endsWith('/') ? customUrl.trim().slice(0, -1) : customUrl.trim();
      return `${base}${endpoint}`;
    }
    // Default logic
    if (window.location.protocol === 'file:' || 
        window.location.hostname === 'localhost' || 
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '') {
      // In EXE/Bundled mode, always check localhost:3000
      return `http://127.0.0.1:3000${endpoint}`;
    }
    return endpoint;
  };

  // Force connection check on mount and interval
  useEffect(() => {
    const check = () => testServerConnection(localStorage.getItem('custom_server_url') || 'http://127.0.0.1:3000');
    check();
    const inv = setInterval(check, 10000);
    return () => clearInterval(inv);
  }, []);

  const testServerConnection = async (url: string) => {
    if (!url) {
      setServerStatus('IDLE');
      return;
    }
    try {
      const base = url.trim().endsWith('/') ? url.trim().slice(0, -1) : url.trim();
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        setServerStatus('CONNECTED');
      } else {
        setServerStatus('FAILED');
      }
    } catch (e) {
      setServerStatus('FAILED');
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem('custom_server_url');
    if (saved) testServerConnection(saved);
  }, []);

  const [threads, setThreads] = useState(1);
  const [delay, setDelay] = useState(200);
  
  // Stats tracking
  const [successCount, setSuccessCount] = useState(0);
  const [failureCount, setFailureCount] = useState(0);

  // Electron Window Resize Logic
  useEffect(() => {
    try {
      // @ts-ignore
      const isElectron = window && window.process && window.process.type === 'renderer';
      if (isElectron) {
        // @ts-ignore
        const { ipcRenderer } = window.require('electron');
        if (ipcRenderer) {
          if (isAuthLoading || !currentUser) {
            ipcRenderer.send('resize-window', { width: 397, height: 506 });
          } else {
            ipcRenderer.send('resize-window', { width: 1184, height: 871 });
          }
        }
      }
    } catch (e) {
      // Not in Electron or failed to load
    }
  }, [currentUser, isAuthLoading]);
  
  const [htmlToConvert, setHtmlToConvert] = useState('');
  const [conversionFormat, setConversionFormat] = useState<'PDF' | 'JPG' | 'PNG' | 'INLINE_PNG' | 'HTML' | 'NON_SELECT_PDF' | 'HQ_IMAGE_FILE'>('PDF');
  const [targetWidth, setTargetWidth] = useState<number>(800);
  const [targetHeight, setTargetHeight] = useState<number>(600);
  const [useRandomHeight, setUseRandomHeight] = useState<boolean>(false);
  const [importedPath, setImportedPath] = useState<string>('');
  const conversionRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isAbortedRef = useRef(false);

  const RESOLUTION_PRESETS = [
    { w: 800, h: 1131 },
    { w: 1000, h: 1414 },
    { w: 1240, h: 1754 },
    { w: 2480, h: 3508 }
  ];

  const [rawSenderInput, setRawSenderInput] = useState('');
  const [rawRecpInput, setRawRecpInput] = useState('');

  const [preventDuplicateRecipients, setPreventDuplicateRecipients] = useState(true);

  // Manual Sender Entry State
  const [senderImportMode, setSenderImportMode] = useState<'BULK' | 'MANUAL'>('BULK');
  const [manualEmail, setManualEmail] = useState('');
  const [manualPassword, setManualPassword] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [manualPUID, setManualPUID] = useState('');

  // Editing State
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editToken, setEditToken] = useState('');
  const [editPUID, setEditPUID] = useState('');

  const [isAuditing, setIsAuditing] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleAddAccounts = async () => {
    if (senderImportMode === 'BULK') {
      const lines = rawSenderInput.split('\n').filter(line => line.trim().length > 0);
      const newAccounts: Account[] = lines.map((line) => {
        const parts = line.split('|');
        return {
          id: Math.random().toString(36).substr(2, 9),
          email: parts[0] || 'Unknown',
          raw: line,
          status: 'VALIDATING'
        };
      });
      setAccounts(prev => [...prev, ...newAccounts]);
      setRawSenderInput('');
      setShowAddSenderModal(false);

      // Verify newly added accounts
      for (const acc of newAccounts) {
        await verifySingleAccount(acc.id, acc.raw);
      }
    } else {
      // Manual Mode
      if (!manualEmail) {
        alert('Email is required!');
        return;
      }
      
      // If password is not provided and token is there, set password to "-"
      let finalPassword = manualPassword;
      if (!manualPassword && (manualToken || manualPUID)) {
        finalPassword = "-";
      }

      if (!finalPassword && !manualToken) {
        alert('Either Password or Token is required!');
        return;
      }

      const rawLine = `${manualEmail}|${finalPassword}|${manualToken}|${manualPUID}`;
      const newAccount: Account = {
        id: Math.random().toString(36).substr(2, 9),
        email: manualEmail,
        raw: rawLine,
        status: 'VALIDATING'
      };
      setAccounts(prev => [...prev, newAccount]);
      
      // Reset manual fields
      setManualEmail('');
      setManualPassword('');
      setManualToken('');
      setManualPUID('');
      setShowAddSenderModal(false);

      verifySingleAccount(newAccount.id, newAccount.raw);
    }
  };

  const verifySingleAccount = async (id: string, raw: string) => {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, status: 'VALIDATING' } : a));
    try {
      const response = await fetch(getApiUrl('/api/verify-account'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: raw })
      });
      const data = await response.json();
      setAccounts(prev => prev.map(a => a.id === id ? { 
        ...a, 
        status: data.success ? 'ACTIVE' : 'INACTIVE',
        message: data.error 
      } : a));
    } catch (e: any) {
      setAccounts(prev => prev.map(a => a.id === id ? { ...a, status: 'INACTIVE', message: e.message } : a));
    }
  };

  const forceReady = (id: string) => {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, status: 'ACTIVE', message: 'MANUAL_OVERRIDE' } : a));
  };

  const checkAllHealth = async () => {
    if (isAuditing) return;
    setIsAuditing(true);
    for (const acc of accounts) {
      await verifySingleAccount(acc.id, acc.raw);
      await new Promise(r => setTimeout(r, 200));
    }
    setIsAuditing(false);
  };

  const handleAddRecipients = (customList?: string[] | React.MouseEvent) => {
    let listToProcess: string[] = [];
    
    if (Array.isArray(customList)) {
      listToProcess = customList;
    } else {
      // If it's undefined or an event object from a click
      listToProcess = rawRecpInput.split('\n').filter(line => line.trim().length > 0);
    }
    
    if (listToProcess.length === 0) return;

    if (preventDuplicateRecipients) {
      setRecipients(prev => [...new Set([...prev, ...listToProcess])]);
    } else {
      setRecipients(prev => [...prev, ...listToProcess]);
    }
    
    // Only clear input and close modal if we were using the raw input (not a custom list)
    if (!Array.isArray(customList)) {
      setRawRecpInput('');
      setShowAddRecpModal(false);
    }
  };

  const handlePasteRecipients = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
      if (lines.length > 0) {
        handleAddRecipients(lines);
      }
    } catch (err: any) {
      console.error('Failed to read clipboard', err);
      if (err.name === 'NotAllowedError' || err.message?.includes('permission') || err.message?.includes('blocked')) {
        setLogs(prev => [{
          id: Math.random().toString(36).substr(2, 9),
          recipient: 'SYSTEM',
          status: 'error',
          message: 'CLIPBOARD ERROR: Access blocked by browser policy. Please use Ctrl+V or open in a new tab.',
          account: 'SYSTEM',
          timestamp: new Date()
        }, ...prev]);
      }
    }
  };

  const handlePasteAccounts = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setRawSenderInput(text);
        // We don't automatically trigger handleAddAccounts because user might want to review or choose mode
        // But for "Paste" button experience, maybe we should just add them if it's in BULK mode
        if (senderImportMode === 'BULK') {
          const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
          const newAccounts: Account[] = lines.map((line) => {
            const parts = line.split('|');
            return {
              id: Math.random().toString(36).substr(2, 9),
              email: parts[0] || 'Unknown',
              raw: line,
              status: 'VALIDATING'
            };
          });
          setAccounts(prev => [...prev, ...newAccounts]);
          for (const acc of newAccounts) {
            verifySingleAccount(acc.id, acc.raw);
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to read clipboard', err);
      if (err.name === 'NotAllowedError' || err.message?.includes('permission') || err.message?.includes('blocked')) {
        setLogs(prev => [{
          id: Math.random().toString(36).substr(2, 9),
          recipient: 'SYSTEM',
          status: 'error',
          message: 'CLIPBOARD ERROR: Access blocked. Please use Ctrl+V in the input field or open in a new tab.',
          account: 'SYSTEM',
          timestamp: new Date()
        }, ...prev]);
      }
    }
  };

  const exportActiveAccounts = () => {
    const activeAccounts = accounts.filter(a => a.status === 'ACTIVE' || a.status === 'SUCCESS');
    if (activeAccounts.length === 0) {
      alert('No active accounts to export!');
      return;
    }
    const content = activeAccounts.map(a => a.raw).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `active_accounts_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>, target: 'ACCOUNTS' | 'RECIPIENTS') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    const reader = new FileReader();

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
      const { read, utils } = await import('xlsx');
      reader.onload = (evt) => {
        const bstr = evt.target?.result;
        const wb = read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = utils.sheet_to_json(ws, { header: 1 }) as any[][];
        
        const extractedEmails: string[] = [];
        data.forEach(row => {
          row.forEach(cell => {
            if (typeof cell === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell.trim())) {
              extractedEmails.push(cell.trim());
            }
          });
        });

        if (extractedEmails.length > 0) {
          if (target === 'RECIPIENTS') {
            handleAddRecipients(extractedEmails);
          } else {
            const newAccounts: Account[] = extractedEmails.map((email) => ({
              id: Math.random().toString(36).substr(2, 9),
              email: email,
              raw: `${email}|-||`, // Minimal placeholder raw
              status: 'VALIDATING'
            }));
            setAccounts(prev => [...prev, ...newAccounts]);
            newAccounts.forEach(acc => verifySingleAccount(acc.id, acc.raw));
          }
        }
      };
      reader.readAsBinaryString(file);
    } else {
      // Text file
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (target === 'RECIPIENTS') {
          handleAddRecipients(lines);
        } else {
          const newAccounts: Account[] = lines.map((line) => {
            const parts = line.split('|');
            return {
              id: Math.random().toString(36).substr(2, 9),
              email: parts[0] || 'Unknown',
              raw: line,
              status: 'VALIDATING'
            };
          });
          setAccounts(prev => [...prev, ...newAccounts]);
          newAccounts.forEach(acc => verifySingleAccount(acc.id, acc.raw));
        }
      };
      reader.readAsText(file);
    }
    // Reset input
    e.target.value = '';
  };

  const [confirmClearSender, setConfirmClearSender] = useState(false);
  const [confirmClearRecp, setConfirmClearRecp] = useState(false);

  const clearAllAccounts = () => {
    if (!confirmClearSender) {
      setConfirmClearSender(true);
      setTimeout(() => setConfirmClearSender(false), 3000);
      return;
    }
    setAccounts([]);
    setConfirmClearSender(false);
  };

  const clearAllRecipients = () => {
    if (!confirmClearRecp) {
      setConfirmClearRecp(true);
      setTimeout(() => setConfirmClearRecp(false), 3000);
      return;
    }
    setRecipients([]);
    setConfirmClearRecp(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, isInline: boolean = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      const cid = isInline ? `inline_${Math.random().toString(36).substr(2, 9)}` : undefined;
      
      setAttachments(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        filename: file.name,
        content: base64,
        isInline,
        cid,
        contentType: file.type
      }]);

      if (isInline && cid) {
        setBody(prev => prev + `\n<div style="text-align:center;"><img src="cid:${cid}" style="max-width:100%; height:auto;" /></div>\n`);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleHtmlFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const fileName = file.name;
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        // Direct replacement instead of clearing first to prevent layout flicker
        setHtmlToConvert(content);
        setImportedPath(fileName);
      };
      reader.readAsText(file);
      
      // Reset input value so same file can be re-selected
      e.target.value = '';
    }
  };

  const stopSending = () => {
    isAbortedRef.current = true;
    setIsSending(false);
  };

  const startSending = async () => {
    if (accounts.length === 0) {
      alert('Please add at least one account!');
      return;
    }
    if (recipients.length === 0) {
      alert('Please add at least one recipient!');
      return;
    }
    if (!subject || !body) {
      alert('Subject and Body are required!');
      return;
    }

    isAbortedRef.current = false;
    setIsSending(true);
    setProgress({ current: 0, total: recipients.length });
    setLogs([]);

    let accountPointer = 0;

    for (let i = 0; i < recipients.length; i++) {
      if (isAbortedRef.current) break;
      const recipient = recipients[i];
      
      let sentSuccessfully = false;
      let attemptsForThisRecipient = 0;

      // Keep trying different accounts for the same recipient until success
      while (!sentSuccessfully && attemptsForThisRecipient < accounts.length) {
        if (isAbortedRef.current) break;

        const currentAccountIndex = (accountPointer) % accounts.length;
        const account = accounts[currentAccountIndex];
        
        // Personalization logic: Generate a consistent set of variables for this recipient
        // We use recipient index 'i' for consistent custom names per recipient even if account changes
        const nameIndex = i % CUSTOM_NAMES.length;
        const addressIndex = i % CUSTOM_ADDRESSES.length;
        
        const senderName = CUSTOM_NAMES[nameIndex];
        const senderAddress = CUSTOM_ADDRESSES[addressIndex];
        
        const recipientTags = getTagMap(recipient);
        const tagOverrides = { 
          ...recipientTags, 
          '#SENDERNAME#': senderName,
          '#NAME#': senderName,
          '#ADDRESS#': senderAddress,
          '#ADDRESS1#': senderAddress,
          '#TFN#': tfnValue || '' 
        };
        
        const processedSubject = replaceTags(subject, recipient, tagOverrides);
        let processedBody = replaceTags(body, recipient, tagOverrides);
        
        let processedAttachments = [...attachments.map(a => ({
          filename: a.filename,
          content: a.content,
          isInline: a.isInline,
          cid: a.cid,
          contentType: a.contentType
        }))];
        
        // Auto-Conversion Logic for Imported HTML - Using secure isolated iframe
        if (htmlToConvert && iframeRef.current) {
          try {
            if (isAbortedRef.current) return;
            const personalizedHtml = replaceTags(htmlToConvert, recipient, tagOverrides);
            
            let finalWidth = targetWidth;
            let finalHeight = targetHeight;
            if (useRandomHeight) {
                const preset = RESOLUTION_PRESETS[Math.floor(Math.random() * RESOLUTION_PRESETS.length)];
                finalWidth = preset.w;
                finalHeight = preset.h;
            }

            const iframe = iframeRef.current;
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!doc) throw new Error("Sandbox isolated document unavailable");

            doc.open();
            doc.write(`
              <!DOCTYPE html>
              <html>
                <head>
                   <style>
                     body { margin: 0; padding: 0; background: white; width: ${finalWidth}px; overflow: visible; }
                     #capture-target { width: ${finalWidth}px; min-height: ${finalHeight}px; background: white; }
                   </style>
                </head>
                <body>
                  <div id="capture-target">${personalizedHtml}</div>
                </body>
              </html>
            `);
            doc.close();

            const captureElement = doc.getElementById('capture-target') as HTMLElement;
            if (!captureElement) throw new Error("Capture target not found");
            
            const capturableImages = captureElement.querySelectorAll('img');
            await Promise.all(Array.from(capturableImages).map((img: HTMLImageElement) => {
              if (img.complete) return Promise.resolve();
              return new Promise(resolve => {
                const timer = setTimeout(resolve, 5000); // 5s individual image guard
                img.onload = () => { clearTimeout(timer); resolve(null); };
                img.onerror = () => { clearTimeout(timer); resolve(null); };
              });
            }));

            await new Promise(r => setTimeout(r, 150)); // rendering stabilization
            if (isAbortedRef.current) return;

            const randomId = Math.random().toString(36).substring(2, 14).toUpperCase();
            let filename = randomId;
            const captureOptions = { backgroundColor: '#ffffff', pixelRatio: 2.0 }; 

            if (conversionFormat === 'PNG' || conversionFormat === 'INLINE_PNG') {
              const content = await toPng(captureElement, captureOptions);
              filename += '.png';
              const contentType = 'image/png';
              
              if (conversionFormat === 'INLINE_PNG') {
                const cid = `inline_conv_${Math.random().toString(36).substr(2, 9)}`;
                processedAttachments.push({ filename, content, isInline: true, cid, contentType });
                processedBody += `<br/><div style="text-align:center;"><img src="cid:${cid}" style="max-width:100%; height:auto;" /></div>`;
              } else {
                processedAttachments.push({ filename, content, isInline: false, contentType });
              }
            } else if (conversionFormat === 'PDF' || conversionFormat === 'NON_SELECT_PDF') {
              const docPdf = new jsPDF('p', 'pt', 'a4');
              const imgData = await toJpeg(captureElement, { ...captureOptions, quality: 0.95 });
              const imgProps = docPdf.getImageProperties(imgData);
              const pdfWidth = docPdf.internal.pageSize.getWidth();
              const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
              docPdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
              const content = docPdf.output('datauristring');
              filename += '.pdf';
              processedAttachments.push({ filename, content, isInline: false, contentType: 'application/pdf' });
            } else if (conversionFormat === 'JPG') {
              const content = await toJpeg(captureElement, { ...captureOptions, quality: 0.92 });
              filename += '.jpg';
              processedAttachments.push({ filename, content, isInline: false, contentType: 'image/jpeg' });
            } else if (conversionFormat === 'HQ_IMAGE_FILE') {
              const element = captureElement;
              const contentHeight = element.scrollHeight;
              const content = await toJpeg(element, { ...captureOptions, height: contentHeight, quality: 0.88 });
              const contentType = 'image/jpeg';
              const cid = `inline_hq_${Math.random().toString(36).substr(2, 9)}`;
              processedAttachments.push({ filename, content, isInline: true, cid, contentType });
              processedBody += `<br/><div style="text-align:center;"><img src="cid:${cid}" style="max-width:100%; height:auto; display:block; margin: 0 auto;" /></div>`;
            } else if (conversionFormat === 'HTML') {
              const content = `data:text/html;base64,${btoa(unescape(encodeURIComponent(personalizedHtml)))}`;
              filename += '.html';
              processedAttachments.push({ filename, content, isInline: false, contentType: 'text/html' });
            }
          } catch (convErr) {
            setLogs(prev => [...prev, {
              id: Math.random().toString(36).substr(2, 9),
              recipient: 'SYSTEM',
              status: 'error',
              message: `CRITICAL: CONVERSION FAILURE FOR ${recipient} - ${convErr instanceof Error ? convErr.message : 'Unknown'}`,
              account: 'SYSTEM',
              timestamp: new Date()
            }]);
            console.error("Auto-conversion failed for " + recipient, convErr);
          }
        }

        setAccounts(prev => prev.map((acc, idx) => 
          idx === currentAccountIndex ? { ...acc, status: 'SENDING' } : acc
        ));

        const logId = Math.random().toString(36).substr(2, 9);
        setLogs(prev => [...prev, {
          id: logId,
          recipient,
          status: 'pending',
          account: account.email,
          timestamp: new Date()
        }]);

        try {
          // Implement delay between sends
          if (i > 0 && delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }

          const response = await fetch(getApiUrl('/api/send-one'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              account: account.raw, 
              recipient, 
              subject: processedSubject, 
              body: processedBody,
              attachBodyAsDoc,
              attachments: processedAttachments
            })
          });

          const data = await response.json();

          setAccounts(prev => prev.map((acc, idx) => 
            idx === currentAccountIndex ? { ...acc, status: data.success ? 'SUCCESS' : 'ERROR', message: data.error } : acc
          ));

          setLogs(prev => prev.map(log => 
            log.id === logId 
              ? { ...log, status: data.success ? 'success' : 'error', message: data.error } 
              : log
          ));

          if (data.success) {
            setSuccessCount(prev => prev + 1);
            sentSuccessfully = true;
            // Success! Move to next account for next recipient
            accountPointer++;
            setProgress(prev => ({ ...prev, current: i + 1 }));
          } else {
            setFailureCount(prev => prev + 1);
            // Failure on this account. Try next account for same recipient.
            accountPointer++;
            attemptsForThisRecipient++;
            const retryMessage = `Account ${account.email} failed. Retrying recipient ${recipient} with next account...`;
            setLogs(prev => [...prev, {
               id: Math.random().toString(36).substr(2, 9),
               recipient: 'SYSTEM',
               status: 'error',
               message: retryMessage,
               account: 'SYSTEM',
               timestamp: new Date()
            }]);
          }
        } catch (error: any) {
          setAccounts(prev => prev.map((acc, idx) => 
            idx === currentAccountIndex ? { ...acc, status: 'ERROR', message: error.message } : acc
          ));
          setLogs(prev => prev.map(log => 
            log.id === logId 
              ? { ...log, status: 'error', message: error.message } 
              : log
          ));
          
          accountPointer++;
          attemptsForThisRecipient++;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await new Promise(resolve => setTimeout(resolve, 800));
      }

      if (!sentSuccessfully && !isAbortedRef.current) {
        // All accounts tried but failed for this recipient
        setLogs(prev => [...prev, {
          id: Math.random().toString(36).substr(2, 9),
          recipient: recipient,
          status: 'error',
          message: 'All available accounts failed for this recipient. Stopping entire process to prevent further errors.',
          account: 'CRITICAL',
          timestamp: new Date()
        }]);
        // Stop the entire sending process as requested
        break; 
      }
    }

    setIsSending(false);
  };

  const removeAccount = (id: string) => {
    setAccounts(prev => prev.filter(a => a.id !== id));
  };

  const removeRecipient = (index: number) => {
    setRecipients(prev => prev.filter((_, i) => i !== index));
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const openEditModal = (acc: Account) => {
    const parts = acc.raw.split('|');
    setEditingAccount(acc);
    setEditEmail(parts[0] || '');
    setEditPassword(parts[1] || '');
    setEditToken(parts[2] || '');
    setEditPUID(parts[3] || '');
  };

  const handleUpdateApiUrl = () => {
    let url = customApiUrl.trim();
    if (url && !url.startsWith('http')) {
      url = 'https://' + url;
      setCustomApiUrl(url);
    }
    localStorage.setItem('custom_server_url', url);
    setShowApiSettingsModal(false);
    
    // Force a fresh check
    setServerStatus('IDLE');
    testServerConnection(url);
  };

  const handleUpdateAccount = () => {
    if (!editingAccount) return;
    const newRaw = `${editEmail}|${editPassword}|${editToken}|${editPUID}`;
    setAccounts(prev => prev.map(a => a.id === editingAccount.id ? {
      ...a,
      email: editEmail,
      raw: newRaw,
      status: 'VALIDATING'
    } : a));
    
    const idToVerify = editingAccount.id;
    setEditingAccount(null);
    verifySingleAccount(idToVerify, newRaw);
  };

  const nodeMetrics = {
    total: accounts.length,
    ready: accounts.filter(a => a.status === 'ACTIVE' || a.status === 'SUCCESS').length,
    dead: accounts.filter(a => a.status === 'INACTIVE' || a.status === 'ERROR').length,
    pending: accounts.filter(a => a.status === 'VALIDATING' || a.status === 'SENDING').length
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-[#050505] overflow-hidden">
      <AnimatePresence mode="wait">
        {isAuthLoading ? (
          <motion.div 
            key="loader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4"
          >
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500/60 animate-pulse">Initializing Security Protocols...</span>
          </motion.div>
        ) : !currentUser ? (
          <motion.div 
            key="login"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.1, y: -20 }}
            className="w-[400px] bg-[#0a0a0a] border border-[#222] p-8 shadow-2xl relative overflow-hidden group"
          >
             <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
             <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-800 to-transparent opacity-20" />
             
             <div className="flex flex-col items-center gap-6 mb-8">
                <div className="w-20 h-20 p-2 bg-white/5 rounded-full border border-white/10 flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                   <img src="https://raw.githubusercontent.com/tonystar8k5-max/NexaMailer-image-icon-/refs/heads/main/NexaMailer-removebg.ico" className="w-full h-full object-contain" />
                </div>
                <div className="text-center">
                   <h1 className="text-xl font-black italic tracking-tight text-white uppercase mb-1">Nexa Outlook</h1>
                   <p className="text-[9px] font-black tracking-[0.4em] text-blue-500/60 uppercase italic">Central Command Login</p>
                </div>
             </div>

             <form onSubmit={handleLogin} className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                   <label className="text-[8px] font-black uppercase text-slate-500 tracking-widest px-1">Access Identity</label>
                   <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" size={14} />
                      <input 
                         type="email" 
                         required
                         placeholder="IDENTIFICATION EMAIL"
                         value={loginEmail}
                         onChange={(e) => setLoginEmail(e.target.value)}
                         className="w-full bg-black/40 border border-[#222] py-3 pl-10 pr-4 text-[11px] font-mono text-blue-200 outline-none focus:border-blue-500/50 transition-all placeholder:text-slate-800"
                      />
                   </div>
                </div>

                <div className="flex flex-col gap-1.5">
                   <label className="text-[8px] font-black uppercase text-slate-500 tracking-widest px-1">Authorization Cipher</label>
                   <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" size={14} />
                      <input 
                         type="password" 
                         required
                         placeholder="SECURITY PASSWORD"
                         value={loginPassword}
                         onChange={(e) => setLoginPassword(e.target.value)}
                         className="w-full bg-black/40 border border-[#222] py-3 pl-10 pr-4 text-[11px] font-mono text-blue-200 outline-none focus:border-blue-500/50 transition-all placeholder:text-slate-800"
                      />
                   </div>
                </div>

                <AnimatePresence>
                  {authError && (
                    <motion.div 
                       initial={{ opacity: 0, height: 0 }}
                       animate={{ opacity: 1, height: 'auto' }}
                       exit={{ opacity: 0, height: 0 }}
                       className="bg-red-500/10 border border-red-500/20 p-3 flex items-center gap-3"
                    >
                       <AlertCircle size={14} className="text-red-500 shrink-0" />
                       <span className="text-[9px] font-black uppercase text-red-400 tracking-tight leading-tight">{authError}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button 
                   type="submit"
                   disabled={isAuthLoading}
                   className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black py-3 uppercase tracking-[0.2em] italic text-xs shadow-[0_4px_15px_rgba(37,99,235,0.4)] transition-all flex items-center justify-center gap-3 mt-2 active:scale-95"
                >
                   {isAuthLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap size={14} />}
                   ESTABLISH UPLINK
                </button>

                <div className="flex flex-col items-center mt-4">
                   <span className="text-[7.5px] font-mono text-slate-700 uppercase tracking-widest">DEVICE HWID SIGNATURE:</span>
                   <span className="text-[7.5px] font-mono text-blue-500/40 uppercase tracking-widest mt-1">{hwid}</span>
                </div>
             </form>
          </motion.div>
        ) : (
          <motion.div 
            key="app"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ width: '1184px', height: '871px', minWidth: '1184px', maxWidth: '1184px', minHeight: '871px', maxHeight: '871px' }} 
            className="flex flex-col bg-[#0a0a0a] text-[#f0f0f0] font-sans text-[11px] overflow-hidden select-none border border-[#2a2a2a] relative shadow-2xl flex-shrink-0"
          >
      {/* Absolute CSS Isolation Guard */}
      <style>{`
        #conversion-sandbox style, #conversion-sandbox link { display: none !important; }
        .rigid-textarea { word-break: break-all !important; white-space: pre-wrap !important; }
      `}</style>
      {/* Precision HUD Overlays */}
      <div className="absolute inset-0 pointer-events-none border-[1px] border-blue-500/10 z-[60]"></div>
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_0%,rgba(59,131,246,0.05)_0%,transparent_70%)] z-[60]"></div>
      
      {/* Tactical Window Header */}
      <div className="flex h-12 items-stretch bg-[#111] border-b border-[#222] shrink-0 shadow-2xl z-50">
        <div className="flex items-center px-6 gap-3 border-r border-[#222] select-none bg-[#141414]">
          <motion.div 
            className="w-8 h-8 flex items-center justify-center bg-transparent rounded-sm overflow-hidden"
          >
            <img src="https://raw.githubusercontent.com/tonystar8k5-max/NexaMailer-image-icon-/refs/heads/main/NexaMailer-removebg.ico" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          </motion.div>
          <div className="flex flex-col leading-none">
            <span className="font-black text-[11px] tracking-tight text-white uppercase italic">NEXA·OUTLOOK</span>
            <span className="text-[7.5px] font-black text-blue-500/60 uppercase tracking-[0.2em] mt-1 italic opacity-80">VERSION 0.1</span>
          </div>
        </div>

        <div className="flex items-center px-4 gap-4 bg-[#141414]/80 border-r border-[#222]">
           <div className="flex flex-col">
              <span className="text-[7px] text-slate-500 font-black uppercase tracking-widest">License Holder</span>
              <span className="text-[9px] text-blue-400 font-bold uppercase tracking-tight truncate max-w-[120px]">{(userData?.email || currentUser?.email)?.split('@')[0]}</span>
           </div>
           <div className="flex flex-col border-l border-white/5 pl-4">
              <span className="text-[7px] text-slate-500 font-black uppercase tracking-widest">Expires</span>
              <span className={`text-[9px] font-bold uppercase tracking-tight ${userData?.expiry && (new Date(userData.expiry).getTime() - new Date().getTime() < 86400000 * 3) ? 'text-red-400' : 'text-green-500/80'}`}>
                 {userData?.expiry ? new Date(userData.expiry).toLocaleDateString() : 'Loading...'}
              </span>
           </div>
        </div>

        <nav className="flex items-stretch flex-1 px-4 gap-1 bg-gradient-to-r from-[#141414] to-[#0a0a0a]">
          {[
            { id: 'CONFIG', icon: Zap, label: 'Transmitter' },
            { id: 'ACCOUNTS', icon: ShieldCheck, label: 'Node Cluster' },
            { id: 'RECIPIENTS', icon: Users, label: 'Target Vault' },
            { id: 'STATS', icon: Settings, label: 'Core Config' }
          ].map(tab => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-3 px-8 transition-all relative group overflow-hidden ${
                activeTab === tab.id 
                ? 'text-blue-400 bg-white/5' 
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/2'
              }`}
            >
              <tab.icon size={13} className={activeTab === tab.id ? 'animate-pulse text-blue-400' : 'opacity-40'} />
              <span className="font-black uppercase tracking-[0.2em] text-[8.5px] italic">{tab.label}</span>
              {activeTab === tab.id && (
                <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 shadow-[0_0_15px_#3b82f6]" />
              )}
            </button>
          ))}
        </nav>

        <div className="flex items-center px-6 gap-8 bg-[#141414] border-l border-[#222]">
           <button 
             onClick={handleLogout}
             title="Sign Out"
             className="text-red-500/80 hover:text-white transition-all flex items-center justify-center p-2 border border-red-500/20 bg-red-500/5 hover:bg-red-600/10 rounded-sm group"
           >
             <LogOut size={14} className="group-hover:translate-x-0.5 transition-transform" />
           </button>
           <div className="flex flex-col items-end">
             <span className="text-[8px] opacity-30 uppercase font-black tracking-widest italic leading-none">Cluster Health</span>
             <div className="flex items-center gap-2 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_10px_#22c55e] animate-pulse" />
                <span className="text-[10px] font-mono font-black text-green-500/80 uppercase tracking-tighter italic">Secured</span>
             </div>
           </div>
        </div>
      </div>

      {/* Dynamic Content Core */}
      <div className="flex-1 overflow-hidden relative flex flex-col bg-[#0d0d0d]">
        <AnimatePresence mode="wait">
          {activeTab === 'CONFIG' && (
            <motion.div 
              key="config"
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="h-full p-6 grid grid-cols-12 gap-6 overflow-hidden custom-scrollbar"
            >
              {/* Tactical Payload Area */}
              <div className="col-span-8 flex flex-col gap-3 overflow-hidden min-w-0">
                {/* HEADS UP STATUS */}
                <div className="flex items-center gap-4 bg-blue-600/5 border border-blue-500/10 p-2 rounded-sm mb-1 shrink-0">
                  <div className="flex items-center gap-2 px-2 border-r border-blue-500/20">
                     <div className={`w-2 h-2 rounded-full ${serverStatus === 'CONNECTED' ? 'bg-green-500 animate-pulse' : 'bg-red-500'} shadow-[0_0_8px_rgba(34,197,94,0.4)]`}></div>
                     <span className="text-[7.5px] font-black uppercase text-slate-400 tracking-widest leading-none pt-0.5">
                        SERVER: {serverStatus === 'CONNECTED' ? 'ONLINE' : 'OFFLINE'}
                     </span>
                  </div>
                  <div className="flex items-center gap-2">
                     <Activity size={10} className="text-blue-500/40" />
                     <span className="text-[7.5px] font-black uppercase text-slate-500 tracking-widest">{nodeMetrics.ready} NODES ARMED</span>
                  </div>
                </div>
                <div className="group shrink-0 h-[65px] flex flex-col">
                  <div className="flex items-center justify-between mb-1.5 px-1">
                    <span className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-500/60 flex items-center gap-2">
                       <Target size={11} /> Subject Line
                    </span>
                    <span className="text-[7px] font-mono text-slate-600 opacity-40">PROTOCOL: X-722</span>
                  </div>
                  <input 
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="ENTER SUBJECT PROTOCOL..."
                    className="w-full h-10 px-4 bg-[#0a0a0a] border border-[#222] focus:border-blue-500/40 outline-none font-mono text-blue-400 italic shadow-inner text-[10px] placeholder:opacity-10 transition-all rounded-sm"
                  />
                </div>
                <div className="flex flex-col flex-1 min-h-0 gap-3 overflow-hidden">
                  <div className="flex flex-col flex-1 min-h-0">
                    <div className="flex items-center justify-between mb-1 px-1 shrink-0">
                      <span className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-500/60 flex items-center gap-2">
                        <FileDigit size={11} /> Body Matrix
                      </span>
                      <button onClick={() => setShowTagsModal(true)} className="text-[7px] font-black uppercase text-blue-400 hover:text-white transition-colors bg-blue-500/5 px-2 py-0.5 border border-blue-500/10 rounded-sm">VARIABLE REGISTRY</button>
                    </div>
                    <textarea 
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="INJECT RAWS TEXT PAYLOAD BODY..."
                      className="w-full flex-1 p-3 bg-[#0a0a0a] border border-[#222] focus:border-blue-500/40 transition-all shadow-inner font-mono text-[10px] text-slate-400 custom-scrollbar outline-none placeholder:opacity-5 resize-none selection:bg-blue-600/30 rounded-sm overflow-x-hidden overflow-y-auto"
                    />
                  </div>

                  <div className="flex flex-col h-[140px] shrink-0">
                    <div className="flex items-center justify-between mb-1 px-1 shrink-0">
                      <span className="text-[9px] font-black uppercase tracking-[0.3em] text-cyan-500/60 flex items-center gap-2">
                        <Code2 size={11} /> HTML Source Vector
                      </span>
                      {htmlToConvert && (
                        <button 
                          onClick={() => setHtmlToConvert('')}
                          className="text-[7.5px] font-black uppercase text-red-500 hover:text-white transition-colors bg-red-500/5 px-3 py-0.5 border border-red-500/10 rounded-sm"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <textarea 
                      value={htmlToConvert}
                      onChange={(e) => setHtmlToConvert(e.target.value)}
                      placeholder="ENTER HTML SOURCE FOR ATTACHMENT CONVERSION..."
                      className="w-full h-full p-3 bg-[#0a0a0a] border border-[#222] focus:border-blue-500/40 transition-all shadow-inner font-mono text-[10px] text-blue-400 custom-scrollbar outline-none placeholder:opacity-5 resize-none selection:bg-blue-600/30 rounded-sm overflow-x-hidden overflow-y-auto rigid-textarea"
                    />
                  </div>
                </div>

                <div className="shrink-0 flex flex-col gap-3 pt-3 border-t border-[#222]/30">
                   <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-[7.5px] font-black uppercase text-blue-500/40 tracking-widest block pl-1">Delay (MS)</span>
                        <input 
                          type="number" 
                          value={delay} 
                          onChange={(e) => setDelay(Number(e.target.value))}
                          className="w-full bg-[#050505] border border-[#222] px-3 py-2 text-center font-mono focus:border-blue-500/50 outline-none text-[10px] text-blue-400 shadow-inner rounded-sm" 
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[7.5px] font-black uppercase text-blue-500/40 tracking-widest block pl-1">Threads</span>
                        <input 
                          type="number" 
                          value={threads} 
                          onChange={(e) => setThreads(Number(e.target.value))}
                          className="w-full bg-[#050505] border border-[#222] px-3 py-2 text-center font-mono focus:border-blue-500/50 outline-none text-[10px] text-blue-400 shadow-inner rounded-sm" 
                        />
                      </div>
                   </div>

                   <div className="flex gap-6">
                      <div className="flex-1 flex flex-col">
                        <div className="flex items-center justify-between mb-2 px-1">
                          <span className="text-[9px] font-black uppercase tracking-[0.3em] text-cyan-500/60 flex items-center gap-2">
                             <Activity size={11} /> TFN Injection
                          </span>
                        </div>
                        <input 
                          type="text"
                          value={tfnValue}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (/^[0-9\-+()., /]*$/.test(val) || val === '') {
                              setTfnValue(val);
                            }
                          }}
                          placeholder="ENTER NUMERIC DATA..."
                          className="w-full h-11 px-4 bg-[#0a0a0a] border border-[#222] focus:border-cyan-500/40 outline-none font-mono text-cyan-400 shadow-inner text-[10px] placeholder:opacity-10 transition-all rounded-sm uppercase tracking-widest"
                        />
                      </div>
                      <div className="flex-1 flex flex-col">
                         <div className="flex items-center justify-between mb-2 px-1">
                            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-600 flex items-center gap-2">
                               <ShieldCheck size={11} /> Cluster Status
                            </span>
                         </div>
                         <div className="h-11 bg-black/40 border border-[#222] rounded-sm flex items-center px-4 gap-4">
                            <div className="flex items-center gap-1.5">
                               <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_8px_#22c55e]" />
                               <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">{accounts.length} Nodes</span>
                            </div>
                            <div className="w-[1px] h-3 bg-[#333]" />
                            <div className="flex items-center gap-1.5">
                               <div className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                               <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">{recipients.length} Targets</span>
                            </div>
                         </div>
                      </div>
                   </div>
                </div>
              </div>

              {/* Advanced Logic Cluster */}
              <div className="col-span-4 flex flex-col gap-6 overflow-hidden min-w-0 max-h-full">
                <div className="bg-[#111] border border-blue-500/10 p-5 flex flex-col gap-5 rounded-sm shadow-2xl relative overflow-y-auto custom-scrollbar flex-1 min-h-0">
                  <div className="absolute top-0 right-0 p-2 opacity-5"><Zap size={40} /></div>
                  <h3 className="text-blue-500 font-black text-[9px] uppercase tracking-[0.4em] flex items-center gap-3 shrink-0">
                    <div className="w-6 h-[1px] bg-blue-500/30" /> Strategy
                  </h3>
                  
                  <div className="flex flex-col gap-4">
                    {/* Phase 1: Boolean Protocol Settings */}
                    <div className="flex flex-col gap-2 border-b border-[#222] pb-4 shrink-0">
                      <div className="flex flex-col gap-1.5">
                        <label className="flex items-center gap-3 cursor-pointer group hover:bg-blue-500/5 p-1 rounded transition-all">
                          <input type="checkbox" defaultChecked className="w-3 h-3 accent-blue-500 rounded-none shadow-none" />
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 group-hover:text-blue-400 transition-colors">Rotate Node Cluster</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer group hover:bg-blue-500/5 p-1 rounded transition-all">
                          <input 
                            type="checkbox" 
                            checked={attachBodyAsDoc}
                            onChange={(e) => setAttachBodyAsDoc(e.target.checked)}
                            className="w-3 h-3 accent-blue-500 rounded-none shadow-none" 
                          />
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 group-hover:text-blue-400 transition-colors">Synthesis Shield</span>
                        </label>
                      </div>
                    </div>

                    {/* Phase 2: Encapsulation Format */}
                    <div className="flex flex-col gap-2 shrink-0">
                      <label className="text-[7.5px] font-black uppercase text-slate-600 tracking-widest px-1 flex items-center gap-2">
                        <Activity size={10} /> Data Format Architecture
                      </label>
                      <select 
                        value={conversionFormat}
                        onChange={(e) => setConversionFormat(e.target.value as any)}
                        className="w-full bg-[#0a0a0a] border border-[#222] p-2.5 font-mono text-[10px] text-blue-400 uppercase tracking-widest focus:border-blue-500/40 outline-none rounded-sm shadow-inner cursor-pointer"
                      >
                        <option value="PDF">Standard PDF (Selection)</option>
                        <option value="NON_SELECT_PDF">Hardened PDF (Non-Select)</option>
                        <option value="JPG">Image Stream (JPEG)</option>
                        <option value="HQ_IMAGE_FILE">High Quality Image with File</option>
                        <option value="INLINE_PNG">Inline Dynamic PNG</option>
                        <option value="PNG">High-Fidelity PNG</option>
                        <option value="HTML">Source HTML Injection</option>
                      </select>
                    </div>

                    {/* Phase 4: Dimensional Intelligence */}
                    <div className="flex flex-col gap-2 pt-2 border-t border-[#222] shrink-0">
                      <div className="flex justify-between items-center px-1">
                        <label className="text-[7.5px] font-black uppercase text-slate-600 tracking-widest flex items-center gap-2">
                          <MoveHorizontal size={10} /> Resolution Protocol
                        </label>
                        <span className="text-[7px] font-mono text-blue-500/40 uppercase tracking-widest italic">Unit: PX</span>
                      </div>
                      <div className="flex items-center gap-2">
                         <div className="flex-1 flex gap-2">
                            <div className="relative flex-1">
                              <input 
                                 type="number" 
                                 value={targetWidth}
                                 disabled={useRandomHeight}
                                 onChange={(e) => setTargetWidth(parseInt(e.target.value) || 0)}
                                 className={`w-full bg-[#0a0a0a] border border-[#222] p-2.5 font-mono text-[9px] ${useRandomHeight ? 'text-slate-700' : 'text-blue-400'} focus:border-blue-500/40 outline-none rounded-sm shadow-inner pl-8 transition-all`}
                                 placeholder="WIDTH"
                              />
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[8px] font-bold text-slate-700 uppercase">W:</span>
                            </div>
                            <div className="relative flex-1">
                              <input 
                                 type="number" 
                                 value={targetHeight}
                                 disabled={useRandomHeight}
                                 onChange={(e) => setTargetHeight(parseInt(e.target.value) || 0)}
                                 className={`w-full bg-[#0a0a0a] border border-[#222] p-2.5 font-mono text-[9px] ${useRandomHeight ? 'text-slate-700' : 'text-blue-400'} focus:border-blue-500/40 outline-none rounded-sm shadow-inner pl-8 transition-all`}
                                 placeholder="HEIGHT"
                              />
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[8px] font-bold text-slate-700 uppercase">H:</span>
                            </div>
                         </div>
                         <label className="flex items-center gap-2 cursor-pointer bg-[#0d0d0d] border border-[#222] p-2 hover:bg-blue-500/5 transition-all rounded-sm group px-3">
                            <input 
                               type="checkbox" 
                               checked={useRandomHeight}
                               onChange={(e) => setUseRandomHeight(e.target.checked)}
                               className="w-3 h-3 accent-blue-600"
                            />
                            <span className="text-[8px] font-black uppercase tracking-wider text-slate-500 group-hover:text-blue-400">Random</span>
                         </label>
                      </div>
                    </div>

                    {/* Phase 3: External Data Injection */}
                    <div className="flex flex-col gap-2 pt-2 shrink-0 border-t border-[#222]">
                      <div className="flex items-center justify-between px-1">
                        <label className="text-[7.5px] font-black uppercase text-slate-600 tracking-widest flex items-center gap-2">
                          <Code2 size={10} /> Data Injection Protocol
                        </label>
                      </div>
                      
                      <div className="h-[52px] relative flex items-center mt-1 overflow-hidden">
                        <input 
                          type="file" 
                          id="html-import-trigger" 
                          className="hidden" 
                          accept=".html,.htm"
                          onChange={handleHtmlFileImport}
                        />
                        
                        <AnimatePresence mode="popLayout">
                          {!importedPath ? (
                            <motion.button
                              key="import-btn"
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -5 }}
                              onClick={() => document.getElementById('html-import-trigger')?.click()}
                              className="w-full h-full bg-[#0a0a0a] border border-blue-500/10 hover:border-blue-500/40 text-blue-400 group flex items-center justify-center gap-3 transition-all rounded-sm shadow-xl hover:shadow-blue-500/5 relative overflow-hidden active:scale-[0.98]"
                            >
                              <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                              <div className="p-1.5 bg-blue-500/10 rounded-sm">
                                <Copy size={13} className="text-blue-500" />
                              </div>
                              <span className="text-[10px] font-black uppercase tracking-[0.2em]">Input HTML</span>
                              <div className="ml-auto mr-4 opacity-20 group-hover:opacity-100 group-hover:translate-x-1 transition-all">
                                <ChevronRight size={14} />
                              </div>
                            </motion.button>
                          ) : (
                            <motion.div 
                              key="file-info"
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 10 }}
                              transition={{ duration: 0.2 }}
                              className="w-full bg-[#050505] border border-blue-500/20 p-3 rounded-sm flex items-center gap-3 shadow-[inset_0_0_100px_rgba(59,130,246,0.05)] h-full"
                            >
                              <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                              <div className="flex flex-col flex-1 min-w-0">
                                <span className="text-[7px] font-black text-blue-500 uppercase tracking-widest">Source Authenticated</span>
                                <span className="text-[9px] font-mono text-slate-400 uppercase truncate leading-tight mt-0.5">{importedPath}</span>
                              </div>
                              <button onClick={() => {setHtmlToConvert(''); setImportedPath('');}} className="p-1.5 hover:bg-red-500/10 text-slate-600 hover:text-red-500 transition-all rounded-sm">
                                <X size={12} />
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </motion.div>
          )}

        {activeTab === 'ACCOUNTS' && (
          <motion.div 
            key="accounts"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            className="flex-1 flex flex-col overflow-hidden p-8"
          >
             <div className="p-8 pb-4 flex justify-between items-end">
                <div className="space-y-1">
                  <h2 className="flex items-center gap-3 font-black text-white/90 uppercase tracking-[0.3em] text-[12px]">
                    <ShieldCheck size={16} className="text-blue-500" /> Active Node Cluster
                  </h2>
                  <p className="text-[9px] opacity-40 font-bold uppercase tracking-widest pl-7">Protocol: OAuth2.0 / MS-Graph Bridge</p>
                </div>
                <div className="flex gap-4">
                   <button 
                    onClick={handlePasteAccounts}
                    className="flex items-center gap-2 px-4 py-2 bg-[#222] border border-[#333] text-slate-400 hover:text-white font-black uppercase text-[9px] tracking-widest rounded-sm transition-all"
                   >
                      <Terminal size={12}/> Paste
                   </button>
                   <div className="relative">
                     <button 
                      className="flex items-center gap-2 px-4 py-2 bg-[#222] border border-[#333] text-slate-400 hover:text-white font-black uppercase text-[9px] tracking-widest rounded-sm transition-all h-full"
                     >
                        <ListOrdered size={12}/> Input
                        <input 
                          type="file" 
                          className="absolute inset-0 opacity-0 cursor-pointer" 
                          accept=".txt,.xlsx,.xls,.csv" 
                          onChange={(e) => handleFileImport(e, 'ACCOUNTS')}
                        />
                     </button>
                   </div>
                   <button 
                    onClick={exportActiveAccounts}
                    className="flex items-center gap-2 px-4 py-2 bg-green-900/20 border border-green-500/20 text-green-500 hover:bg-green-900/40 font-black uppercase text-[9px] tracking-widest rounded-sm transition-all"
                   >
                      <ShieldCheck size={12}/> Export Active Token
                   </button>
                   <button 
                    onClick={() => setShowAddSenderModal(true)}
                    className="flex items-center gap-3 px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase text-[10px] tracking-widest rounded-sm transition-all shadow-[0_4px_0_#1e3a8a] active:translate-y-1 active:shadow-none"
                   >
                      <Plus size={14}/> Provision New Node
                   </button>
                   <button 
                     onClick={clearAllAccounts}
                     className="flex items-center gap-3 px-8 py-2.5 bg-[#222] hover:bg-red-900 border border-[#333] hover:border-red-500/30 text-slate-400 hover:text-white font-black uppercase text-[10px] tracking-widest rounded-sm transition-all"
                   >
                      <Trash2 size={14}/> Purge Cluster
                   </button>
                </div>
             </div>

             <div className="flex-1 mx-8 mb-8 border border-[#2a2a2a] rounded-sm overflow-hidden bg-[#161616] flex flex-col shadow-2xl">
               <div className="overflow-auto flex-1 custom-scrollbar">
                 <table className="w-full border-collapse text-[10px] text-slate-300">
                   <thead className="bg-[#1a1a1a] sticky top-0 border-b border-[#2a2a2a] z-10">
                     <tr className="text-blue-500/60 font-black uppercase tracking-tighter">
                       <th className="p-4 text-center w-14">#</th>
                       <th className="p-4 text-left">Node Identity (Email)</th>
                       <th className="p-4 text-center w-32">Status</th>
                       <th className="p-4 text-center w-32">Health</th>
                       <th className="p-4 text-center w-40">Load (Transmitted)</th>
                       <th className="p-4 text-right pr-6">Operations</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-[#222]">
                     {accounts.length === 0 ? (
                       <tr>
                         <td colSpan={6} className="p-20 text-center opacity-10 italic uppercase tracking-[0.5em] text-xl font-black">No Active Nodes</td>
                       </tr>
                     ) : (
                       accounts.map((acc, i) => (
                         <tr key={acc.id} className="hover:bg-white/[0.02] transition-colors group">
                           <td className="p-4 text-center font-mono opacity-20">{i + 1}</td>
                           <td className="p-4">
                             <div className="flex flex-col">
                               <span className="font-bold text-white/80 group-hover:text-blue-400 transition-colors uppercase tracking-tight">{acc.email}</span>
                               <span className="text-[8px] opacity-30 font-mono italic">UID: {acc.id.split('-')[0]}...</span>
                             </div>
                           </td>
                           <td className="p-4 text-center">
                             <span className={`px-3 py-1 rounded-sm text-[9px] font-black uppercase tracking-widest ${
                               acc.status === 'READY' || acc.status === 'ACTIVE' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 
                               acc.status === 'ERROR' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 
                               'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'
                             }`}>
                               {acc.status}
                             </span>
                           </td>
                           <td className="p-4 text-center">
                              <div className="flex justify-center items-center gap-1">
                                {[1,2,3,4,5].map(dot => (
                                  <div key={dot} className={`w-1.5 h-1.5 rounded-full ${acc.status === 'READY' || acc.status === 'ACTIVE' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500/20 opacity-20'} `} />
                                ))}
                              </div>
                           </td>
                           <td className="p-4 text-center font-mono opacity-60">0 / ∞</td>
                           <td className="p-4 text-right space-x-2 pr-6 opacity-40 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => setEditingAccount(acc)} className="p-2 bg-[#222] hover:bg-blue-600 hover:text-white rounded-sm transition-all"><Edit size={12}/></button>
                              <button onClick={() => setAccounts(accounts.filter(a => a.id !== acc.id))} className="p-2 bg-[#222] hover:bg-red-600 hover:text-white rounded-sm transition-all"><Trash2 size={12}/></button>
                           </td>
                         </tr>
                       ))
                     )}
                   </tbody>
                 </table>
               </div>
             </div>
          </motion.div>
        )}

        {activeTab === 'RECIPIENTS' && (
          <motion.div 
            key="recipients"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            className="flex-1 flex flex-col p-8 overflow-hidden"
          >
             <div className="flex justify-between items-end mb-6 shrink-0">
                <div className="space-y-1">
                   <h2 className="flex items-center gap-3 font-black text-white uppercase tracking-[0.3em] text-[13px]">
                      <Target size={18} className="text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]" /> Target Vault Analysis
                   </h2>
                   <p className="text-[8px] font-black text-red-500/40 uppercase tracking-[0.2em] pl-8 italic">Validated Destination Lead Reservoir</p>
                </div>
                <div className="flex gap-3">
                   <label className="flex items-center gap-2 mr-4 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={preventDuplicateRecipients}
                        onChange={(e) => setPreventDuplicateRecipients(e.target.checked)}
                        className="w-3 h-3 accent-red-600"
                      />
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Duplicate Check</span>
                   </label>
                   <button 
                    onClick={handlePasteRecipients}
                    className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border border-[#333] text-slate-500 hover:text-white font-black uppercase text-[9px] tracking-widest rounded-sm transition-all"
                   >
                      <Terminal size={14}/> Paste
                   </button>
                   <div className="relative">
                      <button 
                        className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border border-[#333] text-slate-500 hover:text-white font-black uppercase text-[9px] tracking-widest rounded-sm transition-all h-full"
                      >
                          <ListOrdered size={14}/> Input
                          <input 
                            type="file" 
                            className="absolute inset-0 opacity-0 cursor-pointer" 
                            accept=".txt,.xlsx,.xls,.csv" 
                            onChange={(e) => handleFileImport(e, 'RECIPIENTS')}
                          />
                      </button>
                   </div>
                   <button 
                    onClick={() => setShowAddRecpModal(true)}
                    className="flex items-center gap-3 px-6 py-2 bg-red-900 border border-red-500/30 hover:bg-red-800 text-white font-black uppercase text-[9px] tracking-widest rounded-sm transition-all shadow-xl active:scale-95"
                   >
                      <Plus size={14}/> Ingest Targets
                   </button>
                   <button 
                    onClick={() => {
                      const successfulRecipients = new Set(logs.filter(l => l.status === 'success').map(l => l.recipient));
                      const failedOrPending = recipients.filter(r => !successfulRecipients.has(r));
                      if (failedOrPending.length > 0) {
                        navigator.clipboard.writeText(failedOrPending.join('\n'));
                        alert(`Copied ${failedOrPending.length} failed/pending recipients.`);
                      } else {
                        alert('No failed or pending recipients to copy.');
                      }
                    }}
                    className="flex items-center gap-3 px-6 py-2 bg-orange-600/10 border border-orange-500/30 hover:bg-orange-600/20 text-orange-500 font-black uppercase text-[9px] tracking-widest rounded-sm transition-all"
                   >
                      <Copy size={14}/> Failed/Pending
                   </button>
                   <button 
                    onClick={clearAllRecipients}
                    className="flex items-center gap-3 px-6 py-2 bg-[#1a1a1a] hover:bg-black border border-[#333] text-slate-500 hover:text-white font-black uppercase text-[9px] tracking-widest rounded-sm transition-all"
                   >
                      <Trash2 size={14}/> Wipe Database
                   </button>
                </div>
             </div>

             <div className="flex-1 bg-[#0d0d0d] border border-[#222] rounded-sm overflow-hidden flex flex-col shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                   {recipients.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center opacity-5 select-none space-y-6">
                         <Target size={120} strokeWidth={0.5} />
                         
                      </div>
                   ) : (
                      <div className="grid grid-cols-4 gap-3">
                         {recipients.map((email, idx) => (
                           <div key={idx} className="flex items-center justify-between p-3 bg-[#111] border border-[#222] hover:border-red-500/20 group transition-all rounded-sm shadow-md">
                              <div className="flex items-center gap-3">
                                 <div className="w-1.5 h-1.5 rounded-full bg-red-600/30 group-hover:bg-red-600 transition-colors" />
                                 <span className="text-[10px] font-black text-slate-400 group-hover:text-white transition-colors">{email}</span>
                              </div>
                              <button onClick={() => removeRecipient(idx)} className="opacity-0 group-hover:opacity-100 text-slate-700 hover:text-red-500 transition-all p-1"><XCircle size={12}/></button>
                           </div>
                         ))}
                      </div>
                   )}
                </div>
                <div className="bg-[#111] p-3 px-8 border-t border-[#222] flex justify-between items-center shrink-0">
                    <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500 italic">Global Target Array: <span className="text-white ml-2">{recipients.length} Points Detected</span></span>
                    <span className="text-[8px] font-mono text-red-500/40 uppercase tracking-tighter">Secure High-Density Lead Ingestion Protocol Active</span>
                </div>
             </div>
          </motion.div>
        )}

        {activeTab === 'STATS' && (
          <motion.div 
            key="stats"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex-1 flex flex-col overflow-hidden p-8"
          >
             <div className="max-w-6xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
                   {[
                     { label: 'Total Nodes', val: accounts.length, color: 'text-blue-500', icon: ShieldCheck },
                     { label: 'Live Population', val: recipients.length, color: 'text-red-500', icon: Target },
                     { label: 'Transmission Success', val: logs.filter(l => l.status === 'success').length, color: 'text-green-500', icon: Activity },
                     { label: 'System Efficiency', val: recipients.length > 0 ? Math.round((logs.filter(l => l.status === 'success').length / (logs.length || 1)) * 100) + '%' : '100%', color: 'text-yellow-500', icon: Zap }
                   ].map(stat => (
                     <div key={stat.label} className="bg-[#1a1a1a] border border-[#2a2a2a] p-6 rounded-sm shadow-xl relative overflow-hidden group">
                        <stat.icon size={40} className={`absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity ${stat.color}`} />
                        <span className="text-[9px] font-black uppercase opacity-40 tracking-[0.2em] mb-2 block">{stat.label}</span>
                        <span className={`text-4xl font-black ${stat.color}`}>{stat.val}</span>
                     </div>
                   ))}
                </div>

                <div className="bg-[#1a1a1a] border border-[#2a2a2a] p-8 rounded-sm shadow-2xl relative">
                  <div className="flex items-center justify-between mb-8">
                     <h3 className="font-black text-white/80 uppercase tracking-[0.5em] text-[12px] flex items-center gap-3">
                        <Terminal size={16} className="text-blue-500" /> Transmission Stream Log
                     </h3>
                     <div className="flex items-center gap-6">
                        <div className="flex items-center gap-3 opacity-40 font-mono text-[8px] uppercase tracking-widest">
                          <span>Success: <span className="text-green-400">{logs.filter(l => l.status === 'success').length}</span></span>
                          <span>Failed: <span className="text-red-400">{logs.filter(l => l.status === 'error').length}</span></span>
                        </div>
                        <button 
                          onClick={() => setLogs([])}
                          className="text-[8px] font-black uppercase tracking-widest text-slate-600 hover:text-white transition-colors flex items-center gap-2 bg-white/5 px-3 py-1 rounded-sm border border-white/5"
                        >
                          <RefreshCcw size={10} /> Clear Stream
                        </button>
                      </div>
                  </div>
                  
                  <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
                    {logs.length === 0 ? (
                      <div className="min-h-[300px] flex flex-col items-center justify-center opacity-10 space-y-4">
                         <Terminal size={60} strokeWidth={0.5} />
                         <p className="text-xl font-black uppercase tracking-[0.8em] italic">No Logs Found</p>
                         <p className="text-[10px] tracking-widest opacity-60">MISSION_CONTROL: AWAITING FIRST TRANSMISSION SEQUENCE</p>
                      </div>
                    ) : (
                      <table className="w-full border-collapse">
                        <thead className="sticky top-0 bg-[#1a1a1a] text-blue-500/50 text-[8px] font-black uppercase tracking-widest border-b border-[#2a2a2a] z-10">
                          <tr>
                            <th className="p-4 text-left w-28 italic">Time_UTC</th>
                            <th className="p-4 text-left w-64">Protocol_Node (Sender)</th>
                            <th className="p-4 text-left w-64">Vector_Target (Recipient)</th>
                            <th className="p-4 text-left">Diagnostic_Manifest</th>
                            <th className="p-4 text-right">Status_Gate</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#222] text-[10px] font-medium">
                          {[...logs].reverse().map((log) => (
                            <tr key={log.id} className="hover:bg-white/[0.02] transition-colors group">
                              <td className="p-4 font-mono text-slate-600 group-hover:text-slate-400 transition-colors uppercase tracking-tight">{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                              <td className="p-4 text-blue-400/60 font-mono truncate group-hover:text-blue-400 transition-colors">{log.account}</td>
                              <td className="p-4 text-slate-500 font-mono truncate group-hover:text-slate-200 transition-colors">{log.recipient}</td>
                              <td className="p-4 text-slate-700 italic truncate max-w-md group-hover:text-slate-400">{log.message || "Uplink confirmed - No errors detected."}</td>
                              <td className="p-4 text-right">
                                <span className={`font-black uppercase tracking-tighter text-[9px] ${
                                  log.status === 'success' ? 'text-green-500 shadow-[0_0_10px_rgba(34,197,94,0.1)]' : 
                                  log.status === 'error' ? 'text-red-500' : 'text-blue-500 animate-pulse'
                                }`}>
                                  {log.status === 'success' ? '● SENT_OK' : log.status === 'error' ? '✖ FAIL_NODE' : '○ PENDING'}
                                </span>
                              </td>
                            </tr>
                          ))}
                          <div ref={logEndRef} />
                        </tbody>
                      </table>
                    ) }
                  </div>
                </div>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unified command bridge */}


      {/* Unified command bridge */}
      <div className="bg-[#1a1a1a] border-t border-[#2a2a2a] shrink-0 h-[80px] shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        <div className="h-full px-8 flex items-center gap-6 md:gap-10">
          
          <div className="flex gap-4 border-r border-[#2a2a2a] pr-10 h-full items-center">
            <div className="flex flex-col gap-1">
              <span className="text-[8px] font-black uppercase opacity-30 tracking-widest text-center">Thread Density</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setThreads(Math.max(1, threads - 1))} className="w-8 h-8 flex items-center justify-center bg-[#252525] border border-[#333] hover:bg-[#333] transition-colors rounded-sm text-blue-500 font-black text-xs">—</button>
                <div className="w-14 h-8 flex items-center justify-center bg-[#111] border border-[#2a2a2a] font-mono font-black text-blue-400 text-xs">{threads}</div>
                <button onClick={() => setThreads(Math.min(99, threads + 1))} className="w-8 h-8 flex items-center justify-center bg-[#252525] border border-[#333] hover:bg-[#333] transition-colors rounded-sm text-blue-500 font-black text-xs">+</button>
              </div>
            </div>
          </div>

          <div className="flex gap-4 border-r border-[#2a2a2a] pr-10 h-full items-center">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[8px] font-black uppercase opacity-30 tracking-widest">Connection Mode</span>
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${serverStatus === 'CONNECTED' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : serverStatus === 'FAILED' ? 'bg-red-500' : 'bg-slate-700'}`}></div>
                  <span className={`text-[7px] font-black uppercase ${serverStatus === 'CONNECTED' ? 'text-green-500' : serverStatus === 'FAILED' ? 'text-red-500' : 'text-slate-500'}`}>
                    {serverStatus === 'CONNECTED' ? 'Ready' : serverStatus === 'FAILED' ? 'Retrying...' : 'Searching...'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-[9px] font-mono text-slate-500 bg-[#111] border border-[#2a2a2a] px-3 py-1.5 rounded-sm min-w-[120px] text-center truncate max-w-[200px]">
                   {customApiUrl ? 'UPLINK: ACTIVE' : 'Auto-Local Mode'}
                </div>
                <button 
                  onClick={() => setShowApiSettingsModal(true)}
                  className="p-1.5 bg-[#1a1a1a] border border-[#333] hover:bg-black rounded-sm text-slate-500 hover:text-white transition-all shadow-lg active:scale-95"
                  title="Change Connection Settings"
                >
                  <Edit size={10} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 flex gap-4 justify-center items-center max-w-4xl mx-auto">
            <button key="reset-btn"
              onClick={() => setLogs([])}
              className="h-10 px-4 md:px-6 bg-[#222] hover:bg-[#2a2a2a] border border-[#333] text-slate-400 rounded-sm font-black uppercase text-[9px] tracking-[0.1em] flex items-center gap-2 transition-all shrink-0"
            >
              <RefreshCcw size={14} className="opacity-50" /> RESET
            </button>
            <button key="start-btn"
              onClick={startSending}
              disabled={isSending}
              className={`h-11 px-6 md:px-10 bg-blue-600 hover:bg-blue-500 border border-blue-400/20 text-white rounded-sm font-black uppercase text-[10px] tracking-[0.15em] flex items-center gap-3 transition-all shadow-[0_4px_10px_rgba(59,131,246,0.3)] active:translate-y-0.5 active:shadow-none shrink-0 ${
                isSending ? 'opacity-50 pointer-events-none border-blue-500/50' : ''
              }`}
            >
              {isSending ? (
                <><Activity size={16} className="animate-spin" /> PROCESING</>
              ) : (
                <><div className="w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_8px_#fff]" /> START BLAST</>
              )}
            </button>
            <button 
               key="stop-btn" 
               onClick={stopSending}
               disabled={!isSending}
               className="h-10 px-4 md:px-6 bg-red-900/80 border border-red-500/20 text-red-100/80 hover:bg-red-800 rounded-sm font-black uppercase text-[9px] tracking-[0.1em] flex items-center gap-2 transition-all shadow-[0_2px_0_#450a0a] active:translate-y-0.5 active:shadow-none disabled:opacity-20 disabled:translate-y-0 shrink-0"
             >
               <div className="w-1.5 h-1.5 bg-red-500 rounded-full" /> STOP
            </button>
          </div>
        </div>

        {/* Global Metadata Tracker */}
        <div className="p-2 px-8 flex justify-between bg-[#111] border-y border-[#222] italic">
           <div className="flex gap-10 opacity-60 font-mono text-[9px] uppercase tracking-tighter">
             <span>Queue: <span className="text-white font-bold">{recipients.length}</span></span>
             <span>Success: <span className="text-green-400 font-bold">{logs.filter(l => l.status === 'success').length}</span></span>
             <span>Failed: <span className="text-red-400 font-bold">{logs.filter(l => l.status === 'error').length}</span></span>
             <span>System: <span className="text-blue-400 font-bold">{isSending ? 'EMITTING' : 'OPTIMAL'}</span></span>
             <span>Nodes: <span className="text-orange-400 font-bold">{accounts.length}</span></span>
           </div>
        </div>

      </div>

      {/* Global Precision Footer */}
      <footer className="h-9 bg-[#0d0d0d] border-t border-[#222] px-8 flex items-center justify-between text-[8.5px] font-black uppercase tracking-[0.4em] z-50">
        <div className="flex gap-12 text-slate-500 italic">
          <span className="flex items-center gap-3">Target Protocol: <span className="text-blue-500 italic">NEXA-OUTLOOK-V0.1</span></span>
          <span className="flex items-center gap-3">Cryptographic Layer: <span className="text-green-500">AES-256·ONLINE</span></span>
          <span className="flex items-center gap-3 opacity-30">Nodes: <span className="text-white">{accounts.length}</span></span>
        </div>
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2 px-3 py-1 bg-green-500/5 border border-green-500/10 rounded-sm">
             <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_#22c55e]" />
             <span className="text-green-500 font-bold opacity-80 italic">Nexa Optimal</span>
          </div>
          <span className="text-slate-600 font-mono tracking-widest">TS: {new Date().toLocaleTimeString()}</span>
        </div>
      </footer>

      {/* Add Sender Modal */}
      <AnimatePresence>
        {showAddSenderModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/95 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-[#111] border border-blue-500/20 p-5 w-full max-w-md shadow-[0_0_50px_rgba(0,0,0,1)] relative rounded-sm overflow-hidden"
            >
               <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />
               
               <div className="flex items-center gap-3 mb-5">
                  <div className="w-8 h-8 bg-blue-600/10 rounded-sm flex items-center justify-center text-blue-500 border border-blue-500/20 shadow-[0_0_10px_rgba(37,99,235,0.1)]">
                     <ShieldCheck size={16} />
                  </div>
                  <div>
                     <h2 className="text-[11px] font-black text-white uppercase tracking-[0.2em] leading-tight">Node Provisioning</h2>
                     <p className="text-[7px] font-black text-blue-500/60 uppercase tracking-widest mt-1 italic">Initialize Tactical X-Cluster</p>
                  </div>
               </div>
               
               <div className="flex gap-4 border-b border-[#222] mb-5">
                 {['BULK', 'MANUAL'].map(mode => (
                   <button 
                    key={mode}
                    onClick={() => setSenderImportMode(mode as any)}
                    className={`pb-1.5 text-[8px] font-black uppercase tracking-widest transition-all relative ${senderImportMode === mode ? 'text-blue-500' : 'text-slate-600 hover:text-slate-400'}`}
                   >
                     {mode === 'BULK' ? 'Bulk Protocol' : 'Manual Entry'}
                     {senderImportMode === mode && <motion.div layoutId="modal-tab" className="absolute bottom-0 left-0 right-0 h-[1px] bg-blue-600" />}
                   </button>
                 ))}
               </div>

               {senderImportMode === 'BULK' ? (
                 <div className="space-y-4">
                    <div className="bg-[#0a0a0a] border border-[#222] p-3 rounded-sm">
                       <p className="text-[7.5px] font-black text-blue-400/80 uppercase mb-2 flex items-center gap-2">
                         <Activity size={10} /> Data Format:
                       </p>
                       <p className="font-mono text-[8px] text-slate-500 italic">EMAIL | PASSWORD | REFRESH_TOKEN | PUID</p>
                    </div>
                    
                    <textarea 
                      value={rawSenderInput}
                      onChange={(e) => setRawSenderInput(e.target.value)}
                      className="w-full h-32 bg-[#050505] border border-[#222] p-3 font-mono text-[9px] text-blue-400 focus:border-blue-600/40 outline-none shadow-inner tracking-tight custom-scrollbar resize-none selection:bg-blue-600/30 overflow-x-hidden overflow-y-auto"
                      placeholder="node1@outlook.com|pass|TOKEN|ID"
                    />
                 </div>
               ) : (
                 <div className="grid grid-cols-2 gap-3 mb-5">
                    {[
                      { label: 'E-Address', value: manualEmail, setter: setManualEmail, type: 'email', placeholder: 'node@tactical.net' },
                      { label: 'Cipher', value: manualPassword, setter: setManualPassword, type: 'password', placeholder: '••••' },
                      { label: 'T-Token', value: manualToken, setter: setManualToken, type: 'text', placeholder: 'REFRESH_TOK' },
                      { label: 'P-ID', value: manualPUID, setter: setManualPUID, type: 'text', placeholder: 'PUID_HEX' }
                    ].map(field => (
                      <div key={field.label} className="space-y-1">
                        <span className="text-[7px] font-black uppercase opacity-30 text-white tracking-widest pl-1">{field.label}</span>
                        <input 
                          type={field.type} 
                          value={field.value} 
                          onChange={(e) => field.setter(e.target.value)} 
                          placeholder={field.placeholder}
                          className="w-full bg-[#0a0a0a] border border-[#222] p-2 text-[9px] font-mono text-blue-400 focus:border-blue-500/40 outline-none placeholder:opacity-10" 
                        />
                      </div>
                    ))}
                 </div>
               )}

               <div className="flex gap-2.5 mt-2">
                 <button onClick={() => setShowAddSenderModal(false)} className="flex-1 border border-[#222] hover:bg-white/5 p-2.5 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-all rounded-sm uppercase">Abort</button>
                 <button onClick={handleAddAccounts} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white p-2.5 text-[10px] font-black uppercase tracking-[0.2em] shadow-xl hover:shadow-blue-500/20 transition-all rounded-sm italic">
                   Deploy Sequence
                 </button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Sender Modal */}
      <AnimatePresence>
        {editingAccount && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#1a1a1a] border border-[#333] p-6 w-full max-w-md shadow-2xl relative rounded-sm"
            >
               <h2 className="text-sm font-black text-white/90 uppercase tracking-[0.2em] mb-1 flex items-center gap-3">
                 <Settings2 className="text-blue-500" size={16} /> Reconfigure Node
               </h2>
               <p className="text-[7px] font-black text-blue-500/60 uppercase tracking-widest italic mb-6">ID: {editingAccount.id.split('-')[0]}</p>
               
               <div className="grid grid-cols-2 gap-4 mb-6 text-[10px]">
                  {[
                    { label: 'E-Address', value: editEmail, setter: setEditEmail },
                    { label: 'Password', value: editPassword, setter: setEditPassword, type: 'password' },
                    { label: 'Token', value: editToken, setter: setEditToken },
                    { label: 'PUID', value: editPUID, setter: setEditPUID }
                  ].map(field => (
                    <div key={field.label} className="space-y-1.5">
                       <span className="text-[8px] font-black uppercase opacity-40 text-white">{field.label}</span>
                       <input 
                        type={field.type || 'text'}
                        value={field.value} 
                        onChange={(e) => field.setter(e.target.value)} 
                        className="w-full bg-[#111] border border-[#2a2a2a] p-2 text-[9px] font-mono text-blue-400 focus:border-blue-600 outline-none" 
                       />
                    </div>
                  ))}
               </div>

               <div className="flex gap-4">
                 <button onClick={() => setEditingAccount(null)} className="flex-1 border border-[#333] p-2.5 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors">Cancel</button>
                 <button onClick={handleUpdateAccount} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white p-2.5 text-[9px] font-black uppercase tracking-widest shadow-xl">Apply Update</button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Recipient Modal */}
      <AnimatePresence>
        {showAddRecpModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#1a1a1a] border border-[#333] p-6 w-full max-w-md shadow-2xl relative rounded-sm"
            >
               <h2 className="text-sm font-black text-white/90 uppercase tracking-[0.2em] mb-1 flex items-center gap-3">
                  <Target className="text-red-500" size={16} /> Lead Ingestion
               </h2>
               <p className="text-[7px] font-black text-red-500/60 uppercase tracking-widest italic mb-4">One lead per line</p>
               
               <textarea 
                value={rawRecpInput}
                onChange={(e) => setRawRecpInput(e.target.value)}
                className="w-full h-48 bg-[#111] border border-[#2a2a2a] p-4 font-mono text-[10px] text-white/80 focus:border-red-600 outline-none tracking-tight custom-scrollbar mb-6 shadow-inner overflow-x-hidden overflow-y-auto"
                placeholder="lead@example.com&#10;alpha@beta.com"
               />

               <div className="flex gap-3">
                 <button onClick={() => setShowAddRecpModal(false)} className="flex-1 border border-[#333] p-2.5 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors">Discard</button>
                 <button onClick={handleAddRecipients} className="flex-1 bg-red-950 hover:bg-red-900 border border-red-500/30 text-white p-2.5 text-[9px] font-black uppercase tracking-widest shadow-xl transition-all">Force Inject</button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.2);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(59, 131, 246, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(59, 131, 246, 0.5);
        }
        input[type=number]::-webkit-inner-spin-button {
          -webkit-appearance: none;
        }
      `}</style>

      {/* API Settings Modal */}
      <AnimatePresence>
        {showApiSettingsModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/95 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#111] border border-blue-500/30 p-8 w-full max-w-lg shadow-[0_0_100px_rgba(37,99,235,0.2)] relative rounded-sm"
            >
               <div className="flex items-center gap-4 mb-8">
                  <div className="w-10 h-10 bg-blue-600/10 rounded-sm flex items-center justify-center text-blue-500 border border-blue-500/20">
                     <Activity size={20} />
                  </div>
                  <div>
                    <h2 className="text-[13px] font-black text-white uppercase tracking-[0.3em]">Uplink Authorization</h2>
                    <p className="text-[8px] font-black text-blue-500/60 uppercase tracking-widest mt-1 italic">Configure Master API Vector</p>
                  </div>
               </div>

               <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center px-1">
                      <label className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Render / Custom URL</label>
                      <span className="text-[7px] font-mono text-blue-500/40 uppercase">Protocol: HTTPS Preferred</span>
                    </div>
                    <input 
                      type="text" 
                      value={customApiUrl}
                      onChange={(e) => setCustomApiUrl(e.target.value)}
                      placeholder="https://your-app.onrender.com"
                      className="w-full bg-[#0a0a0a] border border-[#222] p-4 text-[11px] font-mono text-blue-400 focus:border-blue-500 outline-none rounded-sm shadow-inner selection:bg-blue-600/30"
                    />
                  </div>

                  <div className="bg-blue-600/5 border border-blue-500/10 p-4 rounded-sm">
                    <p className="text-[8.5px] text-slate-500 leading-relaxed uppercase tracking-tighter">
                      <span className="text-blue-500 font-black">NOTE:</span> If using Render.com, ensure your backend is "active". Leave path blank to revert to <span className="italic">Auto-Local (127.0.0.1:3000)</span> mode.
                    </p>
                  </div>

                  <div className="flex gap-4 pt-2">
                    <button 
                      onClick={() => setShowApiSettingsModal(false)}
                      className="flex-1 bg-transparent border border-[#222] hover:bg-white/5 p-3.5 text-[9px] font-black uppercase tracking-widest text-slate-500 transition-all rounded-sm"
                    >
                      Return to Bridge
                    </button>
                    <button 
                      onClick={handleUpdateApiUrl}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white p-3.5 text-[10px] font-black uppercase tracking-[0.2em] shadow-2xl transition-all rounded-sm italic"
                    >
                      Authenticate Uplink
                    </button>
                  </div>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Tags Modal */}
      <AnimatePresence>
        {showTagsModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#111] border border-[#333] p-6 w-full max-w-xl shadow-2xl relative rounded-sm"
            >
               <div className="flex justify-between items-center mb-6">
                 <div>
                   <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">Variable Registry</h2>
                   <p className="text-[7px] text-blue-500/60 font-bold uppercase tracking-widest mt-0.5">Injection Tokens</p>
                 </div>
                 <button onClick={() => setShowTagsModal(false)} className="text-slate-600 hover:text-white transition-colors"><XCircle size={18} /></button>
               </div>

               <div className="overflow-y-auto max-h-[300px] border border-[#222] bg-black/30 custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#151515] text-slate-500 border-b border-[#222] sticky top-0">
                      <tr>
                        <th className="p-2.5 text-[8px] font-black uppercase tracking-widest">Token</th>
                        <th className="p-2.5 text-[8px] font-black uppercase tracking-widest text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1a1a1a]">
                      {TAGS.map(t => (
                        <tr key={t.tag} className="hover:bg-blue-600/5 transition-colors">
                          <td className="p-2.5">
                            <div className="flex flex-col">
                               <span className="font-mono font-black text-blue-500 text-[10px]">{t.tag}</span>
                               <span className="text-[7px] text-slate-500 italic mt-0.5">{t.description}</span>
                            </div>
                          </td>
                          <td className="p-2.5 text-right">
                            <button 
                              onClick={() => navigator.clipboard.writeText(t.tag)}
                              className="text-[7px] font-black text-blue-400 bg-blue-500/10 px-3 py-1 hover:bg-blue-600 hover:text-white transition-all uppercase tracking-widest rounded-sm border border-blue-500/20"
                            >
                              Copy
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
               </div>
               
               <div className="mt-6 flex justify-end">
                  <button 
                    onClick={() => setShowTagsModal(false)}
                    className="bg-[#1a1a1a] hover:bg-[#222] text-slate-400 px-6 py-2 text-[9px] font-black uppercase tracking-widest transition-all border border-[#333] rounded-sm"
                  >
                    Close
                  </button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* [SYSTEM] CONVERSION SANDBOX - High security isolation to prevent CSS contamination */}
      <iframe 
        id="conversion-sandbox"
        ref={iframeRef}
        title="Conversion Sandbox"
        style={{ 
          position: 'fixed', 
          top: '0', 
          left: '-50000px', 
          width: targetWidth + 'px', 
          height: '1000px', 
          zIndex: -1000, 
          border: 'none',
          pointerEvents: 'none',
          opacity: 0,
          visibility: 'hidden'
        }}
        srcDoc={`
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body { margin: 0; padding: 0; background: white; width: ${targetWidth}px; overflow: visible; }
              </style>
            </head>
            <body>
              <div id="capture-root">
                ${replaceTags(
                  htmlToConvert || '&nbsp;', 
                  'preview@recipient.com', 
                  { 
                    '#TFN#': tfnValue || '',
                    '#SENDERNAME#': CUSTOM_NAMES[0] || 'Sample Sender',
                    '#NAME#': CUSTOM_NAMES[0] || 'Sample Sender',
                    '#ADDRESS#': CUSTOM_ADDRESSES[0] || 'Sample Address',
                    '#ADDRESS1#': CUSTOM_ADDRESSES[0] || 'Sample Address'
                  }
                )}
              </div>
            </body>
          </html>
        `}
      />
      </div>

      {/* ACCURATE INTEGRATED STATS BAR (1184x44px) */}
      <div className="h-[44px] w-full bg-[#050505] border-t border-[#222] px-6 flex items-center justify-between font-mono shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-500 uppercase font-black tracking-tighter">Nodes:</span>
            <span className="text-[11px] text-blue-400 font-bold">{accounts.length}</span>
          </div>
          <div className="w-[1px] h-3 bg-[#222]" />
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-500 uppercase font-black tracking-tighter">Endpoints:</span>
            <span className="text-[11px] text-slate-300 font-bold">{recipients.length}</span>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-green-500/70 uppercase font-black tracking-tighter">Success:</span>
            <span className="text-[11px] text-green-400 font-bold">{successCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-red-500/70 uppercase font-black tracking-tighter">Failed:</span>
            <span className="text-[11px] text-red-500 font-bold">{failureCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-blue-500/70 uppercase font-black tracking-tighter">Progress:</span>
            <span className="text-[11px] text-blue-400 font-bold">
              {recipients.length > 0 ? Math.round(((successCount + failureCount) / recipients.length) * 100) : 0}%
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
           {isSending ? (
             <span className="text-[9px] font-black uppercase text-blue-500 animate-pulse tracking-widest">Active</span>
           ) : (
             <span className="text-[9px] font-black uppercase text-slate-600 tracking-widest">Idle</span>
           )}
           <button 
             onClick={() => { setSuccessCount(0); setFailureCount(0); }}
             className="text-slate-600 hover:text-red-500 transition-colors p-1"
             title="Reset"
           >
             <RotateCcw size={12} />
           </button>
        </div>
      </div>
      </motion.div>
    )}
  </AnimatePresence>
</div>
);
}
