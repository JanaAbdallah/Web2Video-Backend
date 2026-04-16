import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const TitleScene: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = spring({ frame, fps, from: 0, to: 1, durationInFrames: 20 });
  const scale = spring({ frame, fps, from: 0.85, to: 1, durationInFrames: 20 });

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px',
      }}
    >
      <div style={{ opacity, transform: `scale(${scale})`, textAlign: 'center' }}>
        {/* Decorative bar */}
        <div style={{
          width: '60px',
          height: '5px',
          background: '#60a5fa',
          borderRadius: '3px',
          margin: '0 auto 30px',
        }} />

        <div style={{
          fontSize: '60px',
          fontWeight: '800',
          color: '#f1f5f9',
          fontFamily: 'system-ui, sans-serif',
          lineHeight: 1.2,
          letterSpacing: '-1px',
        }}>
          {text}
        </div>

        <div style={{
          marginTop: '24px',
          fontSize: '22px',
          color: '#60a5fa',
          fontFamily: 'system-ui, sans-serif',
          fontWeight: '400',
        }}>
          AI-Generated Explanation
        </div>
      </div>
    </AbsoluteFill>
  );
};