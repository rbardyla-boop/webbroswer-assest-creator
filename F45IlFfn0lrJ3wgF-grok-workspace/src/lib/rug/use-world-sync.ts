import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GENESIS_HASH } from "./ids";
import { mergeFrame } from "./merge";
import { getWorld, syncWorld } from "./server";
import type { NetHud, Snapshot, SyncKind } from "./types";

const EMPTY_NET: NetHud = {
  kind: "snapshot",
  rttMs: 0,
  lastAt: 0,
  deltas: 0,
  snapshots: 0,
  diverged: 0,
  inflight: 0,
  localSeq: 0,
  authSeq: 0,
  localHead: GENESIS_HASH,
  authHead: GENESIS_HASH,
};

export function useWorldSync(code: string) {
  const qc = useQueryClient();
  const [net, setNet] = useState<NetHud>(EMPTY_NET);
  const inflight = useRef(0);

  const q = useQuery({
    queryKey: ["world", code],
    queryFn: async (): Promise<Snapshot> => {
      const cur = qc.getQueryData<Snapshot>(["world", code]);
      const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      const frame = await syncWorld({
        data: {
          code,
          sinceSeq: cur?.world.seq ?? 0,
          localHead: cur?.world.headHash ?? GENESIS_HASH,
        },
      });
      const rttMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);

      let next: Snapshot;
      let kind: SyncKind = frame.kind;
      if (!cur || frame.kind === "snapshot" || frame.kind === "diverged") {
        next = frame.snapshot ?? (await getWorld({ data: { code } }));
      } else {
        next = mergeFrame(cur, frame);
        if (frame.kind === "delta" && next.state.headHash !== frame.headHash) {
          kind = "diverged";
          next = (await syncWorld({ data: { code, sinceSeq: 0, localHead: GENESIS_HASH } })).snapshot
            ?? (await getWorld({ data: { code } }));
        }
      }

      setNet((n) => ({
        kind,
        rttMs,
        lastAt: Date.now(),
        deltas: n.deltas + (kind === "delta" || kind === "ack" ? 1 : 0),
        snapshots: n.snapshots + (kind === "snapshot" ? 1 : 0),
        diverged: n.diverged + (kind === "diverged" ? 1 : 0),
        inflight: inflight.current,
        localSeq: next.world.seq,
        authSeq: frame.seq,
        localHead: next.world.headHash,
        authHead: frame.headHash,
      }));
      return next;
    },
    refetchInterval: 400,
  });

  const bumpInflight = (delta: number) => {
    inflight.current = Math.max(0, inflight.current + delta);
    setNet((n) => ({ ...n, inflight: inflight.current }));
  };

  const resync = () => {
    void (async () => {
      const frame = await syncWorld({ data: { code, sinceSeq: 0, localHead: GENESIS_HASH } });
      if (frame.snapshot) qc.setQueryData(["world", code], frame.snapshot);
      setNet((n) => ({
        ...n,
        kind: "snapshot",
        snapshots: n.snapshots + 1,
        localSeq: frame.seq,
        authSeq: frame.seq,
        localHead: frame.headHash,
        authHead: frame.headHash,
      }));
    })();
  };

  useEffect(() => {
    inflight.current = 0;
  }, [code]);

  return { query: q, net, bumpInflight, resync };
}
