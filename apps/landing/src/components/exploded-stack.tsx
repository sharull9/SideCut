import { AnimatePresence, animate, motion, useInView } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";

// Isometric projection of a flat plate: x runs down-right, y runs down-left.
const COS = Math.cos(Math.PI / 6);
const W = 260;
const D = 190;
const T = 10;
const CX = 320;
const ISO = `matrix(${COS},0.5,${-COS},0.5,0,0)`;

// The collapsed stack unfolds into a 480 × 270 player centred here.
const PLAYER_Y = 262;
const PLAYER_W = 480;
const PLAYER_H = 270;
const FX0 = CX - PLAYER_W / 2;
const FX1 = CX + PLAYER_W / 2;
const FY0 = PLAYER_Y - PLAYER_H / 2;
const FY1 = PLAYER_Y + PLAYER_H / 2;

// exploded, collapse, live player, restore
const STEPS = [4200, 1000, 5600, 1300] as const;
const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

type Point = readonly [number, number];

const iso = (x: number, y: number): Point => [(x - y) * COS, (x + y) * 0.5];
const pts = (points: readonly Point[]) => points.map(([x, y]) => `${x},${y}`).join(" ");
const down = ([x, y]: Point, by = T): Point => [x, y + by];

const right = iso(W / 2, -D / 2);
const front = iso(W / 2, D / 2);
const left = iso(-W / 2, D / 2);

const INK = "var(--color-ink)";
const STROKE = { stroke: INK, strokeWidth: 0.9, strokeLinejoin: "round" } as const;

type Layer = {
  id: string;
  label: string;
  side: "left" | "right";
  exploded: number;
  stacked: number;
  face: string;
  content: ReactNode;
};

const LAYERS: readonly Layer[] = [
  {
    id: "editor",
    label: "SHARED EDITOR",
    side: "right",
    exploded: 400,
    stacked: 284,
    face: "#ffffff",
    content: <EditorFace />,
  },
  {
    id: "studio",
    label: "PRODUCTION STUDIO",
    side: "left",
    exploded: 272,
    stacked: 272,
    face: "#ffffff",
    content: <StudioFace />,
  },
  {
    id: "review",
    label: "CLOUD REVIEW + AI",
    side: "right",
    exploded: 144,
    stacked: 260,
    face: "rgba(255,255,255,0.92)",
    content: <ReviewFace />,
  },
];

