import React, { useState } from 'react';

/**
 * PasswordInput - visually identical to username input, with eye icon inside at right end
 */
export default function PasswordInput({ className = '', matchTick, ...props }) {
  const [show, setShow] = useState(false);
  // Use a single div wrapper for correct icon positioning
  return (
    <div className={`relative w-full ${className}`.trim()}>
      <input
        {...props}
        type={show ? 'text' : 'password'}
        className={`input bg-blue-100 pr-10 ${props.className || ''}`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-0 p-0 m-0 text-gray-500 hover:text-gray-700 focus:outline-none"
        style={{ outline: 'none' }}
      >
        {show ? (
          // Eye open SVG
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeWidth="2" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/></svg>
        ) : (
          // Eye closed SVG
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeWidth="2" d="M3 3l18 18M1 12s4-7 11-7c2.21 0 4.21.5 6 1.36M23 12s-4 7-11 7c-2.21 0-4.21-.5-6-1.36"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/></svg>
        )}
      </button>
      {matchTick && (
        <span className="absolute right-10 flex items-center h-full top-0">{matchTick}</span>
      )}
    </div>
  );
}
