import React from 'react';
import { Composition } from 'remotion';
import { MainVideo } from './Video';

export const Root: React.FC = () => {
  return (
    <Composition
      id="MainVideo"
      component={MainVideo}
      durationInFrames={300}   // overridden at render time by videoService
      fps={24}
      width={1280}             // 720p — enforced here and in videoService
      height={720}             // 720p — enforced here and in videoService
      defaultProps={{ scenes: [] }}
    />
  );
};