export function ExplodedStack() {
  const reduce = useReducedMotion();
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { margin: "-10% 0px" });
  const [hovered, setHovered] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [step, setStep] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [morph, setMorph] = useState(0);
  const morphRef = useRef(0);
  const shown = reduce ? 0 : step;

  useEffect(() => {
    if (!settled || !inView || reduce || (step === 0 && hovered)) return;
    const id = window.setTimeout(() => {
      const next = (step + 1) % STEPS.length;
      if (next === 0) setCycle((c) => c + 1);
      setStep(next);
    }, STEPS[step]);
    return () => window.clearTimeout(id);
  }, [settled, inView, reduce, step, hovered]);

  useEffect(() => {
    const target = shown === 2 ? 1 : 0;
    if (morphRef.current === target) return;
    const controls = animate(morphRef.current, target, {
      duration: 0.85,
      delay: target === 1 ? 0.1 : 0.3,
      ease: EASE_IN_OUT,
      onUpdate: (value) => {
        morphRef.current = value;
        setMorph(value);
      },
    });
    return () => controls.stop();
  }, [shown]);

  const exploded = shown === 0;
  const unfolded = shown === 2 || morph > 0;
  const intro = { type: "spring", stiffness: 70, damping: 16, mass: 1.1 } as const;
  const move = { type: "spring", stiffness: 120, damping: 20 } as const;
  const lift = { type: "spring", stiffness: 260, damping: 22 } as const;
  const drawDelay = cycle === 0 ? 1.1 : 0.55;

  return (
    <svg
      ref={ref}
      viewBox="-70 0 780 540"
      className="h-auto w-full overflow-visible select-none"
      role="img"
      aria-labelledby="stack-title"
    >
      <title id="stack-title">
        raE.E in three layers, the shared editor, production studio and cloud review, folding into
        one live video player.
      </title>

      {/* Alignment guides between the plates, drawn while the stack is open. */}
      <AnimatePresence>
        {exploded && (
          <motion.g
            key={cycle}
            stroke={INK}
            strokeOpacity={0.28}
            strokeWidth={0.8}
            strokeDasharray="2 4"
            fill="none"
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
          >
            {[right, left, front].map(([x, y], i) => (
              <motion.line
                key={i}
                x1={CX + x}
                x2={CX + x}
                y1={144 + y + T}
                y2={400 + y}
                initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{
                  delay: drawDelay + i * 0.12,
                  duration: 0.9,
                  ease: [0.22, 1, 0.36, 1],
                }}
              />
            ))}
          </motion.g>
        )}
      </AnimatePresence>

      {LAYERS.map((layer, index) => {
        const active = exploded && hovered === layer.id;
        return (
          <motion.g
            key={layer.id}
            initial={reduce ? false : { y: layer.stacked, opacity: 0 }}
            animate={{
              y: exploded ? layer.exploded + (active ? -10 : 0) : layer.stacked,
              opacity: 1,
            }}
            transition={
              !settled && !reduce
                ? { ...intro, delay: 0.25 + (LAYERS.length - index) * 0.08 }
                : hovered
                  ? lift
                  : move
            }
            onAnimationComplete={() => index === 0 && setSettled(true)}
            onHoverStart={() => setHovered(layer.id)}
            onHoverEnd={() => setHovered(null)}
            style={{ cursor: "default" }}
          >
            <g opacity={unfolded ? 0 : 1}>
              <g transform={`translate(${CX} 0)`}>
                <Plate face={layer.face} active={active}>
                  {layer.content}
                </Plate>
              </g>
              <AnimatePresence>
                {exploded && (
                  <Callout
                    key={cycle}
                    layer={layer}
                    active={active}
                    delay={drawDelay + 0.1}
                    reduce={reduce}
                  />
                )}
              </AnimatePresence>
            </g>
          </motion.g>
        );
      })}

      {unfolded && <Slab morph={morph} />}
      <AnimatePresence>{shown === 2 && <LivePlayer key={cycle} />}</AnimatePresence>
    </svg>
  );
}

function Plate({ face, active, children }: { face: string; active: boolean; children: ReactNode }) {
  const corners = [
    [-W / 2 + 10, -D / 2 + 10],
    [W / 2 - 10, -D / 2 + 10],
    [W / 2 - 10, D / 2 - 10],
    [-W / 2 + 10, D / 2 - 10],
  ] as const;

  return (
    <g>
      <polygon points={pts([right, front, down(front), down(right)])} fill="#ecece8" {...STROKE} />
      <polygon points={pts([front, left, down(left), down(front)])} fill="#f6f6f3" {...STROKE} />
      <g transform={ISO}>
        <rect
          x={-W / 2}
          y={-D / 2}
          width={W}
          height={D}
          rx={8}
          fill={face}
          stroke={active ? "var(--color-brand-deep)" : INK}
          strokeWidth={active ? 1.6 : 1.1}
          style={{ transition: "stroke 200ms ease, stroke-width 200ms ease" }}
        />
        {corners.map(([x, y]) => (
          <g key={`${x}${y}`}>
            <circle cx={x} cy={y} r={3.4} fill="#fff" stroke={INK} strokeWidth={0.8} />
            <circle cx={x} cy={y} r={1.3} fill="none" stroke={INK} strokeWidth={0.6} />
          </g>
        ))}
        {children}
      </g>
    </g>
  );
}

