"use client";

import { useEffect, useRef, useState } from "react";

export function SignaturePad({
  onSigned,
  defaultName,
  disabled,
}: {
  onSigned: (payload: { method: "typed" | "canvas"; signature_data: string }) => void;
  defaultName?: string;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"typed" | "canvas">("typed");
  const [typed, setTyped] = useState(defaultName || "");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#0b1f3a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, [mode]);

  function pointer(e: React.PointerEvent<HTMLCanvasElement>, type: "down" | "move" | "up") {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const rect = c.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (type === "down") {
      drawing.current = true;
      ctx.beginPath();
      ctx.moveTo(x, y);
    } else if (type === "move" && drawing.current) {
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      drawing.current = false;
    }
  }

  function clearCanvas() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx?.clearRect(0, 0, c.width, c.height);
  }

  function submit() {
    if (disabled) return;
    if (mode === "typed") {
      if (!typed.trim()) return;
      onSigned({ method: "typed", signature_data: typed.trim() });
    } else {
      const c = canvasRef.current;
      if (!c) return;
      onSigned({ method: "canvas", signature_data: c.toDataURL("image/png") });
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex gap-2">
        <button
          type="button"
          className={`btn text-xs ${mode === "typed" ? "btn-navy" : "btn-secondary"}`}
          onClick={() => setMode("typed")}
        >
          Typed name
        </button>
        <button
          type="button"
          className={`btn text-xs ${mode === "canvas" ? "btn-navy" : "btn-secondary"}`}
          onClick={() => setMode("canvas")}
        >
          Draw signature
        </button>
      </div>
      {mode === "typed" ? (
        <input
          className="input font-serif italic text-lg"
          placeholder="Type full name as signature"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={disabled}
        />
      ) : (
        <div>
          <canvas
            ref={canvasRef}
            width={400}
            height={120}
            className="w-full max-w-md touch-none rounded border border-dashed border-slate-300 bg-white"
            onPointerDown={(e) => pointer(e, "down")}
            onPointerMove={(e) => pointer(e, "move")}
            onPointerUp={(e) => pointer(e, "up")}
            onPointerLeave={(e) => pointer(e, "up")}
          />
          <button type="button" className="btn-secondary mt-2 text-xs" onClick={clearCanvas}>
            Clear
          </button>
        </div>
      )}
      <button type="button" className="btn-primary" onClick={submit} disabled={disabled}>
        Apply e-signature
      </button>
    </div>
  );
}
