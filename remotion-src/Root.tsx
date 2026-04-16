import React from 'react';
import { Composition } from 'remotion';
import { MainVideo } from './Video';

export const Root: React.FC = () => {
  return (
    <Composition
      id="MainVideo"
      component={MainVideo}
      durationInFrames={300}   // overridden at render time
      fps={30}
      width={1280}
      height={720}
      defaultProps={{ scenes: [] }}
    />
  );
};