/** The collapsed stack, turning from an isometric slab into a flat player frame. */
function Slab({ morph }: { morph: number }) {
  const mix = (from: number, to: number) => from + (to - from) * morph;
  const a = mix(COS, PLAYER_W / W);
  const b = mix(0.5, 0);
  const c = mix(-COS, 0);
  const d = mix(0.5, PLAYER_H / D);
  const project = (x: number, y: number): Point => [a * x + c * y, b * x + d * y];
  const r = project(W / 2, -D / 2);
  const f = project(W / 2, D / 2);
  const l = project(-W / 2, D / 2);
  const thickness = T * (1 - morph);
  const gap = 12 * (1 - morph);

  return (
    <g transform={`translate(${CX} ${mix(260, PLAYER_Y)})`}>
      <g opacity={1 - morph}>
        {[2, 1, 0].map((band) => {
          const top = band * gap;
          const bottom = top + thickness;
          return (
            <g key={band}>
              <polygon
                points={pts([down(r, top), down(f, top), down(f, bottom), down(r, bottom)])}
                fill="#ecece8"
                {...STROKE}
              />
              <polygon
                points={pts([down(f, top), down(l, top), down(l, bottom), down(f, bottom)])}
                fill="#f6f6f3"
                {...STROKE}
              />
            </g>
          );
        })}
      </g>
      <g transform={`matrix(${a},${b},${c},${d},0,0)`}>
        <rect
          x={-W / 2}
          y={-D / 2}
          width={W}
          height={D}
          rx={mix(8, 6)}
          fill="#fff"
          stroke={INK}
          strokeWidth={1.1}
          vectorEffect="non-scaling-stroke"
        />
        <g opacity={Math.max(0, 1 - morph * 3)}>
          <ReviewFace />
        </g>
      </g>
    </g>
  );
}

