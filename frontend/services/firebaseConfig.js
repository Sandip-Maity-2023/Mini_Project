import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { Platform } from "react-native";
import {
  browserLocalPersistence,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: "AIzaSyCgOKP-abGsboZjlvGFoJeNV-hJ0rldWw8",
  authDomain: "eyescanapp-b90df.firebaseapp.com",
  projectId: "eyescanapp-b90df",
  storageBucket: "eyescanapp-b90df.appspot.com",
  messagingSenderId: "728433674254",
  appId: "1:728433674254:web:800d4e85ecd3c1e9fe945f"
};

// Initialize Firebase (Singleton pattern to prevent multiple app instances)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const createAuth = () => {
  try {
    return initializeAuth(app, {
      persistence:
        Platform.OS === "web"
          ? browserLocalPersistence
          : getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch (error) {
    return getAuth(app);
  }
};

export const auth = createAuth();

// Export Services
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
