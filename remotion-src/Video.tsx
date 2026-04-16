import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { TitleScene } from './scenes/TitleScene';
import { ContentScene } from './scenes/ContentScene';

type Scene = {
  scene: number;
  text: string;
  visual: 'title' | 'content';
  duration: number;
  audioDuration?: number;
  audioFile?: string;
  topic?: string;
  emoji?: string;
};

type VideoProps = {
  scenes: Scene[];
};

export const MainVideo: React.FC<VideoProps> = ({ scenes }) => {
  const { fps } = useVideoConfig();
  let currentFrame = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: '#0f172a' }}>
      {scenes.map((scene, index) => {
        const startFrame = currentFrame;

        const effectiveDuration = scene.audioDuration
          ? scene.audioDuration + 0.5
          : scene.duration;

        const durationFrames = Math.round(effectiveDuration * fps);
        currentFrame += durationFrames;

        return (
          <Sequence key={index} from={startFrame} durationInFrames={durationFrames}>
            {scene.visual === 'title' ? (
              <TitleScene text={scene.text} />
            ) : (
              <ContentScene text={scene.text} index={index} topic={scene.topic} emoji={scene.emoji} />
            )}
            {scene.audioFile && (
              <Audio src={scene.audioFile} startFrom={0} />
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};