/** Skeleton of a live stream that starts playing once the frame has settled. */
function LivePlayer() {
  const vx0 = FX0 + 10;
  const vx1 = FX1 - 10;
  const vy0 = FY0 + 10;
  const vy1 = FY1 - 46;
  const barY = FY1 - 22;
  const trackStart = FX0 + 40;
  const trackEnd = FX1 - 70;
  const playAt = 1.9;
  const playY = (vy0 + vy1) / 2;

  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: 0.95, duration: 0.35 } }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
    >
      <defs>
        <clipPath id="player-video">
          <rect x={vx0} y={vy0} width={vx1 - vx0} height={vy1 - vy0} rx={5} />
        </clipPath>
        <linearGradient id="player-shimmer" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity={0} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={0.85} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
      </defs>

      <g clipPath="url(#player-video)">
        <rect x={vx0} y={vy0} width={vx1 - vx0} height={vy1 - vy0} fill="#f1f1ee" />
        <circle
          cx={CX}
          cy={playY - 4}
          r={27}
          fill="#e3e3de"
          stroke={INK}
          strokeOpacity={0.25}
          strokeWidth={0.8}
        />
        <path
          d={`M${CX - 66} ${vy1} q66 -84 132 0z`}
          fill="#e3e3de"
          stroke={INK}
          strokeOpacity={0.25}
          strokeWidth={0.8}
        />
        <rect x={vx0 + 14} y={vy1 - 34} width={150} height={9} rx={4.5} fill="#e3e3de" />
        <rect x={vx0 + 14} y={vy1 - 20} width={96} height={7} rx={3.5} fill="#e9e9e5" />
        <motion.rect
          y={vy0}
          width={140}
          height={vy1 - vy0}
          fill="url(#player-shimmer)"
          initial={{ x: vx0 - 140 }}
          animate={{ x: vx1 }}
          transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 0.4, ease: "easeInOut" }}
        />
      </g>
      <rect
        x={vx0}
        y={vy0}
        width={vx1 - vx0}
        height={vy1 - vy0}
        rx={5}
        fill="none"
        stroke={INK}
        strokeWidth={0.8}
      />

      {/* Live badge, audience and audio activity. */}
      <rect x={vx0 + 12} y={vy0 + 12} width={48} height={18} rx={4} fill="var(--color-rec)" />
      <motion.circle
        cx={vx0 + 23}
        cy={vy0 + 21}
        r={3}
        fill="#fff"
        animate={{ opacity: [1, 0.25, 1] }}
        transition={{ duration: 1, repeat: Infinity }}
      />
      <text
        x={vx0 + 31}
        y={vy0 + 25}
        fontSize={10}
        fontWeight={600}
        fill="#fff"
        className="font-mono"
      >
        LIVE
      </text>
      <rect
        x={vx0 + 66}
        y={vy0 + 12}
        width={96}
        height={18}
        rx={4}
        fill="#fff"
        stroke={INK}
        strokeOpacity={0.3}
        strokeWidth={0.8}
      />
      <text
        x={vx0 + 74}
        y={vy0 + 24.5}
        fontSize={9}
        fill={INK}
        fillOpacity={0.7}
        className="font-mono"
      >
        1,284 watching
      </text>
      {[0, 1, 2, 3].map((bar) => (
        <motion.rect
          key={bar}
          x={vx1 - 34 + bar * 6}
          width={3.5}
          rx={1.75}
          fill="var(--color-brand)"
          initial={{ y: vy0 + 26, height: 4 }}
          animate={{
            y: [vy0 + 26, vy0 + 14 + bar * 2, vy0 + 22, vy0 + 12 + (3 - bar) * 3, vy0 + 26],
            height: [4, 16 - bar * 2, 8, 18 - (3 - bar) * 3, 4],
          }}
          transition={{
            delay: playAt,
            duration: 0.9 + bar * 0.12,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Centre play button: appears, gets pressed, gives way to playback. */}
      <motion.g
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 1, 1, 0], scale: [0.6, 1, 0.88, 1.15] }}
        transition={{ delay: 0.9, duration: playAt - 0.6, times: [0, 0.35, 0.7, 1] }}
        style={{ transformOrigin: `${CX}px ${playY}px`, transformBox: "view-box" }}
      >
        <circle cx={CX} cy={playY} r={24} fill="#fff" stroke={INK} strokeWidth={1} />
        <path d={`M${CX - 6} ${playY - 10} l16 10 -16 10z`} fill={INK} />
      </motion.g>

      {/* Transport: play turns to pause, progress runs towards the live edge. */}
      <motion.path
        d={`M${FX0 + 16} ${barY - 6} l9 6 -9 6z`}
        fill={INK}
        animate={{ opacity: [1, 1, 0] }}
        transition={{ duration: playAt, times: [0, 0.95, 1] }}
      />
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: playAt, duration: 0.1 }}
      >
        <rect x={FX0 + 16} y={barY - 6} width={3} height={12} rx={1} fill={INK} />
        <rect x={FX0 + 22} y={barY - 6} width={3} height={12} rx={1} fill={INK} />
      </motion.g>
      <line
        x1={trackStart}
        x2={trackEnd}
        y1={barY}
        y2={barY}
        stroke="#e3e3de"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <line
        x1={trackStart}
        x2={trackEnd - 24}
        y1={barY}
        y2={barY}
        stroke="#d2d2cc"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <motion.line
        x1={trackStart}
        y1={barY}
        y2={barY}
        stroke="var(--color-brand)"
        strokeWidth={4}
        strokeLinecap="round"
        initial={{ x2: trackStart + 120 }}
        animate={{ x2: trackEnd - 30 }}
        transition={{ delay: playAt, duration: 3.2, ease: "linear" }}
      />
      <motion.circle
        cy={barY}
        r={5}
        fill="#fff"
        stroke="var(--color-brand-deep)"
        strokeWidth={1.4}
        initial={{ cx: trackStart + 120 }}
        animate={{ cx: trackEnd - 30 }}
        transition={{ delay: playAt, duration: 3.2, ease: "linear" }}
      />
      <circle cx={trackEnd + 16} cy={barY} r={3} fill="var(--color-rec)" />
      <text
        x={trackEnd + 24}
        y={barY + 3.5}
        fontSize={9.5}
        fill={INK}
        fillOpacity={0.75}
        className="font-mono"
      >
        LIVE
      </text>

      {/* Title and channel skeleton under the frame. */}
      <motion.g
        animate={{ opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <circle cx={FX0 + 12} cy={FY1 + 26} r={11} fill="#e6e6e1" />
        <rect x={FX0 + 32} y={FY1 + 17} width={210} height={8} rx={4} fill="#e6e6e1" />
        <rect x={FX0 + 32} y={FY1 + 31} width={130} height={7} rx={3.5} fill="#ececE8" />
      </motion.g>

      <PlayerCallout />
    </motion.g>
  );
}

