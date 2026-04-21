import React, { useState, useRef, useEffect } from 'react';
import Spline from '@splinetool/react-spline';
import { QRCodeCanvas } from 'qrcode.react';
import Auth from './Auth';
import { database, auth } from './firebase';
import { ref, onValue, set, get, onDisconnect } from "firebase/database";
import { onAuthStateChanged, signOut } from "firebase/auth";

// --- DEVICE IDENTIFICATION HELPERS ---
const getDeviceId = () => {
  let id = localStorage.getItem('buzznet_device_id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('buzznet_device_id', id);
  }
  return id;
};

const getDeviceName = () => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'Apple iOS Device';
  if (/Android/i.test(ua)) return 'Android Device';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Mac/i.test(ua)) return 'Mac OS Device';
  return 'Unknown Device';
};

export default function BuzzNetDashboard() {
  const splineRef = useRef();

  // --- STATE MANAGEMENT ---
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [mobileTab, setMobileTab] = useState('main');

  const [isSplineLoaded, setIsSplineLoaded] = useState(false);
  const initialSyncDone = useRef(false);

  const [activeSlotUser, setActiveSlotUser] = useState("none");
  const [slotCountdown, setSlotCountdown] = useState(0);
  const [allUsers, setAllUsers] = useState({});
  const [availableLockers, setAvailableLockers] = useState([]);

  const [balance, setBalance] = useState(0);
  const [isDisabled, setIsDisabled] = useState(false);
  const [spendAmount, setSpendAmount] = useState(1);
  const [statusLog, setStatusLog] = useState("System Ready. Master Database Connected.");

  const [session, setSession] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);

  // QR Code Modal State
  const [showQR, setShowQR] = useState(false);

  // --- RATE STATE ---
  const [ratePerPeso, setRatePerPeso] = useState(5);
  const [adminRateInput, setAdminRateInput] = useState(5);

  // --- RESPONSIVE LISTENER ---
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- DEVICE CONNECTION LISTENER ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectLocker = params.get('lockerId');
    const hostUid = params.get('host');

    if (!connectLocker || !hostUid) return;

    const deviceId = getDeviceId();
    const deviceName = getDeviceName();

    const requestRef = ref(database, `connectionRequests/${hostUid}_${connectLocker}`);

    get(requestRef).then(snap => {
      const existing = snap.val() || [];
      const safeList = Array.isArray(existing) ? existing : Object.values(existing);

      if (safeList.find(d => d.deviceId === deviceId)) {
        alert(`✅ This device (${deviceName}) is already connected to Buzzer #${connectLocker}.`);
      } else if (safeList.length >= 2) {
        alert(`❌ Max 2 devices already connected to Buzzer #${connectLocker}.`);
      } else {
        const updated = [...safeList, { deviceId, deviceName, connectedAt: Date.now() }];
        set(requestRef, updated).then(() => {
          alert(`🎉 ${deviceName} connected to Buzzer #${connectLocker}!`);
        });
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }).catch(() => {
      alert("❌ Connection failed. Check Firebase rules for connectionRequests path.");
      window.history.replaceState({}, document.title, window.location.pathname);
    });
  }, []);

  // --- CORE LISTENERS ---
  useEffect(() => {
    let unsubscribeBalance, unsubscribeSession, unsubscribeGlobalLockers, unsubscribeActiveUser, unsubscribeRate;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);

      if (currentUser) {
        if (currentUser.email === 'admin@buzznet.com') {
          setIsAdmin(true); return;
        } else {
          setIsAdmin(false);
        }

        const userRef = ref(database, `users/${currentUser.uid}`);
        unsubscribeBalance = onValue(userRef, (snapshot) => {
          const data = snapshot.val();
          if (data) {
            setBalance(data.balance || 0);
            setIsDisabled(data.isDisabled || false);
            if (data.isDisabled) {
              handleLogout();
              alert("Your account has been disabled by the administrator.");
            }
          }
        });

        const sessionRef = ref(database, `users/${currentUser.uid}/session`);
        unsubscribeSession = onValue(sessionRef, (snapshot) => {
          const sessionData = snapshot.val();
          setSession(sessionData);

          if (sessionData?.lockerId) {
            const requestRef = ref(database, `connectionRequests/${currentUser.uid}_${sessionData.lockerId}`);
            onValue(requestRef, (reqSnap) => {
              const devices = reqSnap.val();
              if (devices) {
                const deviceList = Array.isArray(devices) ? devices : Object.values(devices);
                set(ref(database, `users/${currentUser.uid}/session/devices`), deviceList);
              }
            });
          }
        });
      }
    });

    const lockersRef = ref(database, 'system/availableLockers');
    unsubscribeGlobalLockers = onValue(lockersRef, (snapshot) => {
      if (snapshot.exists()) {
        const rawData = snapshot.val();
        const safeArray = Array.isArray(rawData) ? rawData : Object.values(rawData);
        setAvailableLockers(safeArray.filter(val => val !== null && val !== undefined));
      } else {
        set(ref(database, 'system/availableLockers'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
      }
    });

    // --- RATE LISTENER ---
    const rateRef = ref(database, 'system/ratePerPeso');
    unsubscribeRate = onValue(rateRef, (snapshot) => {
      const val = snapshot.val();
      if (val !== null && val !== undefined) {
        setRatePerPeso(val);
        setAdminRateInput(val);
      }
    });

    const activeUserRef = ref(database, 'activeUser');
    unsubscribeActiveUser = onValue(activeUserRef, (snapshot) => setActiveSlotUser(snapshot.val() || "none"));

    return () => {
      unsubscribeAuth();
      if (unsubscribeBalance) unsubscribeBalance();
      if (unsubscribeSession) unsubscribeSession();
      if (unsubscribeGlobalLockers) unsubscribeGlobalLockers();
      if (unsubscribeActiveUser) unsubscribeActiveUser();
      if (unsubscribeRate) unsubscribeRate();
    };
  }, []);

  useEffect(() => {
    let unsubscribeAllUsers;
    if (isAdmin) {
      const allUsersRef = ref(database, 'users');
      unsubscribeAllUsers = onValue(allUsersRef,
        (snapshot) => setAllUsers(snapshot.val() || {}),
        () => setStatusLog("CRITICAL ERROR: Firebase Rules are blocking the Admin!")
      );
    }
    return () => { if (unsubscribeAllUsers) unsubscribeAllUsers(); };
  }, [isAdmin]);

  // --- UNKILLABLE CLOCK & SWEEP ---
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      const remainingMs = session.expiresAt - Date.now();
      if (remainingMs <= 0) {
        clearInterval(interval);
        handleCloseLocker(user.uid, session.lockerId);
      } else {
        setTimeLeft(remainingMs);
      }
    }, 1000);
    if (session.expiresAt - Date.now() <= 0) handleCloseLocker(user.uid, session.lockerId);
    return () => clearInterval(interval);
  }, [session, user]);

  useEffect(() => {
    if (!isAdmin || Object.keys(allUsers).length === 0) return;
    const sweepInterval = setInterval(() => {
      const now = Date.now();
      Object.entries(allUsers).forEach(([uid, data]) => {
        if (data.session && data.session.expiresAt <= now) {
          handleCloseLocker(uid, data.session.lockerId);
        }
      });
    }, 5000);
    return () => clearInterval(sweepInterval);
  }, [isAdmin, allUsers]);

  // --- SPLINE SYNC ---
  useEffect(() => {
    if (isSplineLoaded && availableLockers.length > 0 && !initialSyncDone.current) {
      const totalLockers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
      const busyLockers = totalLockers.filter(id => !availableLockers.includes(id));
      if (busyLockers.length > 0) {
        initialSyncDone.current = true;
        setTimeout(() => {
          busyLockers.forEach((lockerId, index) => {
            setTimeout(() => {
              if (splineRef.current) {
                splineRef.current.setVariable('TargetLocker', -1);
                splineRef.current.setVariable('DoorStatus', 0);
                setTimeout(() => {
                  splineRef.current.setVariable('TargetLocker', lockerId);
                  splineRef.current.setVariable('DoorStatus', 1);
                }, 50);
              }
            }, index * 150);
          });
        }, 500);
      }
    }
  }, [isSplineLoaded, availableLockers]);

  function onLoad(splineApp) { splineRef.current = splineApp; setIsSplineLoaded(true); }

  const handleLogout = () => {
    if (activeSlotUser === user?.uid) set(ref(database, 'activeUser'), "none");
    setIsAdmin(false); signOut(auth);
  };

  const toggleUserStatus = (uid, currentStatus) => set(ref(database, `users/${uid}/isDisabled`), !currentStatus);

  const formatTime = (ms) => {
    if (ms <= 0) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // --- ACTIONS ---
  const handleActivateSlot = () => {
    if (!user || isDisabled) return;
    const activeUserRef = ref(database, 'activeUser');
    set(activeUserRef, user.uid);
    onDisconnect(activeUserRef).set("none");
    setSlotCountdown(15);
    setStatusLog("Coin slot activated! Insert cash now.");
    const timer = setInterval(() => {
      setSlotCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          set(ref(database, 'activeUser'), "none");
          onDisconnect(activeUserRef).cancel();
          setStatusLog("Time expired. Coin slot locked.");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleInsertMoneyLocal = () => {
    if (activeSlotUser !== user.uid) return;
    set(ref(database, `users/${user.uid}/balance`), balance + 20);
    setStatusLog(`₱20 inserted. Wallet updated.`);
  };

  const handleDispense = () => {
    if (isDisabled) return;
    if (session) { setStatusLog("Error: Active locker exists."); return; }
    if (spendAmount <= 0) { setStatusLog("Error: Invalid amount."); return; }
    if (balance < spendAmount) { setStatusLog(`Error: Need ₱${spendAmount}.`); return; }
    if (availableLockers.length === 0) { setStatusLog("Error: Machine empty!"); return; }

    const durationMs = spendAmount * ratePerPeso * 60 * 1000;
    const lockersCopy = [...availableLockers];
    const targetLocker = lockersCopy.shift();
    set(ref(database, 'system/availableLockers'), lockersCopy);
    set(ref(database, `users/${user.uid}/balance`), balance - spendAmount);
    set(ref(database, `users/${user.uid}/session`), {
      lockerId: targetLocker,
      expiresAt: Date.now() + durationMs,
      paidAmount: spendAmount,
      devices: []
    });
    set(ref(database, `buzzers/${targetLocker}/duration`), durationMs);
    setStatusLog(`Locker #${targetLocker} dispensed.`);

    if (splineRef.current) {
      splineRef.current.setVariable('TargetLocker', -1);
      splineRef.current.setVariable('DoorStatus', 0);
      setTimeout(() => {
        splineRef.current.setVariable('TargetLocker', targetLocker);
        splineRef.current.setVariable('DoorStatus', 1);
      }, 50);
    }
  };

  const handleCloseLocker = (targetUid, lockerId) => {
    if (!targetUid || !lockerId) return;
    set(ref(database, `users/${targetUid}/session`), null);
    set(ref(database, `connectionRequests/${targetUid}_${lockerId}`), null);
    get(ref(database, 'system/availableLockers')).then(snap => {
      const rawData = snap.val();
      const current = Array.isArray(rawData) ? rawData : Object.values(rawData || {});
      const cleanCurrent = current.filter(val => val !== null && val !== undefined);
      if (!cleanCurrent.includes(lockerId)) {
        const updated = [...cleanCurrent, lockerId].sort((a, b) => a - b);
        set(ref(database, 'system/availableLockers'), updated);
      }
    });
    set(ref(database, `buzzers/${lockerId}/duration`), -1);
    setStatusLog(isAdmin ? `Admin Sweep: Locker #${lockerId} returned.` : `Session ended. Locker #${lockerId} closed.`);
    if (splineRef.current) {
      splineRef.current.setVariable('TargetLocker', -1);
      splineRef.current.setVariable('DoorStatus', 0);
      setTimeout(() => {
        splineRef.current.setVariable('TargetLocker', lockerId);
        splineRef.current.setVariable('DoorStatus', 2);
      }, 50);
    }
  };

  // --- SET RATE HANDLER ---
  const handleSetRate = () => {
    const parsed = Number(adminRateInput);
    if (!parsed || parsed <= 0) {
      setStatusLog("Error: Rate must be a positive number.");
      return;
    }
    set(ref(database, 'system/ratePerPeso'), parsed);
    setStatusLog(`Rate updated: ₱1 = ${parsed} mins.`);
  };

  if (loading) return <div style={{ backgroundColor: '#000', height: '100vh' }}></div>;
  if (!user && !isAdmin) return <Auth />;

  const isLockedBySomeoneElse = activeSlotUser !== "none" && activeSlotUser !== user?.uid;
  const isLockedByMe = activeSlotUser === user?.uid;
  const activeBuzzersList = Object.entries(allUsers).filter(([uid, data]) => data.session != null);
  const totalUsers = Object.keys(allUsers).length;
  const totalCashInSystem = Object.values(allUsers).reduce((sum, u) => sum + (u.balance || 0), 0);

  const connectedDevices = session?.devices || [];
  const qrLink = session ? `${window.location.origin}${window.location.pathname}?lockerId=${session.lockerId}&host=${user.uid}` : '';

  // --- STYLES ---
  const colors = {
    bg: '#050505', panel: '#111111', border: '#2a2a2a',
    primary: '#FFCC00', text: '#ffffff', muted: '#777777', danger: '#ff4444'
  };

  const panelStyle = {
    backgroundColor: colors.panel, padding: '20px', borderRadius: '12px',
    border: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '15px'
  };

  const inputStyle = {
    padding: '12px', borderRadius: '6px', border: `1px solid ${colors.border}`,
    backgroundColor: '#000', color: colors.primary, fontSize: '1.2em',
    outline: 'none', fontWeight: 'bold', textAlign: 'center'
  };

  const btnPrimary = {
    padding: '16px', backgroundColor: colors.primary, color: '#000', border: 'none',
    fontWeight: '900', cursor: 'pointer', borderRadius: '8px',
    textTransform: 'uppercase', letterSpacing: '1px', transition: 'all 0.2s', width: '100%'
  };

  const btnOutline = {
    padding: '16px', backgroundColor: 'transparent', color: colors.primary,
    border: `2px solid ${colors.primary}`, cursor: 'pointer', borderRadius: '8px',
    fontWeight: 'bold', textTransform: 'uppercase', width: '100%'
  };

  const btnDisabled = {
    padding: '16px', backgroundColor: '#222', color: '#555', border: 'none',
    borderRadius: '8px', fontWeight: 'bold', textTransform: 'uppercase', width: '100%'
  };

  // =============================================
  // REUSABLE COMPONENTS
  // =============================================

  const LockerGrid = () => (
    <div style={{ backgroundColor: '#000', padding: '20px', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
      <div style={{ color: colors.muted, fontSize: '0.8em', textTransform: 'uppercase', marginBottom: '10px' }}>
        Available Lockers ({availableLockers.length}/14)
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {[1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(num => (
          <div key={num} style={{
            width: '32px', height: '32px', display: 'flex', alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: availableLockers.includes(num) ? '#222' : colors.primary,
            color: availableLockers.includes(num) ? '#555' : '#000',
            borderRadius: '4px', fontSize: '0.75em', fontWeight: 'bold'
          }}>
            {num}
          </div>
        ))}
      </div>
    </div>
  );

  const StatusTerminal = ({ compact }) => (
    <div style={{
      ...panelStyle,
      backgroundColor: '#000',
      padding: compact ? '12px 16px' : '20px',
      gap: '8px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, color: colors.muted, fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Terminal Status
        </h3>
        <div style={{
          width: '8px', height: '8px', borderRadius: '50%',
          backgroundColor: statusLog.includes("ERROR") ? colors.danger : '#00ffcc',
          boxShadow: `0 0 8px ${statusLog.includes("ERROR") ? colors.danger : '#00ffcc'}`
        }}></div>
      </div>
      <p style={{
        color: statusLog.includes("ERROR") ? colors.danger : colors.primary,
        fontWeight: 'bold', margin: 0, fontFamily: 'monospace',
        fontSize: compact ? '0.8em' : '0.95em', lineHeight: '1.4'
      }}>
        {'>'} {statusLog}
      </p>
    </div>
  );

  const ConnectedDevicesList = () => (
    <div style={{ marginTop: '15px', textAlign: 'left', backgroundColor: '#111', padding: '12px', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ color: colors.muted, fontSize: '0.8em', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Connected Devices ({connectedDevices.length}/2)
        </span>
      </div>
      {connectedDevices.length === 0 ? (
        <div style={{ color: '#555', fontSize: '0.85em', fontStyle: 'italic' }}>No devices connected yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {connectedDevices.map((d, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#000', padding: '10px', borderRadius: '6px' }}>
              <span style={{ color: '#fff', fontSize: '0.9em', fontWeight: 'bold' }}>{d.deviceName}</span>
              <span style={{ color: '#00ffcc', fontSize: '0.7em', padding: '2px 6px', border: '1px solid #00ffcc', borderRadius: '10px' }}>CONNECTED</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // =============================================
  //  ADMIN — RATE CONTROL PANEL (reused in desktop + mobile)
  // =============================================
  const RateControlPanel = () => (
    <div style={{ backgroundColor: '#000', padding: '16px', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
      <div style={{ color: colors.muted, fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
        Peso → Time Rate
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: colors.muted, fontSize: '0.85em', whiteSpace: 'nowrap' }}>₱1 =</span>
          <input
            type="number"
            min="1"
            value={adminRateInput}
            onChange={(e) => setAdminRateInput(e.target.value)}
            style={{
              padding: '8px', borderRadius: '6px', border: `1px solid ${colors.border}`,
              backgroundColor: '#111', color: colors.primary, fontSize: '1em',
              outline: 'none', fontWeight: 'bold', textAlign: 'center', width: '70px'
            }}
          />
          <span style={{ color: colors.muted, fontSize: '0.85em' }}>mins</span>
        </div>
        <button
          onClick={handleSetRate}
          style={{
            padding: '9px 16px', backgroundColor: colors.primary, color: '#000',
            border: 'none', borderRadius: '6px', fontWeight: '900', cursor: 'pointer',
            fontSize: '0.8em', textTransform: 'uppercase', whiteSpace: 'nowrap'
          }}
        >
          SET RATE
        </button>
      </div>
      <div style={{ color: '#555', fontSize: '0.75em', marginTop: '10px' }}>
        Current live rate: <span style={{ color: colors.primary, fontWeight: 'bold' }}>₱1 = {ratePerPeso} min{ratePerPeso !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );

  // =============================================
  //  USER — ACTION PANEL (right / main)
  // =============================================
  const UserActions = () => (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: colors.muted, fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>
            Wallet Balance
          </div>
          <div style={{ fontSize: '2.8rem', fontWeight: '900', color: colors.primary, lineHeight: 1 }}>
            ₱{balance}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: colors.muted, fontSize: '0.75em' }}>Rate</div>
          <div style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9em' }}>₱1 = {ratePerPeso} mins</div>
        </div>
      </div>

      {!session ? (
        <div style={panelStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ color: colors.muted, fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.8em' }}>
              Amount to Spend (₱)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px' }}>
              <input
                type="number" min="1" value={spendAmount}
                onChange={(e) => setSpendAmount(Number(e.target.value))}
                style={{ ...inputStyle, width: '100%', minWidth: 0, boxSizing: 'border-box' }}
              />
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 12px', backgroundColor: '#000',
                border: `1px solid ${colors.border}`, borderRadius: '6px',
                color: '#fff', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0, fontSize: '0.9em'
              }}>
                = <span style={{ color: colors.primary, margin: '0 5px' }}>{spendAmount * ratePerPeso}</span> MINS
              </div>
            </div>
          </div>

          <div style={{ height: '1px', backgroundColor: colors.border }}></div>

          {isLockedBySomeoneElse ? (
            <button style={btnDisabled} disabled>Machine Busy...</button>
          ) : isLockedByMe ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button style={btnPrimary} disabled>INSERT CASH NOW ({slotCountdown}s)</button>
              <button onClick={handleInsertMoneyLocal} style={btnOutline}>SIMULATE ₱20 COIN</button>
            </div>
          ) : (
            <button onClick={handleActivateSlot} style={btnOutline}>Activate Coin Slot</button>
          )}

          <button
            onClick={handleDispense}
            style={{ ...btnPrimary, backgroundColor: session ? '#222' : colors.primary, color: session ? '#555' : '#000' }}
            disabled={session != null}
          >
            CHECKOUT BUZZER
          </button>
        </div>
      ) : (
        <div style={{ backgroundColor: '#000', padding: '25px', borderRadius: '12px', border: `2px solid ${colors.primary}`, textAlign: 'center' }}>
          <div style={{ color: colors.muted, fontSize: '0.85em', letterSpacing: '2px', marginBottom: '8px' }}>
            LOCKER #{session.lockerId} ACTIVE
          </div>
          <div style={{ fontSize: '3.5rem', fontWeight: '900', color: colors.primary, fontFamily: 'monospace', marginBottom: '12px' }}>
            {formatTime(timeLeft)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', fontSize: '0.85em', color: colors.muted }}>
            <span>Session Cost: <strong style={{ color: colors.primary }}>₱{session.paidAmount || 0}</strong></span>
          </div>

          <button
            onClick={() => setShowQR(true)}
            style={{ ...btnOutline, padding: '10px', marginBottom: '10px', fontSize: '0.8em' }}
          >
            SHOW QR CODE TO CONNECT
          </button>

          <ConnectedDevicesList />

          <button
            onClick={() => handleCloseLocker(user.uid, session.lockerId)}
            style={{
              padding: '12px 20px', backgroundColor: '#1a0505', color: colors.danger,
              border: `1px solid ${colors.danger}`, borderRadius: '6px', marginTop: '15px',
              cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase', width: '100%'
            }}
          >
            Return Buzzer Early
          </button>
        </div>
      )}
    </>
  );

  // =============================================
  //  ADMIN — USER TABLE
  // =============================================
  const AdminUserTable = () => (
    <div style={{ ...panelStyle, padding: '16px' }}>
      <h3 style={{ margin: 0, color: '#FFF', fontSize: '1em' }}>User Database</h3>
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{
          width: '100%', textAlign: 'left', borderCollapse: 'collapse',
          fontSize: '0.82em', minWidth: '380px'
        }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${colors.primary}` }}>
              {['Email', 'ID', 'Bal', 'Locker', 'Action'].map(h => (
                <th key={h} style={{ padding: '10px 6px', color: colors.primary, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(allUsers).map(([uid, data]) => (
              <tr key={uid} style={{ borderBottom: `1px solid ${colors.border}`, backgroundColor: data.isDisabled ? '#1a0505' : 'transparent' }}>
                <td style={{ padding: '10px 6px', color: '#ccc', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {data.email?.split('@')[0]}
                </td>
                <td style={{ padding: '10px 6px', color: colors.muted }}>{data.idNumber || '-'}</td>
                <td style={{ padding: '10px 6px', fontWeight: 'bold', color: '#fff', whiteSpace: 'nowrap' }}>₱{data.balance || 0}</td>
                <td style={{ padding: '10px 6px', color: colors.primary, fontWeight: 'bold' }}>
                  {data.session ? `#${data.session.lockerId}` : '-'}
                </td>
                <td style={{ padding: '10px 6px' }}>
                  <button
                    onClick={() => toggleUserStatus(uid, data.isDisabled)}
                    style={{
                      padding: '5px 8px',
                      backgroundColor: data.isDisabled ? 'transparent' : colors.danger,
                      color: data.isDisabled ? colors.primary : '#000',
                      border: data.isDisabled ? `1px solid ${colors.primary}` : 'none',
                      borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75em', whiteSpace: 'nowrap'
                    }}
                  >
                    {data.isDisabled ? 'UNBAN' : 'BAN'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <>
      {/* --- QR CODE MODAL OVERLAY --- */}
      {showQR && session && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
          backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px'
        }}>
          <div style={{
            backgroundColor: '#111', padding: '30px', borderRadius: '16px', border: `2px solid ${colors.primary}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', maxWidth: '350px', width: '100%'
          }}>
            <h2 style={{ margin: 0, color: '#fff', fontSize: '1.2em', textTransform: 'uppercase', letterSpacing: '1px' }}>Connect Device</h2>
            <p style={{ margin: 0, color: colors.muted, fontSize: '0.9em', textAlign: 'center' }}>
              Scan this code with your device camera to link it to Buzzer #{session.lockerId}. (Limit 2)
            </p>
            <div style={{ backgroundColor: '#fff', padding: '15px', borderRadius: '8px' }}>
              <QRCodeCanvas value={qrLink} size={200} />
            </div>
            <button onClick={() => setShowQR(false)} style={{ ...btnPrimary, padding: '12px', marginTop: '10px' }}>
              CLOSE
            </button>
          </div>
        </div>
      )}

      {/* =============================================
          MAIN LAYOUT RENDER
          ============================================= */}
      {isMobile ? (
        <div style={{
          display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh',
          backgroundColor: colors.bg, color: colors.text, fontFamily: 'sans-serif', overflow: 'hidden'
        }}>
          {/* Mobile Header */}
          <div style={{
            backgroundColor: colors.panel, borderBottom: `1px solid ${colors.border}`,
            padding: '12px 16px', display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', flexShrink: 0, zIndex: 20
          }}>
            <div>
              <div style={{ color: colors.primary, fontWeight: '900', letterSpacing: '2px', fontSize: '1.1em' }}>
                BUZZNET
              </div>
              <div style={{ color: colors.muted, fontSize: '0.7em', marginTop: '1px' }}>
                {isAdmin ? 'ADMIN' : user?.email}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {session && (
                <div style={{
                  backgroundColor: '#1a1a00', border: `1px solid ${colors.primary}`,
                  borderRadius: '20px', padding: '4px 12px',
                  color: colors.primary, fontWeight: '900', fontFamily: 'monospace', fontSize: '0.9em'
                }}>
                  {formatTime(timeLeft)}
                </div>
              )}
              <button onClick={handleLogout} style={{ padding: '6px 12px', backgroundColor: 'transparent', color: colors.danger, border: `1px solid ${colors.danger}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.75em', fontWeight: 'bold' }}>OUT</button>
            </div>
          </div>

          {/* Scrollable Content Area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '80px' }}>
            {!isAdmin && (
              <>
                {mobileTab === 'main' && <UserActions />}
                {mobileTab === 'session' && (
                  <>
                    {session ? (
                      <div style={{ backgroundColor: '#000', padding: '25px', borderRadius: '12px', border: `2px solid ${colors.primary}`, textAlign: 'center' }}>
                        <div style={{ color: colors.muted, fontSize: '0.9em', letterSpacing: '2px', marginBottom: '10px' }}>LOCKER #{session.lockerId} ACTIVE</div>
                        <div style={{ fontSize: '4.5rem', fontWeight: '900', color: colors.primary, fontFamily: 'monospace', marginBottom: '15px' }}>{formatTime(timeLeft)}</div>
                        <button onClick={() => setShowQR(true)} style={{ ...btnOutline, padding: '10px', marginBottom: '10px', fontSize: '0.8em' }}>SHOW QR CODE</button>
                        <ConnectedDevicesList />
                        <button onClick={() => handleCloseLocker(user.uid, session.lockerId)} style={{ padding: '14px', backgroundColor: '#1a0505', color: colors.danger, border: `1px solid ${colors.danger}`, borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase', width: '100%', marginTop: '15px' }}>Return Buzzer Early</button>
                      </div>
                    ) : (
                      <div style={{ backgroundColor: '#000', padding: '40px', borderRadius: '12px', border: `1px dashed ${colors.border}`, textAlign: 'center', color: colors.muted }}>No active session. Go to Wallet to rent a buzzer.</div>
                    )}
                  </>
                )}
                {mobileTab === 'lockers' && <LockerGrid />}
              </>
            )}

            {isAdmin && (
              <>
                {mobileTab === 'main' && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#000', padding: '14px 16px', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
                      <span style={{ color: colors.muted, fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.8em' }}>Coin Slot</span>
                      <span style={{ color: activeSlotUser !== "none" ? colors.primary : '#555', fontWeight: 'bold', fontSize: '0.85em' }}>{activeSlotUser === "none" ? "IDLE" : `LOCKED`}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {[
                        { label: 'Active Sessions', value: activeBuzzersList.length, color: colors.primary },
                        { label: 'Total Users', value: totalUsers, color: '#fff' },
                        { label: 'System Wallet', value: `₱${totalCashInSystem}`, color: colors.primary }
                      ].map(item => (
                        <div key={item.label} style={{ backgroundColor: '#000', padding: '16px', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
                          <div style={{ color: colors.muted, fontSize: '0.75em', textTransform: 'uppercase', marginBottom: '6px' }}>{item.label}</div>
                          <div style={{ fontWeight: '900', fontSize: '1.3em', color: item.color }}>{item.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Rate Control — Mobile Admin */}
                    <RateControlPanel />

                    <StatusTerminal compact={true} />
                  </>
                )}
                {mobileTab === 'users' && <AdminUserTable />}
                {mobileTab === 'lockers' && <LockerGrid />}
              </>
            )}
          </div>

          {/* Bottom Tab Bar */}
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, backgroundColor: colors.panel, borderTop: `1px solid ${colors.border}`, display: 'flex', zIndex: 20, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            {(isAdmin
              ? [{ id: 'main', label: 'Overview' }, { id: 'users', label: 'Users' }, { id: 'lockers', label: 'Lockers' }]
              : [{ id: 'main', label: 'Wallet' }, { id: 'session', label: 'Session' }, { id: 'lockers', label: 'Lockers' }]
            ).map(tab => (
              <button
                key={tab.id}
                onClick={() => setMobileTab(tab.id)}
                style={{
                  flex: 1, padding: '14px 8px', backgroundColor: 'transparent',
                  color: mobileTab === tab.id ? colors.primary : colors.muted,
                  border: 'none', cursor: 'pointer',
                  fontWeight: mobileTab === tab.id ? '900' : 'normal',
                  fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.5px',
                  borderTop: mobileTab === tab.id ? `2px solid ${colors.primary}` : '2px solid transparent',
                  transition: 'all 0.15s'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* DESKTOP LAYOUT */
        <div style={{ display: 'flex', width: '100vw', height: '100vh', backgroundColor: colors.bg, color: colors.text, fontFamily: 'sans-serif', overflow: 'hidden' }}>

          {/* LEFT PANEL */}
          <div style={{ width: '350px', minWidth: '350px', backgroundColor: colors.panel, borderRight: `1px solid ${colors.border}`, padding: '30px', display: 'flex', flexDirection: 'column', gap: '25px', overflowY: 'auto', zIndex: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `1px solid ${colors.border}`, paddingBottom: '20px' }}>
              <div>
                <div style={{ color: colors.primary, fontWeight: '900', letterSpacing: '2px', fontSize: '1.4em' }}>{isAdmin ? 'ADMIN' : 'USER'}</div>
                <div style={{ color: colors.muted, fontSize: '0.85em', marginTop: '5px', wordBreak: 'break-all' }}>{user?.email}</div>
              </div>
              <button onClick={handleLogout} style={{ padding: '6px 12px', backgroundColor: 'transparent', color: colors.danger, border: `1px solid ${colors.danger}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.8em', fontWeight: 'bold' }}>LOGOUT</button>
            </div>

            {!isAdmin && (
              <>
                <div>
                  <h3 style={{ color: colors.muted, fontSize: '0.85em', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '15px' }}>Active Session</h3>
                  {session ? (
                    <div style={{ backgroundColor: '#000', padding: '25px', borderRadius: '12px', border: `2px solid ${colors.primary}`, textAlign: 'center' }}>
                      <div style={{ color: colors.muted, fontSize: '0.9em', letterSpacing: '2px', marginBottom: '10px' }}>LOCKER #{session.lockerId} ACTIVE</div>
                      <div style={{ fontSize: '4rem', fontWeight: '900', color: colors.primary, fontFamily: 'monospace', textShadow: '0 0 20px rgba(255,204,0,0.4)', marginBottom: '15px' }}>{formatTime(timeLeft)}</div>
                      <button onClick={() => setShowQR(true)} style={{ ...btnOutline, padding: '10px', fontSize: '0.8em' }}>SHOW QR CODE</button>
                      <ConnectedDevicesList />
                      <button onClick={() => handleCloseLocker(user.uid, session.lockerId)} style={{ padding: '12px 20px', backgroundColor: '#1a0505', color: colors.danger, border: `1px solid ${colors.danger}`, borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase', width: '100%', marginTop: '15px' }}>Return Buzzer Early</button>
                    </div>
                  ) : (
                    <div style={{ backgroundColor: '#000', padding: '25px', borderRadius: '12px', border: `1px dashed ${colors.border}`, textAlign: 'center', color: colors.muted }}>No active buzzer.</div>
                  )}
                </div>
              </>
            )}
            <div style={{ marginTop: 'auto' }}><LockerGrid /></div>
          </div>

          {/* CENTER PANEL — SPLINE 3D */}
          <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <Spline
              scene="https://prod.spline.design/H-eYBpbnLnl3xm57/scene.splinecode?v=2"
              onLoad={onLoad}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
            />
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '100px', background: 'linear-gradient(to bottom, #050505 0%, transparent 100%)', pointerEvents: 'none' }}></div>
          </div>

          {/* RIGHT PANEL */}
          <div style={{ width: isAdmin ? '500px' : '400px', minWidth: isAdmin ? '500px' : '400px', backgroundColor: colors.panel, borderLeft: `1px solid ${colors.border}`, padding: '30px', display: 'flex', flexDirection: 'column', gap: '25px', overflowY: 'auto', overflowX: 'hidden', zIndex: 10 }}>
            {isAdmin ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#000', padding: '15px 20px', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
                  <span style={{ color: colors.muted, fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.85em' }}>Coin Slot Status</span>
                  <span style={{ color: activeSlotUser !== "none" ? colors.primary : '#555', fontWeight: 'bold' }}>{activeSlotUser === "none" ? "IDLE" : `LOCKED`}</span>
                </div>

                {/* Rate Control — Desktop Admin */}
                <RateControlPanel />

                <div style={{ flexGrow: 1 }}><AdminUserTable /></div>
              </>
            ) : (
              <>
                <div style={{ ...panelStyle, border: 'none', backgroundColor: 'transparent', padding: 0 }}>
                  <h2 style={{ fontSize: '1.2rem', margin: '0 0 5px 0', color: colors.muted, fontWeight: 'normal', textTransform: 'uppercase' }}>Wallet Balance</h2>
                  <div style={{ fontSize: '3.5rem', fontWeight: '900', color: colors.primary }}>₱{balance}</div>
                </div>
                <div style={panelStyle}>
                  {!session ? (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ color: colors.muted, fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.85em' }}>Amount to Spend (₱)</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', overflow: 'hidden' }}>
                          <input
                            type="number" min="1" value={spendAmount}
                            onChange={(e) => setSpendAmount(Number(e.target.value))}
                            style={{ ...inputStyle, width: '100%', minWidth: 0, boxSizing: 'border-box' }}
                          />
                          <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: '0 15px', backgroundColor: '#000',
                            border: `1px solid ${colors.border}`, borderRadius: '6px',
                            color: '#fff', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0
                          }}>
                            = <span style={{ color: colors.primary, margin: '0 5px' }}>{spendAmount * ratePerPeso}</span> MINS
                          </div>
                        </div>
                      </div>
                      <div style={{ height: '1px', backgroundColor: colors.border, margin: '10px 0' }}></div>
                      {isLockedBySomeoneElse ? (
                        <button style={btnDisabled} disabled>Machine Busy...</button>
                      ) : isLockedByMe ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <button style={btnPrimary} disabled>INSERT CASH NOW ({slotCountdown}s)</button>
                          <button onClick={handleInsertMoneyLocal} style={btnOutline}>SIMULATE ₱20 COIN</button>
                        </div>
                      ) : (
                        <button onClick={handleActivateSlot} style={btnOutline}>Activate Coin Slot</button>
                      )}
                      <button
                        onClick={handleDispense}
                        style={{ ...btnPrimary, marginTop: '10px', backgroundColor: session ? '#222' : colors.primary, color: session ? '#555' : '#000' }}
                        disabled={session != null}
                      >
                        CHECKOUT BUZZER
                      </button>
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '30px 10px', color: colors.muted }}>
                      <div style={{ fontSize: '2em', marginBottom: '10px' }}>🔒</div>
                      You currently have a buzzer checked out.<br />Wait for the session to expire to rent another.
                    </div>
                  )}
                </div>
              </>
            )}
            <div style={{ marginTop: 'auto' }}><StatusTerminal compact={false} /></div>
          </div>
        </div>
      )}
    </>
  );
}