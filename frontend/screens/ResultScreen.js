import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, Dimensions, Image, Alert,
  Animated, Easing, Platform
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, FontAwesome5, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';

// --- UPGRADED LIBRARIES ---
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';

// Firebase Services
import { db } from '../services/firebaseConfig'; 
import { doc, updateDoc, serverTimestamp, collection, addDoc } from "firebase/firestore";

const { width } = Dimensions.get('window');
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'web' ? 'http://127.0.0.1:5000' : 'http://10.150.132.237:5000');

const appendImageToFormData = async (formData, imageUri) => {
  const fileName = `scan-${Date.now()}.jpg`;

  if (Platform.OS === 'web') {
    const imageResponse = await fetch(imageUri);
    const imageBlob = await imageResponse.blob();
    formData.append('image', imageBlob, fileName);
    return;
  }

  formData.append('image', {
    uri: imageUri,
    name: fileName,
    type: 'image/jpeg',
  });
};

// --- PROFESSIONAL MEDICAL THEME ---
const THEME = {
  primary: '#0A7EA4',
  secondary: '#64B5F6',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  bgDark: '#011835',
  bgCard: '#1A1F2E',
  bgCardLight: '#232936',
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  border: 'rgba(148, 163, 184, 0.15)',
  borderActive: 'rgba(10, 126, 164, 0.3)',
  glassBg: 'rgba(26, 31, 46, 0.85)',
};

// --- ANIMATED CONFIDENCE CIRCLE ---
const DiagnosticCircle = ({ percentage, color }) => {
  const animatedValue = useRef(new Animated.Value(0)).current;
  const rotation = animatedValue.interpolate({
    inputRange: [0, 100],
    outputRange: ['0deg', '360deg'],
  });

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: percentage,
      duration: 2500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [percentage]);

  return (
    <View style={styles.confidenceCircleWrapper}>
      <View style={styles.confidenceCircleBg}>
        <View style={[styles.confidenceCircleInner, { borderColor: color }]}>
          <Text style={styles.confidencePercent}>{percentage}%</Text>
          <View style={styles.confidenceDivider} />
          <Text style={styles.confidenceLabel}>CONFIDENCE</Text>
        </View>
      </View>
      <View style={styles.confidenceRing}>
        <Animated.View 
          style={[
            styles.confidenceArc, 
            { 
              borderColor: color,
              transform: [{ rotate: rotation }] 
            }
          ]} 
        />
      </View>
    </View>
  );
};

// --- SEVERITY INDICATOR ---
const SeverityIndicator = ({ status, isPositive }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isPositive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.1, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [isPositive]);

  return (
    <Animated.View style={[styles.severityContainer, { transform: [{ scale: pulseAnim }] }]}>
      <LinearGradient
        colors={isPositive ? ['#EF4444', '#DC2626'] : ['#10B981', '#059669']}
        style={styles.severityGradient}
      >
        <MaterialCommunityIcons 
          name={isPositive ? "alert-circle" : "check-circle"} 
          size={32} 
          color="white" 
        />
        <Text style={styles.severityText}>{status}</Text>
        <View style={styles.severityBadge}>
          <Text style={styles.severityBadgeText}>
            {isPositive ? "REQUIRES ATTENTION" : "HEALTHY STATUS"}
          </Text>
        </View>
      </LinearGradient>
    </Animated.View>
  );
};

// --- TIMELINE ITEM ---
const TimelineItem = ({ icon, title, value, last }) => (
  <View style={[styles.timelineItem, last && styles.timelineItemLast]}>
    <View style={styles.timelineDot}>
      <View style={styles.timelineDotInner} />
    </View>
    {!last && <View style={styles.timelineLine} />}
    <View style={styles.timelineContent}>
      <MaterialCommunityIcons name={icon} size={18} color={THEME.secondary} />
      <View style={styles.timelineTextWrapper}>
        <Text style={styles.timelineTitle}>{title}</Text>
        <Text style={styles.timelineValue}>{value}</Text>
      </View>
    </View>
  </View>
);