function PlayerCallout() {
  const y = FY0 + 44;
  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.2, duration: 0.4 }}
    >
      <motion.line
        x1={FX1 + 8}
        x2={706}
        y1={y}
        y2={y}
        stroke={INK}
        strokeOpacity={0.55}
        strokeWidth={0.8}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 1.25, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />
      <circle cx={FX1 + 8} cy={y} r={1.8} fill={INK} />
      <text
        x={706}
        y={y - 8}
        textAnchor="end"
        className="font-mono"
        fontSize={12}
        letterSpacing={1.6}
        fill={INK}
        fillOpacity={0.7}
      >
        PLAYABLE LIVE
      </text>
    </motion.g>
  );
}

function Callout({
  layer,
  active,
  delay,
  reduce,
}: {
  layer: Layer;
  active: boolean;
  delay: number;
  reduce: boolean;
}) {
  const anchor = layer.side === "right" ? right : left;
  const startX = CX + anchor[0] + (layer.side === "right" ? 8 : -8);
  const y = anchor[1] + T / 2;
  const endX = layer.side === "right" ? 706 : -66;

  return (
    <motion.g
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      transition={{ delay: reduce ? 0 : delay, duration: 0.5 }}
    >
      <motion.line
        x1={startX}
        x2={endX}
        y1={y}
        y2={y}
        stroke={active ? "var(--color-brand-deep)" : INK}
        strokeOpacity={active ? 1 : 0.55}
        strokeWidth={0.8}
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: reduce ? 0 : delay + 0.05, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />
      <circle cx={startX} cy={y} r={1.8} fill={INK} />
      <text
        x={endX}
        y={y - 8}
        textAnchor={layer.side === "right" ? "end" : "start"}
        className="font-mono"
        fontSize={12}
        letterSpacing={1.6}
        fill={active ? "var(--color-brand-deep)" : INK}
        fillOpacity={active ? 1 : 0.7}
      >
        {layer.label}
      </text>
    </motion.g>
  );
}

/* Plate faces are drawn flat in plate coordinates, then projected by ISO. */

function EditorFace() {
  const tracks = [
    {
      y: 18,
      clips: [
        [-104, -40],
        [-34, 30],
        [36, 96],
      ],
    },
    {
      y: 38,
      clips: [
        [-104, -10],
        [-4, 70],
      ],
    },
    { y: 58, clips: [[-104, 96]] },
  ] as const;

  return (
    <g>
      <rect
        x={-112}
        y={-78}
        width={136}
        height={80}
        rx={4}
        fill="#f4f4f1"
        stroke={INK}
        strokeWidth={0.7}
      />
      <path d="M-50 -48 l16 10 -16 10z" fill="none" stroke={INK} strokeWidth={0.8} />
      <rect
        x={34}
        y={-78}
        width={78}
        height={80}
        rx={4}
        fill="none"
        stroke={INK}
        strokeWidth={0.7}
      />
      {[0, 1, 2, 3, 4].map((row) => (
        <line
          key={row}
          x1={42}
          x2={42 + 60 - row * 7}
          y1={-66 + row * 14}
          y2={-66 + row * 14}
          stroke={INK}
          strokeOpacity={0.45}
          strokeWidth={0.8}
        />
      ))}
      {tracks.map((track, ti) =>
        track.clips.map(([from, to]) => (
          <rect
            key={`${ti}${from}`}
            x={from}
            y={track.y}
            width={to - from}
            height={14}
            rx={2.5}
            fill={ti === 2 ? "var(--color-brand-soft)" : ti === 0 ? "#ffffff" : "#efefeb"}
            stroke={INK}
            strokeWidth={0.7}
          />
        )),
      )}
      <line x1={8} x2={8} y1={12} y2={78} stroke="var(--color-brand-deep)" strokeWidth={1.4} />
      <path d="M4 10 h8 l-4 5z" fill="var(--color-brand-deep)" />
    </g>
  );
}

