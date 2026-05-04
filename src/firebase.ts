import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, inMemoryPersistence } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyCdZnXMH0d8wHot_iuQcuUork1sd7HwWpE",
  authDomain: "nexcamailor.firebaseapp.com",
  databaseURL: "https://nexcamailor-default-rtdb.firebaseio.com",
  projectId: "nexcamailor",
  storageBucket: "nexcamailor.firebasestorage.app",
  messagingSenderId: "916803971721",
  appId: "1:916803971721:web:5cc4511d8f5e66a0cbf458"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Disable automatic session persistence - user must login every time the app starts
setPersistence(auth, inMemoryPersistence);

export const rtdb = getDatabase(app);

export const getHWID = () => {
    let hwid = localStorage.getItem('nexa_hwid');
    if (!hwid) {
        hwid = 'HWID-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now();
        localStorage.setItem('nexa_hwid', hwid);
    }
    return hwid;
};
