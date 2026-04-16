import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const GRADIENTS = [
  'linear-gradient(135deg, #1e3a8a, #1d4ed8)',
  'linear-gradient(135deg, #164e63, #0e7490)',
  'linear-gradient(135deg, #312e81, #4338ca)',
  'linear-gradient(135deg, #1e3a8a, #0284c7)',
  'linear-gradient(135deg, #134e4a, #0f766e)',
];

export const ContentScene: React.FC<{ text: string; index: number; topic?: string; emoji?: string }> = ({ text, index, topic, emoji }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const containerOpacity = spring({ frame, fps, from: 0, to: 1, durationInFrames: 20 });
  const cardScale = spring({ frame, fps, from: 0.9, to: 1, durationInFrames: 25, config: { damping: 14 } });
  
  const iconTranslate = spring({ frame: frame - 10, fps, from: 50, to: 0, durationInFrames: 20 });
  const iconOpacity = spring({ frame: frame - 10, fps, from: 0, to: 1, durationInFrames: 20 });
  
  const topicTranslate = spring({ frame: frame - 15, fps, from: 30, to: 0, durationInFrames: 20 });
  const topicOpacity = spring({ frame: frame - 15, fps, from: 0, to: 1, durationInFrames: 20 });

  const textTranslate = spring({ frame: frame - 25, fps, from: 30, to: 0, durationInFrames: 20 });
  const textOpacity = spring({ frame: frame - 25, fps, from: 0, to: 1, durationInFrames: 20 });

  const gradient = GRADIENTS[index % GRADIENTS.length];

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#0f172a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px',
        opacity: containerOpacity
      }}
    >
      <div style={{
        position: 'absolute',
        top: '40px',
        right: '60px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '24px',
        fontWeight: 'bold',
        color: '#334155',
        letterSpacing: '2px',
      }}>
        SCENE {String(index).padStart(2, '0')}
      </div>

      <div style={{
        transform: `scale(${cardScale})`,
        background: gradient,
        borderRadius: '32px',
        padding: '70px',
        maxWidth: '1000px',
        width: '100%',
        boxShadow: '0 40px 80px rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.15)',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px'
      }}>
        
        {emoji && (
          <div style={{
             fontSize: '80px', 
             opacity: iconOpacity, 
             transform: `translateY(${iconTranslate}px)`,
             marginBottom: '10px'
          }}>
            {emoji}
          </div>
        )}

        {topic && (
          <div style={{
             fontSize: '42px',
             fontWeight: '800',
             color: '#fbbf24',
             fontFamily: 'system-ui, sans-serif',
             opacity: topicOpacity,
             transform: `translateY(${topicTranslate}px)`,
             textTransform: 'uppercase',
             letterSpacing: '1px'
          }}>
            {topic}
          </div>
        )}

        <div style={{
          fontSize: '38px',
          color: '#f8fafc',
          fontFamily: 'system-ui, sans-serif',
          lineHeight: 1.5,
          fontWeight: '500',
          opacity: textOpacity,
          transform: `translateY(${textTranslate}px)`,
          borderLeft: '4px solid rgba(255,255,255,0.2)',
          paddingLeft: '30px'
        }}>
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};