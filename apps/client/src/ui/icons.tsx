/**
 * Inline stroke icons (24×24 grid, lucide-style geometry). Keeping them inline
 * avoids an icon font request and works fully offline.
 */
import type { SVGProps } from 'react';

const paths: Record<string, string> = {
  select: 'M4 4l7.07 17 2.51-7.39L21 11.07z',
  hand: 'M18 11V6a2 2 0 0 0-4 0v5 M14 10V4a2 2 0 0 0-4 0v6 M10 10.5V6a2 2 0 0 0-4 0v8 M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
  pen: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
  rect: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ellipse: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18',
  line: 'M5 19L19 5',
  arrow: 'M5 12h14 M12 5l7 7-7 7',
  frame: 'M22 6H2 M22 18H2 M6 2v20 M18 2v20',
  text: 'M4 7V4h16v3 M9 20h6 M12 4v16',
  note: 'M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z M15 3v6h6',
  image: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21',
  eraser: 'M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21 M22 21H7 M5 11l9 9',
  laser: 'M12 2v4 M12 18v4 M4.93 4.93l2.83 2.83 M16.24 16.24l2.83 2.83 M2 12h4 M18 12h4 M4.93 19.07l2.83-2.83 M16.24 7.76l2.83-2.83 M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  undo: 'M3 7v6h6 M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13',
  redo: 'M21 7v6h-6 M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  copy: 'M9 9h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4',
  unlock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 9.9-1',
  group: 'M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M7 7h6v6H7z M11 11h6v6h-6z',
  ungroup: 'M5 3h6v6H5z M13 15h6v6h-6z M5 13v6h4 M19 11V5h-4',
  front: 'M12 2l9 5-9 5-9-5z M3 17l9 5 9-5 M3 12l9 5 9-5',
  back: 'M12 22l9-5-9-5-9 5z M3 7l9-5 9 5',
  alignLeft: 'M4 2v20 M8 6h12v4H8z M8 14h7v4H8z',
  alignCenterH: 'M12 2v20 M6 6h12v4H6z M8.5 14h7v4h-7z',
  alignRight: 'M20 2v20 M4 6h12v4H4z M9 14h7v4H9z',
  alignTop: 'M2 4h20 M6 8h4v12H6z M14 8h4v7h-4z',
  alignCenterV: 'M2 12h20 M6 6h4v12H6z M14 8.5h4v7h-4z',
  alignBottom: 'M2 20h20 M6 4h4v12H6z M14 9h4v7h-4z',
  distributeH: 'M4 3v18 M20 3v18 M9 8h6v8H9z',
  distributeV: 'M3 4h18 M3 20h18 M8 9h8v6H8z',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M21 21l-4.3-4.3',
  command: 'M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3',
  comment: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  chat: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  timer: 'M10 2h4 M12 14l3-3 M12 6a8 8 0 1 0 0 16a8 8 0 1 0 0-16',
  vote: 'M9 12l2 2 4-4 M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
  history: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5 M12 7v5l4 2',
  bookmark: 'M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  shapes: 'M8.3 10a.7.7 0 0 1-.63-1.04l3.7-6.37a.7.7 0 0 1 1.23 0l3.7 6.37A.7.7 0 0 1 15.7 10z M3 14h7v7H3z M17.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0',
  template: 'M3 3h18v7H3z M3 14h7v7H3z M14 14h7v7h-7z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  merge: 'M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M6 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M6 21V9a9 9 0 0 0 9 9',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M12 2v2 M12 20v2 M4.93 4.93l1.41 1.41 M17.66 17.66l1.41 1.41 M2 12h2 M20 12h2 M6.34 17.66l-1.41 1.41 M19.07 4.93l-1.41 1.41',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  monitor: 'M2 3h20v14H2z M8 21h8 M12 17v4',
  grid: 'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18',
  magnet: 'M6 15l-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15 M5 8l4 4 M12 15l4 4',
  eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  play: 'M6 3l14 9-14 9V3z',
  pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
  x: 'M18 6L6 18 M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
  wifi: 'M5 12.55a11 11 0 0 1 14.08 0 M1.42 9a16 16 0 0 1 21.16 0 M8.53 16.11a6 6 0 0 1 6.95 0 M12 20h.01',
  wifiOff: 'M2 2l20 20 M8.5 16.5a5 5 0 0 1 7 0 M2 8.82a15 15 0 0 1 4.17-2.65 M10.66 5c4.01-.36 8.14.9 11.34 3.76 M16.85 11.25a10 10 0 0 1 2.22 1.68 M5 13a10 10 0 0 1 5.24-2.76 M12 20h.01',
  cloud: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z',
  harddrive: 'M22 12H2 M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z M6 16h.01 M10 16h.01',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  sparkles: 'M9.94 14.06L12 21l2.06-6.94L21 12l-6.94-2.06L12 3 9.94 9.94 3 12z',
  flask: 'M10 2v7.31 M14 9.3V1.99 M8.5 2h7 M14 9.3a6.5 6.5 0 1 1-4 0 M5.52 16h12.96',
  presentation: 'M2 3h20 M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3 M7 21l5-5 5 5',
  fit: 'M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  fingerprint: 'M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4 M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2 M17.29 21.02c.12-.6.43-2.3.5-3.02 M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4 M8.65 22c.21-.66.45-1.32.57-2 M14 13.12c0 2.38 0 6.38-1 8.88 M2 16h.01 M21.8 16c.2-2 .131-5.354 0-6 M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2',
  replay: 'M3 2v6h6 M3 13a9 9 0 1 0 3-7.7L3 8',
  wand: 'M15 4V2 M15 16v-2 M8 9h2 M20 9h2 M17.8 11.8L19 13 M15 9h.01 M17.8 6.2L19 5 M3 21l9-9 M12.2 6.2L11 5',
  keyboard: 'M2 6h20v12H2z M6 10h.01 M10 10h.01 M14 10h.01 M18 10h.01 M8 14h8',
  info: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20 M12 16v-4 M12 8h.01',
  alert: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  folder: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z',
  filePlus: 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z M14 2v6h6 M12 18v-6 M9 15h6',
  pin: 'M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
  dashed: 'M3 12h3 M9 12h3 M15 12h3 M21 12h0',
  dotted: 'M4 12h.01 M8 12h.01 M12 12h.01 M16 12h.01 M20 12h.01',
  solid: 'M3 12h18',
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  scribble: 'M3 17c3-6 5-9 7-9s1 6 3 6 3-7 5-7 2 3 3 4',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, strokeWidth = 1.75, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
