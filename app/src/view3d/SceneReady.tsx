import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Skeleton } from "../loading/LoadingState.tsx";

export function useSceneLoading(identity: unknown) {
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), [identity]);
  useEffect(() => setReady(false), [identity]);
  return { ready, markReady };
}
/** Signal an actual drawn scene, not an arbitrary delay. */
export function SceneReady({ onReady }: { onReady: () => void }) {
  const notified = useRef<(() => void) | null>(null);
  useFrame(() => {
    if (notified.current !== onReady) {
      notified.current = onReady;
      onReady();
    }
  });
  return null;
}
export function SceneFallback({ onReady, children }: { onReady: () => void; children: ReactNode }) {
  useEffect(onReady, [onReady]);
  return <div>{children}</div>;
}
export function SceneSkeleton({ ready }: { ready: boolean }) {
  return ready ? null : (
    <div className="scene-loading">
      <Skeleton label="Preparing the 3D view and shadows…" />
    </div>
  );
}
