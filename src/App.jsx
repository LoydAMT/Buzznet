import React, { useState, useRef, useEffect } from 'react';
import Spline from '@splinetool/react-spline';
import Auth from './Auth';
import { database, auth } from './firebase';
import { ref, onValue, set, get, onDisconnect } from "firebase/database";
import { onAuthStateChanged, signOut } from "firebase/auth";

export default function BuzzNetDashboard() {
  const splineRef = useRef();

  // --- STATE MANAGEMENT ---
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

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

  // --- CORE LISTENERS ---
  useEffect(() => {
    let unsubscribeBalance, unsubscribeSession, unsubscribeGlobalLockers, unsubscribeActiveUser;

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
        unsubscribeSession = onValue(sessionRef, (snapshot) => setSession(snapshot.val()));
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

    const activeUserRef = ref(database, 'activeUser');
    unsubscribeActiveUser = onValue(activeUserRef, (snapshot) => setActiveSlotUser(snapshot.val() || "none"));

    return () => {
      unsubscribeAuth();
      if (unsubscribeBalance) unsubscribeBalance();
      if (unsubscribeSession) unsubscribeSession();
      if (unsubscribeGlobalLockers) unsubscribeGlobalLockers();
      if (unsubscribeActiveUser) unsubscribeActiveUser();
    };
  }, []);

  useEffect(() => {
    let unsubscribeAllUsers;
    if (isAdmin) {
      const allUsersRef = ref(database, 'users');
      unsubscribeAllUsers = onValue(allUsersRef, 
        (snapshot) => setAllUsers(snapshot.val() || {}),
        (error) => setStatusLog("CRITICAL ERROR: Firebase Rules are blocking the Admin!")
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

    const durationMs = spendAmount * 5 * 60 * 1000; 
    const lockersCopy = [...availableLockers];
    const targetLocker = lockersCopy.shift();
    set(ref(database, 'system/availableLockers'), lockersCopy);

   set(ref(database, `users/${user.uid}/balance`), balance - spendAmount);
    set(ref(database, `users/${user.uid}/session`), {
      lockerId: targetLocker,
      expiresAt: Date.now() + durationMs,
      paidAmount: spendAmount 
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

  if (loading) return <div style={{ backgroundColor: '#000', height: '100vh' }}></div>;
  if (!user && !isAdmin) return <Auth />;

  const isLockedBySomeoneElse = activeSlotUser !== "none" && activeSlotUser !== user?.uid;
  const isLockedByMe = activeSlotUser === user?.uid;
  
  const activeBuzzersList = Object.entries(allUsers).filter(([uid, data]) => data.session != null);
  const totalUsers = Object.keys(allUsers).length;
  const totalCashInSystem = Object.values(allUsers).reduce((sum, u) => sum + (u.balance || 0), 0);

  // --- STYLES ---
  const colors = { bg: '#050505', panel: '#111111', border: '#2a2a2a', primary: '#FFCC00', text: '#ffffff', muted: '#777777', danger: '#ff4444' };
  const panelStyle = { backgroundColor: colors.panel, padding: '25px', borderRadius: '12px', border: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '15px' };
  const inputStyle = { padding: '12px', borderRadius: '6px', border: `1px solid ${colors.border}`, backgroundColor: '#000', color: colors.primary, fontSize: '1.2em', outline: 'none', fontWeight: 'bold', textAlign: 'center' };
  const btnPrimary = { padding: '16px', backgroundColor: colors.primary, color: '#000', border: 'none', fontWeight: '900', cursor: 'pointer', borderRadius: '8px', textTransform: 'uppercase', letterSpacing: '1px', boxShadow: `0 0 15px rgba(255, 204, 0, 0.15)`, transition: 'all 0.2s' };
  const btnOutline = { padding: '16px', backgroundColor: 'transparent', color: colors.primary, border: `2px solid ${colors.primary}`, cursor: 'pointer', borderRadius: '8px', fontWeight: 'bold', textTransform: 'uppercase' };
  const btnDisabled = { padding: '16px', backgroundColor: '#222', color: '#555', border: 'none', borderRadius: '8px', fontWeight: 'bold', textTransform: 'uppercase' };

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', backgroundColor: colors.bg, color: colors.text, fontFamily: 'sans-serif', overflow: 'hidden' }}>
      
      {/* ================= LEFT PANEL (INFO & STATS) ================= */}
      <div style={{ width: '350px', minWidth: '350px', backgroundColor: colors.panel, borderRight: `1px solid ${colors.border}`, padding: '30px', display: 'flex', flexDirection: 'column', gap: '25px', overflowY: 'auto', zIndex: 10 }}>
        
        {/* Profile Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `1px solid ${colors.border}`, paddingBottom: '20px' }}>
          <div>
            <div style={{ color: colors.primary, fontWeight: '900', letterSpacing: '2px', fontSize: '1.4em' }}>{isAdmin ? 'ADMIN' : 'USER'}</div>
            <div style={{ color: colors.muted, fontSize: '0.85em', marginTop: '5px', wordBreak: 'break-all' }}>{user?.email}</div>
          </div>
          <button onClick={handleLogout} style={{ padding: '6px 12px', backgroundColor: 'transparent', color: colors.danger, border: `1px solid ${colors.danger}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.8em', fontWeight: 'bold' }}>LOGOUT</button>
        </div>

        {isAdmin ? (
          <>
            <div>
              <h3 style={{ color: colors.muted, fontSize: '0.85em', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '15px' }}>System Overview</h3>
              <div style={{ backgroundColor: '#000', padding: '20px', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
                <div style={{ fontSize: '2.5rem', fontWeight: '900', color: colors.primary }}>{activeBuzzersList.length}</div>
                <div style={{ color: colors.muted, fontSize: '0.9em', textTransform: 'uppercase' }}>Active Sessions</div>
              </div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', backgroundColor: '#000', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
                <span style={{ color: colors.muted }}>Total Users</span>
                <span style={{ fontWeight: 'bold' }}>{totalUsers}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', backgroundColor: '#000', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
                <span style={{ color: colors.muted }}>System Wallet</span>
                <span style={{ fontWeight: 'bold', color: colors.primary }}>₱{totalCashInSystem}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', backgroundColor: '#000', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
                <span style={{ color: colors.muted }}>Base Rate</span>
                <span style={{ fontWeight: 'bold' }}>₱1 = 5 Mins</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <h3 style={{ color: colors.muted, fontSize: '0.85em', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '15px' }}>Active Session</h3>
              {session ? (
                <div style={{ backgroundColor: '#000', padding: '25px', borderRadius: '12px', border: `2px solid ${colors.primary}`, textAlign: 'center', boxShadow: `0 0 30px rgba(255,204,0,0.1)` }}>
                  <div style={{ color: colors.muted, fontSize: '0.9em', letterSpacing: '2px', marginBottom: '10px' }}>LOCKER #{session.lockerId} ACTIVE</div>
                  <div style={{ fontSize: '4rem', fontWeight: '900', color: colors.primary, fontFamily: 'monospace', textShadow: '0 0 20px rgba(255,204,0,0.4)', marginBottom: '15px' }}>
                    {formatTime(timeLeft)}
                  </div>
                  
                  <button 
                    onClick={() => handleCloseLocker(user.uid, session.lockerId)}
                    style={{ padding: '12px 20px', backgroundColor: '#1a0505', color: colors.danger, border: `1px solid ${colors.danger}`, borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase', width: '100%', letterSpacing: '1px', transition: 'all 0.2s' }}
                    onMouseOver={(e) => e.target.style.backgroundColor = colors.danger + '22'}
                    onMouseOut={(e) => e.target.style.backgroundColor = '#1a0505'}
                  >
                    Return Buzzer Early
                  </button>
                  
                </div>
              ) : (
                <div style={{ backgroundColor: '#000', padding: '25px', borderRadius: '12px', border: `1px dashed ${colors.border}`, textAlign: 'center', color: colors.muted }}>
                  No active buzzer.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', backgroundColor: '#000', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
                <span style={{ color: colors.muted }}>System Rate</span>
                <span style={{ fontWeight: 'bold' }}>₱12.00 / Hour</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', backgroundColor: '#000', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
                <span style={{ color: colors.muted }}>Conversion</span>
                <span style={{ fontWeight: 'bold' }}>₱1 = 5 Mins</span>
              </div>
              {session && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', backgroundColor: '#1a1a00', borderRadius: '8px', border: `1px solid ${colors.primary}` }}>
                  <span style={{ color: colors.primary }}>Session Cost</span>
                  <span style={{ fontWeight: 'bold', color: colors.primary }}>₱{session.paidAmount || 0}.00</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Universal Availability Graphic */}
        <div style={{ marginTop: 'auto', backgroundColor: '#000', padding: '20px', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
          <div style={{ color: colors.muted, fontSize: '0.8em', textTransform: 'uppercase', marginBottom: '10px' }}>Available Lockers ({availableLockers.length}/14)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {[1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(num => (
              <div key={num} style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: availableLockers.includes(num) ? '#222' : colors.primary, color: availableLockers.includes(num) ? '#555' : '#000', borderRadius: '4px', fontSize: '0.75em', fontWeight: 'bold' }}>
                {num}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ================= CENTER PANEL (SPLINE 3D) ================= */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <Spline scene="https://prod.spline.design/H-eYBpbnLnl3xm57/scene.splinecode?v=2" onLoad={onLoad} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '100px', background: 'linear-gradient(to bottom, #050505 0%, transparent 100%)', pointerEvents: 'none' }}></div>
      </div>

      {/* ================= RIGHT PANEL (ACTIONS & DATA) ================= */}
      <div style={{ width: isAdmin ? '500px' : '400px', minWidth: isAdmin ? '500px' : '400px', backgroundColor: colors.panel, borderLeft: `1px solid ${colors.border}`, padding: '30px', display: 'flex', flexDirection: 'column', gap: '25px', overflowY: 'auto', overflowX: 'hidden', zIndex: 10 }}>
        
        {isAdmin ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#000', padding: '15px 20px', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
              <span style={{ color: colors.muted, fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.85em' }}>Coin Slot Status</span>
              <span style={{ color: activeSlotUser !== "none" ? colors.primary : '#555', fontWeight: 'bold' }}>
                {activeSlotUser === "none" ? "IDLE" : `LOCKED: ${allUsers[activeSlotUser]?.email || activeSlotUser}`}
              </span>
            </div>

            <div style={{ ...panelStyle, flexGrow: 1, padding: '20px' }}>
              <h3 style={{ margin: 0, color: '#FFF', fontSize: '1.1em' }}>User Database</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: '0.9em', minWidth: '400px' }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${colors.primary}` }}>
                      <th style={{ padding: '12px 8px', color: colors.primary }}>Email</th>
                      <th style={{ padding: '12px 8px', color: colors.primary }}>ID</th>
                      <th style={{ padding: '12px 8px', color: colors.primary }}>Bal</th>
                      <th style={{ padding: '12px 8px', color: colors.primary }}>Locker</th>
                      <th style={{ padding: '12px 8px', color: colors.primary }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(allUsers).map(([uid, data]) => (
                      <tr key={uid} style={{ borderBottom: `1px solid ${colors.border}`, backgroundColor: data.isDisabled ? '#1a0505' : 'transparent' }}>
                        <td style={{ padding: '12px 8px', color: '#ccc' }}>{data.email?.split('@')[0]}</td>
                        <td style={{ padding: '12px 8px', color: colors.muted, fontSize: '0.9em' }}>{data.idNumber || '-'}</td>
                        <td style={{ padding: '12px 8px', fontWeight: 'bold', color: '#fff' }}>₱{data.balance || 0}</td>
                        <td style={{ padding: '12px 8px', color: colors.primary, fontWeight: 'bold' }}>{data.session ? `#${data.session.lockerId}` : '-'}</td>
                        <td style={{ padding: '12px 8px' }}>
                          <button onClick={() => toggleUserStatus(uid, data.isDisabled)} style={{ padding: '6px 10px', backgroundColor: data.isDisabled ? 'transparent' : colors.danger, color: data.isDisabled ? colors.primary : '#000', border: data.isDisabled ? `1px solid ${colors.primary}` : 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8em' }}>
                            {data.isDisabled ? 'UNBAN' : 'BAN'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ ...panelStyle, border: 'none', backgroundColor: 'transparent', padding: 0 }}>
              <h2 style={{ fontSize: '1.2rem', margin: '0 0 5px 0', color: colors.muted, fontWeight: 'normal', textTransform: 'uppercase' }}>
                Wallet Balance
              </h2>
              <div style={{ fontSize: '3.5rem', fontWeight: '900', color: colors.primary }}>
                ₱{balance}
              </div>
            </div>
            
            <div style={panelStyle}>
              {!session ? (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ color: colors.muted, fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.85em' }}>Amount to Spend (₱)</label>
                    
                    {/* FIX: overflow: hidden on wrapper + minWidth: 0 on input prevents blowout */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', overflow: 'hidden' }}>
                      <input 
                        type="number" 
                        min="1" 
                        value={spendAmount} 
                        onChange={(e) => setSpendAmount(Number(e.target.value))} 
                        style={{ ...inputStyle, width: '100%', minWidth: 0, boxSizing: 'border-box' }} 
                      />
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 15px', backgroundColor: '#000', border: `1px solid ${colors.border}`, borderRadius: '6px', color: '#fff', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        = <span style={{ color: colors.primary, margin: '0 5px' }}>{spendAmount * 5}</span> MINS
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

                  <button onClick={handleDispense} style={{ ...btnPrimary, marginTop: '10px', backgroundColor: session ? '#222' : colors.primary, color: session ? '#555' : '#000' }} disabled={session != null}>
                    CHECKOUT BUZZER
                  </button>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '30px 10px', color: colors.muted }}>
                  <div style={{ fontSize: '2em', marginBottom: '10px' }}>🔒</div>
                  You currently have a buzzer checked out.<br/>Wait for the session to expire to rent another.
                </div>
              )}
            </div>
          </>
        )}

        {/* Universal Terminal Log */}
        <div style={{ ...panelStyle, marginTop: 'auto', backgroundColor: '#000' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <h3 style={{ margin: 0, color: colors.muted, fontSize: '0.85em', textTransform: 'uppercase', letterSpacing: '1px' }}>Terminal Status</h3>
             <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: statusLog.includes("ERROR") ? colors.danger : '#00ffcc', boxShadow: `0 0 8px ${statusLog.includes("ERROR") ? colors.danger : '#00ffcc'}` }}></div>
          </div>
          <p style={{ color: statusLog.includes("ERROR") ? colors.danger : colors.primary, fontWeight: 'bold', margin: '10px 0 0 0', fontFamily: 'monospace', fontSize: '0.95em', lineHeight: '1.4' }}>
           {'>'} {statusLog}
          </p>
        </div>

      </div>
    </div>
  );
}