"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { formatTime } from "@/lib/format";
import {
  MAX_HEARTS,
  MazeGame,
  type GameEvent,
  type LoseCause,
  type PauseReason,
  type Phase,
} from "@/lib/game";
import { drawScene, scenePadding } from "@/lib/render";
import { WALL_THICKNESS } from "@/lib/collision";
import { SoundEngine } from "@/lib/sound";

import {
  ArrowRightIcon,
  HeartIcon,
  PauseIcon,
  PlayIcon,
  RestartIcon,
  SoundOffIcon,
  SoundOnIcon,
} from "./Icons";

const MUTE_KEY = "maze-cursor:muted";
const CELL_TARGET = 64;
const MIN_CELL = 56;
const MIN_COLS = 7;
const MIN_ROWS = 5;
const MAX_FRAME_MS = 250;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let mutedValue: boolean | null = null;
const muteListeners = new Set<() => void>();

function readStoredMute(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeMute(listener: () => void): () => void {
  muteListeners.add(listener);
  return () => {
    muteListeners.delete(listener);
  };
}

function getMuteSnapshot(): boolean {
  if (mutedValue === null) mutedValue = readStoredMute();
  return mutedValue;
}

function getMuteServerSnapshot(): boolean {
  return false;
}

function setMuteValue(next: boolean): void {
  if (mutedValue === next) return;
  mutedValue = next;
  try {
    window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    // Storage can be unavailable (private mode); the toggle still works for this session.
  }
  for (const listener of muteListeners) listener();
}

function subscribeReducedMotion(listener: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

interface Layout {
  cols: number;
  rows: number;
  cell: number;
}

interface HudState {
  phase: Phase;
  hearts: number;
  level: number;
  attempts: number;
  elapsedMs: number;
  cause: LoseCause | null;
  pauseReason: PauseReason | null;
}

function toHud(game: MazeGame): HudState {
  return {
    phase: game.phase,
    hearts: game.hearts,
    level: game.level,
    attempts: game.attempts,
    elapsedMs: game.elapsedMs,
    cause: game.cause,
    pauseReason: game.pauseReason,
  };
}

function oddFloor(value: number): number {
  const floored = Math.floor(value);
  return floored % 2 === 0 ? floored - 1 : floored;
}

function fitCell(cols: number, rows: number, width: number, height: number): number {
  const estimate = Math.min(width / (cols + WALL_THICKNESS), height / (rows + WALL_THICKNESS));
  const pad = Math.ceil(estimate * (WALL_THICKNESS / 2));
  const widthCell = (width - pad * 2) / cols;
  const heightCell = (height - pad * 2) / rows;
  return Math.min(widthCell, heightCell);
}

/**
 * Pick odd maze dimensions so a cell stays at least MIN_CELL while keeping the
 * classic 64 px target. The 7x5 grid is the absolute floor for tiny windows.
 */
function planLayout(width: number, height: number): Layout {
  let cols = Math.max(MIN_COLS, Math.min(25, oddFloor(width / CELL_TARGET)));
  let rows = Math.max(MIN_ROWS, Math.min(19, oddFloor(height / CELL_TARGET)));

  while ((cols > MIN_COLS || rows > MIN_ROWS) && fitCell(cols, rows, width, height) < MIN_CELL) {
    const widthCell = width / (cols + WALL_THICKNESS);
    const heightCell = height / (rows + WALL_THICKNESS);
    if (widthCell <= heightCell && cols > MIN_COLS) {
      cols -= 2;
    } else if (rows > MIN_ROWS) {
      rows -= 2;
    } else {
      cols -= 2;
    }
  }

  return { cols, rows, cell: fitCell(cols, rows, width, height) };
}

function attemptLabel(attempts: number): string {
  return attempts > 1 ? `${attempts} tentatives` : "1 tentative";
}

export default function GameClient() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<MazeGame | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const soundRef = useRef<SoundEngine | null>(null);

  const [layout, setLayout] = useState<Layout | null>(null);
  const [hud, setHud] = useState<HudState>({
    phase: "idle",
    hearts: MAX_HEARTS,
    level: 1,
    attempts: 1,
    elapsedMs: 0,
    cause: null,
    pauseReason: null,
  });
  const muted = useSyncExternalStore(subscribeMute, getMuteSnapshot, getMuteServerSnapshot);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  const playEvent = useCallback((event: GameEvent) => {
    const sound = soundRef.current;
    if (!sound) return;
    sound.unlock();
    switch (event) {
      case "start":
      case "next-level":
        sound.start();
        break;
      case "restart":
      case "pause":
      case "resume":
        sound.click();
        break;
      case "wall":
        sound.wall();
        break;
      case "heart":
        sound.heart();
        break;
      case "enemy":
        sound.enemy();
        break;
      case "win":
        sound.win();
        break;
      case "lose":
        sound.lose();
        break;
    }
  }, []);

  const unlockAudio = useCallback(() => {
    soundRef.current?.unlock();
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const apply = (width: number, height: number, preserve: boolean) => {
      if (width < 40 || height < 40) return;
      const current = layoutRef.current;
      const currentCell = current ? fitCell(current.cols, current.rows, width, height) : 0;
      const keep =
        preserve &&
        current !== null &&
        (currentCell >= MIN_CELL || (current.cols === MIN_COLS && current.rows === MIN_ROWS));
      const next: Layout = keep ? { ...current, cell: currentCell } : planLayout(width, height);
      layoutRef.current = next;
      setLayout(next);
    };

    const rect = stage.getBoundingClientRect();
    apply(rect.width, rect.height, false);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      apply(entry.contentRect.width, entry.contentRect.height, true);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const engine = new SoundEngine();
    engine.setMuted(getMuteSnapshot());
    soundRef.current = engine;
    return () => {
      engine.dispose();
      soundRef.current = null;
    };
  }, []);

  const cols = layout?.cols ?? 0;
  const rows = layout?.rows ?? 0;

  useEffect(() => {
    if (!cols || !rows) return;
    const game = new MazeGame({ cols, rows, onEvent: playEvent });
    game.setCellSize(layoutRef.current?.cell ?? CELL_TARGET);
    gameRef.current = game;
    return () => {
      if (gameRef.current === game) gameRef.current = null;
    };
  }, [cols, rows, playEvent]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let signature = "";

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const game = gameRef.current;
      const current = layoutRef.current;
      const canvas = canvasRef.current;
      if (!game || !current || !canvas) return;

      const dt = Math.min(MAX_FRAME_MS, Math.max(0, now - last));
      last = now;

      game.setCellSize(current.cell);
      game.tick(dt, now);

      drawScene(canvas, {
        maze: game.maze,
        cell: current.cell,
        dpr: Math.min(2, window.devicePixelRatio || 1),
        avatar: game.avatar,
        pointer: game.pointer,
        enemies: game.enemies,
        phase: game.phase,
        invulnerable: game.isInvulnerable(now),
        lastHitAt: game.lastHitAt,
        now,
        reducedMotion,
      });

      const nextSignature = [
        game.phase,
        game.hearts,
        game.level,
        game.attempts,
        Math.floor(game.elapsedMs / 100),
        game.cause ?? "",
      ].join("|");

      if (nextSignature !== signature) {
        signature = nextSignature;
        setHud(toHud(game));
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  const begin = useCallback(() => {
    const game = gameRef.current;
    if (!game || game.phase !== "idle") return;
    unlockAudio();
    game.start();
    setHud(toHud(game));
  }, [unlockAudio]);

  const restart = useCallback(() => {
    const game = gameRef.current;
    if (!game || game.phase === "idle") return;
    unlockAudio();
    game.restart();
    setHud(toHud(game));
  }, [unlockAudio]);

  const nextLevel = useCallback(() => {
    const game = gameRef.current;
    if (!game || game.phase !== "won") return;
    unlockAudio();
    game.nextLevel();
    setHud(toHud(game));
  }, [unlockAudio]);

  const togglePause = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    const now = performance.now();
    if (game.phase === "playing") game.pause(now);
    else if (game.phase === "paused") game.resume(now);
    setHud(toHud(game));
  }, []);

  const toggleMute = useCallback(() => {
    const next = !getMuteSnapshot();
    setMuteValue(next);
    const sound = soundRef.current;
    sound?.unlock();
    sound?.setMuted(next);
    if (!next) sound?.click();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      const game = gameRef.current;
      if (!game) return;

      if (event.code === "Space" || event.code === "Enter") {
        if (game.phase === "idle") {
          event.preventDefault();
          begin();
        } else if (game.phase === "won") {
          event.preventDefault();
          nextLevel();
        } else if (game.phase === "lost") {
          event.preventDefault();
          restart();
        }
        return;
      }

      if (event.key === "Escape" || event.key.toLowerCase() === "p") {
        event.preventDefault();
        togglePause();
        return;
      }

      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        restart();
        return;
      }

      if (event.key.toLowerCase() === "m") {
        toggleMute();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [begin, nextLevel, restart, toggleMute, togglePause]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const game = gameRef.current;
    const current = layoutRef.current;
    const canvas = canvasRef.current;
    if (!game || !current || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const pad = scenePadding(current.cell);
    const x = event.clientX - rect.left - pad;
    const y = event.clientY - rect.top - pad;
    const inside = x >= 0 && y >= 0 && x <= current.cols * current.cell && y <= current.rows * current.cell;
    const now = performance.now();

    if (!inside) {
      game.movePointer(0, 0, false, now);
      return;
    }
    game.movePointer(x, y, true, now);
  }, []);

  const handlePointerLeave = useCallback(() => {
    gameRef.current?.movePointer(0, 0, false, performance.now());
  }, []);

  const playing = hud.phase === "playing";
  const pad = layout ? scenePadding(layout.cell) : 0;
  const boardWidth = layout ? layout.cols * layout.cell + pad * 2 : 0;
  const boardHeight = layout ? layout.rows * layout.cell + pad * 2 : 0;

  return (
    <div className="app" onPointerDown={unlockAudio}>
      <header className="hud">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">Cursor Maze</span>
        </div>

        <div className="stats">
          <div className="stat">
            <span className="stat__label">Cœurs</span>
            <span className="hearts" role="img" aria-label={`${hud.hearts} cœur${hud.hearts > 1 ? "s" : ""} sur ${MAX_HEARTS}`}>
              {Array.from({ length: MAX_HEARTS }, (_, index) => (
                <HeartIcon
                  key={index}
                  filled={index < hud.hearts}
                  className={index < hud.hearts ? "heart heart--full" : "heart heart--empty"}
                />
              ))}
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Niveau</span>
            <span className="stat__value">{hud.level}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Temps</span>
            <span className="stat__value stat__value--mono">{formatTime(hud.elapsedMs)}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Tentatives</span>
            <span className="stat__value">{hud.attempts}</span>
          </div>
        </div>

        <div className="actions">
          <button
            type="button"
            className="iconBtn"
            onClick={toggleMute}
            aria-label={muted ? "Activer le son" : "Couper le son"}
            title={muted ? "Activer le son (M)" : "Couper le son (M)"}
          >
            {muted ? <SoundOffIcon /> : <SoundOnIcon />}
          </button>
          <button
            type="button"
            className="iconBtn"
            onClick={togglePause}
            disabled={hud.phase !== "playing" && hud.phase !== "paused"}
            aria-label={hud.phase === "paused" ? "Reprendre" : "Mettre en pause"}
            title={hud.phase === "paused" ? "Reprendre (Échap)" : "Pause (Échap)"}
          >
            {hud.phase === "paused" ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button
            type="button"
            className="iconBtn"
            onClick={restart}
            disabled={hud.phase === "idle"}
            aria-label="Recommencer"
            title="Recommencer (R)"
          >
            <RestartIcon />
          </button>
        </div>
      </header>

      <main
        className="stage"
        ref={stageRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={unlockAudio}
      >
        <div
          className={playing ? "board board--live" : "board"}
          style={layout ? { width: boardWidth, height: boardHeight } : undefined}
          data-cols={layout?.cols}
          data-rows={layout?.rows}
          data-cell={layout?.cell.toFixed(2)}
        >
          <canvas
            ref={canvasRef}
            className="canvas"
            role="img"
            aria-label="Labyrinthe. Le curseur guide l'avatar."
          />

          {hud.phase === "ready" && (
            <div className="readyHint" role="status">
              Placez le curseur sur le départ
            </div>
          )}

          {hud.phase === "idle" && (
            <Overlay>
              <p className="eyebrow">Labyrinthe procédural</p>
              <h1 className="title">Cursor Maze</h1>
              <p className="lead">
                Le curseur guide votre avatar. Traversez le labyrinthe, évitez les points rouges et
                rejoignez la sortie turquoise.
              </p>
              <ul className="rules">
                <li>Posez le curseur sur le départ pour lancer le chrono.</li>
                <li>L&apos;avatar ne traverse pas les murs : guidez-le dans les virages.</li>
                <li>Un mur touché coûte un cœur.</li>
                <li>Un ennemi touché termine la partie.</li>
                <li>Atteignez la sortie pour passer au niveau suivant.</li>
              </ul>
              <button type="button" className="btn btn--primary" onClick={begin} autoFocus>
                Commencer
                <ArrowRightIcon />
              </button>
              <p className="micro">Espace ou Entrée · M pour le son</p>
            </Overlay>
          )}

          {hud.phase === "paused" && (
            <Overlay>
              <p className="eyebrow">En pause</p>
              <h2 className="title">
                {hud.pauseReason === "pointer-left" ? "Curseur hors du plateau" : "Reprenez votre souffle"}
              </h2>
              <p className="lead">
                {hud.pauseReason === "pointer-left"
                  ? "En pause — curseur hors du plateau. Ramenez le curseur puis reprenez quand vous voulez."
                  : "Le chrono est arrêté. Le labyrinthe vous attend."}
              </p>
              <div className="btnRow">
                <button type="button" className="btn btn--primary" onClick={togglePause} autoFocus>
                  <PlayIcon />
                  Reprendre
                </button>
                <button type="button" className="btn" onClick={restart}>
                  <RestartIcon />
                  Recommencer
                </button>
              </div>
            </Overlay>
          )}

          {hud.phase === "won" && (
            <Overlay>
              <p className="eyebrow">Victoire</p>
              <h2 className="title">Niveau {hud.level} terminé</h2>
              <p className="lead">
                Temps&nbsp;: <strong>{formatTime(hud.elapsedMs)}</strong> · {attemptLabel(hud.attempts)}
              </p>
              <div className="btnRow">
                <button type="button" className="btn btn--primary" onClick={nextLevel} autoFocus>
                  Niveau suivant
                  <ArrowRightIcon />
                </button>
                <button type="button" className="btn" onClick={restart}>
                  <RestartIcon />
                  Recommencer
                </button>
              </div>
            </Overlay>
          )}

          {hud.phase === "lost" && (
            <Overlay>
              <p className="eyebrow">Partie perdue</p>
              <h2 className="title">
                {hud.cause === "enemy" ? "Un ennemi vous a eu" : "Plus de cœurs"}
              </h2>
              <p className="lead">
                {hud.cause === "enemy"
                  ? "Les points rouges ne pardonnent pas. Reprenez depuis le départ."
                  : "Trois murs de trop. Le labyrinthe se régénère pour une nouvelle tentative."}
              </p>
              <button type="button" className="btn btn--primary" onClick={restart} autoFocus>
                <RestartIcon />
                Réessayer
              </button>
            </Overlay>
          )}
        </div>
      </main>

      <footer className="hint">
        <span>Souris pour guider l&apos;avatar</span>
        <span aria-hidden="true">·</span>
        <span>Échap pause</span>
        <span aria-hidden="true">·</span>
        <span>R recommencer</span>
        <span aria-hidden="true">·</span>
        <span>M son</span>
      </footer>

      <p className="srOnly" role="status">
        {hud.phase === "won"
          ? `Niveau ${hud.level} terminé en ${formatTime(hud.elapsedMs)}.`
          : hud.phase === "lost"
            ? "Partie perdue. Appuyez sur Entrée pour réessayer."
            : ""}
      </p>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="overlay">
      <div className="card">{children}</div>
    </div>
  );
}
