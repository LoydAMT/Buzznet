import React, { useState } from 'react';
import { auth, database } from './firebase'; 
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { ref, set } from 'firebase/database'; 

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (email === 'admin' && password === 'admin') {
      signInWithEmailAndPassword(auth, 'admin@buzznet.com', 'admin123')
        .catch(() => {
          createUserWithEmailAndPassword(auth, 'admin@buzznet.com', 'admin123');
        });
      return; 
    }

    if (isLogin) {
      signInWithEmailAndPassword(auth, email, password)
        .catch((err) => setError(err.message));
    } else {
      if (!idNumber.trim()) {
        setError("Please enter your ID Number.");
        return;
      }
      createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
          const user = userCredential.user;
          set(ref(database, `users/${user.uid}/email`), email);
          set(ref(database, `users/${user.uid}/idNumber`), idNumber);
          set(ref(database, `users/${user.uid}/balance`), 0);
          set(ref(database, `users/${user.uid}/isDisabled`), false);
        })
        .catch((err) => setError(err.message));
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', backgroundColor: '#000000', color: '#ffffff', fontFamily: 'sans-serif' }}>
      <div style={{ backgroundColor: '#111111', padding: '40px', borderRadius: '12px', width: '100%', maxWidth: '400px', border: '1px solid #333333', boxShadow: '0 8px 32px rgba(255, 204, 0, 0.05)' }}>
        
        <h2 style={{ textAlign: 'center', margin: '0 0 25px 0', color: '#FFCC00', letterSpacing: '1px', textTransform: 'uppercase' }}>
          {isLogin ? 'BuzzNet Login' : 'Create Account'}
        </h2>

        {error && <p style={{ color: '#000000', backgroundColor: '#FFCC00', padding: '10px', borderRadius: '5px', fontSize: '0.9em', fontWeight: 'bold' }}>⚠️ {error}</p>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          
          {!isLogin && (
            <input 
              type="text" 
              placeholder="ID Number (e.g. 12-3456)" 
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              required={!isLogin}
              style={{ padding: '14px', borderRadius: '6px', border: '1px solid #333', backgroundColor: '#000000', color: '#ffffff', outline: 'none' }}
              onFocus={(e) => e.target.style.borderColor = '#FFCC00'}
              onBlur={(e) => e.target.style.borderColor = '#333'}
            />
          )}

          <input 
            type="text" 
            placeholder="Email Address" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ padding: '14px', borderRadius: '6px', border: '1px solid #333', backgroundColor: '#000000', color: '#ffffff', outline: 'none' }}
            onFocus={(e) => e.target.style.borderColor = '#FFCC00'}
            onBlur={(e) => e.target.style.borderColor = '#333'}
          />
          <input 
            type="password" 
            placeholder="Password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ padding: '14px', borderRadius: '6px', border: '1px solid #333', backgroundColor: '#000000', color: '#ffffff', outline: 'none' }}
            onFocus={(e) => e.target.style.borderColor = '#FFCC00'}
            onBlur={(e) => e.target.style.borderColor = '#333'}
          />
          <button 
            type="submit"
            style={{ padding: '15px', backgroundColor: '#FFCC00', color: '#000000', border: 'none', fontWeight: 'bold', fontSize: '1.05em', cursor: 'pointer', borderRadius: '6px', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '1px', boxShadow: '0 0 15px rgba(255, 204, 0, 0.3)' }}
          >
            {isLogin ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '25px', fontSize: '0.9em', color: '#888' }}>
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <span 
            onClick={() => { setIsLogin(!isLogin); setError(''); }} 
            style={{ color: '#FFCC00', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {isLogin ? 'Sign Up' : 'Login'}
          </span>
        </p>

      </div>
    </div>
  );
}