export default function ResultScreen({ route, navigation }) {
  const image = route?.params?.image;
  const patient = route?.params?.patient || {};
  const [activePatientId, setActivePatientId] = useState(route?.params?.patientId);

  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPublished, setIsPublished] = useState(false);
  const [result, setResult] = useState(null);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(50)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const headerAnim = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    let isMounted = true;

    startScanAnimation();

    const animateReportIn = () => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.spring(slideUp, { toValue: 0, friction: 8, useNativeDriver: true }),
        Animated.spring(headerAnim, { toValue: 0, friction: 8, useNativeDriver: true }),
      ]).start();
    };

    const analyzeImage = async () => {
      try {
        if (!image) {
          throw new Error('No image was provided for analysis.');
        }

        const formData = new FormData();
        await appendImageToFormData(formData, image);

        const response = await fetch(`${API_BASE_URL}/predict`, {
          method: 'POST',
          body: formData,
        });

        const prediction = await response.json();
        if (!response.ok) {
          throw new Error(prediction.error || 'Prediction request failed.');
        }

        const status = prediction.status || (prediction.condition === 'Cataract' ? 'Positive' : 'Negative');
        const confidence = Number(prediction.confidence || 0);
        const isPositiveResult = status === 'Positive';

        if (!isMounted) return;

        setResult({
          condition: isPositiveResult ? "Cataract Detected" : "Normal Eye Health",
          confidence,
          status,
          severity: prediction.severity || (isPositiveResult ? "Needs ophthalmologist review" : "Optimal"),
          scanId: `DX${new Date().getFullYear()}${String(Math.floor(100000 + Math.random() * 900000))}`,
          date: new Date().toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric'
          }),
          time: new Date().toLocaleTimeString('en-IN', {
            hour: '2-digit', minute: '2-digit', hour12: true
          }),
          technician: "AI-OPHTHAL System",
          deviceId: "SWIN-CATARACT-AI-001",
          probabilities: prediction.probabilities,
        });
        setLoading(false);
        animateReportIn();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        console.error("AI Analysis Error:", error);
        if (!isMounted) return;

        setLoading(false);
        Alert.alert(
          "Analysis Failed",
          `${error.message}\n\nBackend used: ${API_BASE_URL}`,
          [{ text: "Go Back", onPress: () => navigation.goBack() }]
        );
      }
    };

    const timer = setTimeout(() => {
      analyzeImage();
    }, 1200);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, []);

  const startScanAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
  };

  const handleGeneratePDF = async (mode = 'share') => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
      const name = patient.name || "N/A";
      const age = patient.age || "N/A";
      const mobile = patient.mobile || patient.phone || "N/A";
      const village = patient.village || "N/A";
      const status = result.status;
      const percentage = result.confidence;
      const isPositive = status === 'Positive';
      
      let base64Img = "";
      if (image) {
        try {
          const localUri = image.startsWith('file://') ? image : `file://${image}`;
          base64Img = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
        } catch (e) { 
          console.log("Image conversion failed", e); 
        }
      }

      const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            @page { margin: 0; size: A4; }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #1e293b; background: #ffffff; }
            .page { padding: 48px; min-height: 100vh; position: relative; }
            
            /* Header */
            .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; border-bottom: 3px solid #0A7EA4; margin-bottom: 36px; }
            .brand { flex: 1; }
            .brand-title { font-size: 26px; font-weight: 800; color: #0A7EA4; margin-bottom: 4px; letter-spacing: -0.5px; }
            .brand-subtitle { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }
            .report-meta { text-align: right; }
            .report-id { font-size: 13px; font-weight: 700; color: #0A7EA4; margin-bottom: 6px; }
            .report-date { font-size: 11px; color: #64748b; font-weight: 600; }
            
            /* Section Headers */
            .section { margin-bottom: 32px; }
            .section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
            .section-icon { width: 6px; height: 24px; background: linear-gradient(135deg, #0A7EA4, #64B5F6); border-radius: 3px; }
            .section-title { font-size: 14px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; }
            
            /* Patient Info Grid */
            .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0; }
            .info-field { }
            .info-label { font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
            .info-value { font-size: 15px; font-weight: 700; color: #0f172a; }
            
            /* Diagnosis Card */
            .diagnosis-container { margin: 32px 0; }
            .diagnosis-card { border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border: 1px solid ${isPositive ? '#fee2e2' : '#d1fae5'}; }
            .diagnosis-header { background: linear-gradient(135deg, ${isPositive ? '#ef4444' : '#10b981'} 0%, ${isPositive ? '#dc2626' : '#059669'} 100%); padding: 20px; text-align: center; }
            .diagnosis-header-title { color: white; font-size: 16px; font-weight: 800; letter-spacing: 2px; }
            .diagnosis-body { padding: 36px; text-align: center; background: white; }
            .eye-image-wrapper { margin: 0 auto 24px; width: 200px; height: 200px; border-radius: 50%; border: 6px solid #f1f5f9; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
            .eye-image { width: 100%; height: 100%; object-fit: cover; }
            .diagnosis-status { font-size: 32px; font-weight: 900; margin-bottom: 16px; color: ${isPositive ? '#dc2626' : '#059669'}; letter-spacing: -0.5px; }
            .confidence-badge { display: inline-block; padding: 10px 24px; background: linear-gradient(135deg, #f1f5f9, #e2e8f0); border-radius: 24px; font-size: 13px; font-weight: 700; color: #475569; border: 1px solid #cbd5e1; }
            .confidence-label { font-size: 10px; color: #64748b; margin-right: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
            .confidence-value { color: #0f172a; font-size: 15px; }
            
            /* Analysis Details */
            .analysis-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 24px 0; }
            .analysis-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; text-align: center; }
            .analysis-item-label { font-size: 9px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px; }
            .analysis-item-value { font-size: 14px; font-weight: 800; color: #0f172a; }
            
            /* Recommendations */
            .recommendations { background: ${isPositive ? '#fef2f2' : '#f0fdf4'}; border: 2px solid ${isPositive ? '#fecaca' : '#bbf7d0'}; border-radius: 12px; padding: 24px; margin: 24px 0; }
            .rec-title { font-size: 13px; font-weight: 800; color: ${isPositive ? '#dc2626' : '#059669'}; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
            .rec-list { margin-left: 0; padding-left: 20px; }
            .rec-item { font-size: 11px; line-height: 1.8; color: #475569; margin-bottom: 8px; }
            
            /* Disclaimer */
            .disclaimer { background: #fffbeb; border: 2px dashed #fbbf24; border-radius: 10px; padding: 20px; margin-top: 32px; }
            .disclaimer-title { font-size: 11px; font-weight: 800; color: #92400e; margin-bottom: 8px; text-transform: uppercase; }
            .disclaimer-text { font-size: 10px; line-height: 1.6; color: #78350f; }
            
            /* Footer */
            .footer { position: absolute; bottom: 48px; left: 48px; right: 48px; padding-top: 20px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
            .footer-text { font-size: 9px; color: #94a3b8; font-weight: 600; }
            .footer-qr { font-size: 8px; color: #cbd5e1; text-align: right; }
          </style>
        </head>
        <body>
          <div class="page">
            <!-- Header -->
            <div class="header">
              <div class="brand">
                <div class="brand-title">OPHTHALMOLOGY DIAGNOSTIC CENTER</div>
                <div class="brand-subtitle">Advanced AI-Powered Eye Health Analysis</div>
              </div>
              <div class="report-meta">
                <div class="report-id">Report ID: ${result.scanId}</div>
                <div class="report-date">${result.date} • ${result.time}</div>
              </div>
            </div>

            <!-- Patient Information -->
            <div class="section">
              <div class="section-header">
                <div class="section-icon"></div>
                <div class="section-title">Patient Information</div>
              </div>
              <div class="info-grid">
                <div class="info-field">
                  <div class="info-label">Full Name</div>
                  <div class="info-value">${name.toUpperCase()}</div>
                </div>
                <div class="info-field">
                  <div class="info-label">Age / Gender</div>
                  <div class="info-value">${age} Years / ${patient.gender || 'M'}</div>
                </div>
                <div class="info-field">
                  <div class="info-label">Contact Number</div>
                  <div class="info-value">${mobile}</div>
                </div>
                <div class="info-field">
                  <div class="info-label">Location</div>
                  <div class="info-value">${village}</div>
                </div>
              </div>
            </div>

            <!-- Diagnostic Analysis -->
            <div class="section diagnosis-container">
              <div class="section-header">
                <div class="section-icon"></div>
                <div class="section-title">Diagnostic Analysis</div>
              </div>
              <div class="diagnosis-card">
                <div class="diagnosis-header">
                  <div class="diagnosis-header-title">AI SCREENING SUMMARY</div>
                </div>
                <div class="diagnosis-body">
                  ${base64Img ? `
                    <div class="eye-image-wrapper">
                      <img class="eye-image" src="data:image/jpeg;base64,${base64Img}" alt="Retinal Scan" />
                    </div>
                  ` : ''}
                  <div class="diagnosis-status">${isPositive ? 'CATARACT DETECTED' : 'NORMAL EYE HEALTH'}</div>
                  <div class="confidence-badge">
                    <span class="confidence-label">AI Confidence:</span>
                    <span class="confidence-value">${percentage}%</span>
                  </div>
                  
                  <div class="analysis-grid">
                    <div class="analysis-item">
                      <div class="analysis-item-label">Status</div>
                      <div class="analysis-item-value">${isPositive ? 'Positive' : 'Negative'}</div>
                    </div>
                    <div class="analysis-item">
                      <div class="analysis-item-label">Severity</div>
                      <div class="analysis-item-value">${result.severity}</div>
                    </div>
                    <div class="analysis-item">
                      <div class="analysis-item-label">Device</div>
                      <div class="analysis-item-value">${result.deviceId}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Recommendations -->
            <div class="recommendations">
              <div class="rec-title">
                <span>${isPositive ? '⚠️' : '✓'}</span>
                <span>${isPositive ? 'CLINICAL RECOMMENDATIONS' : 'MAINTENANCE GUIDELINES'}</span>
              </div>
              <ul class="rec-list">
                ${isPositive ? `
                  <li class="rec-item">Schedule immediate consultation with certified ophthalmologist for comprehensive dilated eye examination</li>
                  <li class="rec-item">Discuss surgical intervention options - Phacoemulsification cataract surgery has 95%+ success rate</li>
                  <li class="rec-item">Use UV-protective eyewear when outdoors to prevent further lens opacity progression</li>
                  <li class="rec-item">Monitor blood glucose levels if diabetic - uncontrolled diabetes accelerates cataract formation</li>
                  <li class="rec-item">Avoid self-medication with over-the-counter eye drops without professional consultation</li>
                ` : `
                  <li class="rec-item">Continue regular 6-month ophthalmology checkups for early detection of changes</li>
                  <li class="rec-item">Maintain balanced diet rich in lutein, zeaxanthin, and omega-3 fatty acids</li>
                  <li class="rec-item">Wear polarized sunglasses during daytime activities to reduce UV exposure</li>
                  <li class="rec-item">Practice 20-20-20 rule: Every 20 minutes, look 20 feet away for 20 seconds</li>
                  <li class="rec-item">Stay hydrated and ensure 7-8 hours quality sleep for optimal eye health</li>
                `}
              </ul>
            </div>

            <!-- Disclaimer -->
            <div class="disclaimer">
              <div class="disclaimer-title">⚕️ Medical Disclaimer</div>
              <div class="disclaimer-text">
                This report is generated by an AI-powered preliminary screening system and should not be considered as a final diagnosis. 
                Clinical examination by a qualified ophthalmologist is mandatory for treatment planning, surgical decisions, and prescription medications. 
                This screening tool is designed to assist healthcare professionals and should not replace professional medical judgment.
              </div>
            </div>

            <!-- Footer -->
            <div class="footer">
              <div class="footer-text">
                <div>Generated by: ${result.technician}</div>
                <div style="margin-top: 4px;">System Version: AI-OPHTHAL-v4.2.1 | Certified: ISO 13485:2016</div>
              </div>
              <div class="footer-qr">
                <div>Verification Code: ${result.scanId}</div>
                <div style="margin-top: 4px;">Page 1 of 1 | Confidential Medical Document</div>
              </div>
            </div>
          </div>
        </body>
      </html>`;

      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
    } catch (error) {
      Alert.alert("Error", "Unable to generate medical report. Please try again.");
    }
  };

  const handleUpdateToFirebase = async () => {
    if (!result) return;
    setIsSyncing(true);
    try {
      const payload = {
        cataract_value: result.confidence,
        cataract_status: result.status,
        diagnostic_result: result.condition,
        scan_id: result.scanId,
        device_id: result.deviceId,
        severity: result.severity,
        last_updated: serverTimestamp(),
        is_analyzed: true,
        analysis_timestamp: serverTimestamp(),
      };

      if (activePatientId) {
        await updateDoc(doc(db, "patients", activePatientId), payload);
      } else {
        const docRef = await addDoc(collection(db, "patients"), { 
          ...patient, 
          ...payload, 
          createdAt: serverTimestamp() 
        });
        setActivePatientId(docRef.id);
      }

      setIsPublished(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("✓ Success", "Diagnostic data successfully published to cloud database.");
    } catch (error) {
      console.error("Cloud Sync Error: ", error);
      Alert.alert("✗ Error", "Failed to sync data. Please check your connection and try again.");
    } finally {
      setIsSyncing(false);
    }
  };

  if (loading) {
    const scanProgress = scanLineAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 160],
    });

    return (
      <View style={styles.loadingContainer}>
        <LinearGradient 
          colors={[THEME.bgDark, '#0A1628', THEME.bgDark]} 
          style={StyleSheet.absoluteFill} 
        />
        <StatusBar barStyle="light-content" />
        
        <View style={styles.loadingContent}>
          <Text style={styles.loadingTitle}>ANALYZING RETINAL SCAN</Text>
          
          <View style={styles.scanFrame}>
            <Image source={{ uri: image }} style={styles.scanImage} />
            <View style={styles.scanOverlay}>
              <Animated.View 
                style={[
                  styles.scanLine, 
                  { transform: [{ translateY: scanProgress }] }
                ]} 
              />
              <View style={styles.scanGrid}>
                {[...Array(8)].map((_, i) => (
                  <View key={i} style={styles.scanGridLine} />
                ))}
              </View>
            </View>
            <View style={styles.scanCorners}>
              <View style={[styles.scanCorner, styles.scanCornerTL]} />
              <View style={[styles.scanCorner, styles.scanCornerTR]} />
              <View style={[styles.scanCorner, styles.scanCornerBL]} />
              <View style={[styles.scanCorner, styles.scanCornerBR]} />
            </View>
          </View>

          <View style={styles.loadingSteps}>
            <View style={styles.loadingStep}>
              <ActivityIndicator size="small" color={THEME.primary} />
              <Text style={styles.loadingStepText}>Processing Image Data</Text>
            </View>
            <View style={styles.loadingStep}>
              <View style={styles.loadingStepDot} />
              <Text style={[styles.loadingStepText, styles.loadingStepTextInactive]}>
                Running AI Analysis
              </Text>
            </View>
            <View style={styles.loadingStep}>
              <View style={styles.loadingStepDot} />
              <Text style={[styles.loadingStepText, styles.loadingStepTextInactive]}>
                Generating Report
              </Text>
            </View>
          </View>

          <Text style={styles.loadingSubtext}>
            Please wait while we analyze the retinal scan...
          </Text>
        </View>
      </View>
    );
  }

  if (!result) {
    return (
      <SafeAreaView style={styles.container}>
        <LinearGradient
          colors={[THEME.bgDark, '#0A1628', THEME.bgDark]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.loadingContent}>
          <MaterialCommunityIcons name="alert-circle" size={72} color={THEME.error} />
          <Text style={styles.loadingTitle}>ANALYSIS UNAVAILABLE</Text>
          <Text style={styles.loadingSubtext}>
            The backend did not return a diagnostic result.
          </Text>
          <TouchableOpacity style={styles.tertiaryActionBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={20} color={THEME.textSecondary} />
            <Text style={styles.tertiaryActionText}>Return to Scan</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isPositive = result.status === "Positive";
  const themeColor = isPositive ? THEME.error : THEME.success;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient 
        colors={[THEME.bgDark, '#0A1628', THEME.bgDark]} 
        style={StyleSheet.absoluteFill} 
      />

      {/* Professional Header */}
      <Animated.View style={[styles.header, { transform: [{ translateY: headerAnim }] }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBackBtn}>
            <Ionicons name="arrow-back" size={22} color={THEME.textPrimary} />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Diagnostic Report</Text>
            <Text style={styles.headerSubtitle}>AI-Powered Analysis</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => handleGeneratePDF('share')} style={styles.headerShareBtn}>
          <Feather name="share-2" size={20} color={THEME.primary} />
        </TouchableOpacity>
      </Animated.View>

      <Animated.ScrollView 
        showsVerticalScrollIndicator={false} 
        contentContainerStyle={styles.scrollContent} 
        style={{ opacity: fadeAnim, transform: [{ translateY: slideUp }] }}
      >
        {/* Report ID Badge */}
        <View style={styles.reportIdContainer}>
          <View style={styles.reportIdBadge}>
            <MaterialCommunityIcons name="file-document" size={16} color={THEME.primary} />
            <Text style={styles.reportIdText}>ID: {result.scanId}</Text>
          </View>
          <View style={styles.reportDateBadge}>
            <Ionicons name="calendar-outline" size={14} color={THEME.textSecondary} />
            <Text style={styles.reportDateText}>{result.date}</Text>
          </View>
        </View>

        {/* Main Diagnostic Card */}
        <View style={[styles.mainCard, { borderColor: themeColor + '30' }]}>
          <LinearGradient
            colors={isPositive 
              ? ['rgba(239, 68, 68, 0.1)', 'rgba(220, 38, 38, 0.05)'] 
              : ['rgba(16, 185, 129, 0.1)', 'rgba(5, 150, 105, 0.05)']
            }
            style={styles.mainCardGradient}
          >
            {/* Eye Image */}
            <View style={[styles.eyeImageContainer, { borderColor: themeColor }]}>
              <Image source={{ uri: image }} style={styles.eyeImage} />
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.3)']}
                style={styles.eyeImageGradient}
              />
            </View>

            {/* Status Badge */}
            <View style={[styles.statusBadgeMain, { backgroundColor: themeColor }]}>
              <MaterialCommunityIcons 
                name={isPositive ? "alert-circle" : "check-circle"} 
                size={18} 
                color="white" 
              />
              <Text style={styles.statusBadgeMainText}>
                {isPositive ? "POSITIVE DETECTION" : "NEGATIVE RESULT"}
              </Text>
            </View>

            {/* Condition Text */}
            <Text style={styles.conditionLabel}>DIAGNOSTIC FINDING</Text>
            <Text style={[styles.conditionText, { color: themeColor }]}>
              {result.condition}
            </Text>
            <Text style={styles.severityText}>
              Severity Level: <Text style={[styles.severityValue, { color: themeColor }]}>
                {result.severity}
              </Text>
            </Text>
          </LinearGradient>
        </View>

        {/* Metrics Grid */}
        <View style={styles.metricsGrid}>
          <View style={styles.metricCardLarge}>
            <DiagnosticCircle percentage={result.confidence} color={themeColor} />
          </View>
          <View style={styles.metricCardSmall}>
            <SeverityIndicator status={result.status} isPositive={isPositive} />
          </View>
        </View>

        {/* Patient Information Card */}
        <View style={styles.infoCard}>
          <View style={styles.cardHeaderRow}>
            <FontAwesome5 name="user-md" size={16} color={THEME.primary} />
            <Text style={styles.cardTitle}>PATIENT DETAILS</Text>
          </View>
          <View style={styles.infoGridContainer}>
            <View style={styles.infoRow}>
              <View style={styles.infoCol}>
                <Text style={styles.infoLabel}>Full Name</Text>
                <Text style={styles.infoValue}>{patient.name || "N/A"}</Text>
              </View>
              <View style={styles.infoCol}>
                <Text style={styles.infoLabel}>Age / Gender</Text>
                <Text style={styles.infoValue}>{patient.age || "62"} / {patient.gender || "M"}</Text>
              </View>
            </View>
            <View style={styles.infoRow}>
              <View style={styles.infoCol}>
                <Text style={styles.infoLabel}>Mobile Number</Text>
                <Text style={styles.infoValue}>{patient.mobile || patient.phone || "N/A"}</Text>
              </View>
              <View style={styles.infoCol}>
                <Text style={styles.infoLabel}>Location</Text>
                <Text style={styles.infoValue}>{patient.village || "N/A"}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Scan Timeline */}
        <View style={styles.timelineCard}>
          <View style={styles.cardHeaderRow}>
            <MaterialCommunityIcons name="timeline-clock" size={16} color={THEME.primary} />
            <Text style={styles.cardTitle}>SCAN TIMELINE</Text>
          </View>
          <View style={styles.timelineContainer}>
            <TimelineItem 
              icon="calendar-check" 
              title="Scan Date" 
              value={result.date} 
            />
            <TimelineItem 
              icon="clock-outline" 
              title="Scan Time" 
              value={result.time} 
            />
            <TimelineItem 
              icon="robot" 
              title="Analyzed By" 
              value={result.technician} 
            />
            <TimelineItem 
              icon="barcode-scan" 
              title="Device ID" 
              value={result.deviceId} 
              last 
            />
          </View>
        </View>

        {/* Clinical Recommendations */}
        <View style={[styles.recommendationsCard, { borderColor: themeColor + '20' }]}>
          <LinearGradient
            colors={isPositive 
              ? ['rgba(239, 68, 68, 0.08)', 'rgba(220, 38, 38, 0.03)'] 
              : ['rgba(16, 185, 129, 0.08)', 'rgba(5, 150, 105, 0.03)']
            }
            style={styles.recommendationsGradient}
          >
            <View style={styles.recommendationsHeader}>
              <View style={[styles.recommendationsIcon, { backgroundColor: themeColor }]}>
                <MaterialCommunityIcons 
                  name={isPositive ? "alert-octagon" : "shield-check"} 
                  size={22} 
                  color="white" 
                />
              </View>
              <Text style={[styles.recommendationsTitle, { color: themeColor }]}>
                {isPositive ? "URGENT RECOMMENDATIONS" : "PREVENTIVE CARE GUIDELINES"}
              </Text>
            </View>

            {isPositive ? (
              <View style={styles.recommendationsList}>
                <View style={styles.recommendationSection}>
                  <Text style={[styles.recommendationSectionTitle, { color: themeColor }]}>
                    ✓ IMMEDIATE ACTIONS
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Schedule urgent consultation with certified ophthalmologist within 7 days
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Bring this diagnostic report for comprehensive dilated eye examination
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Discuss phacoemulsification surgery - proven 95%+ success rate
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Get detailed pre-operative evaluation including biometry measurements
                  </Text>
                </View>

                <View style={styles.divider} />

                <View style={styles.recommendationSection}>
                  <Text style={[styles.recommendationSectionTitle, { color: themeColor }]}>
                    ⚠️ PRECAUTIONARY MEASURES
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Wear UV400-rated sunglasses when outdoors to prevent progression
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Avoid night driving if experiencing glare, halos, or blurred vision
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Monitor and control blood glucose levels if diabetic
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Do not use OTC eye drops without ophthalmologist approval
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Increase ambient lighting at home to compensate for reduced clarity
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.recommendationsList}>
                <View style={styles.recommendationSection}>
                  <Text style={[styles.recommendationSectionTitle, { color: themeColor }]}>
                    ✨ MAINTENANCE PROTOCOL
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Schedule routine eye exams every 6 months for early detection
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Consume diet rich in lutein, zeaxanthin (leafy greens, eggs)
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Take omega-3 supplements or eat fatty fish 2-3 times weekly
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Wear polarized UV-protective eyewear during outdoor activities
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Practice 20-20-20 rule to reduce digital eye strain
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Maintain optimal hydration (8-10 glasses water daily)
                  </Text>
                  <Text style={styles.recommendationItem}>
                    • Ensure 7-8 hours quality sleep for natural eye restoration
                  </Text>
                </View>
              </View>
            )}
          </LinearGradient>
        </View>

        {/* Medical Disclaimer */}
        <View style={styles.disclaimerCard}>
          <View style={styles.disclaimerHeader}>
            <MaterialCommunityIcons name="information" size={20} color={THEME.warning} />
            <Text style={styles.disclaimerTitle}>IMPORTANT MEDICAL DISCLAIMER</Text>
          </View>
          <Text style={styles.disclaimerText}>
            This report is generated by an AI-powered preliminary screening system and is intended 
            for informational purposes only. It should NOT be considered as a definitive diagnosis 
            or substitute for professional medical advice. Clinical examination by a qualified, 
            licensed ophthalmologist is mandatory for accurate diagnosis, treatment planning, 
            surgical decisions, and prescription of medications. Always consult healthcare 
            professionals for medical concerns.
          </Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionSection}>
          {/* Publish to Database */}
          <TouchableOpacity 
            style={[
              styles.primaryActionBtn,
              (isSyncing || isPublished) && styles.primaryActionBtnDisabled
            ]} 
            onPress={handleUpdateToFirebase} 
            disabled={isSyncing || isPublished}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={isPublished 
                ? [THEME.success, '#059669'] 
                : [THEME.primary, '#0891B2']
              }
              style={styles.primaryActionGradient}
            >
              {isSyncing ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <>
                  <MaterialCommunityIcons 
                    name={isPublished ? "check-circle" : "cloud-upload"} 
                    size={22} 
                    color="white" 
                  />
                  <Text style={styles.primaryActionText}>
                    {isPublished ? "SYNCED TO DATABASE" : "PUBLISH TO DATABASE"}
                  </Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Download PDF */}
          <TouchableOpacity 
            style={styles.secondaryActionBtn} 
            onPress={() => handleGeneratePDF('download')}
            activeOpacity={0.8}
          >
            <Feather name="download" size={20} color={THEME.primary} />
            <Text style={styles.secondaryActionText}>DOWNLOAD MEDICAL REPORT (PDF)</Text>
          </TouchableOpacity>

          {/* Return Home */}
          <TouchableOpacity 
            style={styles.tertiaryActionBtn} 
            onPress={() => navigation.popToTop()}
            activeOpacity={0.8}
          >
            <Ionicons name="home-outline" size={20} color={THEME.textSecondary} />
            <Text style={styles.tertiaryActionText}>Return to Home</Text>
          </TouchableOpacity>
        </View>

        {/* Footer Info */}
        <View style={styles.footerInfo}>
          <Text style={styles.footerText}>
            Report generated by AI-OPHTHAL System v4.2.1
          </Text>
          <Text style={styles.footerText}>
            Certified: ISO 13485:2016 | Medical Device Class IIa
          </Text>
        </View>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bgDark,
  },

  // Loading Screen Styles
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  loadingTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME.textPrimary,
    letterSpacing: 2,
    marginBottom: 40,
  },
  scanFrame: {
    width: 220,
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 2,
    borderColor: THEME.primary,
    shadowColor: THEME.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  scanImage: {
    width: '100%',
    height: '100%',
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 126, 164, 0.15)',
  },
  scanLine: {
    width: '100%',
    height: 3,
    backgroundColor: THEME.primary,
    shadowColor: THEME.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 10,
  },
  scanGrid: {
    ...StyleSheet.absoluteFillObject,
  },
  scanGridLine: {
    height: 1,
    backgroundColor: 'rgba(10, 126, 164, 0.2)',
    marginTop: 19,
  },
  scanCorners: {
    ...StyleSheet.absoluteFillObject,
  },
  scanCorner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: THEME.primary,
  },
  scanCornerTL: {
    top: 10,
    left: 10,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  scanCornerTR: {
    top: 10,
    right: 10,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  scanCornerBL: {
    bottom: 10,
    left: 10,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  scanCornerBR: {
    bottom: 10,
    right: 10,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  loadingSteps: {
    marginTop: 50,
    width: '100%',
  },
  loadingStep: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  loadingStepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: THEME.bgCardLight,
    borderWidth: 2,
    borderColor: THEME.border,
  },
  loadingStepText: {
    marginLeft: 15,
    fontSize: 13,
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  loadingStepTextInactive: {
    color: THEME.textMuted,
  },
  loadingSubtext: {
    marginTop: 30,
    fontSize: 12,
    color: THEME.textSecondary,
    textAlign: 'center',
  },

  // Header Styles
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: THEME.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME.border,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.textPrimary,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: THEME.textSecondary,
    marginTop: 2,
  },
  headerShareBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: THEME.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME.borderActive,
  },

  // Scroll Content
  scrollContent: {
    paddingBottom: 40,
  },

  // Report ID Section
  reportIdContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 20,
  },
  reportIdBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: THEME.bgCard,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.borderActive,
  },
  reportIdText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.primary,
  },
  reportDateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: THEME.bgCard,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  reportDateText: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.textSecondary,
  },

  // Main Diagnostic Card
  mainCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  mainCardGradient: {
    padding: 24,
    alignItems: 'center',
  },
  eyeImageContainer: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 4,
    overflow: 'hidden',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  eyeImage: {
    width: '100%',
    height: '100%',
  },
  eyeImageGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  statusBadgeMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 16,
  },
  statusBadgeMainText: {
    fontSize: 12,
    fontWeight: '800',
    color: 'white',
    letterSpacing: 0.5,
  },
  conditionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: THEME.textMuted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  conditionText: {
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 12,
  },
  severityText: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME.textSecondary,
  },
  severityValue: {
    fontWeight: '800',
  },

  // Metrics Grid
  metricsGrid: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginTop: 20,
    marginBottom: 20,
  },
  metricCardLarge: {
    flex: 1.2,
    backgroundColor: THEME.bgCard,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: THEME.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  metricCardSmall: {
    flex: 1,
    backgroundColor: THEME.bgCard,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME.border,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Confidence Circle
  confidenceCircleWrapper: {
    position: 'relative',
    width: 100,
    height: 100,
  },
  confidenceCircleBg: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confidenceCircleInner: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: THEME.bgCardLight,
  },
  confidencePercent: {
    fontSize: 22,
    fontWeight: '900',
    color: THEME.textPrimary,
  },
  confidenceDivider: {
    width: 30,
    height: 1,
    backgroundColor: THEME.border,
    marginVertical: 4,
  },
  confidenceLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: THEME.textMuted,
    letterSpacing: 0.5,
  },
  confidenceRing: {
    position: 'absolute',
    width: 100,
    height: 100,
  },
  confidenceArc: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: THEME.primary,
    borderStyle: 'dashed',
  },

  // Severity Indicator
  severityContainer: {
    width: '100%',
  },
  severityGradient: {
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  severityText: {
    fontSize: 13,
    fontWeight: '800',
    color: 'white',
    marginTop: 4,
  },
  severityBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 6,
  },
  severityBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: 'white',
    letterSpacing: 0.5,
  },

  // Info Card
  infoCard: {
    marginHorizontal: 20,
    backgroundColor: THEME.bgCard,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: THEME.border,
    marginBottom: 20,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: THEME.textPrimary,
    letterSpacing: 0.5,
  },
  infoGridContainer: {
    gap: 16,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 16,
  },
  infoCol: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: THEME.textMuted,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.textPrimary,
  },

  // Timeline Card
  timelineCard: {
    marginHorizontal: 20,
    backgroundColor: THEME.bgCard,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: THEME.border,
    marginBottom: 20,
  },
  timelineContainer: {
    marginTop: 4,
  },
  timelineItem: {
    flexDirection: 'row',
    position: 'relative',
    paddingBottom: 20,
  },
  timelineItemLast: {
    paddingBottom: 0,
  },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: THEME.bgCardLight,
    borderWidth: 2,
    borderColor: THEME.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  timelineDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: THEME.primary,
  },
  timelineLine: {
    position: 'absolute',
    left: 11,
    top: 24,
    bottom: 0,
    width: 2,
    backgroundColor: THEME.border,
  },
  timelineContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timelineTextWrapper: {
    flex: 1,
  },
  timelineTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.textMuted,
    marginBottom: 4,
  },
  timelineValue: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.textPrimary,
  },

  // Recommendations Card
  recommendationsCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 2,
    marginBottom: 20,
  },
  recommendationsGradient: {
    padding: 20,
  },
  recommendationsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  recommendationsIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recommendationsTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  recommendationsList: {
    gap: 16,
  },
  recommendationSection: {
    gap: 12,
  },
  recommendationSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  recommendationItem: {
    fontSize: 12,
    lineHeight: 20,
    color: THEME.textSecondary,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: THEME.border,
    marginVertical: 4,
  },

  // Disclaimer Card
  disclaimerCard: {
    marginHorizontal: 20,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    marginBottom: 30,
  },
  disclaimerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  disclaimerTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.warning,
    letterSpacing: 0.5,
  },
  disclaimerText: {
    fontSize: 11,
    lineHeight: 18,
    color: THEME.textSecondary,
    fontWeight: '500',
  },

  // Action Section
  actionSection: {
    paddingHorizontal: 20,
    gap: 12,
  },
  primaryActionBtn: {
    height: 56,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: THEME.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  primaryActionBtnDisabled: {
    opacity: 0.8,
  },
  primaryActionGradient: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  primaryActionText: {
    fontSize: 13,
    fontWeight: '800',
    color: 'white',
    letterSpacing: 0.5,
  },
  secondaryActionBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: THEME.bgCard,
    borderWidth: 1,
    borderColor: THEME.borderActive,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  secondaryActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.primary,
  },
  tertiaryActionBtn: {
    height: 48,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: THEME.border,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  tertiaryActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.textSecondary,
  },

  // Footer Info
  footerInfo: {
    marginTop: 30,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 10,
    color: THEME.textMuted,
    fontWeight: '500',
  },
});
