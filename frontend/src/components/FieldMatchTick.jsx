import React from 'react';

export default function FieldMatchTick({ show }) {
  if (!show) return null;
  return (
    <span className="absolute right-8 text-green-500" title="Passwords match">
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill="#fff" stroke="#22c55e" strokeWidth="2" />
        <path d="M8 12.5l2.5 2.5L16 10" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