function StudioFace() {
  return (
    <g>
      <rect
        x={-112}
        y={-78}
        width={170}
        height={100}
        rx={5}
        fill="#f4f4f1"
        stroke={INK}
        strokeWidth={0.8}
      />
      <path
        d="M-112 2 q40 -36 78 -6 t80 -10"
        fill="none"
        stroke={INK}
        strokeOpacity={0.35}
        strokeWidth={0.8}
      />
      <rect
        x={10}
        y={-34}
        width={40}
        height={48}
        rx={6}
        fill="#fff"
        stroke={INK}
        strokeWidth={0.8}
      />
      <circle cx={30} cy={-16} r={8} fill="none" stroke={INK} strokeWidth={0.8} />
      <path d="M17 8 q13 -14 26 0" fill="none" stroke={INK} strokeWidth={0.8} />
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={-112 + i * 58}
          y={34}
          width={50}
          height={30}
          rx={3}
          fill={i === 0 ? "var(--color-brand-soft)" : "#fff"}
          stroke={INK}
          strokeWidth={0.7}
        />
      ))}
      <rect
        x={70}
        y={-78}
        width={42}
        height={142}
        rx={5}
        fill="none"
        stroke={INK}
        strokeWidth={0.7}
      />
      <circle
        cx={91}
        cy={-56}
        r={9}
        fill="var(--color-rec)"
        fillOpacity={0.9}
        stroke={INK}
        strokeWidth={0.8}
      />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <line
            x1={80}
            x2={80}
            y1={-30}
            y2={54}
            stroke={INK}
            strokeOpacity={0.15}
            strokeWidth={4}
            strokeLinecap="round"
            transform={`translate(${i * 10} 0)`}
          />
          <line
            x1={80}
            x2={80}
            y1={54 - 34 - i * 14}
            y2={54}
            stroke="var(--color-brand)"
            strokeWidth={4}
            strokeLinecap="round"
            transform={`translate(${i * 10} 0)`}
          />
        </g>
      ))}
    </g>
  );
}

function ReviewFace() {
  const pins = [-74, -18, 40, 82] as const;
  return (
    <g>
      <rect
        x={-112}
        y={-78}
        width={224}
        height={110}
        rx={5}
        fill="none"
        stroke={INK}
        strokeWidth={0.7}
        strokeDasharray="3 3"
      />
      <line x1={-104} x2={104} y1={52} y2={52} stroke={INK} strokeWidth={1} />
      <line x1={-104} x2={-6} y1={52} y2={52} stroke="var(--color-brand-deep)" strokeWidth={2.2} />
      {pins.map((x, i) => (
        <g key={x}>
          <circle
            cx={x}
            cy={52}
            r={4.5}
            fill={i < 2 ? "var(--color-brand)" : "#fff"}
            stroke={INK}
            strokeWidth={0.8}
          />
          <line x1={x} x2={x} y1={47} y2={40} stroke={INK} strokeOpacity={0.4} strokeWidth={0.7} />
        </g>
      ))}
      <rect
        x={-96}
        y={-62}
        width={92}
        height={32}
        rx={6}
        fill="#fff"
        stroke={INK}
        strokeWidth={0.8}
      />
      <circle
        cx={-84}
        cy={-46}
        r={6}
        fill="var(--color-brand-soft)"
        stroke={INK}
        strokeWidth={0.7}
      />
      <line
        x1={-72}
        x2={-20}
        y1={-50}
        y2={-50}
        stroke={INK}
        strokeOpacity={0.55}
        strokeWidth={1.2}
      />
      <line
        x1={-72}
        x2={-36}
        y1={-42}
        y2={-42}
        stroke={INK}
        strokeOpacity={0.3}
        strokeWidth={1.2}
      />
      <rect
        x={12}
        y={-40}
        width={84}
        height={32}
        rx={6}
        fill="#fff"
        stroke={INK}
        strokeWidth={0.8}
      />
      <path d="M22 -24 l5 5 9 -10" fill="none" stroke="var(--color-brand-deep)" strokeWidth={1.4} />
      <line x1={44} x2={86} y1={-28} y2={-28} stroke={INK} strokeOpacity={0.55} strokeWidth={1.2} />
      <line x1={44} x2={70} y1={-20} y2={-20} stroke={INK} strokeOpacity={0.3} strokeWidth={1.2} />
      <path
        d="M86 -66 l3 -7 3 7 7 3 -7 3 -3 7 -3 -7 -7 -3z"
        fill="none"
        stroke={INK}
        strokeWidth={0.8}
      />
    </g>
  );
}
